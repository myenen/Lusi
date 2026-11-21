use super::DiscoveredImap;
use crate::mail::{smtp::SmtpSettings, Account, MailError};
use quick_xml::{events::Event, Reader};
use reqwest::{redirect::Policy, Client, Url};
use serde::Deserialize;
use std::{net::IpAddr, time::Duration};

const CONFIG_LIMIT: usize = 64 * 1024;

#[derive(Deserialize)]
struct Config {
    #[serde(rename = "emailProvider", default)]
    providers: Vec<Provider>,
}

#[derive(Deserialize)]
struct Provider {
    #[serde(rename = "domain", default)]
    domains: Vec<String>,
    #[serde(rename = "incomingServer", default)]
    incoming: Vec<Server>,
    #[serde(rename = "outgoingServer", default)]
    outgoing: Vec<Server>,
}

#[derive(Deserialize)]
struct Server {
    #[serde(rename = "@type", default)]
    kind: String,
    #[serde(default)]
    hostname: String,
    #[serde(default)]
    port: String,
    #[serde(rename = "socketType", default)]
    socket_type: String,
    #[serde(default)]
    username: String,
    #[serde(rename = "authentication", default)]
    authentication: Vec<String>,
}

impl Server {
    fn password_settings(
        &self,
        email: &str,
        local: &str,
        domain: &str,
    ) -> Result<Account, MailError> {
        if !self
            .authentication
            .iter()
            .any(|method| method.trim().eq_ignore_ascii_case("password-cleartext"))
        {
            return Err(
                if self
                    .authentication
                    .iter()
                    .any(|method| method.trim().eq_ignore_ascii_case("OAuth2"))
                {
                    MailError::OAuthRequired
                } else {
                    MailError::InvalidSettings
                },
            );
        }
        let start_tls = match self.socket_type.trim().to_ascii_uppercase().as_str() {
            "SSL" => false,
            "STARTTLS" => true,
            _ => return Err(MailError::InvalidSettings),
        };
        let host =
            expand(self.hostname.trim(), email, local, domain).ok_or(MailError::InvalidSettings)?;
        if host.parse::<IpAddr>().is_ok() {
            return Err(MailError::InvalidSettings);
        }
        let port = self
            .port
            .trim()
            .parse()
            .map_err(|_| MailError::InvalidSettings)?;
        let login =
            expand(self.username.trim(), email, local, domain).ok_or(MailError::InvalidSettings)?;
        Account {
            email: email.into(),
            host,
            port,
            username: (!login.is_empty() && login != email).then_some(login),
            start_tls,
        }
        .validated()
    }
}

fn outgoing_settings(
    servers: &[Server],
    email: &str,
    local: &str,
    domain: &str,
) -> Result<Option<SmtpSettings>, MailError> {
    let mut oauth_required = false;
    for server in servers
        .iter()
        .filter(|server| server.kind.eq_ignore_ascii_case("smtp"))
    {
        match server.password_settings(email, local, domain) {
            Ok(account) => return Ok(Some(SmtpSettings::from_server(account))),
            Err(MailError::OAuthRequired) => oauth_required = true,
            Err(_) => {}
        }
    }
    if oauth_required {
        Err(MailError::OAuthRequired)
    } else {
        Ok(None)
    }
}

pub(super) async fn discover(
    email: &str,
    domain: &str,
) -> Result<Option<DiscoveredImap>, MailError> {
    let Ok(client) = Client::builder()
        .https_only(true)
        .min_tls_version(reqwest::tls::Version::TLS_1_2)
        .redirect(Policy::none())
        .timeout(Duration::from_secs(2))
        .build()
    else {
        return Ok(None);
    };
    for url in endpoints(email, domain) {
        let Some(xml) = fetch(&client, url).await else {
            continue;
        };
        if let Some(settings) = parse(&xml, email, domain)? {
            return Ok(Some(settings));
        }
    }
    Ok(None)
}

fn endpoints(email: &str, domain: &str) -> impl Iterator<Item = Url> {
    let subdomain = format!("autoconfig.{domain}");
    [
        (subdomain.as_str(), "/mail/config-v1.1.xml", true),
        (
            domain,
            "/.well-known/autoconfig/mail/config-v1.1.xml",
            false,
        ),
    ]
    .map(|(host, path, include_address)| {
        let mut url = Url::parse(&format!("https://{host}{path}")).ok()?;
        if url.domain() != Some(host) {
            return None;
        }
        if include_address {
            url.query_pairs_mut().append_pair("emailaddress", email);
        }
        Some(url)
    })
    .into_iter()
    .flatten()
}

