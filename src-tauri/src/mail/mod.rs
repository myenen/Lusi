mod attachments;
mod credentials;
pub mod discovery;
mod gmail;
mod html;
mod imap;
pub(crate) mod notifications;
mod reply;
mod search;
mod setup_diagnostics;
mod smtp;
mod storage;
mod summary;
pub(crate) mod sync;

use crate::unread_badge::UnreadBadge;
use serde::{Deserialize, Serialize};
use smtp::{OutgoingMessage, SmtpSettings};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

pub(crate) use attachments::AttachmentPreviews;
pub use gmail::GmailSession;
use search::{SearchPage, SearchRequest};

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MailError {
    InvalidSettings,
    OAuthRequired,
    GoogleNotConfigured,
    GoogleSignIn,
    GoogleBrowser,
    GoogleConsent,
    GoogleAccountMismatch,
    GoogleGrantExpired,
    AlreadyConnected,
    NoAccount,
    Storage,
    Credentials,
    LegacyCredentials,
    Network,
    Tls,
    Timeout,
    LoginRejected,
    SmtpSettings,
    SmtpTls,
    SmtpLoginRejected,
    SmtpUnavailable,
    NoSmtp,
    InvalidMessage,
    SendRejected,
    SendUncertain,
    ActionUnavailable,
    ActionFailed,
    Inbox,
    Folders,
    Folder,
    MailboxChanged,
    MessageMissing,
    AttachmentUnavailable,
    AttachmentTooLarge,
    AttachmentSave,
    AttachmentOpen,
    AttachmentOpenUnsupported,
}

