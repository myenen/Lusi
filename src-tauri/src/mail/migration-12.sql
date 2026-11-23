CREATE TABLE scheduled_mail (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    scheduled_at INTEGER NOT NULL,
    wake_at INTEGER NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('queued', 'retrying', 'sending', 'failed', 'uncertain')),
    subject TEXT NOT NULL,
    recipients TEXT NOT NULL,
    payload BLOB NOT NULL
);
CREATE INDEX scheduled_mail_due ON scheduled_mail(state, wake_at, id);
PRAGMA user_version = 12;
