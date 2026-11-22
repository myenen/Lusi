use super::{
    database, imap, storage, stored_connection, switch_connected_account, AccountId, Inbox,
    MailHeader, MessageKey,
};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};
use tauri_plugin_notification::NotificationExt;

const TARGET: &str = "lusiTarget";
const OPEN_EVENT: &str = "mail:notification-open";

#[derive(Clone, Copy, Deserialize, Serialize)]
struct Target {
    account_id: AccountId,
    key: MessageKey,
}

#[derive(Serialize)]
struct NotificationOpen {
    inbox: Inbox,
    header: Option<MailHeader>,
}

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
    let mut notification = app.notification().builder().title("Lusi").body(body);
    if show_details && messages.len() == 1 {
        let sender = if newest.sender.trim().is_empty() {
            &newest.address
        } else {
            &newest.sender
        };
        notification = notification.title(sender).body(&newest.subject);
    }
    let _ = notification
        .extra(
            TARGET,
            Target {
                account_id,
                key: newest.key,
            },
        )
        .show();
}

async fn open_message(app: AppHandle, target: Target) {
    if !crate::desktop::show_main(&app) {
        return;
    }

    let id = target.account_id;
    let Ok(snapshot) = database(&app, move |db, _| storage::snapshot_for(db, id)).await else {
        return;
    };
    let header = match snapshot
        .headers
        .iter()
        .find(|header| header.key == target.key)
    {
        Some(header) => Some(header.clone()),
        None => match stored_connection(&app, id).await {
            Ok((account, auth)) => imap::inbox_header(&account, &auth, target.key).await.ok(),
            Err(_) => None,
        },
    };
    let inbox = match database(&app, |db, _| storage::active_account_id(db)).await {
        Ok(Some(active)) if active == id => {
            let Ok(inbox) = database(&app, move |db, _| storage::snapshot_for(db, id)).await else {
                return;
            };
            inbox
        }
        _ => {
            let Ok(inbox) = switch_connected_account(app.clone(), id).await else {
                return;
            };
            inbox
        }
    };
    let _ = app.emit_to("main", OPEN_EVENT, &NotificationOpen { inbox, header });
}
