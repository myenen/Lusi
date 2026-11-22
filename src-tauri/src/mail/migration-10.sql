CREATE TABLE inbox_sync_state (
    account_id INTEGER PRIMARY KEY REFERENCES account(id) ON DELETE CASCADE,
    uid_validity INTEGER NOT NULL,
    high_uid INTEGER NOT NULL
);
PRAGMA user_version = 10;
