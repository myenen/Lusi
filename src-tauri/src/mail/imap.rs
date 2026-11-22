use super::{
    attachments, validate_folder, Account, BatchActionResult, FolderKind, MailAuth, MailError,
    MailFolder, MailHeader, MessageAction, MessageKey, OlderMessages, OpenedMessage,
};
use async_imap::{
    imap_proto::SectionPath,
    types::{Capabilities, Capability, Flag, NameAttribute},
    Authenticator, Client, Session,
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
const HEADER_QUERY: &str = "(UID FLAGS BODYSTRUCTURE BODY.PEEK[HEADER]<0.16384>)";
const BODY_QUERY: &str = "(UID FLAGS BODYSTRUCTURE RFC822.SIZE BODY.PEEK[]<0.1048577>)";
const BODY_LIMIT: usize = 1_048_576;
pub(super) const WINDOW_SIZE: u32 = 50;

pub async fn inbox(
    account: &Account,
    auth: &MailAuth,
) -> Result<(Vec<MailHeader>, Option<u32>), MailError> {
    let (mut session, headers) = timeout(REQUEST_TIMEOUT, async {
        let mut session = authenticate(account, auth).await?;
        let headers = fetch_folder(&mut session, "INBOX").await?;
        Ok::<_, MailError>((session, headers))
    })
    .await
    .map_err(|_| MailError::Timeout)??;
    let unread = inbox_unread(&mut session, Some("INBOX")).await;
    Ok((headers, unread))
}

pub(super) async fn fetch_inbox_unread(account: &Account, auth: &MailAuth) -> Option<u32> {
    let mut session = timeout(REQUEST_TIMEOUT, authenticate(account, auth))
        .await
        .ok()?
        .ok()?;
    inbox_unread(&mut session, None).await
}

async fn inbox_unread<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    selected: Option<&str>,
) -> Option<u32> {
    timeout(Duration::from_secs(2), async {
        if selected.is_some_and(|folder| folder.eq_ignore_ascii_case("INBOX")) {
            // UNSELECT never expunges mail. Older servers can still answer STATUS directly.
            let _ = session.run_command_and_check_ok("UNSELECT").await;
        }
        session.status("INBOX", "(UNSEEN)").await.ok()?.unseen
    })
    .await
    .ok()
    .flatten()
}

pub async fn folder(
    account: &Account,
    auth: &MailAuth,
    folder: &str,
) -> Result<Vec<MailHeader>, MailError> {
    timeout(REQUEST_TIMEOUT, async {
        let mut session = authenticate(account, auth).await?;
        fetch_folder(&mut session, folder).await
    })
    .await
    .map_err(|_| MailError::Timeout)?
}

pub(super) async fn older_messages(
    account: &Account,
    auth: &MailAuth,
    folder: &str,
    before: MessageKey,
) -> Result<OlderMessages, MailError> {
    timeout(REQUEST_TIMEOUT, async {
        let mut session = authenticate(account, auth).await?;
        fetch_older_messages(&mut session, folder, before).await
    })
    .await
    .map_err(|_| MailError::Timeout)?
}

pub async fn message(
    account: &Account,
    auth: &MailAuth,
    folder: &str,
    key: MessageKey,
) -> Result<(OpenedMessage, Option<u32>), MailError> {
    let deadline = Instant::now() + REQUEST_TIMEOUT;
    let mut session = timeout_at(deadline, authenticate(account, auth))
        .await
        .map_err(|_| MailError::Timeout)??;
    let (message, marked_read) =
        open_in_session(&mut session, folder, key, &account.email, deadline).await?;
    let unread = if marked_read {
        inbox_unread(&mut session, Some(folder)).await
    } else {
        None
    };
    Ok((message, unread))
}