#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Account {
    email: String,
    host: String,
    port: u16,
    username: Option<String>,
    #[serde(default, rename = "startTls")]
    start_tls: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageKey {
    uid_validity: u32,
    uid: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailHeader {
    key: MessageKey,
    sender: String,
    address: String,
    subject: String,
    sent_at: Option<i64>,
    unread: bool,
    starred: bool,
    has_attachments: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OlderMessages {
    headers: Vec<MailHeader>,
    next_before: Option<MessageKey>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inbox {
    account_id: AccountId,
    email: String,
    headers: Vec<MailHeader>,
    can_send: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    oauth_provider: Option<discovery::OAuthProvider>,
}

type AccountId = i64;

#[derive(Serialize)]
pub struct ConnectedAccount {
    id: AccountId,
    email: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedMessage {
    #[serde(flatten)]
    content: MessageContent,
    seen: bool,
    seen_error: Option<MailError>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MessageContent {
    body: Option<String>,
    body_truncated: bool,
    html: Option<html::HtmlBody>,
    attachments: Vec<attachments::Attachment>,
    summary: Option<summary::MessageSummary>,
    reply: Option<reply::ReplyDetails>,
}

#[derive(Debug, Serialize)]
pub struct BatchActionResult {
    updated: Vec<MessageKey>,
    error: Option<MailError>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MessageAction {
    Read,
    Unread,
    Star,
    Unstar,
    Archive,
    Trash,
    Restore,
}

impl MessageAction {
    fn affects_unread_count(self) -> bool {
        !matches!(self, Self::Star | Self::Unstar)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FolderKind {
    Inbox,
    Sent,
    Drafts,
    Archive,
    Trash,
    Junk,
    All,
    Flagged,
    Custom,
}

#[derive(Debug, Serialize)]
pub struct MailFolder {
    id: String,
    name: String,
    kind: FolderKind,
}

#[derive(Default)]
pub struct MailOperations(Mutex<()>);

enum MailAuth {
    Password(Zeroizing<String>),
    OAuth(Zeroizing<String>),
}

impl MailAuth {
    fn secret(&self) -> &str {
        match self {
            Self::Password(secret) | Self::OAuth(secret) => secret,
        }
    }
}

impl Account {
    fn uses_gmail_oauth(&self) -> bool {
        address_domain(&self.email).is_ok_and(discovery::is_gmail_domain)
    }

    fn validated(mut self) -> Result<Self, MailError> {
        self.email = self.email.trim().to_owned();
        self.host = self.host.trim().to_ascii_lowercase();
        validate_address(&self.email)?;
        if self.port == 0
            || !valid_hostname(&self.host)
            || self.username.as_ref().is_some_and(|login| {
                login.trim().is_empty() || login.len() > 254 || login.chars().any(char::is_control)
            })
        {
            return Err(MailError::InvalidSettings);
        }
        if [
            "gmail.com",
            "googlemail.com",
            "outlook.com",
            "office365.com",
            "outlook.office.com",
        ]
        .iter()
        .any(|suffix| {
            self.host == *suffix
                || self
                    .host
                    .strip_suffix(suffix)
                    .is_some_and(|prefix| prefix.ends_with('.'))
        }) {
            return Err(MailError::OAuthRequired);
        }
        Ok(self)
    }

    fn login(&self) -> &str {
        self.username.as_deref().unwrap_or(&self.email)
    }

    fn legacy_credential(&self) -> Result<keyring::Entry, MailError> {
        keyring::Entry::new(
            "dev.minimalmail.desktop.imap",
            &format!("{}:{}/{}", self.host, self.port, self.email),
        )
        .map_err(|_| MailError::LegacyCredentials)
    }
}

fn address_domain(email: &str) -> Result<&str, MailError> {
    let email = email.trim();
    let (local, domain) = email.split_once('@').ok_or(MailError::InvalidSettings)?;
    if email.len() > 254
        || local.is_empty()
        || local.len() > 64
        || !local.bytes().all(|byte| byte.is_ascii_graphic())
        || !valid_hostname(domain)
    {
        return Err(MailError::InvalidSettings);
    }
    Ok(domain)
}

fn validate_address(email: &str) -> Result<(), MailError> {
    let domain = address_domain(email)?;
    if discovery::is_gmail_domain(domain)
        || ["outlook.com", "hotmail.com", "live.com", "msn.com"]
            .iter()
            .any(|provider| domain.eq_ignore_ascii_case(provider))
    {
        return Err(MailError::OAuthRequired);
    }
    Ok(())
}

fn valid_hostname(host: &str) -> bool {
    host.len() <= 253
        && host.contains('.')
        && host.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        })
}

fn data_directory(app: &AppHandle) -> Result<PathBuf, MailError> {
    app.path()
        .app_local_data_dir()
        .map_err(|_| MailError::Storage)
}

async fn database<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce(&mut rusqlite::Connection, &Path) -> Result<T, MailError> + Send + 'static,
) -> Result<T, MailError> {
    let directory = data_directory(app)?;
    tauri::async_runtime::spawn_blocking(move || {
        task(
            &mut storage::open(&directory.join("mail.sqlite3"))?,
            &directory,
        )
    })
    .await
    .map_err(|_| MailError::Storage)?
}

async fn update_unread_badge(app: &AppHandle, count: Option<(AccountId, u32)>) {
    let handle = app.clone();
    let _ = database(app, move |db, _| {
        if let Some((account, unread)) = count {
            storage::remember_unread(db, account, unread)?;
        }
        handle
            .state::<UnreadBadge>()
            .publish(&handle, || storage::active_unread(db));
        Ok(())
    })
    .await;
}

#[tauri::command]
pub fn check_imap_settings(account: Account, outgoing: SmtpSettings) -> Result<(), MailError> {
    let account = account.validated()?;
    outgoing.validated(&account.email).map(|_| ())
}

#[tauri::command]
pub async fn load_connected_inbox(app: AppHandle) -> Result<Option<Inbox>, MailError> {
    let inbox = database(&app, |db, _| storage::snapshot(db)).await?;
    update_unread_badge(&app, None).await;
    Ok(inbox)
}

#[tauri::command]
pub async fn list_connected_accounts(app: AppHandle) -> Result<Vec<ConnectedAccount>, MailError> {
    database(&app, |db, _| storage::list_accounts(db)).await
}

#[tauri::command]
pub async fn switch_connected_account(
    app: AppHandle,
    account_id: AccountId,
) -> Result<Inbox, MailError> {
    let inbox = database(&app, move |db, _| storage::select_account(db, account_id)).await?;
    update_unread_badge(&app, None).await;
    app.state::<sync::InboxSync>().request_refresh();
    Ok(inbox)
}

#[tauri::command]
pub async fn connect_imap_account(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    account: Account,
    outgoing: SmtpSettings,
    password: String,
) -> Result<Inbox, MailError> {
    let auth = MailAuth::Password(Zeroizing::new(password));
    let password = auth.secret();
    let account = account.validated()?;
    let outgoing = outgoing.validated(&account.email)?;
    if password.is_empty() || password.len() > 1024 || password.chars().any(char::is_control) {
        return Err(MailError::InvalidSettings);
    }
    let _operation = operations.0.lock().await;
    let email = account.email.clone();
    if database(&app, move |db, _| storage::find_account(db, &email))
        .await?
        .is_some()
    {
        return Err(MailError::AlreadyConnected);
    }
    setup_diagnostics::record(format_args!("imap start"));
    let (headers, unread) = imap::inbox(&account, &auth).await.inspect_err(|error| {
        setup_diagnostics::record(format_args!("imap failed category={error:?}"));
    })?;
    setup_diagnostics::record(format_args!("imap ok"));
    smtp::verify(&outgoing, &account.email, &auth).await?;
    let result = database(&app, move |db, directory| {
        storage::save_new_account(db, directory, account, &outgoing, auth.secret(), headers)
    })
    .await;
    setup_diagnostics::record(format_args!("storage ok={}", result.is_ok()));
    let inbox = result?;
    update_unread_badge(&app, unread.map(|count| (inbox.account_id, count))).await;
    app.state::<sync::InboxSync>().request_refresh();
    Ok(inbox)
}

#[tauri::command]
pub async fn connect_gmail_account(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    email: String,
    reconnect_account_id: Option<AccountId>,
) -> Result<Inbox, MailError> {
    let _operation = operations.0.lock().await;
    let requested_email = email.trim().to_owned();
    let existing = database(&app, move |db, _| {
        storage::find_account(db, &requested_email)
    })
    .await?;
    match (&existing, reconnect_account_id) {
        (Some(account), Some(id)) if account.id == id => {}
        (Some(_), _) => return Err(MailError::AlreadyConnected),
        (None, Some(_)) => return Err(MailError::NoAccount),
        (None, None) => {}
    }
    let authorized = gmail::authorize(email.trim()).await?;
    let email = existing.map_or(authorized.email, |account| account.email);
    let (account, outgoing) = discovery::gmail_servers(&email);
    let auth = MailAuth::OAuth(authorized.access.value.clone());
    let (headers, unread) = imap::inbox(&account, &auth).await?;
    smtp::verify(&outgoing, &account.email, &auth).await?;
    let refresh = authorized.refresh;
    let save = database(&app, move |db, _| {
        storage::save_gmail_account(db, account, reconnect_account_id, headers, |email| {
            gmail::store_refresh(email, &refresh)
        })
    });
    let inbox = app
        .state::<GmailSession>()
        .save_authorized(email, authorized.access, save)
        .await?;
    update_unread_badge(&app, unread.map(|count| (inbox.account_id, count))).await;
    app.state::<sync::InboxSync>().request_refresh();
    Ok(inbox)
}

#[tauri::command]
pub async fn refresh_connected_inbox(
    app: AppHandle,
    account_id: AccountId,
) -> Result<Inbox, MailError> {
    sync::refresh(&app, account_id, false).await
}

#[tauri::command]
pub async fn list_connected_folders(
    app: AppHandle,
    account_id: AccountId,
) -> Result<Vec<MailFolder>, MailError> {
    let (account, auth) = stored_connection(&app, account_id).await?;
    imap::folders(&account, &auth).await
}

#[tauri::command]
pub async fn read_connected_folder(
    app: AppHandle,
    account_id: AccountId,
    folder: String,
) -> Result<Vec<MailHeader>, MailError> {
    validate_folder(&folder)?;
    let (account, auth) = stored_connection(&app, account_id).await?;
    imap::folder(&account, &auth, &folder).await
}

#[tauri::command]
pub async fn read_older_connected_messages(
    app: AppHandle,
    account_id: AccountId,
    folder: String,
    before: MessageKey,
) -> Result<OlderMessages, MailError> {
    validate_folder(&folder)?;
    if before.uid == 0 || before.uid_validity == 0 {
        return Err(MailError::MessageMissing);
    }
    let (account, auth) = stored_connection(&app, account_id).await?;
    imap::older_messages(&account, &auth, &folder, before).await
}

#[tauri::command]
pub async fn search_connected_messages(
    app: AppHandle,
    account_id: AccountId,
    folder: String,
    mut request: SearchRequest,
) -> Result<SearchPage, MailError> {
    validate_folder(&folder)?;
    request.validate()?;
    let (account, auth) = stored_connection(&app, account_id).await?;
    imap::search_messages(&account, &auth, &folder, &request).await
}

fn validate_folder(folder: &str) -> Result<(), MailError> {
    if folder.is_empty() || folder.len() > 4096 || folder.chars().any(char::is_control) {
        return Err(MailError::InvalidSettings);
    }
    Ok(())
}

async fn stored_connection(
    app: &AppHandle,
    account_id: AccountId,
) -> Result<(Account, MailAuth), MailError> {
    let (account, password) = database(app, move |db, directory| {
        let account = storage::account(db, account_id)?.ok_or(MailError::NoAccount)?;
        if account.uses_gmail_oauth() {
            return Ok((discovery::gmail_servers(&account.email).0, None));
        }
        let (account, password) =
            storage::connection_details(db, directory, account_id, Account::legacy_credential)?;
        Ok((account, Some(password)))
    })
    .await?;
    let auth = match password {
        Some(password) => MailAuth::Password(password),
        None => MailAuth::OAuth(app.state::<GmailSession>().access(&account.email).await?),
    };
    Ok((account, auth))
}

#[tauri::command]
pub async fn read_connected_message(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    account_id: AccountId,
    folder: String,
    key: MessageKey,
    unread: bool,
) -> Result<OpenedMessage, MailError> {
    validate_folder(&folder)?;
    if key.uid == 0 || key.uid_validity == 0 {
        return Err(MailError::MessageMissing);
    }
    let _operation = operations.0.lock().await;
    let is_inbox = folder.eq_ignore_ascii_case("INBOX");
    let cache_folder = folder.clone();
    let cached = database(&app, move |db, _| {
        storage::cached_message(db, account_id, &cache_folder, key)
    })
    .await
    .ok()
    .flatten();
    let (message, unread_count) = if let Some(content) = cached {
        let mut opened = OpenedMessage {
            content,
            seen: !unread,
            seen_error: None,
        };
        let mut unread_count = None;
        if unread {
            let result = async {
                let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(4);
                let (account, auth) =
                    tokio::time::timeout_at(deadline, stored_connection(&app, account_id))
                        .await
                        .map_err(|_| MailError::Timeout)??;
                let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
                imap::apply_action(
                    &account,
                    &auth,
                    &folder,
                    key,
                    MessageAction::Read,
                    Some(remaining),
                )
                .await
            }
            .await;
            match result {
                Ok(count) => {
                    opened.seen = true;
                    unread_count = count;
                }
                Err(error @ (MailError::MailboxChanged | MailError::MessageMissing)) => {
                    let _ = database(&app, move |db, _| {
                        storage::remove_cached_message(db, account_id, &folder, key)
                    })
                    .await;
                    return Err(error);
                }
                Err(error) => opened.seen_error = Some(error),
            }
        }
        (opened, unread_count)
    } else {
        let (account, auth) = stored_connection(&app, account_id).await?;
        let (opened, unread_count) = imap::message(&account, &auth, &folder, key).await?;
        if let Ok(payload) = serde_json::to_vec(&opened.content) {
            let _ = database(&app, move |db, _| {
                storage::save_message(db, account_id, &folder, key, &payload)
            })
            .await;
        }
        (opened, unread_count)
    };
    if is_inbox && (message.seen || !message.content.attachments.is_empty()) {
        let seen = message.seen;
        let has_attachments = !message.content.attachments.is_empty();
        let _ = database(&app, move |db, _| {
            storage::record_opened_message(db, account_id, key, seen, has_attachments)
        })
        .await;
    }
    if let Some(count) = unread_count {
        update_unread_badge(&app, Some((account_id, count))).await;
    }
    Ok(message)
}

#[tauri::command]
pub async fn download_connected_attachment(
    app: AppHandle,
    account_id: AccountId,
    folder: String,
    key: MessageKey,
    part: Vec<u32>,
) -> Result<attachments::DownloadResult, MailError> {
    let downloads = app
        .path()
        .download_dir()
        .map_err(|_| MailError::AttachmentSave)?;
    let (attachment, bytes) =
        get_connected_attachment(&app, account_id, &folder, key, part).await?;
    tauri::async_runtime::spawn_blocking(move || {
        attachments::save_download(&downloads, &attachment, &bytes, attachments::launch)
    })
    .await
    .map_err(|_| MailError::AttachmentSave)?
}

#[tauri::command]
pub async fn open_connected_attachment(
    app: AppHandle,
    account_id: AccountId,
    folder: String,
    key: MessageKey,
    part: Vec<u32>,
) -> Result<(), MailError> {
    let (attachment, bytes) =
        get_connected_attachment(&app, account_id, &folder, key, part).await?;
    tauri::async_runtime::spawn_blocking(move || {
        app.state::<AttachmentPreviews>().open(&attachment, &bytes)
    })
    .await
    .map_err(|_| MailError::AttachmentOpen)?
}

async fn get_connected_attachment(
    app: &AppHandle,
    account_id: AccountId,
    folder: &str,
    key: MessageKey,
    part: Vec<u32>,
) -> Result<(attachments::Attachment, Vec<u8>), MailError> {
    validate_folder(folder)?;
    if key.uid_validity == 0
        || key.uid == 0
        || part.is_empty()
        || part.len() > attachments::MAX_PART_DEPTH
        || part.contains(&0)
    {
        return Err(MailError::AttachmentUnavailable);
    }
    let (account, auth) = stored_connection(app, account_id).await?;
    imap::download_attachment(&account, &auth, folder, key, part).await
}

#[tauri::command]
pub async fn send_connected_message(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    account_id: AccountId,
    message: OutgoingMessage,
) -> Result<SentCopyStatus, MailError> {
    let _operation = operations.0.lock().await;
    let (email, settings, password) = database(&app, move |db, directory| {
        let account = storage::account(db, account_id)?.ok_or(MailError::NoAccount)?;
        if account.uses_gmail_oauth() {
            let outgoing = discovery::gmail_servers(&account.email).1;
            return Ok((account.email, outgoing, None));
        }
        let (email, settings, password) = storage::outgoing_connection(db, directory, account_id)?;
        Ok((email, settings, Some(password)))
    })
    .await?;
    let auth = match password {
        Some(password) => MailAuth::Password(password),
        None => MailAuth::OAuth(app.state::<GmailSession>().access(&email).await?),
    };
    let sent = smtp::send(&settings, &email, &auth, message).await?;
    if matches!(auth, MailAuth::OAuth(_)) {
        return Ok(SentCopyStatus::ProviderManaged);
    }
    // A Sent-folder failure must never prompt the user to retry an accepted SMTP submission.
    let saved = match stored_connection(&app, account_id).await {
        Ok((account, auth)) => imap::save_sent_copy(&account, &auth, &sent).await.is_ok(),
        Err(_) => false,
    };
    Ok(if saved {
        SentCopyStatus::Saved
    } else {
        SentCopyStatus::Unavailable
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SentCopyStatus {
    Saved,
    ProviderManaged,
    Unavailable,
}

#[tauri::command]
pub async fn update_connected_message(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    account_id: AccountId,
    folder: String,
    key: MessageKey,
    action: MessageAction,
) -> Result<(), MailError> {
    validate_folder(&folder)?;
    if key.uid == 0 || key.uid_validity == 0 {
        return Err(MailError::MessageMissing);
    }
    let _operation = operations.0.lock().await;
    let (account, auth) = stored_connection(&app, account_id).await?;
    let unread = imap::apply_action(&account, &auth, &folder, key, action, None).await?;
    // The server already accepted the action. A cache error must not prompt a retry.
    let _ = database(&app, move |db, _| {
        let transaction = db.transaction().map_err(|_| MailError::Storage)?;
        storage::apply_cached_action(&transaction, account_id, &folder, key, action)?;
        transaction.commit().map_err(|_| MailError::Storage)
    })
    .await;
    if let Some(unread) = unread {
        update_unread_badge(&app, Some((account_id, unread))).await;
    }
    Ok(())
}

#[tauri::command]
pub async fn update_connected_messages(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    account_id: AccountId,
    folder: String,
    keys: Vec<MessageKey>,
    action: MessageAction,
) -> Result<BatchActionResult, MailError> {
    validate_folder(&folder)?;
    let first = keys.first().ok_or(MailError::InvalidSettings)?;
    let mut unique = std::collections::HashSet::new();
    if keys.len() > imap::WINDOW_SIZE as usize
        || first.uid_validity == 0
        || keys.iter().any(|key| {
            key.uid == 0 || key.uid_validity != first.uid_validity || !unique.insert(key.uid)
        })
    {
        return Err(MailError::InvalidSettings);
    }
    let _operation = operations.0.lock().await;
    let (account, auth) = stored_connection(&app, account_id).await?;
    let (result, unread) = imap::apply_batch(&account, &auth, &folder, &keys, action).await?;
    if !result.updated.is_empty() {
        let updated = result.updated.clone();
        // A cache failure must not turn a confirmed server operation into a retry.
        let _ = database(&app, move |db, _| {
            let transaction = db.transaction().map_err(|_| MailError::Storage)?;
            for key in updated {
                storage::apply_cached_action(&transaction, account_id, &folder, key, action)?;
            }
            transaction.commit().map_err(|_| MailError::Storage)
        })
        .await;
    }
    if let Some(unread) = unread {
        update_unread_badge(&app, Some((account_id, unread))).await;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_manual_accounts_and_requires_oauth_for_google_or_microsoft() {
        let account = Account {
            email: " inbox@example.test ".into(),
            host: " IMAP.Example.Test ".into(),
            port: 993,
            username: None,
            start_tls: false,
        };
        let validated = account.clone().validated().unwrap();
        assert_eq!(validated.email, "inbox@example.test");
        assert_eq!(validated.host, "imap.example.test");
        for (email, host, expected) in [
            (
                "inbox@gmail.com",
                "imap.example.test",
                MailError::OAuthRequired,
            ),
            (
                "inbox@example.test",
                "outlook.office365.com",
                MailError::OAuthRequired,
            ),
            (
                "inbox@example.test",
                "https://imap.example.test",
                MailError::InvalidSettings,
            ),
            (
                "inbox@example.test",
                "-imap.example.test",
                MailError::InvalidSettings,
            ),
            (
                "inbox@@example.test",
                "imap.example.test",
                MailError::InvalidSettings,
            ),
        ] {
            assert_eq!(
                Account {
                    email: email.into(),
                    host: host.into(),
                    ..account.clone()
                }
                .validated()
                .err(),
                Some(expected)
            );
        }
    }
}
