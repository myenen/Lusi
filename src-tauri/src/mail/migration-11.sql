CREATE TABLE notification_targets (
    token BLOB PRIMARY KEY NOT NULL,
    account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    uid_validity INTEGER NOT NULL,
    uid INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
);
PRAGMA user_version = 11;
