use super::{validate_folder, Account, FolderKind, MailError, MailFolder, MailHeader, MessageKey};
use async_imap::{
    types::{Flag, NameAttribute},
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
    time::timeout,
};
use tokio_native_tls::{TlsConnector, TlsStream};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const HEADER_QUERY: &str = "(UID FLAGS BODY.PEEK[HEADER]<0.16384>)";
const BODY_QUERY: &str = "(UID RFC822.SIZE BODY.PEEK[]<0.1048577>)";
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
) -> Result<Option<String>, MailError> {
    timeout(REQUEST_TIMEOUT, async {
        let mut session = authenticate(account, password).await?;
        fetch_message(&mut session, folder, key).await
    })
    .await
    .map_err(|_| MailError::Timeout)?
}

async fn authenticate(
    account: &Account,
    password: &str,
) -> Result<Session<TlsStream<TcpStream>>, MailError> {
    let socket = TcpStream::connect((account.host.as_str(), account.port))
        .await
        .map_err(|_| MailError::Network)?;
    let connector = native_tls::TlsConnector::builder()
        .min_protocol_version(Some(Protocol::Tlsv12))
        .build()
        .map_err(|_| MailError::Tls)?;
    let stream = TlsConnector::from(connector)
        .connect(&account.host, socket)
        .await
        .map_err(|_| MailError::Tls)?;
    let mut client = Client::new(stream);
    client
        .read_response()
        .await
        .map_err(|_| MailError::Network)?
        .ok_or(MailError::Network)?;
    client
        .login(&account.email, password)
        .await
        .map_err(|(error, _)| match error {
            async_imap::error::Error::No(_) => MailError::LoginRejected,
            _ => MailError::Network,
        })
}

pub async fn folders(account: &Account, password: &str) -> Result<Vec<MailFolder>, MailError> {
    timeout(REQUEST_TIMEOUT, async {
        let mut session = authenticate(account, password).await?;
        fetch_folders(&mut session).await
    })
    .await
    .map_err(|_| MailError::Timeout)?
}

async fn fetch_folders<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
) -> Result<Vec<MailFolder>, MailError> {
    let mut names = session
        .list(None, Some("\"*\""))
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
) -> Result<Option<String>, MailError> {
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
        result = Ok(MessageParser::default()
            .parse(bytes)
            .and_then(|mail| mail.body_text(0).map(|body| body.into_owned())));
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
            let folders = fetch_folders(&mut session).await.unwrap();
            assert_eq!(folders.iter().map(|folder| (folder.id.as_str(), folder.name.as_str(), folder.kind)).collect::<Vec<_>>(),
                vec![("Parent/Sent", "Parent/Sent", FolderKind::Sent), ("&AOc-", "ç", FolderKind::Custom), ("INBOX", "INBOX", FolderKind::Inbox)]);
            let headers = fetch_folder(&mut session, "Parent/Sent").await.unwrap();
            assert_eq!(headers.len(), 1);
            assert_eq!(headers[0].subject, "Test ç");
            assert!(!headers[0].unread);
            let key = headers[0].key;
            assert_eq!(key, MessageKey { uid_validity: 20, uid: 171 });
            assert_eq!(fetch_message(&mut session, "Parent/Sent", key).await.unwrap().unwrap().trim(), "Example body.");
            assert_eq!(fetch_message(&mut session, "Parent/Sent", MessageKey { uid_validity: 19, ..key }).await, Err(MailError::MailboxChanged));
            fixture.await.unwrap();
        }).await.unwrap() });
    }
}
