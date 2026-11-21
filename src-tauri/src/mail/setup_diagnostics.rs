use std::{
    fmt::Arguments,
    time::{SystemTime, UNIX_EPOCH},
};

pub(super) fn record(event: Arguments<'_>) {
    if std::env::var("LUSI_SETUP_DIAGNOSTICS").as_deref() == Ok("1") {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default();
        eprintln!(
            "lusi-setup {}.{:03} {event}",
            timestamp.as_secs(),
            timestamp.subsec_millis()
        );
    }
}
