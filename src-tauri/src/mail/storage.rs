use super::{
    credentials, smtp::SmtpSettings, Account, Inbox, MailError, MailHeader, MessageAction,
    MessageKey,
};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::{borrow::Borrow, fs, path::Path, time::Duration};
use zeroize::Zeroizing;

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
    if read_version(db)? == 5 {
        return Ok(());
    }
    let transaction = db.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let version = read_version(&transaction)?;
    match version {
        0 => transaction.execute_batch(
            "
            CREATE TABLE account (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                email TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535)
            );
        ",
        )?,
        1..=5 => {}
        _ => return Err(rusqlite::Error::InvalidQuery),
    }
    if version < 2 {
        transaction.execute_batch(
            "ALTER TABLE account ADD COLUMN username TEXT;
             ALTER TABLE account ADD COLUMN start_tls INTEGER NOT NULL DEFAULT 0 CHECK (start_tls IN (0, 1));",
        )?;
    }
    if version < 3 {
        transaction.execute_batch(
            "ALTER TABLE account ADD COLUMN encrypted_password BLOB;
             ALTER TABLE account ADD COLUMN legacy_cleanup_pending INTEGER NOT NULL DEFAULT 0
                CHECK (legacy_cleanup_pending IN (0, 1));",
        )?;
    }
    if version < 4 {
        transaction.execute_batch(
            "CREATE TABLE outgoing_server (
                account_id INTEGER PRIMARY KEY CHECK (account_id = 1) REFERENCES account(id),
                host TEXT NOT NULL,
                port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
                username TEXT,
                start_tls INTEGER NOT NULL CHECK (start_tls IN (0, 1)),
                encrypted_password BLOB NOT NULL
             );",
        )?;
    }
    if version < 5 {
        transaction.execute_batch(
            "CREATE TABLE IF NOT EXISTS inbox_headers (
                uid_validity INTEGER NOT NULL,
                uid INTEGER NOT NULL,
                sender TEXT NOT NULL,
                address TEXT NOT NULL,
                subject TEXT NOT NULL,
                sent_at INTEGER,
                unread INTEGER NOT NULL,
                PRIMARY KEY (uid_validity, uid)
             );
             ALTER TABLE inbox_headers ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
             PRAGMA user_version = 5;",
        )?;
    }
    transaction.commit()
}

pub fn account(db: &Connection) -> Result<Option<Account>, MailError> {
    db.query_row(
        "SELECT email, host, port, username, start_tls FROM account WHERE id = 1",
        [],
        |row| {
            Ok(Account {
                email: row.get(0)?,
                host: row.get(1)?,
                port: row.get(2)?,
                username: row.get(3)?,
                start_tls: row.get(4)?,
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
        "SELECT uid_validity, uid, sender, address, subject, sent_at, unread, starred FROM inbox_headers ORDER BY uid DESC"
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
                starred: row.get(7)?,
            })
        })
        .map_err(|_| MailError::Storage)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| MailError::Storage)?;
    Ok(Some(Inbox {
        email: account.email,
        headers,
        can_send: has_outgoing(&transaction)?,
    }))
}

fn has_outgoing(db: &Connection) -> Result<bool, MailError> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM outgoing_server WHERE account_id = 1)",
        [],
        |row| row.get(0),
    )
    .map_err(|_| MailError::Storage)
}

pub(super) fn outgoing_connection(
    db: &Connection,
    directory: &Path,
) -> Result<(String, SmtpSettings, Zeroizing<String>), MailError> {
    let email = account(db)?.ok_or(MailError::NoAccount)?.email;
    let (settings, sealed): (SmtpSettings, Vec<u8>) = db.query_row(
        "SELECT host, port, username, start_tls, encrypted_password FROM outgoing_server WHERE account_id = 1",
        [], |row| Ok((SmtpSettings {
            host: row.get(0)?, port: row.get(1)?, username: row.get(2)?, start_tls: row.get(3)?,
        }, row.get(4)?)),
    ).optional().map_err(|_| MailError::Storage)?.ok_or(MailError::NoSmtp)?;
    let password = credentials::unseal_outgoing(directory, &email, &settings, &sealed)?;
    Ok((email, settings, password))
}

pub fn contains_message(db: &Connection, key: MessageKey) -> Result<bool, MailError> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM inbox_headers WHERE uid_validity = ? AND uid = ?)",
        params![key.uid_validity, key.uid],
        |row| row.get(0),
    )
    .map_err(|_| MailError::Storage)
}

