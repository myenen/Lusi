use super::{
    validate_folder, Account, FolderKind, MailError, MailFolder, MailHeader, MessageAction,
    MessageKey, OpenedMessage,
};
use async_imap::{
    types::{Capabilities, Capability, Flag, NameAttribute},
    Client, Session,
};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine};
use futures_util::TryStreamExt;
use mail_parser::MessageParser;
use native_tls::Protocol;
use std::time::Duration;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    net::TcpStream,
    time::{timeout, timeout_at, Instant},
};
use tokio_native_tls::{TlsConnector, TlsStream};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const HEADER_QUERY: &str = "(UID FLAGS BODY.PEEK[HEADER]<0.16384>)";
const BODY_QUERY: &str = "(UID FLAGS RFC822.SIZE BODY.PEEK[]<0.1048577>)";
const BODY_LIMIT: usize = 1_048_576;
const WINDOW_SIZE: u32 = 50;

pub async fn inbox(account: &Account, password: &str) -> Result<Vec<MailHeader>, MailError> {
    folder(account, password, "INBOX").await
}

pub async fn folder(
    account: &Account,
    password: &str,
    folder: &str,
) -> Result<Vec<MailHeader>, MailError> {
    timeout(REQUEST_TIMEOUT, async {
        let mut session = authenticate(account, password).await?;
        fetch_folder(&mut session, folder).await
    })
    .await
    .map_err(|_| MailError::Timeout)?
}

pub async fn message(
    account: &Account,
    password: &str,
    folder: &str,
    key: MessageKey,
) -> Result<OpenedMessage, MailError> {
    let deadline = Instant::now() + REQUEST_TIMEOUT;
    let mut session = timeout_at(deadline, authenticate(account, password))
        .await
        .map_err(|_| MailError::Timeout)??;
    open_in_session(&mut session, folder, key, &account.email, deadline).await
}

async fn open_in_session<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    key: MessageKey,
    email: &str,
    deadline: Instant,
) -> Result<OpenedMessage, MailError> {
    let mut message = timeout_at(deadline, fetch_message(session, folder, key, email))
        .await
        .map_err(|_| MailError::Timeout)??;
    if !message.seen {
        match timeout(
            Duration::from_secs(4),
            change_message(session, folder, key, MessageAction::Read, None),
        )
        .await
        {
            Ok(Ok(())) => message.seen = true,
            Ok(Err(error)) => message.seen_error = Some(error),
            Err(_) => message.seen_error = Some(MailError::Timeout),
        }
    }
    Ok(message)
}

pub(super) async fn apply_action(
    account: &Account,
    password: &str,
    folder: &str,
    key: MessageKey,
    action: MessageAction,
) -> Result<(), MailError> {
    timeout(REQUEST_TIMEOUT, async {
        let mut session = authenticate(account, password).await?;
        apply_message_action(&mut session, folder, key, action).await
    })
    .await
    .map_err(|_| MailError::ActionFailed)?
}

async fn apply_message_action<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    key: MessageKey,
    action: MessageAction,
) -> Result<(), MailError> {
    let destination = match action {
        MessageAction::Archive => Some(FolderKind::Archive),
        MessageAction::Trash => Some(FolderKind::Trash),
        MessageAction::Restore => Some(FolderKind::Inbox),
        _ => None,
    };
    let destination = if let Some(kind) = destination {
        let capabilities = session
            .capabilities()
            .await
            .map_err(|_| MailError::ActionFailed)?;
        if !advertises(&capabilities, "MOVE") && !advertises(&capabilities, "IMAP4rev2") {
            return Err(MailError::ActionUnavailable);
        }
        let folders = discover_folders(session, advertises(&capabilities, "SPECIAL-USE")).await?;
        if matches!(action, MessageAction::Restore)
            && !folders
                .iter()
                .any(|entry| entry.id == folder && entry.kind == FolderKind::Trash)
        {
            return Err(MailError::ActionUnavailable);
        }
        let target = folders
            .into_iter()
            .find(|entry| entry.kind == kind)
            .ok_or(MailError::ActionUnavailable)?;
        if target.id == folder
            || (kind == FolderKind::Inbox && folder.eq_ignore_ascii_case("INBOX"))
        {
            return Err(MailError::ActionUnavailable);
        }
        Some(target.id)
    } else {
        None
    };
    change_message(session, folder, key, action, destination.as_deref()).await
}

