use super::{
    credentials, gmail, smtp::SmtpSettings, Account, AccountId, ConnectedAccount, Inbox, MailError,
    MailHeader, MessageAction, MessageKey,
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
    db.pragma_update(None, "foreign_keys", true)
        .map_err(|_| MailError::Storage)?;
    migrate(&mut db).map_err(|_| MailError::Storage)?;
    Ok(db)
}

fn migrate(db: &mut Connection) -> rusqlite::Result<()> {
    let read_version =
        |db: &Connection| db.pragma_query_value(None, "user_version", |row| row.get::<_, i32>(0));
    if read_version(db)? == 7 {
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
        1..=7 => {}
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
    if version < 6 {
        transaction.execute_batch(include_str!("migration-6.sql"))?;
    }
    if version < 7 {
        transaction.execute_batch(
            "ALTER TABLE inbox_headers ADD COLUMN has_attachments INTEGER NOT NULL DEFAULT 0;
             PRAGMA user_version = 7;",
        )?;
    }
    transaction.commit()
}

pub fn account(db: &Connection, id: AccountId) -> Result<Option<Account>, MailError> {
    db.query_row(
        "SELECT email, host, port, username, start_tls FROM account WHERE id = ?",
        [id],
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

pub(super) fn list_accounts(db: &Connection) -> Result<Vec<ConnectedAccount>, MailError> {
    let mut query = db
        .prepare("SELECT id, email FROM account ORDER BY id")
        .map_err(|_| MailError::Storage)?;
    let rows = query
        .query_map([], |row| {
            Ok(ConnectedAccount {
                id: row.get(0)?,
                email: row.get(1)?,
            })
        })
        .map_err(|_| MailError::Storage)?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|_| MailError::Storage)
}

pub(super) fn find_account(
    db: &Connection,
    email: &str,
) -> Result<Option<ConnectedAccount>, MailError> {
    Ok(list_accounts(db)?.into_iter().find(|account| {
        account.email.eq_ignore_ascii_case(email) || gmail::same_mailbox(&account.email, email)
    }))
}

pub fn snapshot(db: &mut Connection) -> Result<Option<Inbox>, MailError> {
    let transaction = db.transaction().map_err(|_| MailError::Storage)?;
    let active = transaction
        .query_row(
            "SELECT account_id FROM active_account WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| MailError::Storage)?;
    active.map(|id| snapshot_for(&transaction, id)).transpose()
}

pub(super) fn select_account(db: &mut Connection, id: AccountId) -> Result<Inbox, MailError> {
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MailError::Storage)?;
    let snapshot = snapshot_for(&transaction, id)?;
    set_active(&transaction, id)?;
    transaction.commit().map_err(|_| MailError::Storage)?;
    Ok(snapshot)
}

fn set_active(db: &Connection, id: AccountId) -> Result<(), MailError> {
    db.execute(
        "INSERT INTO active_account (id, account_id) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id",
        [id],
    ).map(|_| ()).map_err(|_| MailError::Storage)
}

fn snapshot_for(db: &Connection, id: AccountId) -> Result<Inbox, MailError> {
    let Some(account) = account(db, id)? else {
        return Err(MailError::NoAccount);
    };
    let mut statement = db.prepare(
        "SELECT uid_validity, uid, sender, address, subject, sent_at, unread, starred, has_attachments FROM inbox_headers WHERE account_id = ? ORDER BY uid DESC"
    ).map_err(|_| MailError::Storage)?;
    let headers = statement
        .query_map([id], |row| {
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
                has_attachments: row.get(8)?,
            })
        })
        .map_err(|_| MailError::Storage)?
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| MailError::Storage)?;
    let can_send = account.uses_gmail_oauth() || has_outgoing(db, id)?;
    let oauth_provider = account
        .uses_gmail_oauth()
        .then_some(super::discovery::OAuthProvider::Gmail);
    Ok(Inbox {
        account_id: id,
        email: account.email,
        headers,
        can_send,
        oauth_provider,
    })
}

fn has_outgoing(db: &Connection, id: AccountId) -> Result<bool, MailError> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM outgoing_server WHERE account_id = ?)",
        [id],
        |row| row.get(0),
    )
    .map_err(|_| MailError::Storage)
}

pub(super) fn outgoing_connection(
    db: &Connection,
    directory: &Path,
    id: AccountId,
) -> Result<(String, SmtpSettings, Zeroizing<String>), MailError> {
    let email = account(db, id)?.ok_or(MailError::NoAccount)?.email;
    let (settings, sealed): (SmtpSettings, Vec<u8>) = db.query_row(
        "SELECT host, port, username, start_tls, encrypted_password FROM outgoing_server WHERE account_id = ?",
        [id], |row| Ok((SmtpSettings {
            host: row.get(0)?, port: row.get(1)?, username: row.get(2)?, start_tls: row.get(3)?,
        }, row.get(4)?)),
    ).optional().map_err(|_| MailError::Storage)?.ok_or(MailError::NoSmtp)?;
    let password = credentials::unseal_outgoing(directory, &email, &settings, &sealed)?;
    Ok((email, settings, password))
}

