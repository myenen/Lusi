pub mod discovery;
mod imap;
mod storage;

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
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
    Network,
    Tls,
    Timeout,
    LoginRejected,
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
}

#[derive(Debug, Serialize)]
pub struct Inbox {
    email: String,
    headers: Vec<MailHeader>,
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
        if self.port == 0 || !valid_hostname(&self.host) {
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

    fn credential(&self) -> Result<keyring::Entry, MailError> {
        keyring::Entry::new(
            "dev.minimalmail.desktop.imap",
            &format!("{}:{}/{}", self.host, self.port, self.email),
        )
        .map_err(|_| MailError::Credentials)
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

fn database_path(app: &AppHandle) -> Result<PathBuf, MailError> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("mail.sqlite3"))
        .map_err(|_| MailError::Storage)
}

async fn database<T: Send + 'static>(
    app: &AppHandle,
    task: impl FnOnce(&mut rusqlite::Connection) -> Result<T, MailError> + Send + 'static,
) -> Result<T, MailError> {
    let path = database_path(app)?;
    tauri::async_runtime::spawn_blocking(move || task(&mut storage::open(&path)?))
        .await
        .map_err(|_| MailError::Storage)?
}

#[tauri::command]
pub fn check_imap_settings(account: Account) -> Result<(), MailError> {
    account.validated().map(|_| ())
}

#[tauri::command]
pub async fn load_connected_inbox(app: AppHandle) -> Result<Option<Inbox>, MailError> {
    database(&app, storage::snapshot).await
}

#[tauri::command]
pub async fn connect_imap_account(
    app: AppHandle,
    operations: State<'_, MailOperations>,
    account: Account,
    password: String,
) -> Result<Inbox, MailError> {
    let password = Zeroizing::new(password);
    let account = account.validated()?;
    if password.is_empty() || password.len() > 1024 || password.chars().any(char::is_control) {
        return Err(MailError::InvalidSettings);
    }
    let _operation = operations.0.lock().await;
    if database(&app, |db| storage::account(db)).await?.is_some() {
        return Err(MailError::AlreadyConnected);
    }
    let headers = imap::inbox(&account, &password).await?;
    database(&app, move |db| {
        storage::save_new_account(db, account, &password, headers)
    })
    .await
}

#[tauri::command]
pub async fn refresh_connected_inbox(
    app: AppHandle,
    operations: State<'_, MailOperations>,
) -> Result<Inbox, MailError> {
    let _operation = operations.0.lock().await;
    let (account, password) = database(&app, |db| {
        connection_details(storage::account(db)?.ok_or(MailError::NoAccount)?)
    })
    .await?;
    let headers = imap::inbox(&account, &password).await?;
    database(&app, move |db| {
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
    database(app, |db| {
        connection_details(storage::account(db)?.ok_or(MailError::NoAccount)?)
    })
    .await
}

#[tauri::command]
pub async fn read_connected_message(
    app: AppHandle,
    folder: String,
    key: MessageKey,
) -> Result<Option<String>, MailError> {
    validate_folder(&folder)?;
    let (account, password) = if folder.eq_ignore_ascii_case("INBOX") {
        database(&app, move |db| {
            let account = storage::account(db)?.ok_or(MailError::NoAccount)?;
            if !storage::contains_message(db, key)? {
                return Err(MailError::MessageMissing);
            }
            connection_details(account)
        })
        .await?
    } else {
        stored_connection(&app).await?
    };
    imap::message(&account, &password, &folder, key).await
}

fn connection_details(account: Account) -> Result<(Account, Zeroizing<String>), MailError> {
    let password = account
        .credential()?
        .get_password()
        .map_err(|_| MailError::Credentials)?;
    Ok((account, Zeroizing::new(password)))
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