pub(super) async fn download_attachment(
    account: &Account,
    auth: &MailAuth,
    folder: &str,
    key: MessageKey,
    part: Vec<u32>,
) -> Result<(attachments::Attachment, Vec<u8>), MailError> {
    timeout(REQUEST_TIMEOUT * 3, async {
        let mut session = authenticate(account, auth).await?;
        fetch_attachment(&mut session, folder, key, part).await
    })
    .await
    .map_err(|_| MailError::Timeout)?
}

async fn fetch_attachment<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    key: MessageKey,
    part: Vec<u32>,
) -> Result<(attachments::Attachment, Vec<u8>), MailError> {
    let mailbox = session
        .examine(folder)
        .await
        .map_err(|_| MailError::Folder)?;
    if mailbox.uid_validity != Some(key.uid_validity) {
        return Err(MailError::MailboxChanged);
    }
    let uid = key.uid.to_string();
    let selected = {
        let mut fetches = session
            .uid_fetch(&uid, "(UID BODYSTRUCTURE)")
            .await
            .map_err(|_| MailError::AttachmentUnavailable)?;
        let mut selected = None;
        while let Some(fetch) = fetches
            .try_next()
            .await
            .map_err(|_| MailError::AttachmentUnavailable)?
        {
            if fetch.uid == Some(key.uid) {
                if let Some(structure) = fetch.bodystructure() {
                    selected =
                        attachments::list(structure).find(|entry| entry.attachment.part == part);
                }
            }
        }
        selected.ok_or(MailError::AttachmentUnavailable)?
    };
    let encoding = selected.encoding.ok_or(MailError::AttachmentUnavailable)?;
    let wire_limit = attachments::wire_limit(encoding);
    let expected_size = selected.octets as usize;
    if expected_size > wire_limit {
        return Err(MailError::AttachmentTooLarge);
    }
    let section = part
        .iter()
        .map(u32::to_string)
        .collect::<Vec<_>>()
        .join(".");
    let query = format!("(UID BODY.PEEK[{section}]<0.{}>)", expected_size + 1);
    let section = SectionPath::Part(part, None);
    let mut fetches = session
        .uid_fetch(uid, query)
        .await
        .map_err(|_| MailError::AttachmentUnavailable)?;
    let mut data = None;
    while let Some(fetch) = fetches
        .try_next()
        .await
        .map_err(|_| MailError::AttachmentUnavailable)?
    {
        if fetch.uid == Some(key.uid) {
            if let Some(bytes) = fetch.section(&section) {
                if bytes.len() > wire_limit {
                    return Err(MailError::AttachmentTooLarge);
                }
                if bytes.len() != expected_size {
                    return Err(MailError::AttachmentUnavailable);
                }
                data = Some(attachments::decode(bytes, encoding)?);
            }
        }
    }
    Ok((
        selected.attachment,
        data.ok_or(MailError::AttachmentUnavailable)?,
    ))
}

async fn open_in_session<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    key: MessageKey,
    email: &str,
    deadline: Instant,
) -> Result<(OpenedMessage, bool), MailError> {
    let mut message = timeout_at(deadline, fetch_message(session, folder, key, email))
        .await
        .map_err(|_| MailError::Timeout)??;
    let was_unread = !message.seen;
    if was_unread {
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
    let marked_read = was_unread && message.seen;
    Ok((message, marked_read))
}

pub(super) async fn apply_action(
    account: &Account,
    auth: &MailAuth,
    folder: &str,
    key: MessageKey,
    action: MessageAction,
    action_timeout: Option<Duration>,
) -> Result<Option<u32>, MailError> {
    let mut session = timeout(action_timeout.unwrap_or(REQUEST_TIMEOUT), async {
        let mut session = authenticate(account, auth).await?;
        apply_message_action(&mut session, folder, key, action).await?;
        Ok::<_, MailError>(session)
    })
    .await
    .map_err(|_| {
        if action_timeout.is_some() {
            MailError::Timeout
        } else {
            MailError::ActionFailed
        }
    })??;
    Ok(if action.affects_unread_count() {
        inbox_unread(&mut session, Some(folder)).await
    } else {
        None
    })
}

async fn apply_message_action<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    key: MessageKey,
    action: MessageAction,
) -> Result<(), MailError> {
    let destination = action_destination(session, folder, action).await?;
    change_message(session, folder, key, action, destination.as_deref()).await
}