pub fn contains_message(
    db: &Connection,
    id: AccountId,
    key: MessageKey,
) -> Result<bool, MailError> {
    db.query_row(
        "SELECT EXISTS(SELECT 1 FROM inbox_headers WHERE account_id = ? AND uid_validity = ? AND uid = ?)",
        params![id, key.uid_validity, key.uid],
        |row| row.get(0),
    )
    .map_err(|_| MailError::Storage)
}

pub(super) fn apply_cached_action(
    db: &Connection,
    id: AccountId,
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
        &format!("{statement} WHERE account_id = ? AND uid_validity = ? AND uid = ?"),
        params![id, key.uid_validity, key.uid],
    )
    .map(|_| ())
    .map_err(|_| MailError::Storage)
}

pub(super) fn record_opened_message(
    db: &Connection,
    id: AccountId,
    key: MessageKey,
    seen: bool,
    has_attachments: bool,
) -> Result<(), MailError> {
    db.execute(
        "UPDATE inbox_headers SET unread = unread AND NOT ?, has_attachments = has_attachments OR ?
         WHERE account_id = ? AND uid_validity = ? AND uid = ?",
        params![seen, has_attachments, id, key.uid_validity, key.uid],
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
    if find_account(&transaction, &details.email)?.is_some() {
        return Err(MailError::AlreadyConnected);
    }
    let sealed = credentials::seal(directory, &details, password)?;
    let id = insert_account(&transaction, &details, Some(sealed))?;
    let sealed = credentials::seal_outgoing(directory, &details.email, outgoing, password)?;
    transaction.execute(
        "INSERT INTO outgoing_server (account_id, host, port, username, start_tls, encrypted_password)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![id, outgoing.host, outgoing.port, outgoing.username, outgoing.start_tls, sealed],
    ).map_err(|_| MailError::Storage)?;
    replace_headers(&transaction, id, &headers).map_err(|_| MailError::Storage)?;
    set_active(&transaction, id)?;
    transaction.commit().map_err(|_| MailError::Storage)?;
    Ok(Inbox {
        account_id: id,
        email: details.email,
        headers,
        can_send: true,
        oauth_provider: None,
    })
}

pub(super) fn save_gmail_account(
    db: &mut Connection,
    details: Account,
    reconnect_id: Option<AccountId>,
    headers: Vec<MailHeader>,
    persist_refresh: impl FnOnce(&str) -> Result<(), MailError>,
) -> Result<Inbox, MailError> {
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MailError::Storage)?;
    let existing = find_account(&transaction, &details.email)?;
    let id = match (existing, reconnect_id) {
        (Some(account), Some(id)) if account.id == id && account.email == details.email => id,
        (Some(_), _) => return Err(MailError::AlreadyConnected),
        (None, Some(_)) => return Err(MailError::NoAccount),
        (None, None) => {
            let id = insert_account(&transaction, &details, None)?;
            set_active(&transaction, id)?;
            id
        }
    };
    replace_headers(&transaction, id, &headers).map_err(|_| MailError::Storage)?;
    persist_refresh(&details.email)?;
    transaction.commit().map_err(|_| MailError::Storage)?;
    Ok(Inbox {
        account_id: id,
        email: details.email,
        headers,
        can_send: true,
        oauth_provider: Some(super::discovery::OAuthProvider::Gmail),
    })
}

fn insert_account(
    db: &Connection,
    details: &Account,
    sealed: Option<Vec<u8>>,
) -> Result<AccountId, MailError> {
    db.execute(
        "INSERT INTO account (email, host, port, username, start_tls, encrypted_password)
         VALUES (?, ?, ?, ?, ?, ?)",
        params![
            details.email,
            details.host,
            details.port,
            details.username,
            details.start_tls,
            sealed
        ],
    )
    .map(|_| db.last_insert_rowid())
    .map_err(|_| MailError::Storage)
}

pub(super) fn connection_details<C: Borrow<keyring::Entry>>(
    db: &mut Connection,
    directory: &Path,
    id: AccountId,
    legacy_entry: impl FnOnce(&Account) -> Result<C, MailError>,
) -> Result<(Account, Zeroizing<String>), MailError> {
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MailError::Storage)?;
    let details = account(&transaction, id)?.ok_or(MailError::NoAccount)?;
    let (sealed, cleanup_pending): (Option<Vec<u8>>, bool) = transaction
        .query_row(
            "SELECT encrypted_password, legacy_cleanup_pending FROM account WHERE id = ?",
            [id],
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
                "UPDATE account SET encrypted_password = ?, legacy_cleanup_pending = 1 WHERE id = ?",
                params![sealed, id],
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
            "UPDATE account SET legacy_cleanup_pending = 0 WHERE id = ?",
            [id],
        );
    }
    Ok((details, password))
}

