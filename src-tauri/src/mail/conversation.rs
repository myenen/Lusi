use super::{
    foreground_imap, imap, reply::valid_id, validate_folder, AccountId, FolderKind, MailError,
    MailFolder, MailHeader, MessageKey,
};
use async_imap::{types::Fetch, Session};
use futures_util::TryStreamExt;
use mail_parser::{Message, MessageParser};
use serde::Serialize;
use std::collections::HashSet;
use std::fmt::Debug;
use std::time::Duration;
use tauri::AppHandle;
use tokio::{
    io::{AsyncRead, AsyncWrite},
    time::{timeout_at, Instant},
};

const QUERY: &str = "(UID FLAGS BODY.PEEK[HEADER]<0.16384>)";
const MAX_FOLDERS: usize = 8;
const MAX_MATCHES_PER_FOLDER: usize = 100;

#[derive(Serialize)]
pub struct Conversation {
    entries: Vec<ConversationEntry>,
    limited: bool,
}

#[derive(Serialize)]
struct ConversationEntry {
    folder: MailFolder,
    header: MailHeader,
}

#[tauri::command]
pub async fn read_conversation(
    app: AppHandle,
    account_id: AccountId,
    folder: String,
    key: MessageKey,
) -> Result<Conversation, MailError> {
    validate_folder(&folder)?;
    if key.uid == 0 || key.uid_validity == 0 {
        return Err(MailError::MessageMissing);
    }

    let deadline = Instant::now() + Duration::from_secs(12);
    foreground_imap(&app, account_id, Some(deadline), async |connection| {
        timeout_at(
            deadline,
            find_conversation(&mut connection.session, &folder, key),
        )
        .await
        .map_err(|_| MailError::Timeout)?
    })
    .await
}

async fn find_conversation<T: AsyncRead + AsyncWrite + Unpin + Send + Debug>(
    session: &mut Session<T>,
    folder: &str,
    key: MessageKey,
) -> Result<Conversation, MailError> {
    let mailbox = session
        .examine(folder)
        .await
        .map_err(|_| MailError::Folder)?;
    if mailbox.uid_validity != Some(key.uid_validity) {
        return Err(MailError::MailboxChanged);
    }
    let anchor = {
        let mut fetches = session
            .uid_fetch(key.uid.to_string(), QUERY)
            .await
            .map_err(|_| MailError::Folder)?;
        let mut anchor = None;
        while let Some(fetch) = fetches.try_next().await.map_err(|_| MailError::Folder)? {
            if fetch.uid == Some(key.uid) {
                anchor = Some(fetch);
            }
        }
        anchor.ok_or(MailError::MessageMissing)?
    };
    let parser = MessageParser::default();
    let mut conversation = Conversation {
        entries: Vec::new(),
        limited: false,
    };
    let Some(message) = parse_headers(&parser, &anchor) else {
        return Ok(conversation);
    };
    let ids = conversation_ids(&message);
    if ids.is_empty() {
        return Ok(conversation);
    }

    let capabilities = session
        .capabilities()
        .await
        .map_err(|_| MailError::Folders)?;
    let folders =
        imap::discover_folders(session, imap::advertises(&capabilities, "SPECIAL-USE")).await?;
    let folders = searchable_folders(folders, folder);
    let search = search_query(&ids);
    let mut seen = message
        .message_id()
        .and_then(valid_id)
        .map(str::to_owned)
        .into_iter()
        .collect::<HashSet<_>>();
    conversation.limited = folders.len() > MAX_FOLDERS || ids.len() > 10;
    for source in folders.iter().take(MAX_FOLDERS) {
        let selected = (source.id == folder).then_some(key);
        let (matches, limited) = folder_matches(session, &source.id, selected, &search).await?;
        conversation.limited |= limited;
        for (key, fetch) in matches {
            let Some(message) = parse_headers(&parser, &fetch) else {
                continue;
            };
            if !conversation_ids(&message).iter().any(|id| ids.contains(id)) {
                continue;
            }
            if let Some(id) = message.message_id().and_then(valid_id) {
                if !seen.insert(id.to_owned()) {
                    continue;
                }
            }
            conversation.entries.push(ConversationEntry {
                folder: source.clone(),
                header: imap::header_from_fetch(&parser, &fetch, key),
            });
        }
    }
    if !conversation.entries.is_empty() || conversation.limited {
        let anchor_folder = folders.into_iter().next().ok_or(MailError::Folder)?;
        conversation.entries.push(ConversationEntry {
            folder: anchor_folder,
            header: imap::header_from_fetch(&parser, &anchor, key),
        });
    }
    conversation.entries.sort_by(|a, b| {
        (
            a.header.sent_at.unwrap_or(i64::MAX),
            &a.folder.id,
            a.header.key.uid,
        )
            .cmp(&(
                b.header.sent_at.unwrap_or(i64::MAX),
                &b.folder.id,
                b.header.key.uid,
            ))
    });
    Ok(conversation)
}

