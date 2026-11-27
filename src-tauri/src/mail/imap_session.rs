use super::{imap::ActionFolders, AccountId, MailError};
use async_imap::Session;
use std::{
    fmt::Debug,
    sync::atomic::{AtomicU64, Ordering},
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
    sync::Mutex,
    time::{timeout, Instant},
};
use tokio_native_tls::TlsStream;

const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(20);
const PROBE_TIMEOUT: Duration = Duration::from_secs(2);
const REUSE_WINDOW: Duration = Duration::from_secs(120);

pub(crate) type ImapSessions = SessionCache<TlsStream<TcpStream>>;
pub(super) type ImapConnection = Connection<TlsStream<TcpStream>>;

pub(super) struct Connection<T: AsyncRead + AsyncWrite + Unpin + Debug> {
    pub session: Session<T>,
    pub email: String,
    pub reusable: bool,
    pub(super) action_folders: Option<ActionFolders>,
}

struct CachedConnection<T: AsyncRead + AsyncWrite + Unpin + Debug> {
    account: AccountId,
    generation: u64,
    used_at: Instant,
    connection: Connection<T>,
}

pub(crate) struct SessionCache<T: AsyncRead + AsyncWrite + Unpin + Debug> {
    slot: Mutex<Option<CachedConnection<T>>>,
    generation: AtomicU64,
}

impl<T: AsyncRead + AsyncWrite + Unpin + Debug> Default for SessionCache<T> {
    fn default() -> Self {
        Self {
            slot: Mutex::new(None),
            generation: AtomicU64::new(0),
        }
    }
}

impl<T: AsyncRead + AsyncWrite + Unpin + Send + Debug> SessionCache<T> {
    pub(super) fn clear(&self) {
        self.generation.fetch_add(1, Ordering::AcqRel);
        if let Ok(mut slot) = self.slot.try_lock() {
            *slot = None;
        }
    }