pub(super) fn apply_cached_action(
    db: &Connection,
    key: MessageKey,
    action: MessageAction,
) -> Result<(), MailError> {
    let statement = match action {
        MessageAction::Read => "UPDATE inbox_headers SET unread = 0",
        MessageAction::Unread => "UPDATE inbox_headers SET unread = 1",
        MessageAction::Star => "UPDATE inbox_headers SET starred = 1",
        MessageAction::Unstar => "UPDATE inbox_headers SET starred = 0",
        MessageAction::Archive | MessageAction::Trash | MessageAction::Restore => {
            "DELETE FROM inbox_headers"
        }
    };
    db.execute(
        &format!("{statement} WHERE uid_validity = ? AND uid = ?"),
        params![key.uid_validity, key.uid],
    )
    .map(|_| ())
    .map_err(|_| MailError::Storage)
}

pub fn save_new_account(
    db: &mut Connection,
    directory: &Path,
    details: Account,
    outgoing: &SmtpSettings,
    password: &str,
    headers: Vec<MailHeader>,
) -> Result<Inbox, MailError> {
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MailError::Storage)?;
    if account(&transaction)?.is_some() {
        return Err(MailError::AlreadyConnected);
    }
    let sealed = credentials::seal(directory, &details, password)?;
    transaction
        .execute(
            "INSERT INTO account (id, email, host, port, username, start_tls, encrypted_password)
             VALUES (1, ?, ?, ?, ?, ?, ?)",
            params![
                details.email,
                details.host,
                details.port,
                details.username,
                details.start_tls,
                sealed
            ],
        )
        .map_err(|_| MailError::Storage)?;
    let sealed = credentials::seal_outgoing(directory, &details.email, outgoing, password)?;
    transaction.execute(
        "INSERT INTO outgoing_server (account_id, host, port, username, start_tls, encrypted_password)
         VALUES (1, ?, ?, ?, ?, ?)",
        params![outgoing.host, outgoing.port, outgoing.username, outgoing.start_tls, sealed],
    ).map_err(|_| MailError::Storage)?;
    replace_headers(&transaction, &headers).map_err(|_| MailError::Storage)?;
    transaction.commit().map_err(|_| MailError::Storage)?;
    Ok(Inbox {
        email: details.email,
        headers,
        can_send: true,
    })
}

pub(super) fn connection_details<C: Borrow<keyring::Entry>>(
    db: &mut Connection,
    directory: &Path,
    legacy_entry: impl FnOnce(&Account) -> Result<C, MailError>,
) -> Result<(Account, Zeroizing<String>), MailError> {
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MailError::Storage)?;
    let details = account(&transaction)?.ok_or(MailError::NoAccount)?;
    let (sealed, cleanup_pending): (Option<Vec<u8>>, bool) = transaction
        .query_row(
            "SELECT encrypted_password, legacy_cleanup_pending FROM account WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| MailError::Storage)?;

    let (password, old_entry) = if let Some(sealed) = sealed {
        let password = credentials::unseal(directory, &details, &sealed)?;
        let old_entry = cleanup_pending
            .then(|| legacy_entry(&details))
            .and_then(Result::ok);
        (password, old_entry)
    } else {
        let entry = legacy_entry(&details)?;
        let password = Zeroizing::new(
            entry
                .borrow()
                .get_password()
                .map_err(|_| MailError::LegacyCredentials)?,
        );
        let sealed = credentials::seal(directory, &details, &password)?;
        transaction
            .execute(
                "UPDATE account SET encrypted_password = ?, legacy_cleanup_pending = 1 WHERE id = 1",
                [sealed],
            )
            .map_err(|_| MailError::Storage)?;
        (password, Some(entry))
    };
    transaction.commit().map_err(|_| MailError::Storage)?;

    // An interrupted or denied deletion is retried after the next successful decryption.
    if old_entry.is_some_and(|entry| {
        matches!(
            entry.borrow().delete_credential(),
            Ok(()) | Err(keyring::Error::NoEntry)
        )
    }) {
        let _ = db.execute(
            "UPDATE account SET legacy_cleanup_pending = 0 WHERE id = 1",
            [],
        );
    }
    Ok((details, password))
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
    let can_send = has_outgoing(&transaction)?;
    transaction.commit().map_err(|_| MailError::Storage)?;
    Ok(Inbox {
        email: details.email,
        headers,
        can_send,
    })
}

