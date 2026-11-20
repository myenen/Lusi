use super::{validate_address, Account, MailError};
use hickory_resolver::{
    proto::rr::{rdata::SRV, RData},
    TokioResolver,
};
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
}

#[tauri::command]
pub async fn discover_imap_settings(email: String) -> Result<Option<DiscoveredImap>, MailError> {
    let email = email.trim();
    validate_address(email)?;
    let (_, domain) = email.split_once('@').ok_or(MailError::InvalidSettings)?;
    let domain = domain.to_ascii_lowercase();
    let Ok(resolver) = TokioResolver::builder_tokio().and_then(|builder| builder.build()) else {
        return Ok(None);
    };
    let query = format!("_imaps._tcp.{domain}.");
    let Ok(Ok(lookup)) = timeout(Duration::from_secs(4), resolver.srv_lookup(query)).await else {
        return Ok(None);
    };
    select_server(
        email,
        &domain,
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
        })
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn server(priority: u16, host: &str, port: u16) -> SRV {
        SRV::new(priority, 0, port, host.parse().unwrap())
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
                needs_confirmation: false
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