    pub(super) async fn run<R>(
        &self,
        account: AccountId,
        acquire_deadline: Option<Instant>,
        connect: impl AsyncFnOnce() -> Result<(String, Session<T>), MailError>,
        operation: impl AsyncFnOnce(&mut Connection<T>) -> Result<R, MailError>,
    ) -> Result<R, MailError> {
        let deadline = Instant::now() + ACQUIRE_TIMEOUT;
        let deadline = acquire_deadline.map_or(deadline, |requested| requested.min(deadline));
        let (mut slot, generation, mut connection) = tokio::time::timeout_at(deadline, async {
            let mut slot = self.slot.lock().await;
            let generation = self.generation.load(Ordering::Acquire);
            if let Some(mut cached) = slot.take() {
                if cached.account == account
                    && cached.generation == generation
                    && cached.used_at.elapsed() < REUSE_WINDOW
                    // Probe before any command that could change server state.
                    && matches!(
                        timeout(PROBE_TIMEOUT, cached.connection.session.run_command_and_check_ok("NOOP")).await,
                        Ok(Ok(()))
                    )
                {
                    return Ok((slot, generation, cached.connection));
                }
            }
            let (email, session) = connect().await?;
            Ok((slot, generation, Connection { session, email, reusable: true, action_folders: None }))
        })
        .await
        .map_err(|_| MailError::Timeout)??;

        // The slot stays empty if a command errors, times out, or is cancelled.
        let result = operation(&mut connection).await;
        if result.is_ok()
            && connection.reusable
            && self.generation.load(Ordering::Acquire) == generation
        {
            while connection.session.unsolicited_responses.try_recv().is_ok() {}
            *slot = Some(CachedConnection {
                account,
                generation,
                used_at: Instant::now(),
                connection,
            });
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_imap::Client;
    use tokio::{
        io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream},
        task::JoinHandle,
    };

    async fn fixture(
        fixtures: &mut Vec<JoinHandle<()>>,
        email: &str,
        commands: &[(&str, bool)],
    ) -> Result<(String, Session<DuplexStream>), MailError> {
        let (client, server) = duplex(1024);
        let mut steps = vec![(format!("LOGIN \"{email}\" \"fixture\""), true)];
        steps.extend(
            commands
                .iter()
                .map(|(command, reply)| (command.to_string(), *reply)),
        );
        fixtures.push(tokio::spawn(async move {
            let mut server = BufReader::new(server);
            for (expected, reply) in steps {
                let mut line = String::new();
                server.read_line(&mut line).await.unwrap();
                let (tag, command) = line.trim_end().split_once(' ').unwrap();
                assert_eq!(command, expected);
                if reply {
                    server
                        .get_mut()
                        .write_all(format!("{tag} OK completed\r\n").as_bytes())
                        .await
                        .unwrap();
                }
            }
        }));
        let session = Client::new(client)
            .login(email, "fixture")
            .await
            .map_err(|_| MailError::LoginRejected)?;
        Ok((email.to_string(), session))
    }

    #[test]
    fn reuses_a_session_for_the_same_account_and_never_replays_a_move() {
        tauri::async_runtime::block_on(async {
            timeout(Duration::from_secs(5), async {
                let cache = SessionCache::default();
                let mut fixtures = Vec::new();
                let email = "first@example.test";
                let move_command = r#"UID MOVE 17 "Trash""#;
                cache
                    .run(
                        1,
                        None,
                        async || {
                            fixture(
                                &mut fixtures,
                                email,
                                &[("NOOP", true), (move_command, false)],
                            )
                            .await
                        },
                        async |connection| Ok(connection.email.clone()),
                    )
                    .await
                    .unwrap();

                assert_eq!(
                    cache
                        .run(
                            1,
                            None,
                            async || panic!("same account should reuse its socket"),
                            async |connection| connection
                                .session
                                .run_command_and_check_ok(move_command)
                                .await
                                .map_err(|_| MailError::ActionFailed),
                        )
                        .await,
                    Err(MailError::ActionFailed)
                );

                assert_eq!(
                    cache
                        .run(
                            1,
                            None,
                            async || fixture(&mut fixtures, email, &[]).await,
                            async |connection| Ok(connection.email.clone()),
                        )
                        .await
                        .unwrap(),
                    email
                );
                for fixture in fixtures {
                    fixture.await.unwrap();
                }
            })
            .await
            .unwrap();
        });
    }

    #[test]
    fn reconnects_on_failed_probe_and_isolates_accounts() {
        tauri::async_runtime::block_on(async {
            timeout(Duration::from_secs(5), async {
                let cache = SessionCache::default();
                let mut fixtures = Vec::new();
                let first = "first@example.test";
                let second = "second@example.test";
                cache
                    .run(
                        1,
                        None,
                        async || fixture(&mut fixtures, first, &[("NOOP", false)]).await,
                        async |_| Ok(()),
                    )
                    .await
                    .unwrap();
                cache
                    .run(
                        1,
                        None,
                        async || fixture(&mut fixtures, first, &[]).await,
                        async |_| Ok(()),
                    )
                    .await
                    .unwrap();
                assert_eq!(
                    cache
                        .run(
                            2,
                            None,
                            async || fixture(&mut fixtures, second, &[]).await,
                            async |connection| Ok(connection.email.clone()),
                        )
                        .await
                        .unwrap(),
                    second
                );

                // Reauthorization may happen while a command owns the connection.
                cache
                    .run(
                        1,
                        None,
                        async || fixture(&mut fixtures, first, &[]).await,
                        async |_| {
                            cache.clear();
                            Ok(())
                        },
                    )
                    .await
                    .unwrap();
                assert!(cache.slot.lock().await.is_none());
                for fixture in fixtures {
                    fixture.await.unwrap();
                }
            })
            .await
            .unwrap();
        });
    }
}