pub(super) async fn apply_batch(
    account: &Account,
    auth: &MailAuth,
    folder: &str,
    keys: &[MessageKey],
    action: MessageAction,
) -> Result<(BatchActionResult, Option<u32>), MailError> {
    let first = keys.first().ok_or(MailError::InvalidSettings)?;
    let deadline = Instant::now() + REQUEST_TIMEOUT * 2;
    let (mut session, destination) = timeout_at(deadline, async {
        let mut session = authenticate(account, auth).await?;
        let destination = action_destination(&mut session, folder, action).await?;
        select_action_folder(&mut session, folder, first.uid_validity).await?;
        Ok::<_, MailError>((session, destination))
    })
    .await
    .map_err(|_| MailError::ActionFailed)??;
    let result =
        change_selected_batch(&mut session, keys, action, destination.as_deref(), deadline).await;
    let unread = if !result.updated.is_empty() && action.affects_unread_count() {
        inbox_unread(&mut session, Some(folder)).await
    } else {
        None
    };
    Ok((result, unread))
}

async fn change_selected_batch<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    keys: &[MessageKey],
    action: MessageAction,
    destination: Option<&str>,
    deadline: Instant,
) -> BatchActionResult {
    let mut updated = Vec::with_capacity(keys.len());
    for &key in keys {
        let result = timeout_at(
            deadline,
            change_selected_message(session, key.uid, action, destination),
        )
        .await
        .unwrap_or(Err(MailError::ActionFailed));
        if let Err(error) = result {
            return BatchActionResult {
                updated,
                error: Some(error),
            };
        }
        updated.push(key);
    }
    BatchActionResult {
        updated,
        error: None,
    }
}

async fn action_destination<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    action: MessageAction,
) -> Result<Option<String>, MailError> {
    let destination = match action {
        MessageAction::Archive => Some(FolderKind::Archive),
        MessageAction::Trash => Some(FolderKind::Trash),
        MessageAction::Restore => Some(FolderKind::Inbox),
        _ => None,
    };
    if let Some(kind) = destination {
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
        Ok(Some(target.id))
    } else {
        Ok(None)
    }
}

async fn change_message<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    key: MessageKey,
    action: MessageAction,
    destination: Option<&str>,
) -> Result<(), MailError> {
    select_action_folder(session, folder, key.uid_validity).await?;
    change_selected_message(session, key.uid, action, destination).await
}

async fn select_action_folder<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    uid_validity: u32,
) -> Result<(), MailError> {
    let selected = session
        .select(folder)
        .await
        .map_err(|_| MailError::ActionFailed)?;
    if selected.uid_validity != Some(uid_validity) {
        return Err(MailError::MailboxChanged);
    }
    Ok(())
}

async fn change_selected_message<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    uid_number: u32,
    action: MessageAction,
    destination: Option<&str>,
) -> Result<(), MailError> {
    let uid = uid_number.to_string();
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
            found |= entry.uid == Some(uid_number);
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
    auth: &MailAuth,
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
    let session = match auth {
        MailAuth::Password(password) => client.login(account.login(), password.as_str()).await,
        MailAuth::OAuth(token) => {
            client
                .authenticate(
                    "XOAUTH2",
                    Xoauth2 {
                        user: account.login(),
                        token,
                        sent: false,
                    },
                )
                .await
        }
    };
    session.map_err(|(error, _)| match error {
        async_imap::error::Error::No(_) => MailError::LoginRejected,
        _ => MailError::Network,
    })
}