async fn change_message<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    key: MessageKey,
    action: MessageAction,
    destination: Option<&str>,
) -> Result<(), MailError> {
    let selected = session
        .select(folder)
        .await
        .map_err(|_| MailError::ActionFailed)?;
    if selected.uid_validity != Some(key.uid_validity) {
        return Err(MailError::MailboxChanged);
    }
    let uid = key.uid.to_string();
    {
        let mut matches = session
            .uid_fetch(&uid, "(UID)")
            .await
            .map_err(|_| MailError::ActionFailed)?;
        let mut found = false;
        while let Some(entry) = matches
            .try_next()
            .await
            .map_err(|_| MailError::ActionFailed)?
        {
            found |= entry.uid == Some(key.uid);
        }
        if !found {
            return Err(MailError::MessageMissing);
        }
    }
    let flags = match action {
        MessageAction::Read => "+FLAGS.SILENT (\\Seen)",
        MessageAction::Unread => "-FLAGS.SILENT (\\Seen)",
        MessageAction::Star => "+FLAGS.SILENT (\\Flagged)",
        MessageAction::Unstar => "-FLAGS.SILENT (\\Flagged)",
        MessageAction::Archive | MessageAction::Trash | MessageAction::Restore => {
            return session
                .uid_mv(&uid, destination.ok_or(MailError::ActionUnavailable)?)
                .await
                .map_err(|_| MailError::ActionFailed);
        }
    };
    session
        .run_command_and_check_ok(format!("UID STORE {uid} {flags}"))
        .await
        .map_err(|_| MailError::ActionFailed)
}

async fn authenticate(
    account: &Account,
    password: &str,
) -> Result<Session<TlsStream<TcpStream>>, MailError> {
    let socket = TcpStream::connect((account.host.as_str(), account.port))
        .await
        .map_err(|_| MailError::Network)?;
    let socket = if account.start_tls {
        request_start_tls(socket).await?
    } else {
        socket
    };
    let connector = native_tls::TlsConnector::builder()
        .min_protocol_version(Some(Protocol::Tlsv12))
        .build()
        .map_err(|_| MailError::Tls)?;
    let stream = TlsConnector::from(connector)
        .connect(&account.host, socket)
        .await
        .map_err(|_| MailError::Tls)?;
    let mut client = Client::new(stream);
    if !account.start_tls {
        client
            .read_response()
            .await
            .map_err(|_| MailError::Network)?
            .ok_or(MailError::Network)?;
    }
    client
        .login(account.login(), password)
        .await
        .map_err(|(error, _)| match error {
            async_imap::error::Error::No(_) => MailError::LoginRejected,
            _ => MailError::Network,
        })
}

async fn request_start_tls<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    socket: T,
) -> Result<T, MailError> {
    let mut client = Client::new(socket);
    client
        .read_response()
        .await
        .map_err(|_| MailError::Network)?
        .ok_or(MailError::Network)?;
    client
        .run_command_and_check_ok("STARTTLS", None)
        .await
        .map_err(|_| MailError::Tls)?;
    Ok(client.into_inner())
}

pub async fn folders(account: &Account, password: &str) -> Result<Vec<MailFolder>, MailError> {
    timeout(REQUEST_TIMEOUT, async {
        let mut session = authenticate(account, password).await?;
        let capabilities = session
            .capabilities()
            .await
            .map_err(|_| MailError::Folders)?;
        discover_folders(&mut session, advertises(&capabilities, "SPECIAL-USE")).await
    })
    .await
    .map_err(|_| MailError::Timeout)?
}

fn advertises(capabilities: &Capabilities, name: &str) -> bool {
    capabilities.iter().any(|capability| {
        matches!(capability, Capability::Atom(value) if value.eq_ignore_ascii_case(name))
    })
}

async fn discover_folders<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    special_use: bool,
) -> Result<Vec<MailFolder>, MailError> {
    if special_use {
        let folders = fetch_folders(session, "\"*\" RETURN (SPECIAL-USE)").await?;
        if !folders.is_empty() {
            return Ok(folders);
        }
    }
    fetch_folders(session, "\"*\"").await
}

