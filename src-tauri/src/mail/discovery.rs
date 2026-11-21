mod autoconfig;
mod providers;

use super::{address_domain, smtp::SmtpSettings, validate_address, Account, MailError};
use hickory_resolver::{
    proto::rr::{rdata::SRV, RData},
    TokioResolver,
};
pub(super) use providers::{gmail_servers, is_gmail_domain, OAuthProvider};
use rand::{seq::SliceRandom, RngExt};
use serde::Serialize;
use std::time::Duration;
use tokio::time::timeout;

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredImap {
    host: String,
    port: u16,
    needs_confirmation: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    username: Option<String>,
    start_tls: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    outgoing: Option<SmtpSettings>,
    #[serde(skip_serializing_if = "Option::is_none")]
    oauth_provider: Option<OAuthProvider>,
}

#[tauri::command]
pub async fn discover_imap_settings(email: String) -> Result<Option<DiscoveredImap>, MailError> {
    let email = email.trim();
    let domain = address_domain(email)?;
    if let Some(settings) = providers::preset(email, domain) {
        return Ok(Some(settings));
    }
    validate_address(email)?;
    let domain = domain.to_ascii_lowercase();
    if let Some(settings) = autoconfig::discover(email, &domain).await? {
        return Ok(Some(settings));
    }
    discover_srv(email, &domain).await
}

async fn discover_srv(email: &str, domain: &str) -> Result<Option<DiscoveredImap>, MailError> {
    let Ok(resolver) = TokioResolver::builder_tokio().and_then(|builder| builder.build()) else {
        return Ok(None);
    };
    let query = format!("_imaps._tcp.{domain}.");
    let Ok(Ok(lookup)) = timeout(Duration::from_secs(4), resolver.srv_lookup(query)).await else {
        return Ok(None);
    };
    select_server(
        email,
        domain,
        lookup
            .answers()
            .iter()
            .filter_map(|record| match &record.data {
                RData::SRV(server) => Some(server),
                _ => None,
            }),
    )
}

fn select_server<'a>(
    email: &str,
    domain: &str,
    records: impl Iterator<Item = &'a SRV>,
) -> Result<Option<DiscoveredImap>, MailError> {
    let mut candidates = Vec::new();
    let mut oauth_required = false;
    for record in records {
        let target = record.target.to_ascii();
        let host = target
            .strip_suffix('.')
            .unwrap_or(&target)
            .to_ascii_lowercase();
        if host.parse::<std::net::IpAddr>().is_ok() {
            continue;
        }
        match (Account {
            email: email.into(),
            host,
            port: record.port,
            username: None,
            start_tls: false,
        })
        .validated()
        {
            Ok(account) => candidates.push((record, account)),
            Err(MailError::OAuthRequired) => oauth_required = true,
            Err(_) => {}
        }
    }
    let Some(priority) = candidates.iter().map(|(record, _)| record.priority).min() else {
        return if oauth_required {
            Err(MailError::OAuthRequired)
        } else {
            Ok(None)
        };
    };
    candidates.retain(|(record, _)| record.priority == priority);

    let mut rng = rand::rng();
    candidates.shuffle(&mut rng);
    candidates.sort_by_key(|(record, _)| record.weight != 0);
    let total_weight: u64 = candidates
        .iter()
        .map(|(record, _)| u64::from(record.weight))
        .sum();
    let mut draw = rng.random_range(0..=total_weight);
    Ok(candidates.into_iter().find_map(|(record, account)| {
        let weight = u64::from(record.weight);
        if draw > weight {
            draw -= weight;
            return None;
        }
        let same_domain = account.host == domain
            || account
                .host
                .strip_suffix(domain)
                .is_some_and(|prefix| prefix.ends_with('.'));
        Some(DiscoveredImap {
            host: account.host,
            port: account.port,
            needs_confirmation: !same_domain,
            username: None,
            start_tls: false,
            outgoing: None,
            oauth_provider: None,
        })
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(priority: u16, host: &str, port: u16) -> SRV {
        SRV::new(priority, 0, port, host.parse().unwrap())
    }

    #[tokio::test]
    async fn discovers_gmail_and_googlemail_before_password_discovery() {
        for email in ["mail@gmail.com", "Mail+test@GOOGLEMAIL.COM"] {
            let settings = discover_imap_settings(format!(" {email} "))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(settings.host, "imap.gmail.com");
            assert_eq!(settings.port, 993);
            assert!(!settings.start_tls && !settings.needs_confirmation);
            assert_eq!(settings.username.as_deref(), Some(email));
            assert_eq!(settings.oauth_provider, Some(OAuthProvider::Gmail));
            assert_eq!(
                settings.outgoing,
                Some(SmtpSettings {
                    host: "smtp.gmail.com".into(),
                    port: 465,
                    username: Some(email.into()),
                    start_tls: false,
                })
            );
            assert_eq!(validate_address(email), Err(MailError::OAuthRequired));
        }
        assert!(
            providers::preset("mail@gmail.com.example.test", "gmail.com.example.test").is_none()
        );
        assert_eq!(
            discover_imap_settings("@gmail.com".into()).await,
            Err(MailError::InvalidSettings)
        );
        assert_eq!(
            discover_imap_settings("mail@outlook.com".into()).await,
            Err(MailError::OAuthRequired)
        );
    }

    #[test]
    fn uses_the_lowest_usable_priority_and_preserves_the_advertised_port() {
        let records = [
            server(1, "bad.example.test.", 0),
            server(20, "backup.example.test.", 993),
            server(10, "IMAP.example.test.", 1993),
        ];
        assert_eq!(
            select_server("mail@example.test", "example.test", records.iter()),
            Ok(Some(DiscoveredImap {
                host: "imap.example.test".into(),
                port: 1993,
                needs_confirmation: false,
                username: None,
                start_tls: false,
                outgoing: None,
                oauth_provider: None,
            })),
        );
    }

    #[test]
    fn requests_confirmation_for_an_unrelated_domain() {
        let records = [server(0, "imap.notexample.test.", 993)];
        let result = select_server("mail@example.test", "example.test", records.iter()).unwrap();
        assert!(result.unwrap().needs_confirmation);
    }

    #[test]
    fn falls_back_for_unavailable_service_and_blocks_known_oauth_hosts() {
        let unavailable = [server(0, ".", 0)];
        assert_eq!(
            select_server("mail@example.test", "example.test", unavailable.iter()),
            Ok(None)
        );
        let oauth = [server(0, "outlook.office365.com.", 993)];
        assert_eq!(
            select_server("mail@example.test", "example.test", oauth.iter()),
            Err(MailError::OAuthRequired)
        );
    }
}