struct Xoauth2<'a> {
    user: &'a str,
    token: &'a str,
    sent: bool,
}

impl Authenticator for Xoauth2<'_> {
    type Response = zeroize::Zeroizing<Vec<u8>>;

    fn process(&mut self, challenge: &[u8]) -> Self::Response {
        // Gmail sends an error challenge after a rejected token and expects an empty reply.
        if self.sent || !challenge.is_empty() {
            return zeroize::Zeroizing::new(Vec::new());
        }
        self.sent = true;
        zeroize::Zeroizing::new(
            format!("user={}\x01auth=Bearer {}\x01\x01", self.user, self.token).into_bytes(),
        )
    }
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

pub async fn folders(account: &Account, auth: &MailAuth) -> Result<Vec<MailFolder>, MailError> {
    timeout(REQUEST_TIMEOUT, async {
        let mut session = authenticate(account, auth).await?;
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
    let folder_error = || list_error(folder);
    let mailbox = session.examine(folder).await.map_err(|_| folder_error())?;
    let uid_validity = mailbox
        .uid_validity
        .filter(|uid| *uid > 0)
        .ok_or_else(folder_error)?;
    if mailbox.exists == 0 {
        return Ok(Vec::new());
    }
    let start = mailbox.exists.saturating_sub(WINDOW_SIZE - 1).max(1);
    fetch_headers(session, folder, uid_validity, start, mailbox.exists, None).await
}

async fn fetch_older_messages<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    before: MessageKey,
) -> Result<OlderMessages, MailError> {
    let mailbox = session
        .examine(folder)
        .await
        .map_err(|_| list_error(folder))?;
    if mailbox.uid_validity != Some(before.uid_validity) {
        return Err(MailError::MailboxChanged);
    }
    let end = if mailbox.exists == 0 || before.uid == 1 {
        0
    } else {
        older_sequence(session, folder, before.uid, mailbox.exists).await?
    };
    if end == 0 {
        return Ok(OlderMessages {
            headers: Vec::new(),
            next_before: None,
        });
    }
    let start = end.saturating_sub(WINDOW_SIZE - 1).max(1);
    let headers = fetch_headers(
        session,
        folder,
        before.uid_validity,
        start,
        end,
        Some(before.uid),
    )
    .await?;
    let next_before = if start > 1 {
        Some(headers.last().ok_or_else(|| list_error(folder))?.key)
    } else {
        None
    };
    Ok(OlderMessages {
        headers,
        next_before,
    })
}

async fn older_sequence<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    before_uid: u32,
    exists: u32,
) -> Result<u32, MailError> {
    {
        let mut records = session
            .uid_fetch(before_uid.to_string(), "(UID)")
            .await
            .map_err(|_| list_error(folder))?;
        let mut sequence = None;
        while let Some(record) = records.try_next().await.map_err(|_| list_error(folder))? {
            if record.uid == Some(before_uid) {
                sequence = Some(record.message);
            }
        }
        if let Some(sequence) = sequence {
            return Ok(sequence.saturating_sub(1));
        }
    }
    // A deleted anchor has no sequence number. UIDs still increase with sequence number.
    let (mut low, mut high) = (0, exists);
    while low < high {
        let mid = low + (high - low).div_ceil(2);
        let mut records = session
            .fetch(mid.to_string(), "(UID)")
            .await
            .map_err(|_| list_error(folder))?;
        let mut uid = None;
        while let Some(record) = records.try_next().await.map_err(|_| list_error(folder))? {
            if record.message == mid {
                uid = record.uid;
            }
        }
        if uid.ok_or_else(|| list_error(folder))? < before_uid {
            low = mid;
        } else {
            high = mid - 1;
        }
    }
    Ok(low)
}

fn list_error(folder: &str) -> MailError {
    if folder.eq_ignore_ascii_case("INBOX") {
        MailError::Inbox
    } else {
        MailError::Folder
    }
}