async fn fetch_folders<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    pattern: &str,
) -> Result<Vec<MailFolder>, MailError> {
    let mut names = session
        .list(None, Some(pattern))
        .await
        .map_err(|_| MailError::Folders)?;
    let mut folders = Vec::new();
    let mut seen = std::collections::HashSet::new();
    while let Some(name) = names.try_next().await.map_err(|_| MailError::Folders)? {
        let raw = name.name();
        if validate_folder(raw).is_err() || name.attributes().contains(&NameAttribute::NoSelect) {
            continue;
        }
        let (id, kind) = if raw.eq_ignore_ascii_case("INBOX") {
            ("INBOX".to_owned(), FolderKind::Inbox)
        } else {
            let kind = name
                .attributes()
                .iter()
                .find_map(|attribute| match attribute {
                    NameAttribute::Sent => Some(FolderKind::Sent),
                    NameAttribute::Drafts => Some(FolderKind::Drafts),
                    NameAttribute::Archive => Some(FolderKind::Archive),
                    NameAttribute::Trash => Some(FolderKind::Trash),
                    NameAttribute::Junk => Some(FolderKind::Junk),
                    NameAttribute::All => Some(FolderKind::All),
                    NameAttribute::Flagged => Some(FolderKind::Flagged),
                    _ => None,
                })
                .unwrap_or(FolderKind::Custom);
            (raw.to_owned(), kind)
        };
        if seen.insert(id.clone()) {
            folders.push(MailFolder {
                id,
                name: decode_folder_name(raw),
                kind,
            });
        }
    }
    Ok(folders)
}

fn decode_folder_name(mut wire: &str) -> String {
    let original = wire;
    let mut name = String::new();
    while let Some((plain, encoded)) = wire.split_once('&') {
        name.push_str(plain);
        let Some((chunk, rest)) = encoded.split_once('-') else {
            return original.into();
        };
        if chunk.is_empty() {
            name.push('&');
        } else {
            let Ok(bytes) = STANDARD_NO_PAD.decode(chunk.replace(',', "/")) else {
                return original.into();
            };
            let (pairs, remainder) = bytes.as_chunks::<2>();
            if !remainder.is_empty() {
                return original.into();
            }
            let utf16: Vec<_> = pairs.iter().copied().map(u16::from_be_bytes).collect();
            let Ok(decoded) = String::from_utf16(&utf16) else {
                return original.into();
            };
            name.push_str(&decoded);
        }
        wire = rest;
    }
    name.push_str(wire);
    name
}

async fn fetch_folder<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
) -> Result<Vec<MailHeader>, MailError> {
    let folder_error = || {
        if folder.eq_ignore_ascii_case("INBOX") {
            MailError::Inbox
        } else {
            MailError::Folder
        }
    };
    let mailbox = session.examine(folder).await.map_err(|_| folder_error())?;
    let uid_validity = mailbox
        .uid_validity
        .filter(|uid| *uid > 0)
        .ok_or_else(folder_error)?;
    if mailbox.exists == 0 {
        return Ok(Vec::new());
    }
    let range = format!(
        "{}:{}",
        mailbox.exists.saturating_sub(WINDOW_SIZE - 1).max(1),
        mailbox.exists
    );
    let mut fetches = session
        .fetch(range, HEADER_QUERY)
        .await
        .map_err(|_| folder_error())?;
    let mut headers = Vec::new();
    let parser = MessageParser::default();
    while let Some(fetch) = fetches.try_next().await.map_err(|_| folder_error())? {
        let Some(uid) = fetch.uid.filter(|uid| *uid > 0) else {
            continue;
        };
        let parsed = fetch
            .header()
            .and_then(|bytes| parser.parse(&bytes[..bytes.len().min(16_384)]));
        let sender = parsed
            .as_ref()
            .and_then(|mail| mail.from())
            .and_then(|address| address.first());
        let sender_name = sender.as_ref().and_then(|value| value.name());
        let sender_address = sender.as_ref().and_then(|value| value.address());
        let subject = parsed.as_ref().and_then(|mail| mail.subject());
        let sent_at = parsed
            .as_ref()
            .and_then(|mail| mail.date())
            .map(|value| value.to_timestamp());
        headers.push(MailHeader {
            key: MessageKey { uid_validity, uid },
            sender: clean_header(
                sender_name
                    .filter(|name| !name.is_empty())
                    .or(sender_address),
                160,
            ),
            address: clean_header(sender_address, 254),
            subject: clean_header(subject, 300),
            sent_at,
            unread: !fetch.flags().any(|flag| flag == Flag::Seen),
            starred: fetch.flags().any(|flag| flag == Flag::Flagged),
        });
        if headers.len() > WINDOW_SIZE as usize {
            return Err(folder_error());
        }
    }
    headers.sort_unstable_by_key(|header| std::cmp::Reverse(header.key.uid));
    headers.dedup_by_key(|header| header.key.uid);
    Ok(headers)
}

