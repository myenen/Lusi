CREATE TABLE account_v6 (
    id INTEGER PRIMARY KEY,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    username TEXT,
    start_tls INTEGER NOT NULL DEFAULT 0 CHECK (start_tls IN (0, 1)),
    encrypted_password BLOB,
    legacy_cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK (legacy_cleanup_pending IN (0, 1))
);
CREATE TABLE outgoing_server_v6 (
    account_id INTEGER PRIMARY KEY REFERENCES account_v6(id),
    host TEXT NOT NULL,
    port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
    username TEXT,
    start_tls INTEGER NOT NULL CHECK (start_tls IN (0, 1)),
    encrypted_password BLOB NOT NULL
);
CREATE TABLE inbox_headers_v6 (
    account_id INTEGER NOT NULL REFERENCES account_v6(id),
    uid_validity INTEGER NOT NULL,
    uid INTEGER NOT NULL,
    sender TEXT NOT NULL,
    address TEXT NOT NULL,
    subject TEXT NOT NULL,
    sent_at INTEGER,
    unread INTEGER NOT NULL,
    starred INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (account_id, uid_validity, uid)
);

INSERT INTO account_v6 SELECT id, email, host, port, username, start_tls, encrypted_password, legacy_cleanup_pending FROM account;
INSERT INTO outgoing_server_v6 SELECT account_id, host, port, username, start_tls, encrypted_password FROM outgoing_server;
INSERT INTO inbox_headers_v6
    SELECT account.id, inbox_headers.uid_validity, inbox_headers.uid, inbox_headers.sender, inbox_headers.address,
           inbox_headers.subject, inbox_headers.sent_at, inbox_headers.unread, inbox_headers.starred
    FROM inbox_headers JOIN account ON account.id = 1;

DROP TABLE outgoing_server;
DROP TABLE inbox_headers;
DROP TABLE account;
ALTER TABLE account_v6 RENAME TO account;
ALTER TABLE outgoing_server_v6 RENAME TO outgoing_server;
ALTER TABLE inbox_headers_v6 RENAME TO inbox_headers;
CREATE INDEX inbox_headers_account_uid ON inbox_headers(account_id, uid DESC);
CREATE TABLE active_account (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    account_id INTEGER NOT NULL REFERENCES account(id)
);
INSERT INTO active_account SELECT 1, id FROM account ORDER BY id LIMIT 1;
PRAGMA user_version = 6;
