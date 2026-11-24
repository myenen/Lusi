ALTER TABLE account ADD COLUMN signature TEXT NOT NULL DEFAULT '';
CREATE TABLE recent_correspondents (
    account_id INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
    address_key TEXT NOT NULL,
    address TEXT NOT NULL,
    name TEXT NOT NULL,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY (account_id, address_key)
);
CREATE INDEX recent_correspondents_by_date ON recent_correspondents(account_id, seen_at DESC);
INSERT OR IGNORE INTO recent_correspondents
SELECT account_id, lower(address), address, sender, coalesce(sent_at, 0)
FROM inbox_headers WHERE address <> '' ORDER BY sent_at DESC;
PRAGMA user_version = 13;