async fn fetch_message<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    key: MessageKey,
    email: &str,
) -> Result<OpenedMessage, MailError> {
    let mailbox = session
        .examine(folder)
        .await
        .map_err(|_| MailError::Folder)?;
    if mailbox.uid_validity != Some(key.uid_validity) {
        return Err(MailError::MailboxChanged);
    }
    let mut fetches = session
        .uid_fetch(key.uid.to_string(), BODY_QUERY)
        .await
        .map_err(|_| MailError::Inbox)?;
    let mut result = Err(MailError::MessageMissing);
    while let Some(fetch) = fetches.try_next().await.map_err(|_| MailError::Inbox)? {
        if fetch.uid != Some(key.uid) {
            continue;
        }
        let Some(bytes) = fetch.body() else {
            continue;
        };
        if bytes.len() > BODY_LIMIT || fetch.size.is_some_and(|size| size as usize > BODY_LIMIT) {
            return Err(MailError::MessageTooLarge);
        }
        let (body, html) = super::html::read_body(bytes);
        let summary = super::summary::MessageSummarizer::summarize(body.as_deref(), html.as_ref());
        result = Ok(OpenedMessage {
            body,
            html,
            summary,
            reply: super::reply::details(bytes, email),
            seen: fetch.flags().any(|flag| flag == Flag::Seen),
            seen_error: None,
        });
    }
    result
}

