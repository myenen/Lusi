CREATE TABLE opened_messages (
    account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    folder TEXT NOT NULL,
    uid_validity INTEGER NOT NULL,
    uid INTEGER NOT NULL,
    content BLOB NOT NULL,
    PRIMARY KEY (account_id, folder, uid_validity, uid)
);
PRAGMA user_version = 8;
