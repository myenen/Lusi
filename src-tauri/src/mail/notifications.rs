use super::{
    database, imap, storage, stored_connection, switch_connected_account, AccountId, Inbox,
    MailHeader, MessageKey,
};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
#[cfg(not(windows))]
use tauri::Emitter;
#[cfg(not(windows))]
use tauri_plugin_notification::NotificationExt;

#[cfg(any(windows, test))]
#[path = "notification_activation.rs"]
pub(crate) mod activation;

#[cfg(not(windows))]
const TARGET: &str = "lusiTarget";
#[cfg(not(windows))]
const OPEN_EVENT: &str = "mail:notification-open";

#[derive(Clone, Copy, Deserialize, Serialize)]
struct Target {
    account_id: AccountId,
    key: MessageKey,
}

#[derive(Serialize)]
pub struct NotificationOpen {
    inbox: Inbox,
    header: Option<MailHeader>,
}

#[cfg(not(windows))]
pub(crate) fn install(app: &AppHandle) -> tauri_plugin_notification::Result<()> {
    let handle = app.clone();
    app.notification().on_action(move |event| {
        if event.action_id() != "tap" {
            return;
        }
        let Some(target) = event
            .notification()
            .and_then(|notification| notification.extra().get(TARGET))
            .and_then(|value| Target::deserialize(value).ok())
        else {
            return;
        };
        tauri::async_runtime::spawn(open_message(handle.clone(), target));
    })
}

pub(super) fn deliver(app: &AppHandle, account_id: AccountId, messages: &[MailHeader]) {
    let Some(newest) = messages.iter().max_by_key(|header| header.key.uid) else {
        return;
    };
    let Some((show_details, turkish)) = crate::preferences::notification_options(app) else {
        return;
    };
    let body = match (messages.len(), turkish) {
        (1, true) => "Yeni ileti".to_owned(),
        (1, false) => "New message".to_owned(),
        (count, true) => format!("{count} yeni ileti"),
        (count, false) => format!("{count} new messages"),
    };
    let (title, body) = if show_details && messages.len() == 1 {
        let sender = if newest.sender.trim().is_empty() {
            &newest.address
        } else {
            &newest.sender
        };
        (sender.to_owned(), newest.subject.clone())
    } else {
        ("Lusi".to_owned(), body)
    };
    let target = Target {
        account_id,
        key: newest.key,
    };
    #[cfg(windows)]
    activation::deliver(app.clone(), target, title, body);
    #[cfg(not(windows))]
    let _ = app
        .notification()
        .builder()
        .title(title)
        .body(body)
        .extra(TARGET, target)
        .show();
}

#[cfg(not(windows))]
async fn open_message(app: AppHandle, target: Target) {
    if let Some(notification) = resolve_message(&app, target).await {
        let _ = app.emit_to("main", OPEN_EVENT, &notification);
    }
}

async fn resolve_message(app: &AppHandle, target: Target) -> Option<NotificationOpen> {
    if !crate::desktop::show_main(app) {
        return None;
    }

    let id = target.account_id;
    let snapshot = database(app, move |db, _| storage::snapshot_for(db, id))
        .await
        .ok()?;
    let header = match snapshot
        .headers
        .iter()
        .find(|header| header.key == target.key)
    {
        Some(header) => Some(header.clone()),
        None => match stored_connection(app, id).await {
            Ok((account, auth)) => imap::inbox_header(&account, &auth, target.key).await.ok(),
            Err(_) => None,
        },
    };
    let inbox = match database(app, |db, _| storage::active_account_id(db)).await {
        Ok(Some(active)) if active == id => {
            database(app, move |db, _| storage::snapshot_for(db, id))
                .await
                .ok()?
        }
        _ => switch_connected_account(app.clone(), id).await.ok()?,
    };
    Some(NotificationOpen { inbox, header })
}

#[tauri::command]
pub fn take_notification_open(app: AppHandle) -> Option<NotificationOpen> {
    #[cfg(windows)]
    {
        activation::take_pending(&app)
    }
    #[cfg(not(windows))]
    {
        let _ = app;
        None
    }
}