fn replace_headers(db: &Connection, headers: &[MailHeader]) -> rusqlite::Result<()> {
    db.execute("DELETE FROM inbox_headers", [])?;
    let mut statement = db.prepare(
        "INSERT INTO inbox_headers (uid_validity, uid, sender, address, subject, sent_at, unread, starred)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )?;
    for header in headers {
        statement.execute(params![
            header.key.uid_validity,
            header.key.uid,
            header.sender,
            header.address,
            header.subject,
            header.sent_at,
            header.unread,
            header.starred,
        ])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn existing_accounts_keep_email_as_login_after_migration() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "CREATE TABLE account (id INTEGER PRIMARY KEY, email TEXT, host TEXT, port INTEGER);
             INSERT INTO account VALUES (1, 'mail@example.test', 'imap.example.test', 993);
             PRAGMA user_version = 1;",
        )
        .unwrap();
        migrate(&mut db).unwrap();
        let legacy = account(&db).unwrap().unwrap();
        assert_eq!(legacy.login(), "mail@example.test");
        assert!(!legacy.start_tls);
        db.execute(
            "UPDATE account SET username = 'mail', start_tls = 1 WHERE id = 1",
            [],
        )
        .unwrap();
        let configured = account(&db).unwrap().unwrap();
        assert_eq!(configured.login(), "mail");
        assert!(configured.start_tls);
        assert_eq!(configured.email, legacy.email);
    }

    #[test]
    fn saves_the_secret_and_reopens_it_without_the_credential_store() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("mail.sqlite3");
        let mut db = open(&path).unwrap();
        let details = Account {
            email: "mail@example.test".into(),
            host: "imap.example.test".into(),
            port: 993,
            username: None,
            start_tls: false,
        };
        let password = "isolated-test-password";
        let outgoing = SmtpSettings {
            host: "smtp.example.test".into(),
            port: 587,
            username: Some("mail".into()),
            start_tls: true,
        };
        save_new_account(
            &mut db,
            directory.path(),
            details,
            &outgoing,
            password,
            vec![],
        )
        .unwrap();
        drop(db);
        let mut db = open(&path).unwrap();
        let sealed: Vec<u8> = db
            .query_row("SELECT encrypted_password FROM account", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(!sealed
            .windows(password.len())
            .any(|part| part == password.as_bytes()));
        let outgoing_record: (String, u16, String, bool, Vec<u8>) = db
            .query_row(
                "SELECT host, port, username, start_tls, encrypted_password FROM outgoing_server",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            (
                outgoing_record.0.as_str(),
                outgoing_record.1,
                outgoing_record.2.as_str(),
                outgoing_record.3
            ),
            ("smtp.example.test", 587, "mail", true)
        );
        assert_ne!(sealed, outgoing_record.4);
        assert!(!outgoing_record
            .4
            .windows(password.len())
            .any(|part| part == password.as_bytes()));
        let (email, settings, smtp_password) = outgoing_connection(&db, directory.path()).unwrap();
        assert_eq!(email, "mail@example.test");
        assert_eq!(settings, outgoing);
        assert_eq!(smtp_password.as_str(), password);
        fn no_legacy(_: &Account) -> Result<keyring::Entry, MailError> {
            panic!("encrypted accounts must not consult the OS credential store");
        }
        let (_, stored) = connection_details(&mut db, directory.path(), no_legacy).unwrap();
        assert_eq!(stored.as_str(), password);

        fs::remove_file(directory.path().join("credentials.key")).unwrap();
        assert_eq!(
            connection_details(&mut db, directory.path(), no_legacy).err(),
            Some(MailError::Credentials)
        );
        assert!(!directory.path().join("credentials.key").exists());
    }

    #[test]
    fn preserves_the_legacy_password_until_the_encrypted_record_is_committed() {
        let directory = tempfile::tempdir().unwrap();
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        db.execute_batch(
            "INSERT INTO account (id, email, host, port)
                VALUES (1, 'mail@example.test', 'imap.example.test', 993);
             CREATE TRIGGER reject_upgrade BEFORE UPDATE ON account
                BEGIN SELECT RAISE(ABORT, 'test write failure'); END;",
        )
        .unwrap();
        let entry =
            keyring::Entry::new_with_credential(Box::new(keyring::mock::MockCredential::default()));
        entry.set_password("legacy-test-password").unwrap();

        assert_eq!(
            connection_details(&mut db, directory.path(), |_| Ok(&entry)).err(),
            Some(MailError::Storage)
        );
        assert_eq!(entry.get_password().unwrap(), "legacy-test-password");

        db.execute_batch("DROP TRIGGER reject_upgrade;").unwrap();
        let (_, password) = connection_details(&mut db, directory.path(), |_| Ok(&entry)).unwrap();
        assert_eq!(password.as_str(), "legacy-test-password");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
        let (_, reopened) = connection_details(
            &mut db,
            directory.path(),
            |_| -> Result<keyring::Entry, MailError> {
                panic!("a migrated account must not consult the OS credential store");
            },
        )
        .unwrap();
        assert_eq!(reopened.as_str(), password.as_str());
    }

    #[test]
    fn replaces_inbox_by_uid_validity_and_rolls_back_failed_snapshots() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        assert!(snapshot(&mut db).unwrap().is_none());
        db.execute(
            "INSERT INTO account (id, email, host, port) VALUES (1, 'mail@example.test', 'imap.example.test', 993)",
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
            starred: false,
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