pub fn update_snapshot(
    db: &mut Connection,
    id: AccountId,
    headers: Vec<MailHeader>,
) -> Result<Inbox, MailError> {
    let transaction = db
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| MailError::Storage)?;
    let details = account(&transaction, id)?.ok_or(MailError::NoAccount)?;
    replace_headers(&transaction, id, &headers).map_err(|_| MailError::Storage)?;
    let can_send = details.uses_gmail_oauth() || has_outgoing(&transaction, id)?;
    let oauth_provider = details
        .uses_gmail_oauth()
        .then_some(super::discovery::OAuthProvider::Gmail);
    transaction.commit().map_err(|_| MailError::Storage)?;
    Ok(Inbox {
        account_id: id,
        email: details.email,
        headers,
        can_send,
        oauth_provider,
    })
}

fn replace_headers(db: &Connection, id: AccountId, headers: &[MailHeader]) -> rusqlite::Result<()> {
    db.execute("DELETE FROM inbox_headers WHERE account_id = ?", [id])?;
    let mut statement = db.prepare(
        "INSERT INTO inbox_headers (account_id, uid_validity, uid, sender, address, subject, sent_at, unread, starred, has_attachments)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )?;
    for header in headers {
        statement.execute(params![
            id,
            header.key.uid_validity,
            header.key.uid,
            header.sender,
            header.address,
            header.subject,
            header.sent_at,
            header.unread,
            header.starred,
            header.has_attachments,
        ])?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_the_old_current_account_and_its_cached_inbox() {
        let mut db = Connection::open_in_memory().unwrap();
        db.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE account (id INTEGER PRIMARY KEY CHECK (id = 1), email TEXT, host TEXT, port INTEGER,
                 username TEXT, start_tls INTEGER, encrypted_password BLOB, legacy_cleanup_pending INTEGER);
             CREATE TABLE outgoing_server (account_id INTEGER PRIMARY KEY REFERENCES account(id), host TEXT, port INTEGER,
                 username TEXT, start_tls INTEGER, encrypted_password BLOB);
             CREATE TABLE inbox_headers (uid_validity INTEGER, uid INTEGER, sender TEXT, address TEXT,
                 subject TEXT, sent_at INTEGER, unread INTEGER, starred INTEGER);
             INSERT INTO account VALUES (1, 'fixture@example.test', 'imap.example.test', 993, 'fixture', 0, x'1234', 1);
             INSERT INTO outgoing_server VALUES (1, 'smtp.example.test', 465, NULL, 0, x'5678');
             INSERT INTO inbox_headers VALUES (4, 7, 'Sender', 'sender@example.test', 'Hello', NULL, 1, 1);
             PRAGMA user_version=5;",
        ).unwrap();
        migrate(&mut db).unwrap();
        let loaded = snapshot(&mut db).unwrap().unwrap();
        assert_eq!(loaded.account_id, 1);
        assert_eq!(loaded.email, "fixture@example.test");
        assert!(loaded.can_send && loaded.headers[0].starred);
        assert_eq!(
            loaded.headers[0].key,
            MessageKey {
                uid_validity: 4,
                uid: 7
            }
        );
        let secrets: (String, String, bool) = db.query_row(
            "SELECT hex(account.encrypted_password), hex(outgoing_server.encrypted_password), legacy_cleanup_pending
             FROM account JOIN outgoing_server ON account.id = outgoing_server.account_id",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(secrets, ("1234".into(), "5678".into(), true));
    }

    #[test]
    fn keeps_credentials_and_matching_message_keys_separate_between_accounts() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("mail.sqlite3");
        let mut db = open(&path).unwrap();
        let key = MessageKey {
            uid_validity: 5,
            uid: 10,
        };
        let header = |subject: &str| MailHeader {
            key,
            sender: "Sender".into(),
            address: "sender@example.test".into(),
            subject: subject.into(),
            sent_at: None,
            unread: true,
            starred: false,
            has_attachments: false,
        };
        let connect = |db: &mut Connection, email: &str, label: &str| {
            save_new_account(
                db,
                directory.path(),
                Account {
                    email: email.into(),
                    host: "imap.example.test".into(),
                    port: 993,
                    username: None,
                    start_tls: false,
                },
                &SmtpSettings {
                    host: "smtp.example.test".into(),
                    port: 465,
                    username: None,
                    start_tls: false,
                },
                label,
                vec![header(label)],
            )
            .unwrap()
            .account_id
        };
        let first = connect(&mut db, "first@example.test", "first password");
        let second = connect(&mut db, "second@example.test", "second password");
        assert_ne!(first, second);
        assert_eq!(snapshot(&mut db).unwrap().unwrap().account_id, second);
        apply_cached_action(&db, first, key, MessageAction::Star).unwrap();
        assert!(!snapshot(&mut db).unwrap().unwrap().headers[0].starred);
        assert!(select_account(&mut db, first).unwrap().headers[0].starred);
        assert!(matches!(
            select_account(&mut db, 999),
            Err(MailError::NoAccount)
        ));
        drop(db);
        let mut db = open(&path).unwrap();
        assert_eq!(snapshot(&mut db).unwrap().unwrap().account_id, first);
        assert_eq!(
            outgoing_connection(&db, directory.path(), second)
                .unwrap()
                .2
                .as_str(),
            "second password"
        );
        update_snapshot(&mut db, second, vec![header("updated second message")]).unwrap();
        assert_eq!(
            snapshot(&mut db).unwrap().unwrap().headers[0].subject,
            "first password"
        );
        assert_eq!(list_accounts(&db).unwrap().len(), 2);
    }

    #[test]
    fn gmail_snapshot_requires_a_saved_refresh_token_and_can_be_reauthorized() {
        let mut db = Connection::open_in_memory().unwrap();
        migrate(&mut db).unwrap();
        let (account, _) = super::super::discovery::gmail_servers("fixture@gmail.com");
        assert_eq!(
            save_gmail_account(&mut db, account.clone(), None, vec![], |_| Err(
                MailError::Credentials
            ))
            .err(),
            Some(MailError::Credentials)
        );
        assert!(snapshot(&mut db).unwrap().is_none());
        for reconnect in [None, Some(1)] {
            save_gmail_account(&mut db, account.clone(), reconnect, vec![], |email| {
                assert_eq!(email, "fixture@gmail.com");
                Ok(())
            })
            .unwrap();
        }
        let reopened = snapshot(&mut db).unwrap().unwrap();
        assert!(reopened.can_send);
        assert_eq!(
            reopened.oauth_provider,
            Some(super::super::discovery::OAuthProvider::Gmail)
        );
        let password_present: bool = db
            .query_row(
                "SELECT encrypted_password IS NOT NULL FROM account WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!password_present);
    }

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
        let legacy = account(&db, 1).unwrap().unwrap();
        assert_eq!(legacy.login(), "mail@example.test");
        assert!(!legacy.start_tls);
        db.execute(
            "UPDATE account SET username = 'mail', start_tls = 1 WHERE id = 1",
            [],
        )
        .unwrap();
        let configured = account(&db, 1).unwrap().unwrap();
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
        let (email, settings, smtp_password) =
            outgoing_connection(&db, directory.path(), 1).unwrap();
        assert_eq!(email, "mail@example.test");
        assert_eq!(settings, outgoing);
        assert_eq!(smtp_password.as_str(), password);
        fn no_legacy(_: &Account) -> Result<keyring::Entry, MailError> {
            panic!("encrypted accounts must not consult the OS credential store");
        }
        let (_, stored) = connection_details(&mut db, directory.path(), 1, no_legacy).unwrap();
        assert_eq!(stored.as_str(), password);

        fs::remove_file(directory.path().join("credentials.key")).unwrap();
        assert_eq!(
            connection_details(&mut db, directory.path(), 1, no_legacy).err(),
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
            connection_details(&mut db, directory.path(), 1, |_| Ok(&entry)).err(),
            Some(MailError::Storage)
        );
        assert_eq!(entry.get_password().unwrap(), "legacy-test-password");

        db.execute_batch("DROP TRIGGER reject_upgrade;").unwrap();
        let (_, password) =
            connection_details(&mut db, directory.path(), 1, |_| Ok(&entry)).unwrap();
        assert_eq!(password.as_str(), "legacy-test-password");
        assert!(matches!(entry.get_password(), Err(keyring::Error::NoEntry)));
        let (_, reopened) = connection_details(
            &mut db,
            directory.path(),
            1,
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
            has_attachments: true,
        };
        set_active(&db, 1).unwrap();
        update_snapshot(&mut db, 1, vec![header(7)]).unwrap();
        assert!(update_snapshot(&mut db, 1, vec![header(9), header(9)]).is_err());
        assert!(contains_message(&db, 1, header(7).key).unwrap());
        update_snapshot(&mut db, 1, vec![header(9)]).unwrap();
        assert!(!contains_message(&db, 1, header(7).key).unwrap());
        assert_eq!(snapshot(&mut db).unwrap().unwrap().headers, vec![header(9)]);
    }
}
