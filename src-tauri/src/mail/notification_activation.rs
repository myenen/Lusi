use super::{MessageKey, Target};
use crate::mail::MailError;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rusqlite::{params, Connection, OptionalExtension};

const PREFIX: &str = "lusi-notification://open/";
type Token = [u8; 16];

fn activation_uri(token: &Token) -> String {
    format!("{PREFIX}{}", URL_SAFE_NO_PAD.encode(token))
}

fn parse_activation(uri: &str) -> Option<Token> {
    let token = uri.strip_prefix(PREFIX)?;
    if token.len() != 22 {
        return None;
    }
    let mut decoded = [0; 16];
    let size = URL_SAFE_NO_PAD.decode_slice(token, &mut decoded).ok()?;
    (size == decoded.len()).then_some(decoded)
}

fn remember(db: &mut Connection, token: Token, target: Target) -> Result<(), MailError> {
    let transaction = db.transaction().map_err(|_| MailError::Storage)?;
    transaction
        .execute(
            "INSERT INTO notification_targets VALUES (?1, ?2, ?3, ?4, unixepoch() + 604800)",
            params![
                token.as_slice(),
                target.account_id,
                target.key.uid_validity,
                target.key.uid
            ],
        )
        .map_err(|_| MailError::Storage)?;
    transaction
        .execute(
            "DELETE FROM notification_targets WHERE expires_at <= unixepoch() OR rowid IN (
                 SELECT rowid FROM notification_targets ORDER BY rowid DESC LIMIT -1 OFFSET 256
             )",
            [],
        )
        .map_err(|_| MailError::Storage)?;
    transaction.commit().map_err(|_| MailError::Storage)
}

fn redeem(db: &Connection, token: Token) -> Result<Option<Target>, MailError> {
    db.query_row(
        "DELETE FROM notification_targets WHERE token = ? AND expires_at > unixepoch()
         RETURNING account_id, uid_validity, uid",
        [token.as_slice()],
        |row| {
            Ok(Target {
                account_id: row.get(0)?,
                key: MessageKey {
                    uid_validity: row.get(1)?,
                    uid: row.get(2)?,
                },
            })
        },
    )
    .optional()
    .map_err(|_| MailError::Storage)
}

#[cfg(windows)]
use {
    super::{database, resolve_message, NotificationOpen},
    std::sync::Mutex,
    tauri::{AppHandle, Emitter, Manager},
};

#[cfg(windows)]
#[derive(Default)]
pub(crate) struct PendingNotification(Mutex<Option<NotificationOpen>>);

#[cfg(windows)]
pub(crate) fn activate(app: &AppHandle, args: impl IntoIterator<Item = String>) -> bool {
    let Some(token) = args.into_iter().find_map(|arg| parse_activation(&arg)) else {
        return false;
    };
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(Some(target)) = database(&app, move |db, _| redeem(db, token)).await else {
            return;
        };
        if let Some(notification) = resolve_message(&app, target).await {
            let pending = app.state::<PendingNotification>();
            if let Ok(mut slot) = pending.0.lock() {
                *slot = Some(notification);
            }
            let _ = app.emit_to("main", "mail:notification-ready", ());
        }
    });
    true
}

#[cfg(windows)]
pub(super) fn take_pending(app: &AppHandle) -> Option<NotificationOpen> {
    app.state::<PendingNotification>().0.lock().ok()?.take()
}

#[cfg(windows)]
pub(super) fn deliver(app: AppHandle, target: Target, title: String, body: String) {
    tauri::async_runtime::spawn(async move {
        let token = rand::random::<Token>();
        let uri = database(&app, move |db, _| remember(db, token, target))
            .await
            .ok()
            .map(|()| activation_uri(&token));
        if let Err(error) = show_toast(&app.config().identifier, uri.as_deref(), &title, &body) {
            log::warn!("Could not show Windows notification: {}", error.code());
        }
    });
}

#[cfg(windows)]
fn show_toast(
    app_id: &str,
    uri: Option<&str>,
    title: &str,
    body: &str,
) -> windows::core::Result<()> {
    use quick_xml::escape::escape;
    use windows::{
        core::HSTRING,
        Data::Xml::Dom::XmlDocument,
        UI::Notifications::{ToastNotification, ToastNotificationManager},
    };

    let activation = uri.map_or_else(String::new, |uri| {
        format!(r#" activationType="protocol" launch="{}""#, escape(uri))
    });
    let xml = format!(
        r#"<toast{activation}><visual><binding template="ToastGeneric"><text>{}</text><text>{}</text></binding></visual></toast>"#,
        escape(title),
        escape(body),
    );
    let document = XmlDocument::new()?;
    document.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&document)?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(app_id))?.Show(&toast)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn requires_an_exact_opaque_activation_uri() {
        let token = [17; 16];
        assert_eq!(parse_activation(&activation_uri(&token)), Some(token));
        assert!(parse_activation("lusi-notification://open/1/2/3").is_none());
        assert!(parse_activation(&format!("{}?other=1", activation_uri(&token))).is_none());
    }

    #[test]
    fn resolves_only_a_stored_unexpired_token_once() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.sqlite");
        let mut db = crate::mail::storage::open(&path).unwrap();
        db.execute("INSERT INTO account (id, email, host, port) VALUES (1, 'mail@example.test', 'imap.example.test', 993)", []).unwrap();
        let target = Target {
            account_id: 1,
            key: MessageKey {
                uid_validity: 42,
                uid: 7,
            },
        };
        remember(&mut db, [1; 16], target).unwrap();
        remember(&mut db, [2; 16], target).unwrap();
        db.execute(
            "UPDATE notification_targets SET expires_at = 0 WHERE token = ?",
            [[2u8; 16].as_slice()],
        )
        .unwrap();
        drop(db);
        let db = crate::mail::storage::open(&path).unwrap();
        assert!(redeem(&db, [2; 16]).unwrap().is_none());
        assert!(redeem(&db, [3; 16]).unwrap().is_none());
        let opened = redeem(&db, [1; 16]).unwrap().unwrap();
        assert_eq!(
            (opened.account_id, opened.key),
            (target.account_id, target.key)
        );
        assert!(redeem(&db, [1; 16]).unwrap().is_none());
    }
}
