use super::{
    database, imap, notifications, storage, stored_connection, update_unread_badge, AccountId,
    Inbox, MailError, MailOperations,
};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    sync::Notify,
    time::{sleep, timeout},
};

const POLL_INTERVAL: Duration = Duration::from_secs(120);
const IDLE_LIMIT: Duration = Duration::from_secs(10 * 60);
const MIN_IDLE_INTERVAL: Duration = Duration::from_secs(10);
const RETRY_MAX: Duration = Duration::from_secs(10 * 60);
const INBOX_CHANGED: &str = "mail:inbox-changed";

#[derive(Default)]
pub(crate) struct InboxSync {
    changed: Notify,
}

impl InboxSync {
    pub(crate) fn request_refresh(&self) {
        self.changed.notify_one();
    }
}

pub(super) async fn refresh(
    app: &AppHandle,
    account_id: AccountId,
    background: bool,
) -> Result<Inbox, MailError> {
    let operations = app.state::<MailOperations>();
    let _operation = operations.0.lock().await;
    if background && !database(app, move |db, _| storage::is_active(db, account_id)).await? {
        return Err(MailError::NoAccount);
    }
    let cached = database(app, move |db, _| storage::snapshot_for(db, account_id)).await?;
    let (account, auth) = stored_connection(app, account_id).await?;
    let (cursor, headers, unread) = imap::sync_inbox(&account, &auth, &cached.headers).await?;
    let changed = headers != cached.headers;
    let (headers, newly_unread) = database(app, move |db, _| {
        let newly_unread = storage::commit_inbox_sync(db, account_id, &headers, cursor, changed)?;
        Ok((headers, newly_unread))
    })
    .await?;
    let inbox = Inbox { headers, ..cached };
    if let Some(count) = unread {
        update_unread_badge(app, Some((account_id, count))).await;
    }
    if (background || !newly_unread.is_empty())
        && database(app, move |db, _| storage::is_active(db, account_id))
            .await
            .unwrap_or(false)
    {
        if background {
            let _ = app.emit_to("main", INBOX_CHANGED, &inbox);
        }
        notifications::deliver(app, account_id, &newly_unread);
    }
    Ok(inbox)
}

pub(crate) async fn run(app: AppHandle) {
    let worker = app.state::<InboxSync>();
    let mut previous_account = None;
    let mut failures = 0u32;
    loop {
        let account = match database(&app, |db, _| storage::active_account_id(db)).await {
            Ok(Some(account)) => account,
            Ok(None) => {
                previous_account = None;
                failures = 0;
                worker.changed.notified().await;
                continue;
            }
            Err(_) => {
                tokio::select! { _ = worker.changed.notified() => {}, _ = sleep(POLL_INTERVAL) => {} }
                continue;
            }
        };
        if previous_account != Some(account) {
            previous_account = Some(account);
            failures = 0;
        }
        tokio::select! {
            biased;
            _ = worker.changed.notified() => {
                previous_account = None;
                // Synchronize whichever account is current, not the one that was waiting.
                if let Ok(Some(current)) = database(&app, |db, _| storage::active_account_id(db)).await {
                    failures = u32::from(refresh(&app, current, true).await.is_err());
                    previous_account = Some(current);
                }
                continue;
            }
            _ = wait_until_check(&app, account, failures) => {}
        }
        failures = if refresh(&app, account, true).await.is_ok() {
            0
        } else {
            failures.saturating_add(1)
        };
    }
}

async fn wait_until_check(app: &AppHandle, account_id: AccountId, failures: u32) {
    if failures > 0 {
        sleep(retry_delay(failures)).await;
        return;
    }
    let started = tokio::time::Instant::now();
    let result = async {
        let (account, auth) = timeout(Duration::from_secs(20), stored_connection(app, account_id))
            .await
            .map_err(|_| MailError::Timeout)??;
        imap::idle_inbox(&account, &auth, IDLE_LIMIT).await
    }
    .await;
    match result {
        Ok(true) => sleep(MIN_IDLE_INTERVAL.saturating_sub(started.elapsed())).await,
        Ok(false) => sleep(POLL_INTERVAL).await,
        Err(_) => sleep(retry_delay(1)).await,
    }
}

fn retry_delay(failures: u32) -> Duration {
    (Duration::from_secs(15) * 2u32.pow(failures.min(6))).min(RETRY_MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnects_with_a_bounded_backoff() {
        assert_eq!(retry_delay(1), Duration::from_secs(30));
        assert_eq!(retry_delay(2), Duration::from_secs(60));
        assert_eq!(retry_delay(u32::MAX), RETRY_MAX);
    }
}