async fn fetch_headers<T: AsyncRead + AsyncWrite + Unpin + Send + std::fmt::Debug>(
    session: &mut Session<T>,
    folder: &str,
    uid_validity: u32,
    start: u32,
    end: u32,
    before_uid: Option<u32>,
) -> Result<Vec<MailHeader>, MailError> {
    let folder_error = || list_error(folder);
    let mut fetches = session
        .fetch(format!("{start}:{end}"), HEADER_QUERY)
        .await
        .map_err(|_| folder_error())?;
    let mut headers = Vec::new();
    let parser = MessageParser::default();
    while let Some(fetch) = fetches.try_next().await.map_err(|_| folder_error())? {
        let Some(uid) = fetch
            .uid
            .filter(|uid| *uid > 0 && before_uid.is_none_or(|before| *uid < before))
        else {
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
            has_attachments: fetch
                .bodystructure()
                .is_some_and(|structure| attachments::list(structure).next().is_some()),
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
        let body_truncated =
            bytes.len() > BODY_LIMIT || fetch.size.is_some_and(|size| size as usize > BODY_LIMIT);
        let bytes = &bytes[..bytes.len().min(BODY_LIMIT)];
        let (body, html) = super::html::read_body(bytes);
        let attachments = fetch
            .bodystructure()
            .map(|structure| {
                attachments::list(structure)
                    .map(|entry| entry.attachment)
                    .collect()
            })
            .unwrap_or_default();
        let summary = super::summary::MessageSummarizer::summarize(body.as_deref(), html.as_ref());
        result = Ok(OpenedMessage {
            content: super::MessageContent {
                body,
                body_truncated,
                html,
                attachments,
                summary,
                reply: super::reply::details(bytes, email),
            },
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
    fn xoauth2_sends_the_token_once_and_empties_the_error_challenge() {
        let mut auth = Xoauth2 {
            user: "fixture@gmail.com",
            token: "fixture-token",
            sent: false,
        };
        assert_eq!(
            auth.process(b"").as_slice(),
            b"user=fixture@gmail.com\x01auth=Bearer fixture-token\x01\x01"
        );
        assert!(auth.process(br#"{"status":"401"}"#).is_empty());
    }

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
    fn pages_by_uid_even_after_the_anchor_is_deleted() {
        tauri::async_runtime::block_on(async {
            timeout(Duration::from_secs(5), async {
                let (client, server) = duplex(16_384);
                let fixture = tokio::spawn(async move {
                    let mut server = BufReader::new(server);
                    exchange(
                        &mut server,
                        r#"LOGIN "mail@example.test" "fixture-only""#,
                        "",
                    )
                    .await;
                    exchange(
                        &mut server,
                        r#"EXAMINE "INBOX""#,
                        "* 125 EXISTS\r\n* OK [UIDVALIDITY 20] stable\r\n",
                    )
                    .await;
                    exchange(
                        &mut server,
                        "UID FETCH 240 (UID)",
                        "* 76 FETCH (UID 240)\r\n",
                    )
                    .await;
                    let rows: String = (26..=75)
                        .map(|seq| format!("* {seq} FETCH (UID {} FLAGS ())\r\n", seq * 3))
                        .collect();
                    exchange(&mut server, &format!("FETCH 26:75 {HEADER_QUERY}"), &rows).await;
                    exchange(
                        &mut server,
                        r#"EXAMINE "INBOX""#,
                        "* 3 EXISTS\r\n* OK [UIDVALIDITY 20] stable\r\n",
                    )
                    .await;
                    exchange(&mut server, "UID FETCH 78 (UID)", "").await;
                    exchange(&mut server, "FETCH 2 (UID)", "* 2 FETCH (UID 75)\r\n").await;
                    exchange(&mut server, "FETCH 3 (UID)", "* 3 FETCH (UID 240)\r\n").await;
                    exchange(
                        &mut server,
                        &format!("FETCH 1:2 {HEADER_QUERY}"),
                        "* 1 FETCH (UID 8 FLAGS ())\r\n* 2 FETCH (UID 75 FLAGS ())\r\n",
                    )
                    .await;
                    exchange(
                        &mut server,
                        r#"EXAMINE "INBOX""#,
                        "* 2 EXISTS\r\n* OK [UIDVALIDITY 21] changed\r\n",
                    )
                    .await;
                });
                let mut session = Client::new(client)
                    .login("mail@example.test", "fixture-only")
                    .await
                    .unwrap();
                let page = fetch_older_messages(
                    &mut session,
                    "INBOX",
                    MessageKey {
                        uid_validity: 20,
                        uid: 240,
                    },
                )
                .await
                .unwrap();
                assert_eq!(page.headers.len(), WINDOW_SIZE as usize);
                assert_eq!(page.headers[0].key.uid, 225);
                let next = page.next_before.unwrap();
                assert_eq!(next.uid, 78);
                let last = fetch_older_messages(&mut session, "INBOX", next)
                    .await
                    .unwrap();
                assert_eq!(
                    last.headers
                        .iter()
                        .map(|header| header.key.uid)
                        .collect::<Vec<_>>(),
                    [75, 8]
                );
                assert!(last.next_before.is_none());
                assert!(matches!(
                    fetch_older_messages(&mut session, "INBOX", next).await,
                    Err(MailError::MailboxChanged)
                ));
                fixture.await.unwrap();
            })
            .await
            .unwrap();
        });
    }

    #[test]
    fn lists_and_downloads_attachments_by_uid_and_part_without_fetching_inline_images() {
        tauri::async_runtime::block_on(async {
            timeout(Duration::from_secs(5), async {
                let (client, server) = duplex(4096);
                let fixture = tokio::spawn(async move {
                    let mut server = BufReader::new(server);
                    exchange(&mut server, r#"LOGIN "mail@example.test" "fixture-only""#, "").await;
                    let selected = "* 1 EXISTS\r\n* OK [UIDVALIDITY 20] stable UID namespace\r\n";
                    let structure = concat!(
                        r#"((("TEXT" "HTML" NIL NIL NIL "7BIT" 4 1)"#,
                        r#"("IMAGE" "PNG" ("NAME" "logo.png") "<logo>" NIL "BASE64" 8 NIL ("INLINE" ("FILENAME" "logo.png"))) "RELATED")"#,
                        r#"("APPLICATION" "PDF" NIL NIL NIL "BASE64" 8 NIL ("ATTACHMENT" ("FILENAME" "price.pdf"))) "MIXED")"#,
                    );
                    exchange(&mut server, r#"EXAMINE "INBOX""#, selected).await;
                    exchange(&mut server, &format!("FETCH 1:1 {HEADER_QUERY}"),
                        &format!("* 1 FETCH (UID 17 FLAGS (\\Seen) BODYSTRUCTURE {structure})\r\n")).await;
                    exchange(&mut server, r#"EXAMINE "INBOX""#, selected).await;
                    let body = "Content-Type: text/plain\r\n\r\nExample body.\r\n";
                    exchange(&mut server, &format!("UID FETCH 17 {BODY_QUERY}"), &format!(
                        "* 1 FETCH (UID 17 BODYSTRUCTURE {structure} RFC822.SIZE {} BODY[]<0> {{{}}}\r\n{body})\r\n",
                        BODY_LIMIT + 2, body.len()
                    )).await;
                    for _ in 0..2 {
                        exchange(&mut server, r#"EXAMINE "INBOX""#, selected).await;
                        exchange(&mut server, "UID FETCH 17 (UID BODYSTRUCTURE)",
                            &format!("* 1 FETCH (UID 17 BODYSTRUCTURE {structure})\r\n")).await;
                    }
                    exchange(&mut server, "UID FETCH 17 (UID BODY.PEEK[2]<0.9>)",
                        "* 1 FETCH (UID 17 BODY[2]<0> {8}\r\nUERGAA==)\r\n").await;
                });
                let mut session = Client::new(client).login("mail@example.test", "fixture-only").await.unwrap();
                let key = MessageKey { uid_validity: 20, uid: 17 };
                assert!(fetch_folder(&mut session, "INBOX").await.unwrap()[0].has_attachments);
                let message = fetch_message(&mut session, "INBOX", key, "mail@example.test").await.unwrap();
                assert!(message.content.body_truncated);
                assert_eq!(message.content.attachments.len(), 1);
                assert_eq!(message.content.attachments[0].part, [2]);
                assert_eq!(serde_json::to_value(&message.content.attachments[0]).unwrap()["name"], "price.pdf");
                assert_eq!(fetch_attachment(&mut session, "INBOX", key, vec![1, 2]).await, Err(MailError::AttachmentUnavailable));
                assert_eq!(fetch_attachment(&mut session, "INBOX", key, vec![2]).await.unwrap().1, b"PDF\0");
                fixture.await.unwrap();
            }).await.unwrap();
        });
    }

    #[test]
    fn a_batch_reports_only_the_changes_confirmed_before_a_missing_uid() {
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
                    exchange(
                        &mut server,
                        r#"SELECT "INBOX""#,
                        "* 2 EXISTS\r\n* OK [UIDVALIDITY 20] stable UID namespace\r\n",
                    )
                    .await;
                    exchange(&mut server, "UID FETCH 17 (UID)", "* 1 FETCH (UID 17)\r\n").await;
                    exchange(&mut server, "UID STORE 17 +FLAGS.SILENT (\\Seen)", "").await;
                    exchange(&mut server, "UID FETCH 18 (UID)", "").await;
                    let mut line = String::new();
                    assert_eq!(server.read_line(&mut line).await.unwrap(), 0);
                });
                let mut session = Client::new(client)
                    .login("mail@example.test", "fixture-only")
                    .await
                    .unwrap();
                let keys = [17, 18, 19].map(|uid| MessageKey {
                    uid_validity: 20,
                    uid,
                });
                select_action_folder(&mut session, "INBOX", 20)
                    .await
                    .unwrap();
                let result = change_selected_batch(
                    &mut session,
                    &keys,
                    MessageAction::Read,
                    None,
                    Instant::now() + REQUEST_TIMEOUT,
                )
                .await;
                assert_eq!(result.updated, keys[..1]);
                assert_eq!(result.error, Some(MailError::MessageMissing));
                drop(session);
                fixture.await.unwrap();
            })
            .await
            .unwrap();
        });
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
                    exchange(&mut server, "UNSELECT", "").await;
                    exchange(
                        &mut server,
                        r#"STATUS "INBOX" (UNSEEN)"#,
                        "* STATUS INBOX (UNSEEN 78)\r\n",
                    )
                    .await;
                });
                let mut session = Client::new(client)
                    .login("mail@example.test", "fixture-only")
                    .await
                    .unwrap();
                let (opened, marked_read) = open_in_session(
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
                assert_eq!(opened.content.body.unwrap().trim(), "Example body.");
                assert!(opened.seen);
                assert_eq!(opened.seen_error, None);
                assert!(marked_read);
                assert_eq!(inbox_unread(&mut session, Some("INBOX")).await, Some(78));
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
            assert_eq!(fetch_message(&mut session, "Parent/Sent", key, "mail@example.test").await.unwrap().content.body.unwrap().trim(), "Example body.");
            assert_eq!(fetch_message(&mut session, "Parent/Sent", MessageKey { uid_validity: 19, ..key }, "mail@example.test").await, Err(MailError::MailboxChanged));
            fixture.await.unwrap();
        }).await.unwrap() });
    }
}
