use super::{Account, DiscoveredImap, SmtpSettings};
use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::mail) enum OAuthProvider {
    Gmail,
}

pub(in crate::mail) fn is_gmail_domain(domain: &str) -> bool {
    ["gmail.com", "googlemail.com"]
        .iter()
        .any(|known_domain| domain.eq_ignore_ascii_case(known_domain))
}

pub(super) fn preset(email: &str, domain: &str) -> Option<DiscoveredImap> {
    let (account, outgoing) = is_gmail_domain(domain).then(|| gmail_servers(email))?;
    Some(DiscoveredImap {
        host: account.host,
        port: account.port,
        needs_confirmation: false,
        username: account.username,
        start_tls: account.start_tls,
        outgoing: Some(outgoing),
        oauth_provider: Some(OAuthProvider::Gmail),
    })
}

pub(in crate::mail) fn gmail_servers(email: &str) -> (Account, SmtpSettings) {
    // Google for Developers: https://developers.google.com/workspace/gmail/imap/imap-smtp
    (
        Account {
            email: email.into(),
            host: "imap.gmail.com".into(),
            port: 993,
            username: Some(email.into()),
            start_tls: false,
        },
        SmtpSettings {
            host: "smtp.gmail.com".into(),
            port: 465,
            username: Some(email.into()),
            start_tls: false,
        },
    )
}