async fn fetch(client: &Client, url: Url) -> Option<String> {
    let mut response = client.get(url).send().await.ok()?;
    if !response.status().is_success()
        || response
            .content_length()
            .is_some_and(|length| length > CONFIG_LIMIT as u64)
    {
        return None;
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.ok()? {
        if chunk.len() > CONFIG_LIMIT - bytes.len() {
            return None;
        }
        bytes.extend_from_slice(&chunk);
    }
    String::from_utf8(bytes).ok()
}

fn parse(xml: &str, email: &str, domain: &str) -> Result<Option<DiscoveredImap>, MailError> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);
    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) if start.name().as_ref() == "clientConfig" => break,
            Ok(Event::Decl(_) | Event::Comment(_)) => {}
            _ => return Ok(None),
        }
    }
    let Ok(config) = quick_xml::de::from_str::<Config>(xml) else {
        return Ok(None);
    };
    let Some((local, _)) = email.split_once('@') else {
        return Ok(None);
    };
    let mut oauth_required = false;
    for provider in config.providers {
        if !provider
            .domains
            .iter()
            .any(|name| name.trim().eq_ignore_ascii_case(domain))
        {
            continue;
        }
        for server in provider.incoming {
            if !server.kind.eq_ignore_ascii_case("imap") {
                continue;
            }
            match server.password_settings(email, local, domain) {
                Ok(account) => {
                    return Ok(Some(DiscoveredImap {
                        host: account.host,
                        port: account.port,
                        needs_confirmation: false,
                        username: account.username,
                        start_tls: account.start_tls,
                        outgoing: outgoing_settings(&provider.outgoing, email, local, domain)?,
                        oauth_provider: None,
                    }))
                }
                Err(MailError::OAuthRequired) => oauth_required = true,
                Err(_) => {}
            }
        }
    }
    if oauth_required {
        Err(MailError::OAuthRequired)
    } else {
        Ok(None)
    }
}

fn expand(mut template: &str, email: &str, local: &str, domain: &str) -> Option<String> {
    let mut value = String::new();
    while let Some((prefix, placeholder)) = template.split_once('%') {
        let (key, rest) = placeholder.split_once('%')?;
        value.push_str(prefix);
        value.push_str(match key {
            "EMAILADDRESS" => email,
            "EMAILLOCALPART" => local,
            "EMAILDOMAIN" => domain,
            _ => return None,
        });
        template = rest;
    }
    value.push_str(template);
    Some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    const SSL: &str = r#"<incomingServer type="imap">
      <hostname>imap.provider.test</hostname><port>993</port><socketType>SSL</socketType>
      <username>%EMAILLOCALPART%</username><authentication>password-cleartext</authentication>
    </incomingServer>"#;

    fn config(domain: &str, servers: &str) -> String {
        format!(
            r#"<?xml version="1.0"?>
          <clientConfig version="1.1"><emailProvider id="provider">
            <domain>{domain}</domain>{servers}
          </emailProvider></clientConfig>"#
        )
    }

    #[test]
    fn uses_only_provider_https_endpoints_and_encodes_the_address() {
        let urls: Vec<_> = endpoints("mail+test@example.test", "example.test").collect();
        assert_eq!(urls[0].as_str(), "https://autoconfig.example.test/mail/config-v1.1.xml?emailaddress=mail%2Btest%40example.test");
        assert_eq!(
            urls[1].as_str(),
            "https://example.test/.well-known/autoconfig/mail/config-v1.1.xml"
        );
    }

    #[test]
    fn selects_tls_imap_and_expands_the_provider_login() {
        let unsupported = SSL.replace("SSL", "plain");
        let document = config("example.test", &format!("{unsupported}{SSL}"));
        assert_eq!(
            parse(&document, "mail@example.test", "example.test"),
            Ok(Some(DiscoveredImap {
                host: "imap.provider.test".into(),
                port: 993,
                needs_confirmation: false,
                username: Some("mail".into()),
                start_tls: false,
                outgoing: None,
                oauth_provider: None,
            }))
        );
    }

    #[test]
    fn accepts_starttls_when_advertised() {
        let starttls = SSL.replace("SSL", "STARTTLS").replace("993", "143");
        let settings = parse(
            &config("example.test", &starttls),
            "mail@example.test",
            "example.test",
        )
        .unwrap()
        .unwrap();
        assert!(settings.start_tls);
        assert_eq!(settings.port, 143);
    }

    #[test]
    fn discovers_smtp_with_its_own_login_and_skips_cleartext_servers() {
        let smtp = r#"<outgoingServer type="smtp">
            <hostname>smtp.provider.test</hostname><port>587</port><socketType>STARTTLS</socketType>
            <username>%EMAILLOCALPART%-out</username><authentication>password-cleartext</authentication>
        </outgoingServer>"#;
        let cleartext = smtp.replace("STARTTLS", "plain").replace("587", "25");
        let discovered = parse(
            &config("example.test", &format!("{SSL}{cleartext}{smtp}")),
            "mail@example.test",
            "example.test",
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            discovered.outgoing,
            Some(SmtpSettings {
                host: "smtp.provider.test".into(),
                port: 587,
                username: Some("mail-out".into()),
                start_tls: true,
            })
        );
        assert_eq!(
            parse(
                &config("example.test", &format!("{SSL}{cleartext}")),
                "mail@example.test",
                "example.test"
            )
            .unwrap()
            .unwrap()
            .outgoing,
            None,
        );
    }

    #[test]
    fn rejects_plaintext_wrong_domains_and_xml_dtds() {
        let unsupported = SSL.replace("SSL", "plain");
        let wrong_domain = config("other.test", SSL);
        let dtd = format!(
            "<!DOCTYPE clientConfig SYSTEM \"https://example.test/remote.dtd\">{}",
            config("example.test", SSL)
        );
        for document in [config("example.test", &unsupported), wrong_domain, dtd] {
            assert_eq!(
                parse(&document, "mail@example.test", "example.test"),
                Ok(None)
            );
        }
    }

    #[test]
    fn does_not_prompt_for_a_password_when_the_provider_requires_oauth() {
        let oauth = config("example.test", &SSL.replace("password-cleartext", "OAuth2"));
        assert_eq!(
            parse(&oauth, "mail@example.test", "example.test"),
            Err(MailError::OAuthRequired)
        );
    }
}
