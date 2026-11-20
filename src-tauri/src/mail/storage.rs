use super::{Account, Inbox, MailError, MailHeader, MessageKey};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::{fs, path::Path, time::Duration};

pub fn open(path: &Path) -> Result<Connection, MailError> {
    let directory = path.parent().ok_or(MailError::Storage)?;
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
        builder.mode(0o700);
        builder.create(directory).map_err(|_| MailError::Storage)?;
        fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .open(path)
            .map_err(|_| MailError::Storage)?;
    }
    #[cfg(not(unix))]
    builder.create(directory).map_err(|_| MailError::Storage)?;
    let mut db = Connection::open(path).map_err(|_| MailError::Storage)?;
    db.busy_timeout(Duration::from_secs(3))
        .map_err(|_| MailError::Storage)?;
    migrate(&mut db).map_err(|_| MailError::Storage)?;
    Ok(db)
}

fn migrate(db: &mut Connection) -> rusqlite::Result<()> {
    let read_version =
        |db: &Connection| db.pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0));
    if read_version(db)? == 1 {
        return Ok(());
    }
    let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    match read_version(&transaction)? {
        0 => transaction.execute_batch(
            "
            CREATE TABLE account (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                email TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535)
            );
            CREATE TABLE inbox_headers (
                uid_validity INTEGER NOT NULL,
                uid INTEGER NOT NULL,
                sender TEXT NOT NULL,
                address TEXT NOT NULL,
                subject TEXT NOT NULL,
                sent_at INTEGER,
                unread INTEGER NOT NULL,
                PRIMARY KEY (uid_validity, uid)
            );
            PRAGMA user_version = 1;
        ",
        )?,
        1 => {}
        _ => return Err(rusqlite::Error::InvalidQuery),
    }
    transaction.commit()
}

pub fn account(db: &Connection) -> Result<Option<Account>, MailError> {
    db.query_row(
        "SELECT email, host, port FROM account WHERE id = 1",
        [],
        |row| {
            Ok(Account {
                email: row.get(0)?,
                host: row.get(1)?,
                port: row.get(2)?,
            })
        },
    )
    .optional()
    .map_err(|_| MailError::Storage)
}

pub fn snapshot(db: &mut Connection) -> Result<Option<Inbox>, MailError> {
    let transaction = db.transaction().map_err(|_| MailError::Storage)?;
    let Some(account) = account(&transaction)? else {
        return Ok(None);
    };
    let mut statement = transaction.prepare(
        "SELECT uid_validity, uid, sender, address, subject, sent_at, unread FROM inbox_headers ORDER BY uid DESC"
    ).map_err(|_| MailError::Storage)?;
    let headers = statement
        .query_map([], |row| {
            Ok(MailHeader {
                key: MessageKey {
                    uid_validity: row.get(0)?,
                    uid: row.get(1)?,
                },
                sender: row.get(2)?,
                address: row.get(3)?,
                subject: row.get(4)?,
                sent_at: row.get(5)?,
                unread: row.get(6)?,
            })
        })
        .map_err(|_| MailError::Storage)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| MailError::Storage)?;
    Ok(Some(Inbox {
        email: account.email,
        headers,
    }))
}

pub fn contains_message(db: &Connection, key: MessageKey) -> Result<bool, MailError> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM inbox_headers WHERE uid_validity = ? AND uid = ?)",
        params![key.uid_validity, key.uid],
        |row| row.get(0),
    )
    .map_err(|_| MailError::Storage)
}

pub fn save_new_account(
    db: &mut Connection,
    details: Account,
    password: &str,
    headers: Vec<MailHeader>,
) -> Result<Inbox, MailError> {
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MailError::Storage)?;
    if account(&transaction)?.is_some() {
        return Err(MailError::AlreadyConnected);
    }
    transaction
        .execute(
            "INSERT INTO account (id, email, host, port) VALUES (1, ?, ?, ?)",
            params![details.email, details.host, details.port],
        )
        .map_err(|_| MailError::Storage)?;
    replace_headers(&transaction, &headers).map_err(|_| MailError::Storage)?;
    let credential = details.credential()?;
    credential
        .set_password(password)
        .map_err(|_| MailError::Credentials)?;
    if transaction.commit().is_err() {
        let _ = credential.delete_credential();
        return Err(MailError::Storage);
    }
    Ok(Inbox {
        email: details.email,
        headers,
    })
}

pub fn update_snapshot(
    db: &mut Connection,
    details: Account,
    headers: Vec<MailHeader>,
) -> Result<Inbox, MailError> {
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MailError::Storage)?;
    replace_headers(&transaction, &headers).map_err(|_| MailError::Storage)?;
    transaction.commit().map_err(|_| MailError::Storage)?;
    Ok(Inbox {
        email: details.email,
        headers,
    })
}

fn replace_headers(db: &Connection, headers: &[MailHeader]) -> rusqlite::Result<()> {
    db.execute("DELETE FROM inbox_headers", [])?;
    let mut statement = db.prepare("INSERT INTO inbox_headers VALUES (?, ?, ?, ?, ?, ?, ?)")?;
    for header in headers {
        statement.execute(params![
            header.key.uid_validity,
            header.key.uid,
            header.sender,
            header.address,
            header.subject,
            header.sent_at,
            header.unread
        ])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_inbox_by_uid_validity_and_rolls_back_failed_snapshots() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        assert!(snapshot(&mut db).unwrap().is_none());
        db.execute(
            "INSERT INTO account VALUES (1, 'mail@example.test', 'imap.example.test', 993)",
            [],
        )
        .unwrap();
        let header = |uid_validity| MailHeader {
            key: MessageKey {
                uid_validity,
                uid: 10,
            },
            sender: "Sender".into(),
            address: "sender@example.test".into(),
            subject: "A message".into(),
            sent_at: None,
            unread: true,
        };
        let details = account(&db).unwrap().unwrap();
        update_snapshot(&mut db, details.clone(), vec![header(7)]).unwrap();
        assert!(update_snapshot(&mut db, details.clone(), vec![header(9), header(9)]).is_err());
        assert!(contains_message(&db, header(7).key).unwrap());
        update_snapshot(&mut db, details, vec![header(9)]).unwrap();
        assert!(!contains_message(&db, header(7).key).unwrap());
        assert_eq!(snapshot(&mut db).unwrap().unwrap().headers, vec![header(9)]);
    }
}
