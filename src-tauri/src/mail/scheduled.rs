use super::{
    database, send_from_account, storage, AccountId, MailError, MailOperations, OutgoingMessage,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    sync::Notify,
    time::{sleep, timeout},
};

const CHANGED: &str = "mail:scheduled-changed";
const CHECK_INTERVAL: Duration = Duration::from_secs(60);
const SEND_TIMEOUT: Duration = Duration::from_secs(120);
const CLAIM_SECONDS: i64 = 180;
const RETRY_SECONDS: i64 = 60;

#[derive(Default)]
pub(crate) struct ScheduledMail {
    changed: Notify,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledItem {
    id: i64,
    from: String,
    recipients: String,
    subject: String,
    scheduled_at: i64,
    state: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledContent {
    body: String,
    html: String,
    attachment_names: Vec<String>,
}

struct Job {
    id: i64,
    account_id: AccountId,
    payload: Vec<u8>,
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[tauri::command]
pub async fn schedule_message(
    app: AppHandle,
    account_id: AccountId,
    scheduled_at: i64,
    message: OutgoingMessage,
) -> Result<(), MailError> {
    database(&app, move |db, _| {
        schedule(db, account_id, scheduled_at, message, now())
    })
    .await?;
    notify_change(&app);
    Ok(())
}

fn schedule(
    db: &Connection,
    account_id: AccountId,
    scheduled_at: i64,
    message: OutgoingMessage,
    now: i64,
) -> Result<(), MailError> {
    if scheduled_at <= now || scheduled_at > 253_402_300_799 {
        return Err(MailError::InvalidSchedule);
    }
    let account = storage::account(db, account_id)?.ok_or(MailError::NoAccount)?;
    if !account.uses_gmail_oauth()
        && !db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM outgoing_server WHERE account_id = ?)",
                [account_id],
                |row| row.get::<_, bool>(0),
            )
            .map_err(|_| MailError::Storage)?
    {
        return Err(MailError::NoSmtp);
    }
    // Validate with the same MIME rules used for immediate sending.
    message.build(&account.email)?;
    let payload = serde_json::to_vec(&message).map_err(|_| MailError::InvalidMessage)?;
    db.execute(
        "INSERT INTO scheduled_mail(account_id, scheduled_at, wake_at, state, subject, recipients, payload)
         VALUES (?1, ?2, ?2, 'queued', ?3, ?4, ?5)",
        params![account_id, scheduled_at, message.subject, message.to.join(", "), payload],
    ).map_err(|_| MailError::Storage)?;
    Ok(())
}

#[tauri::command]
pub async fn list_scheduled_messages(app: AppHandle) -> Result<Vec<ScheduledItem>, MailError> {
    database(&app, |db, _| list(db)).await
}

fn list(db: &Connection) -> Result<Vec<ScheduledItem>, MailError> {
    let mut query = db.prepare(
        "SELECT scheduled_mail.id, account.email, recipients, subject, scheduled_at, state
         FROM scheduled_mail JOIN account ON account.id = scheduled_mail.account_id ORDER BY scheduled_at, scheduled_mail.id",
    ).map_err(|_| MailError::Storage)?;
    let rows = query
        .query_map([], |row| {
            Ok(ScheduledItem {
                id: row.get(0)?,
                from: row.get(1)?,
                recipients: row.get(2)?,
                subject: row.get(3)?,
                scheduled_at: row.get(4)?,
                state: row.get(5)?,
            })
        })
        .map_err(|_| MailError::Storage)?;
    rows.collect::<Result<_, _>>()
        .map_err(|_| MailError::Storage)
}

#[tauri::command]
pub async fn read_scheduled_message(
    app: AppHandle,
    id: i64,
) -> Result<ScheduledContent, MailError> {
    database(&app, move |db, _| read(db, id)).await
}

fn read(db: &Connection, id: i64) -> Result<ScheduledContent, MailError> {
    let payload: Vec<u8> = db
        .query_row(
            "SELECT payload FROM scheduled_mail WHERE id = ?",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| MailError::Storage)?
        .ok_or(MailError::ScheduleUnavailable)?;
    let message: OutgoingMessage =
        serde_json::from_slice(&payload).map_err(|_| MailError::Storage)?;
    let (body, html) = message.bodies();
    Ok(ScheduledContent {
        body,
        html,
        attachment_names: message.attachment_names(),
    })
}

#[tauri::command]
pub async fn cancel_scheduled_message(app: AppHandle, id: i64) -> Result<(), MailError> {
    database(&app, move |db, _| cancel(db, id)).await?;
    notify_change(&app);
    Ok(())
}

fn cancel(db: &Connection, id: i64) -> Result<(), MailError> {
    let removed = db
        .execute(
            "DELETE FROM scheduled_mail WHERE id = ? AND state != 'sending'",
            [id],
        )
        .map_err(|_| MailError::Storage)?;
    if removed == 0 {
        return Err(MailError::ScheduleUnavailable);
    }
    Ok(())
}

fn notify_change(app: &AppHandle) {
    app.state::<ScheduledMail>().changed.notify_one();
    let _ = app.emit_to("main", CHANGED, None::<AccountId>);
}

fn expire_claims(db: &Connection, now: i64) -> rusqlite::Result<bool> {
    db.execute(
        "UPDATE scheduled_mail SET state = 'uncertain' WHERE state = 'sending' AND wake_at <= ?",
        [now],
    )
    .map(|updated| updated != 0)
}

fn claim(db: &Connection, now: i64) -> rusqlite::Result<Option<Job>> {
    db.query_row(
        "UPDATE scheduled_mail SET state = 'sending', wake_at = ?2
         WHERE id = (SELECT id FROM scheduled_mail WHERE state IN ('queued', 'retrying') AND wake_at <= ?1
                     ORDER BY wake_at, id LIMIT 1)
         RETURNING id, account_id, payload",
        params![now, now + CLAIM_SECONDS],
        |row| Ok(Job { id: row.get(0)?, account_id: row.get(1)?, payload: row.get(2)? }),
    ).optional()
}

fn finish(
    db: &Connection,
    id: i64,
    result: Result<(), MailError>,
    now: i64,
) -> rusqlite::Result<()> {
    let state = match result {
        Ok(()) => {
            db.execute("DELETE FROM scheduled_mail WHERE id = ?", [id])?;
            return Ok(());
        }
        Err(MailError::SendUncertain) => "uncertain",
        Err(MailError::SmtpUnavailable | MailError::GoogleSignIn) => "retrying",
        Err(_) => "failed",
    };
    db.execute(
        "UPDATE scheduled_mail SET state = ?1, wake_at = ?2 WHERE id = ?3 AND state = 'sending'",
        params![state, now + RETRY_SECONDS, id],
    )?;
    Ok(())
}

async fn send(app: &AppHandle, job: Job) {
    let Job {
        id,
        account_id,
        payload,
    } = job;
    let result = async {
        let message = serde_json::from_slice(&payload).map_err(|_| MailError::InvalidMessage)?;
        let operations = app.state::<MailOperations>();
        let _operation = timeout(Duration::from_secs(20), operations.0.lock())
            .await
            .map_err(|_| MailError::SmtpUnavailable)?;
        timeout(SEND_TIMEOUT, send_from_account(app, account_id, message))
            .await
            .map_err(|_| MailError::SendUncertain)?
            .map(|_| ())
    }
    .await;
    let sent = result.is_ok();
    let _ = database(app, move |db, _| {
        finish(db, id, result, now()).map_err(|_| MailError::Storage)
    })
    .await;
    let _ = app.emit_to("main", CHANGED, sent.then_some(account_id));
}

pub(crate) async fn run(app: AppHandle) {
    let worker = app.state::<ScheduledMail>();
    loop {
        let work = database(&app, |db, _| {
            let now = now();
            let expired = expire_claims(db, now).map_err(|_| MailError::Storage)?;
            let job = claim(db, now).map_err(|_| MailError::Storage)?;
            if job.is_some() {
                return Ok((expired, job, Duration::ZERO));
            }
            let next = db.query_row(
                "SELECT min(wake_at) FROM scheduled_mail WHERE state IN ('queued', 'retrying', 'sending')",
                [], |row| row.get::<_, Option<i64>>(0),
            ).map_err(|_| MailError::Storage)?;
            let delay = next.map_or(CHECK_INTERVAL, |next| Duration::from_secs(next.saturating_sub(now).max(1) as u64).min(CHECK_INTERVAL));
            Ok((expired, job, delay))
        }).await;
        let delay = match work {
            Ok((expired, job, delay)) => {
                if expired || job.is_some() {
                    let _ = app.emit_to("main", CHANGED, None::<AccountId>);
                }
                if let Some(job) = job {
                    send(&app, job).await;
                    continue;
                }
                delay
            }
            Err(_) => CHECK_INTERVAL,
        };
        tokio::select! {
            _ = worker.changed.notified() => {}
            _ = sleep(delay) => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, Connection) {
        let directory = tempfile::tempdir().unwrap();
        let db = storage::open(&directory.path().join("mail.sqlite3")).unwrap();
        db.execute_batch(
            "INSERT INTO account(id, email, host, port) VALUES
                (1, 'first@gmail.com', 'imap.gmail.com', 993),
                (2, 'second@gmail.com', 'imap.gmail.com', 993);
             INSERT INTO active_account VALUES(1, 2);",
        )
        .unwrap();
        (directory, db)
    }

    fn draft() -> OutgoingMessage {
        serde_json::from_value(serde_json::json!({
            "to": ["recipient@example.test"], "cc": [], "bcc": [], "subject": "Later",
            "body": "", "html": "<p><b>Hello</b></p><script>hidden()</script>",
            "attachments": [{"name": "note.txt", "data": "SGVsbG8="}]
        }))
        .unwrap()
    }

    #[test]
    fn persists_and_claims_once_from_the_original_account() {
        let (directory, db) = fixture();
        schedule(&db, 1, 120, draft(), 100).unwrap();
        schedule(&db, 2, 130, draft(), 100).unwrap();
        drop(db);

        let path = directory.path().join("mail.sqlite3");
        let db = storage::open(&path).unwrap();
        let another_connection = storage::open(&path).unwrap();
        let jobs = list(&db).unwrap();
        assert_eq!(
            jobs.iter()
                .map(|item| item.from.as_str())
                .collect::<Vec<_>>(),
            ["first@gmail.com", "second@gmail.com"]
        );
        let preview = read(&db, jobs[0].id).unwrap();
        assert_eq!(preview.body.trim(), "Hello");
        assert!(preview.html.contains("<b>Hello</b>"));
        assert!(!preview.html.contains("hidden()"));
        assert_eq!(preview.attachment_names, ["note.txt"]);
        assert!(claim(&db, 119).unwrap().is_none());
        let job = claim(&db, 120).unwrap().unwrap();
        assert_eq!(job.account_id, 1);
        let payload: OutgoingMessage = serde_json::from_slice(&job.payload).unwrap();
        let mime = payload.build("first@gmail.com").unwrap();
        assert_eq!(
            mime.envelope().to()[0].to_string(),
            "recipient@example.test"
        );
        assert!(String::from_utf8(mime.formatted())
            .unwrap()
            .contains("note.txt"));
        assert!(claim(&another_connection, 120).unwrap().is_none());
        assert_eq!(
            cancel(&another_connection, job.id),
            Err(MailError::ScheduleUnavailable)
        );
        finish(&db, job.id, Ok(()), 125).unwrap();
        cancel(&db, jobs[1].id).unwrap();
        assert!(claim(&db, 150).unwrap().is_none());
        assert!(list(&db).unwrap().is_empty());
        assert!(matches!(
            read(&db, job.id),
            Err(MailError::ScheduleUnavailable)
        ));
    }

    #[test]
    fn retries_offline_sends_and_never_replays_uncertain_delivery() {
        let (_directory, db) = fixture();
        assert_eq!(
            schedule(&db, 1, 100, draft(), 100),
            Err(MailError::InvalidSchedule)
        );
        schedule(&db, 1, 120, draft(), 100).unwrap();
        let job = claim(&db, 120).unwrap().unwrap();
        finish(&db, job.id, Err(MailError::GoogleSignIn), 120).unwrap();
        assert_eq!(list(&db).unwrap()[0].state, "retrying");
        assert!(claim(&db, 179).unwrap().is_none());
        assert_eq!(claim(&db, 180).unwrap().unwrap().id, job.id);
        assert!(!expire_claims(&db, 359).unwrap());
        assert!(expire_claims(&db, 360).unwrap());
        assert_eq!(list(&db).unwrap()[0].state, "uncertain");
        assert!(claim(&db, 1_000).unwrap().is_none());
        cancel(&db, job.id).unwrap();
    }
}