async fn folder_matches<T: AsyncRead + AsyncWrite + Unpin + Send + Debug>(
    session: &mut Session<T>,
    folder: &str,
    selected: Option<MessageKey>,
    search: &str,
) -> Result<(Vec<(MessageKey, Fetch)>, bool), MailError> {
    let mailbox = session
        .examine(folder)
        .await
        .map_err(|_| MailError::Folder)?;
    let uid_validity = mailbox
        .uid_validity
        .filter(|value| *value > 0)
        .ok_or(MailError::Folder)?;
    if selected.is_some_and(|key| key.uid_validity != uid_validity) {
        return Err(MailError::MailboxChanged);
    }
    if mailbox.exists == 0 {
        return Ok((Vec::new(), false));
    }
    let mut uids: Vec<_> = session
        .uid_search(search)
        .await
        .map_err(|_| MailError::Folder)?
        .into_iter()
        .filter(|uid| *uid > 0 && selected.is_none_or(|key| *uid != key.uid))
        .collect();
    uids.sort_unstable_by_key(|uid| std::cmp::Reverse(*uid));
    let limited = uids.len() > MAX_MATCHES_PER_FOLDER;
    uids.truncate(MAX_MATCHES_PER_FOLDER);
    if uids.is_empty() {
        return Ok((Vec::new(), limited));
    }
    let requested = uids.iter().copied().collect::<HashSet<_>>();
    let uid_set = uids
        .into_iter()
        .map(|uid| uid.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let mut fetches = session
        .uid_fetch(uid_set, QUERY)
        .await
        .map_err(|_| MailError::Folder)?;
    let mut matches = Vec::new();
    let mut returned = HashSet::new();
    while let Some(fetch) = fetches.try_next().await.map_err(|_| MailError::Folder)? {
        if let Some(uid) = fetch
            .uid
            .filter(|uid| requested.contains(uid) && returned.insert(*uid))
        {
            matches.push((MessageKey { uid, uid_validity }, fetch));
        }
    }
    Ok((matches, limited))
}

fn parse_headers<'a>(parser: &MessageParser, fetch: &'a Fetch) -> Option<Message<'a>> {
    let bytes = fetch.header()?;
    parser.parse_headers(&bytes[..bytes.len().min(16_384)])
}

fn conversation_ids<'a>(message: &'a Message<'_>) -> Vec<&'a str> {
    let mut seen = HashSet::new();
    message
        .message_id()
        .into_iter()
        .chain(message.references().into_iter().flat_map(|ids| ids.iter()))
        .chain(message.in_reply_to().into_iter().flat_map(|ids| ids.iter()))
        .filter_map(valid_id)
        .filter(|id| seen.insert(*id))
        .collect()
}

fn search_query(ids: &[&str]) -> String {
    let terms = ids
        .iter()
        .take(2)
        .chain(ids.iter().skip(2).rev().take(8))
        .flat_map(|id| {
            let escaped = id.replace('\\', "\\\\").replace('"', "\\\"");
            ["Message-ID", "References", "In-Reply-To"]
                .map(|field| format!("HEADER {field} \"<{escaped}>\""))
        })
        .collect::<Vec<_>>();
    format!(
        "{}{}",
        "OR ".repeat(terms.len().saturating_sub(1)),
        terms.join(" ")
    )
}

