mod credentials;
pub mod discovery;
mod html;
mod imap;
mod reply;
mod setup_diagnostics;
mod smtp;
mod storage;
mod summary;

use serde::{Deserialize, Serialize};
use smtp::{OutgoingMessage, SmtpSettings};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;
use zeroize::Zeroizing;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MailError {
    InvalidSettings,
    OAuthRequired,
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
    MessageTooLarge,
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

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailHeader {
    key: MessageKey,
    sender: String,
    address: String,
    subject: String,
    sent_at: Option<i64>,
    unread: bool,
    starred: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inbox {
    email: String,
    headers: Vec<MailHeader>,
    can_send: bool,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedMessage {
    body: Option<String>,
    html: Option<html::HtmlBody>,
    summary: Option<summary::MessageSummary>,
    reply: Option<reply::ReplyDetails>,
    seen: bool,
    seen_error: Option<MailError>,
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

impl Account {
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

fn validate_address(email: &str) -> Result<(), MailError> {
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
    if [
        "gmail.com",
        "googlemail.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
    ]
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

#[tauri::command]
pub fn check_imap_settings(account: Account, outgoing: SmtpSettings) -> Result<(), MailError> {
    let account = account.validated()?;
    outgoing.validated(&account.email).map(|_| ())
}

#[tauri::command]
pub async fn load_connected_inbox(app: AppHandle) -> Result<Option<Inbox>, MailError> {
    database(&app, |db, _| storage::snapshot(db)).await
}

#[tauri::command]
pub async fn connect_imap_account(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    account: Account,
    outgoing: SmtpSettings,
    password: String,
) -> Result<Inbox, MailError> {
    let password = Zeroizing::new(password);
    let account = account.validated()?;
    let outgoing = outgoing.validated(&account.email)?;
    if password.is_empty() || password.len() > 1024 || password.chars().any(char::is_control) {
        return Err(MailError::InvalidSettings);
    }
    let _operation = operations.0.lock().await;
    if database(&app, |db, _| storage::account(db))
        .await?
        .is_some()
    {
        return Err(MailError::AlreadyConnected);
    }
    setup_diagnostics::record(format_args!("imap start"));
    let headers = imap::inbox(&account, &password)
        .await
        .inspect_err(|error| {
            setup_diagnostics::record(format_args!("imap failed category={error:?}"));
        })?;
    setup_diagnostics::record(format_args!("imap ok"));
    smtp::verify(&outgoing, &account.email, &password).await?;
    let result = database(&app, move |db, directory| {
        storage::save_new_account(db, directory, account, &outgoing, &password, headers)
    })
    .await;
    setup_diagnostics::record(format_args!("storage ok={}", result.is_ok()));
    result
}

#[tauri::command]
pub async fn refresh_connected_inbox(
    app: AppHandle,
    operations: State<'_, MailOperations>,
) -> Result<Inbox, MailError> {
    let _operation = operations.0.lock().await;
    let (account, password) = stored_connection(&app).await?;
    let headers = imap::inbox(&account, &password).await?;
    database(&app, move |db, _| {
        storage::update_snapshot(db, account, headers)
    })
    .await
}

#[tauri::command]
pub async fn list_connected_folders(app: AppHandle) -> Result<Vec<MailFolder>, MailError> {
    let (account, password) = stored_connection(&app).await?;
    imap::folders(&account, &password).await
}

#[tauri::command]
pub async fn read_connected_folder(
    app: AppHandle,
    folder: String,
) -> Result<Vec<MailHeader>, MailError> {
    validate_folder(&folder)?;
    let (account, password) = stored_connection(&app).await?;
    imap::folder(&account, &password, &folder).await
}

fn validate_folder(folder: &str) -> Result<(), MailError> {
    if folder.is_empty() || folder.len() > 4096 || folder.chars().any(char::is_control) {
        return Err(MailError::InvalidSettings);
    }
    Ok(())
}

async fn stored_connection(app: &AppHandle) -> Result<(Account, Zeroizing<String>), MailError> {
    database(app, |db, directory| {
        storage::connection_details(db, directory, Account::legacy_credential)
    })
    .await
}

#[tauri::command]
pub async fn read_connected_message(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    folder: String,
    key: MessageKey,
) -> Result<OpenedMessage, MailError> {
    validate_folder(&folder)?;
    let _operation = operations.0.lock().await;
    let is_inbox = folder.eq_ignore_ascii_case("INBOX");
    let (account, password) = if is_inbox {
        database(&app, move |db, directory| {
            if storage::account(db)?.is_none() {
                return Err(MailError::NoAccount);
            }
            if !storage::contains_message(db, key)? {
                return Err(MailError::MessageMissing);
            }
            storage::connection_details(db, directory, Account::legacy_credential)
        })
        .await?
    } else {
        stored_connection(&app).await?
    };
    let message = imap::message(&account, &password, &folder, key).await?;
    if is_inbox && message.seen {
        let _ = database(&app, move |db, _| {
            storage::apply_cached_action(db, key, MessageAction::Read)
        })
        .await;
    }
    Ok(message)
}

#[tauri::command]
pub async fn send_connected_message(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    message: OutgoingMessage,
) -> Result<(), MailError> {
    let _operation = operations.0.lock().await;
    let (email, settings, password) = database(&app, |db, directory| {
        storage::outgoing_connection(db, directory)
    })
    .await?;
    smtp::send(&settings, &email, &password, message).await
}

#[tauri::command]
pub async fn update_connected_message(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    folder: String,
    key: MessageKey,
    action: MessageAction,
) -> Result<(), MailError> {
    validate_folder(&folder)?;
    if key.uid == 0 || key.uid_validity == 0 {
        return Err(MailError::MessageMissing);
    }
    let _operation = operations.0.lock().await;
    let (account, password) = stored_connection(&app).await?;
    imap::apply_action(&account, &password, &folder, key, action).await?;
    if folder.eq_ignore_ascii_case("INBOX") {
        // The server already accepted the action. A cache error must not prompt a retry.
        let _ = database(&app, move |db, _| {
            storage::apply_cached_action(db, key, action)
        })
        .await;
    }
    Ok(())
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