fn clean_header(text: Option<&str>, limit: usize) -> String {
    text.unwrap_or_default()
        .chars()
        .filter(|character| !character.is_control())
        .take(limit)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};

    #[test]
    fn refuses_to_continue_when_the_server_rejects_starttls() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async {
            timeout(Duration::from_secs(5), async {
                let (client, server) = duplex(4096);
                let fixture = tokio::spawn(async move {
                    let mut server = BufReader::new(server);
                    server.get_mut().write_all(b"* OK ready\r\n").await.unwrap();
                    let mut line = String::new();
                    server.read_line(&mut line).await.unwrap();
                    let (tag, command) = line.split_once(' ').unwrap();
                    assert_eq!(command, "STARTTLS\r\n");
                    server
                        .get_mut()
                        .write_all(format!("{tag} NO TLS unavailable\r\n").as_bytes())
                        .await
                        .unwrap();
                    line.clear();
                    assert_eq!(server.read_line(&mut line).await.unwrap(), 0);
                });
                assert_eq!(request_start_tls(client).await.unwrap_err(), MailError::Tls);
                fixture.await.unwrap();
            })
            .await
            .unwrap();
        });
    }

    async fn exchange(server: &mut BufReader<DuplexStream>, expected: &str, response: &str) {
        let mut line = String::new();
        server.read_line(&mut line).await.unwrap();
        let (tag, command) = line.split_once(' ').unwrap();
        assert_eq!(command.trim_end(), expected);
        server
            .get_mut()
            .write_all(format!("{response}{tag} OK completed\r\n").as_bytes())
            .await
            .unwrap();
    }

    #[test]
    fn opens_and_marks_only_the_requested_uid_read() {
        tauri::async_runtime::block_on(async {
            timeout(Duration::from_secs(5), async {
                let (client, server) = duplex(4096);
                let fixture = tokio::spawn(async move {
                    let mut server = BufReader::new(server);
                    exchange(
                        &mut server,
                        r#"LOGIN "mail@example.test" "fixture-only""#,
                        "",
                    )
                    .await;
                    let selected = "* 1 EXISTS\r\n* OK [UIDVALIDITY 20] stable UID namespace\r\n";
                    exchange(&mut server, r#"EXAMINE "INBOX""#, selected).await;
                    let body = "Content-Type: text/plain\r\n\r\nExample body.\r\n";
                    let reply = format!(
                        "* 1 FETCH (UID 17 FLAGS () RFC822.SIZE {} BODY[]<0> {{{}}}\r\n{body})\r\n",
                        body.len(),
                        body.len()
                    );
                    exchange(&mut server, &format!("UID FETCH 17 {BODY_QUERY}"), &reply).await;
                    exchange(&mut server, r#"SELECT "INBOX""#, selected).await;
                    exchange(&mut server, "UID FETCH 17 (UID)", "* 1 FETCH (UID 17)\r\n").await;
                    exchange(&mut server, "UID STORE 17 +FLAGS.SILENT (\\Seen)", "").await;
                });
                let mut session = Client::new(client)
                    .login("mail@example.test", "fixture-only")
                    .await
                    .unwrap();
                let opened = open_in_session(
                    &mut session,
                    "INBOX",
                    MessageKey {
                        uid_validity: 20,
                        uid: 17,
                    },
                    "mail@example.test",
                    Instant::now() + REQUEST_TIMEOUT,
                )
                .await
                .unwrap();
                assert_eq!(opened.body.unwrap().trim(), "Example body.");
                assert!(opened.seen);
                assert_eq!(opened.seen_error, None);
                fixture.await.unwrap();
            })
            .await
            .unwrap();
        });
    }

    #[test]
    fn moves_messages_to_the_server_advertised_trash_and_archive() {
        tauri::async_runtime::block_on(async {
            timeout(Duration::from_secs(5), async {
                let (client, server) = duplex(4096);
                let fixture = tokio::spawn(async move {
                    let mut server = BufReader::new(server);
                    exchange(
                        &mut server,
                        r#"LOGIN "mail@example.test" "fixture-only""#,
                        "",
                    )
                    .await;
                    let selected = "* 1 EXISTS\r\n* OK [UIDVALIDITY 20] stable UID namespace\r\n";
                    for (uid, expected_move) in [
                        (17, r#"UID MOVE 17 "Folders/Deleted items""#),
                        (18, r#"UID MOVE 18 "Folders/Records""#),
                    ] {
                        exchange(
                            &mut server,
                            "CAPABILITY",
                            "* CAPABILITY IMAP4rev1 MOVE SPECIAL-USE\r\n",
                        )
                        .await;
                        exchange(
                            &mut server,
                            r#"LIST "" "*" RETURN (SPECIAL-USE)"#,
                            concat!(
                                r#"* LIST (\Trash) "/" "Folders/Deleted items""#,
                                "\r\n",
                                r#"* LIST (\Archive) "/" "Folders/Records""#,
                                "\r\n",
                            ),
                        )
                        .await;
                        exchange(&mut server, r#"SELECT "INBOX""#, selected).await;
                        exchange(
                            &mut server,
                            &format!("UID FETCH {uid} (UID)"),
                            &format!("* 1 FETCH (UID {uid})\r\n"),
                        )
                        .await;
                        exchange(&mut server, expected_move, "* 1 EXPUNGE\r\n").await;
                    }
                });
                let mut session = Client::new(client)
                    .login("mail@example.test", "fixture-only")
                    .await
                    .unwrap();
                apply_message_action(
                    &mut session,
                    "INBOX",
                    MessageKey {
                        uid_validity: 20,
                        uid: 17,
                    },
                    MessageAction::Trash,
                )
                .await
                .unwrap();
                apply_message_action(
                    &mut session,
                    "INBOX",
                    MessageKey {
                        uid_validity: 20,
                        uid: 18,
                    },
                    MessageAction::Archive,
                )
                .await
                .unwrap();
                fixture.await.unwrap();
            })
            .await
            .unwrap();
        });
    }

    #[test]
    fn checks_uid_validity_and_requires_the_server_to_accept_flag_changes() {
        tauri::async_runtime::block_on(async {
            timeout(Duration::from_secs(5), async {
                let (client, server) = duplex(4096);
                let fixture = tokio::spawn(async move {
                    let mut server = BufReader::new(server);
                    exchange(
                        &mut server,
                        r#"LOGIN "mail@example.test" "fixture-only""#,
                        "",
                    )
                    .await;
                    let selected = "* 1 EXISTS\r\n* OK [UIDVALIDITY 20] stable UID namespace\r\n";
                    exchange(&mut server, r#"SELECT "INBOX""#, selected).await;
                    exchange(&mut server, r#"SELECT "INBOX""#, selected).await;
                    exchange(&mut server, "UID FETCH 17 (UID)", "* 1 FETCH (UID 17)\r\n").await;
                    let mut line = String::new();
                    server.read_line(&mut line).await.unwrap();
                    let (tag, command) = line.split_once(' ').unwrap();
                    assert_eq!(command.trim_end(), "UID STORE 17 +FLAGS.SILENT (\\Flagged)");
                    server
                        .get_mut()
                        .write_all(format!("{tag} NO read-only mailbox\r\n").as_bytes())
                        .await
                        .unwrap();
                });
                let mut session = Client::new(client)
                    .login("mail@example.test", "fixture-only")
                    .await
                    .unwrap();
                let key = MessageKey {
                    uid_validity: 20,
                    uid: 17,
                };
                assert_eq!(
                    change_message(
                        &mut session,
                        "INBOX",
                        MessageKey {
                            uid_validity: 19,
                            ..key
                        },
                        MessageAction::Star,
                        None
                    )
                    .await,
                    Err(MailError::MailboxChanged),
                );
                assert_eq!(
                    change_message(&mut session, "INBOX", key, MessageAction::Star, None).await,
                    Err(MailError::ActionFailed),
                );
                fixture.await.unwrap();
            })
            .await
            .unwrap();
        });
    }

    #[test]
    fn lists_folders_and_reads_a_message_by_uid_without_mutating_flags() {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        runtime.block_on(async { timeout(Duration::from_secs(5), async {
            let (client, server) = duplex(4096);
            let fixture = tokio::spawn(async move {
                let mut server = BufReader::new(server);
                exchange(&mut server, r#"LOGIN "mail@example.test" "fixture-only""#, "").await;
                exchange(&mut server, r#"LIST "" "*""#, concat!(
                    r#"* LIST (\Noselect) "/" Parent"#, "\r\n",
                    r#"* LIST (\Sent) "/" Parent/Sent"#, "\r\n",
                    r#"* LIST () "/" &AOc-"#, "\r\n",
                    r#"* LIST () "/" InBoX"#, "\r\n",
                )).await;
                let examine = "* 63 EXISTS\r\n* OK [UIDVALIDITY 20] stable UID namespace\r\n";
                exchange(&mut server, "EXAMINE \"Parent/Sent\"", examine).await;
                let raw_headers = "From: Sender <sender@example.test>\r\nSubject: =?UTF-8?Q?Test_=C3=A7?=\r\n\r\n";
                exchange(&mut server, &format!("FETCH 14:63 {HEADER_QUERY}"), &format!(
                    "* 63 FETCH (UID 171 FLAGS (\\Seen) BODY[HEADER]<0> {{{}}}\r\n{raw_headers})\r\n", raw_headers.len()
                )).await;
                exchange(&mut server, "EXAMINE \"Parent/Sent\"", examine).await;
                let raw_body = "Content-Type: text/plain; charset=utf-8\r\n\r\nExample body.\r\n";
                exchange(&mut server, &format!("UID FETCH 171 {BODY_QUERY}"), &format!(
                    "* 63 FETCH (UID 171 RFC822.SIZE {} BODY[]<0> {{{}}}\r\n{raw_body})\r\n", raw_body.len(), raw_body.len()
                )).await;
                exchange(&mut server, "EXAMINE \"Parent/Sent\"", examine).await;
            });
            let mut session = Client::new(client).login("mail@example.test", "fixture-only").await.unwrap();
            let folders = discover_folders(&mut session, false).await.unwrap();
            assert_eq!(folders.iter().map(|folder| (folder.id.as_str(), folder.name.as_str(), folder.kind)).collect::<Vec<_>>(),
                vec![("Parent/Sent", "Parent/Sent", FolderKind::Sent), ("&AOc-", "ç", FolderKind::Custom), ("INBOX", "INBOX", FolderKind::Inbox)]);
            let headers = fetch_folder(&mut session, "Parent/Sent").await.unwrap();
            assert_eq!(headers.len(), 1);
            assert_eq!(headers[0].subject, "Test ç");
            assert!(!headers[0].unread);
            let key = headers[0].key;
            assert_eq!(key, MessageKey { uid_validity: 20, uid: 171 });
            assert_eq!(fetch_message(&mut session, "Parent/Sent", key, "mail@example.test").await.unwrap().body.unwrap().trim(), "Example body.");
            assert_eq!(fetch_message(&mut session, "Parent/Sent", MessageKey { uid_validity: 19, ..key }, "mail@example.test").await, Err(MailError::MailboxChanged));
            fixture.await.unwrap();
        }).await.unwrap() });
    }
}