fn searchable_folders(folders: Vec<MailFolder>, current: &str) -> Vec<MailFolder> {
    let mut primary = None;
    let mut searchable = Vec::new();
    for folder in folders {
        if folder.id == current {
            primary = Some(folder);
        } else if matches!(
            folder.kind,
            FolderKind::Inbox | FolderKind::Sent | FolderKind::All | FolderKind::Archive
        ) {
            searchable.push(folder);
        }
    }
    searchable.sort_by_key(|folder| match folder.kind {
        FolderKind::Sent => 0,
        FolderKind::Inbox => 1,
        FolderKind::All => 2,
        _ => 3,
    });
    searchable.insert(
        0,
        primary.unwrap_or_else(|| MailFolder {
            id: current.to_owned(),
            name: current.to_owned(),
            kind: FolderKind::Custom,
        }),
    );
    searchable
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_imap::Client;
    use tokio::io::{duplex, AsyncBufReadExt, AsyncWriteExt, BufReader, DuplexStream};

    async fn exchange(server: &mut BufReader<DuplexStream>, expected: &str, reply: &str) {
        let mut line = String::new();
        server.read_line(&mut line).await.unwrap();
        let (tag, command) = line.split_once(' ').unwrap();
        assert_eq!(command.trim_end(), expected);
        server
            .get_mut()
            .write_all(format!("{reply}{tag} OK complete\r\n").as_bytes())
            .await
            .unwrap();
    }

    fn header(uid: u32, text: &str) -> String {
        format!(
            "* 1 FETCH (UID {uid} FLAGS (\\Seen) BODY[HEADER]<0> {{{}}}\r\n{text})\r\n",
            text.len()
        )
    }

    #[tokio::test]
    async fn returns_inbox_and_sent_in_date_order_and_filters_false_matches_and_copies() {
        let (client, server) = duplex(4096);
        let original = "From: Deniz <deniz@example.test>\r\nDate: Thu, 1 Jan 2026 10:00:00 +0000\r\nMessage-ID: <root@example.test>\r\nSubject: Request\r\n\r\n";
        let outgoing = "From: Me <me@example.test>\r\nDate: Thu, 1 Jan 2026 11:00:00 +0000\r\nMessage-ID: <reply@example.test>\r\nIn-Reply-To: <root@example.test>\r\nSubject: Re: Request\r\n\r\n";
        let unrelated = "From: Other <other@example.test>\r\nMessage-ID: <other@example.test>\r\nReferences: <unrelated-root@example.test>\r\nSubject: Re: Request\r\n\r\n";
        let fixture = tokio::spawn(async move {
            let mut server = BufReader::new(server);
            exchange(&mut server, r#"LOGIN "me@example.test" "fixture""#, "").await;
            let inbox = "* 2 EXISTS\r\n* OK [UIDVALIDITY 5] stable\r\n";
            let search = r#"UID SEARCH OR OR HEADER Message-ID "<root@example.test>" HEADER References "<root@example.test>" HEADER In-Reply-To "<root@example.test>""#;
            exchange(&mut server, r#"EXAMINE "INBOX""#, inbox).await;
            exchange(
                &mut server,
                &format!("UID FETCH 17 {QUERY}"),
                &header(17, original),
            )
            .await;
            exchange(&mut server, "CAPABILITY", "* CAPABILITY IMAP4rev1\r\n").await;
            exchange(
                &mut server,
                r#"LIST "" "*""#,
                "* LIST (\\Sent) \"/\" Out\r\n* LIST (\\All) \"/\" All\r\n",
            )
            .await;
            exchange(&mut server, r#"EXAMINE "INBOX""#, inbox).await;
            exchange(&mut server, search, "* SEARCH 17 18\r\n").await;
            exchange(
                &mut server,
                &format!("UID FETCH 18 {QUERY}"),
                &header(18, unrelated),
            )
            .await;
            exchange(
                &mut server,
                r#"EXAMINE "Out""#,
                "* 1 EXISTS\r\n* OK [UIDVALIDITY 9] stable\r\n",
            )
            .await;
            exchange(&mut server, search, "* SEARCH 82\r\n").await;
            exchange(
                &mut server,
                &format!("UID FETCH 82 {QUERY}"),
                &header(82, outgoing),
            )
            .await;
            exchange(
                &mut server,
                r#"EXAMINE "All""#,
                "* 2 EXISTS\r\n* OK [UIDVALIDITY 10] stable\r\n",
            )
            .await;
            exchange(&mut server, search, "* SEARCH 91 92\r\n").await;
            exchange(
                &mut server,
                &format!("UID FETCH 92,91 {QUERY}"),
                &(header(91, original) + &header(92, outgoing)),
            )
            .await;
        });
        let mut session = Client::new(client)
            .login("me@example.test", "fixture")
            .await
            .unwrap();
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            find_conversation(
                &mut session,
                "INBOX",
                MessageKey {
                    uid_validity: 5,
                    uid: 17,
                },
            ),
        )
        .await
        .unwrap()
        .unwrap();
        let keys: Vec<_> = result
            .entries
            .iter()
            .map(|entry| (entry.folder.id.as_str(), entry.header.key.uid))
            .collect();
        assert_eq!(keys, [("INBOX", 17), ("Out", 82)]);
        assert!(!result.limited);
        fixture.await.unwrap();
    }
}
