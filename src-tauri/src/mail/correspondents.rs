use super::{database, AccountId, MailError, MailHeader};
use rusqlite::{params, Connection, TransactionBehavior};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
pub struct RecipientSuggestion {
    address: String,
    name: String,
}

fn usable_address(address: &str) -> bool {
    address.len() <= 254
        && !address.contains([',', ';'])
        && !address.chars().any(char::is_control)
        && address.parse::<lettre::Address>().is_ok()
}

fn remember<'a>(
    db: &Connection,
    id: AccountId,
    entries: impl IntoIterator<Item = (&'a str, &'a str, i64)>,
) -> rusqlite::Result<()> {
    let mut insert = db.prepare(
        "INSERT INTO recent_correspondents (account_id, address_key, address, name, seen_at)
         SELECT ?1, lower(?2), ?2, ?3, ?4 WHERE EXISTS (
             SELECT 1 FROM account WHERE id = ?1 AND lower(email) <> lower(?2))
         ON CONFLICT(account_id, address_key) DO UPDATE SET
             name = CASE WHEN excluded.name <> '' AND
                (recent_correspondents.name = '' OR excluded.seen_at >= recent_correspondents.seen_at)
                THEN excluded.name ELSE recent_correspondents.name END,
             seen_at = max(recent_correspondents.seen_at, excluded.seen_at)",
    )?;
    for (address, name, seen_at) in entries {
        if usable_address(address) {
            insert.execute(params![
                id,
                address,
                if name == address { "" } else { name },
                seen_at
            ])?;
        }
    }
    db.execute(
        "DELETE FROM recent_correspondents WHERE account_id = ?1 AND address_key IN (
             SELECT address_key FROM recent_correspondents WHERE account_id = ?1
             ORDER BY seen_at DESC, address_key LIMIT -1 OFFSET 2000)",
        [id],
    )?;
    Ok(())
}

pub(super) fn remember_headers(
    db: &Connection,
    id: AccountId,
    headers: &[MailHeader],
) -> rusqlite::Result<()> {
    remember(
        db,
        id,
        headers.iter().map(|header| {
            (
                header.address.as_str(),
                header.sender.as_str(),
                header.sent_at.unwrap_or_default(),
            )
        }),
    )
}

pub(super) async fn remember_fetched(app: &AppHandle, id: AccountId, headers: &[MailHeader]) {
    if headers.is_empty() {
        return;
    }
    let headers = headers.to_vec();
    let _ = database(app, move |db, _| {
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| MailError::Storage)?;
        remember_headers(&tx, id, &headers).map_err(|_| MailError::Storage)?;
        tx.commit().map_err(|_| MailError::Storage)
    })
    .await;
}

pub(super) async fn remember_addresses(app: &AppHandle, id: AccountId, addresses: Vec<String>) {
    if addresses.is_empty() {
        return;
    }
    let now = super::scheduled::now();
    let _ = database(app, move |db, _| {
        let tx = db
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| MailError::Storage)?;
        remember(
            &tx,
            id,
            addresses.iter().map(|address| (address.as_str(), "", now)),
        )
        .map_err(|_| MailError::Storage)?;
        tx.commit().map_err(|_| MailError::Storage)
    })
    .await;
}

fn suggestions(
    db: &Connection,
    account_id: AccountId,
    query: &str,
) -> rusqlite::Result<Vec<RecipientSuggestion>> {
    let mut statement = db.prepare(
        "SELECT c.address, c.name FROM recent_correspondents c JOIN account a ON a.id = c.account_id
         WHERE c.account_id = ? AND c.address_key <> lower(a.email)
         ORDER BY c.seen_at DESC, c.address_key",
    )?;
    let mut prefix = Vec::new();
    let mut partial = Vec::new();
    for entry in statement.query_map([account_id], |row| {
        Ok(RecipientSuggestion {
            address: row.get(0)?,
            name: row.get(1)?,
        })
    })? {
        let entry = entry?;
        if !usable_address(&entry.address) {
            continue;
        }
        let address = entry.address.to_lowercase();
        let name = entry.name.to_lowercase();
        if address.starts_with(query) || name.split_whitespace().any(|word| word.starts_with(query))
        {
            prefix.push(entry);
            if prefix.len() == 12 {
                break;
            }
        } else if partial.len() < 12 && (address.contains(query) || name.contains(query)) {
            partial.push(entry);
        }
    }
    prefix.extend(partial.into_iter().take(12 - prefix.len()));
    Ok(prefix)
}

#[tauri::command]
pub async fn suggest_recipients(
    app: AppHandle,
    account_id: AccountId,
    query: String,
) -> Result<Vec<RecipientSuggestion>, MailError> {
    let query = query.trim().to_lowercase();
    if query.chars().count() < 2 || query.len() > 300 || query.chars().any(char::is_control) {
        return Ok(Vec::new());
    }
    database(&app, move |db, _| {
        suggestions(db, account_id, &query).map_err(|_| MailError::Storage)
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ranks_matching_contacts_and_persists_separate_signatures_and_history() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("mail.sqlite3");
        let db = super::super::storage::open(&path).unwrap();
        for (id, email) in [(1, "one@example.test"), (2, "two@example.test")] {
            db.execute(
                "INSERT INTO account(id, email, host, port) VALUES (?, ?, 'imap.example.test', 993)",
                params![id, email],
            ).unwrap();
        }
        remember(
            &db,
            1,
            [
                ("deniz@example.test", "Deniz Kaya", 10),
                ("team-deniz@example.test", "Team", 20),
                ("DENIZ@example.test", "", 30),
                ("one@example.test", "Deniz (me)", 40),
            ],
        )
        .unwrap();
        remember(&db, 2, [("deniz-other@example.test", "Deniz Other", 40)]).unwrap();
        super::super::storage::save_signature(&db, 1, "Office\nSignature", false).unwrap();
        drop(db);

        let db = super::super::storage::open(&path).unwrap();
        assert_eq!(
            super::super::storage::signature(&db, 1).unwrap(),
            ("Office\nSignature".into(), false)
        );
        assert_eq!(
            super::super::storage::signature(&db, 2).unwrap(),
            ("".into(), false)
        );
        let result = suggestions(&db, 1, "den").unwrap();
        assert_eq!(
            result
                .iter()
                .map(|entry| entry.address.as_str())
                .collect::<Vec<_>>(),
            ["deniz@example.test", "team-deniz@example.test"]
        );
        assert_eq!(result[0].name, "Deniz Kaya");
        assert_eq!(
            suggestions(&db, 2, "den").unwrap()[0].address,
            "deniz-other@example.test"
        );
    }
}
