use super::{address_domain, discovery::is_gmail_domain, Inbox, MailError};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use reqwest::{Client, Response, Url};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
};
use serde::{de::DeserializeOwned, Deserialize};
use std::{collections::HashMap, env, future::Future, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::Mutex,
    time::{timeout, Instant},
};
use zeroize::Zeroizing;

const MAIL_SCOPE: &str = "https://mail.google.com/";
const CALLBACK_PATH: &str = "/oauth/gmail/callback";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://openidconnect.googleapis.com/v1/userinfo";

struct ClientConfig {
    id: String,
    secret: Option<Zeroizing<String>>,
}

impl ClientConfig {
    fn load() -> Result<Self, MailError> {
        let id = env::var("LUSI_GOOGLE_CLIENT_ID")
            .ok()
            .or_else(|| option_env!("LUSI_GOOGLE_CLIENT_ID").map(str::to_owned))
            .filter(|id| id.ends_with(".apps.googleusercontent.com") && id.len() <= 512)
            .ok_or(MailError::GoogleNotConfigured)?;
        let secret = env::var("LUSI_GOOGLE_CLIENT_SECRET")
            .ok()
            .filter(|secret| !secret.is_empty())
            .map(Zeroizing::new);
        Ok(Self { id, secret })
    }

    async fn exchange(&self, parameters: &[(&str, &str)]) -> Result<TokenResponse, MailError> {
        // Serialize the form without placing secrets in the token endpoint URL.
        let mut form = Url::parse(TOKEN_URL).map_err(|_| MailError::GoogleSignIn)?;
        {
            let mut fields = form.query_pairs_mut();
            fields.append_pair("client_id", &self.id);
            if let Some(secret) = &self.secret {
                fields.append_pair("client_secret", secret);
            }
            fields.extend_pairs(parameters.iter().copied());
        }
        let body = form.query().ok_or(MailError::GoogleSignIn)?.to_owned();
        let response = http_client()?
            .post(TOKEN_URL)
            .header(
                reqwest::header::CONTENT_TYPE,
                "application/x-www-form-urlencoded",
            )
            .body(body)
            .send()
            .await
            .map_err(|_| MailError::GoogleSignIn)?;
        if !response.status().is_success() {
            let error: TokenError = read_json(response).await?;
            return Err(match error.error.as_str() {
                "invalid_grant" => MailError::GoogleGrantExpired,
                "invalid_client" | "unauthorized_client" => MailError::GoogleNotConfigured,
                _ => MailError::GoogleSignIn,
            });
        }
        read_json(response).await
    }
}

#[derive(Deserialize)]
struct TokenError {
    error: String,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    token_type: String,
    expires_in: u64,
    scope: Option<String>,
}

#[derive(Clone)]
pub(super) struct AccessToken {
    pub value: Zeroizing<String>,
    usable_until: Instant,
}

impl TokenResponse {
    fn into_tokens(self) -> Result<(AccessToken, Option<Zeroizing<String>>), MailError> {
        if !self.token_type.eq_ignore_ascii_case("Bearer")
            || self.expires_in == 0
            || !valid_token(&self.access_token)
            || self
                .refresh_token
                .as_deref()
                .is_some_and(|token| !valid_token(token))
        {
            return Err(MailError::GoogleSignIn);
        }
        if self
            .scope
            .as_deref()
            .is_some_and(|scope| !scope.split_whitespace().any(|part| part == MAIL_SCOPE))
        {
            return Err(MailError::GoogleConsent);
        }
        Ok((
            AccessToken {
                value: Zeroizing::new(self.access_token),
                usable_until: Instant::now()
                    + Duration::from_secs(self.expires_in.min(3600).saturating_sub(60)),
            },
            self.refresh_token.map(Zeroizing::new),
        ))
    }
}

fn valid_token(token: &str) -> bool {
    !token.is_empty() && token.len() <= 4096 && token.bytes().all(|byte| byte.is_ascii_graphic())
}

pub(super) struct AuthorizedAccount {
    pub email: String,
    pub access: AccessToken,
    pub refresh: Zeroizing<String>,
}

#[derive(Default)]
pub struct GmailSession(Mutex<HashMap<String, AccessToken>>);

impl GmailSession {
    pub(super) async fn save_authorized(
        &self,
        email: String,
        access: AccessToken,
        save: impl Future<Output = Result<Inbox, MailError>>,
    ) -> Result<Inbox, MailError> {
        let mut saved = self.0.lock().await;
        let inbox = save.await?;
        saved.insert(email, access);
        Ok(inbox)
    }

    pub(super) async fn access(&self, email: &str) -> Result<Zeroizing<String>, MailError> {
        let mut saved = self.0.lock().await;
        if let Some(token) = saved
            .get(email)
            .filter(|token| token.usable_until > Instant::now())
        {
            return Ok(token.value.clone());
        }
        let config = ClientConfig::load()?;
        let keyring_email = email.to_owned();
        let refresh = tauri::async_runtime::spawn_blocking(move || {
            keyring_entry(&keyring_email)?
                .get_password()
                .map(Zeroizing::new)
                .map_err(|_| MailError::Credentials)
        })
        .await
        .map_err(|_| MailError::Credentials)??;
        let result = config
            .exchange(&[("grant_type", "refresh_token"), ("refresh_token", &refresh)])
            .await?;
        let (access, new_refresh) = result.into_tokens()?;
        if let Some(refresh) = new_refresh {
            let keyring_email = email.to_owned();
            tauri::async_runtime::spawn_blocking(move || store_refresh(&keyring_email, &refresh))
                .await
                .map_err(|_| MailError::Credentials)??;
        }
        let value = access.value.clone();
        saved.insert(email.into(), access);
        Ok(value)
    }
}

fn keyring_entry(email: &str) -> Result<keyring::Entry, MailError> {
    keyring::Entry::new("dev.minimalmail.desktop.oauth.gmail", email)
        .map_err(|_| MailError::Credentials)
}

pub(super) fn store_refresh(email: &str, refresh: &str) -> Result<(), MailError> {
    keyring_entry(email)?
        .set_password(refresh)
        .map_err(|_| MailError::Credentials)
}

pub(super) async fn authorize(email: &str) -> Result<AuthorizedAccount, MailError> {
    let expected = gmail_identity(email).ok_or(MailError::InvalidSettings)?;
    let config = ClientConfig::load()?;
    let verifier = random_parameter()?;
    let state = random_parameter()?;
    let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
        .await
        .map_err(|_| MailError::GoogleSignIn)?;
    let port = listener
        .local_addr()
        .map_err(|_| MailError::GoogleSignIn)?
        .port();
    let redirect = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let url = authorization_url(&config.id, email, &redirect, &state, &challenge(&verifier))?;
    open::that_detached(url.as_str()).map_err(|_| MailError::GoogleBrowser)?;
    let code = timeout(Duration::from_secs(180), wait_for_code(&listener, &state))
        .await
        .map_err(|_| MailError::Timeout)??;
    drop(listener);
    let response = config
        .exchange(&[
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect),
        ])
        .await?;
    let (access, refresh) = response.into_tokens()?;
    let refresh = refresh.ok_or(MailError::GoogleConsent)?;
    let response = http_client()?
        .get(USERINFO_URL)
        .bearer_auth(&*access.value)
        .send()
        .await
        .map_err(|_| MailError::GoogleSignIn)?;
    if !response.status().is_success() {
        return Err(MailError::GoogleSignIn);
    }
    let identity: UserInfo = read_json(response).await?;
    if !identity.email_verified
        || gmail_identity(&identity.email).as_deref() != Some(expected.as_str())
    {
        return Err(MailError::GoogleAccountMismatch);
    }
    Ok(AuthorizedAccount {
        email: identity.email.to_ascii_lowercase(),
        access,
        refresh,
    })
}

#[derive(Deserialize)]
struct UserInfo {
    email: String,
    email_verified: bool,
}

fn gmail_identity(email: &str) -> Option<String> {
    let domain = address_domain(email).ok()?;
    if !is_gmail_domain(domain) {
        return None;
    }
    let local = email.trim().split_once('@')?.0;
    let base = local
        .split('+')
        .next()?
        .replace('.', "")
        .to_ascii_lowercase();
    (!base.is_empty() && base.bytes().all(|byte| byte.is_ascii_alphanumeric())).then_some(base)
}

pub(super) fn same_mailbox(first: &str, second: &str) -> bool {
    gmail_identity(first).is_some_and(|first| Some(first) == gmail_identity(second))
}

fn random_parameter() -> Result<Zeroizing<String>, MailError> {
    let mut random = Zeroizing::new([0u8; 32]);
    SystemRandom::new()
        .fill(&mut *random)
        .map_err(|_| MailError::GoogleSignIn)?;
    Ok(Zeroizing::new(URL_SAFE_NO_PAD.encode(&random[..])))
}

fn challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, verifier.as_bytes()).as_ref())
}

fn authorization_url(
    id: &str,
    email: &str,
    redirect: &str,
    state: &str,
    challenge: &str,
) -> Result<Url, MailError> {
    let mut url = Url::parse(AUTH_URL).map_err(|_| MailError::GoogleSignIn)?;
    url.query_pairs_mut().extend_pairs([
        ("client_id", id),
        ("redirect_uri", redirect),
        ("response_type", "code"),
        ("scope", "openid email https://mail.google.com/"),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("login_hint", email),
        ("state", state),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
    ]);
    Ok(url)
}

async fn wait_for_code(
    listener: &TcpListener,
    state: &str,
) -> Result<Zeroizing<String>, MailError> {
    loop {
        let (mut stream, _) = listener
            .accept()
            .await
            .map_err(|_| MailError::GoogleSignIn)?;
        let callback = timeout(Duration::from_secs(3), read_callback(&mut stream, state))
            .await
            .ok()
            .flatten();
        let (status, message) = match &callback {
            Some(Ok(_)) => ("200 OK", "Return to Lusi to finish signing in."),
            Some(Err(_)) => (
                "200 OK",
                "Google sign-in was declined. Return to Lusi to retry.",
            ),
            None => ("400 Bad Request", "Invalid sign-in response."),
        };
        let response = format!(
            "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{message}",
            message.len()
        );
        let _ = timeout(
            Duration::from_secs(1),
            stream.write_all(response.as_bytes()),
        )
        .await;
        if let Some(callback) = callback {
            return callback;
        }
    }
}

async fn read_callback(
    stream: &mut TcpStream,
    state: &str,
) -> Option<Result<Zeroizing<String>, MailError>> {
    let mut request = Zeroizing::new([0u8; 8192]);
    let mut used = 0;
    while used < request.len() {
        let read = stream.read(&mut request[used..]).await.ok()?;
        if read == 0 {
            break;
        }
        used += read;
        if request[..used].windows(4).any(|part| part == b"\r\n\r\n") {
            let line = std::str::from_utf8(&request[..used]).ok()?.lines().next()?;
            return parse_callback(line, state);
        }
    }
    None
}

fn parse_callback(
    line: &str,
    expected_state: &str,
) -> Option<Result<Zeroizing<String>, MailError>> {
    let mut parts = line.split_ascii_whitespace();
    if parts.next()? != "GET" {
        return None;
    }
    let (path, query) = parts.next()?.split_once('?')?;
    if path != CALLBACK_PATH
        || !matches!(parts.next()?, "HTTP/1.1" | "HTTP/1.0")
        || parts.next().is_some()
    {
        return None;
    }
    let url = Url::parse(&format!("http://127.0.0.1/?{query}")).ok()?;
    let mut state = None;
    let mut code = None;
    let mut error = None;
    for (name, value) in url.query_pairs() {
        match name.as_ref() {
            "state" if state.is_none() => state = Some(value),
            "code" if code.is_none() => code = Some(value),
            "error" if error.is_none() => error = Some(value),
            "state" | "code" | "error" => return None,
            _ => {}
        }
    }
    if state.as_deref() != Some(expected_state) {
        return None;
    }
    match (code, error) {
        (Some(code), None) if valid_token(&code) => Some(Ok(Zeroizing::new(code.into_owned()))),
        (None, Some(_)) => Some(Err(MailError::GoogleConsent)),
        _ => None,
    }
}

fn http_client() -> Result<Client, MailError> {
    Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|_| MailError::GoogleSignIn)
}

async fn read_json<T: DeserializeOwned>(mut response: Response) -> Result<T, MailError> {
    let mut json = Zeroizing::new(Vec::new());
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| MailError::GoogleSignIn)?
    {
        if json.len() + chunk.len() > 32_768 {
            return Err(MailError::GoogleSignIn);
        }
        json.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&json).map_err(|_| MailError::GoogleSignIn)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uses_s256_offline_access_and_the_mail_scope() {
        let digest = challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk");
        assert_eq!(digest, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
        let redirect = "http://127.0.0.1:1234/oauth/gmail/callback";
        let url = authorization_url(
            "fixture",
            "test+alias@gmail.com",
            redirect,
            "state",
            &digest,
        )
        .unwrap();
        let pairs: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(url.host_str(), Some("accounts.google.com"));
        assert_eq!(pairs["code_challenge_method"], "S256");
        assert_eq!(pairs["redirect_uri"], redirect);
        assert_eq!(pairs["scope"], "openid email https://mail.google.com/");
        assert_eq!(pairs["access_type"], "offline");
        assert_eq!(pairs["login_hint"], "test+alias@gmail.com");
    }

    #[test]
    fn requires_the_exact_callback_path_and_single_matching_state() {
        let code = parse_callback(
            "GET /oauth/gmail/callback?code=x%2Fy&state=match HTTP/1.1",
            "match",
        )
        .unwrap()
        .unwrap();
        assert_eq!(&*code, "x/y");
        for line in [
            "GET /oauth/gmail/callback?code=x&state=wrong HTTP/1.1",
            "GET /oauth/gmail/callback?code=x&state=match&state=match HTTP/1.1",
            "GET /oauth/gmail/callback?code=x&state=match&error=access_denied HTTP/1.1",
            "GET /elsewhere?code=x&state=match HTTP/1.1",
            "POST /oauth/gmail/callback?code=x&state=match HTTP/1.1",
        ] {
            assert!(parse_callback(line, "match").is_none());
        }
        assert_eq!(
            parse_callback(
                "GET /oauth/gmail/callback?error=access_denied&state=match HTTP/1.1",
                "match"
            )
            .unwrap()
            .err(),
            Some(MailError::GoogleConsent)
        );
    }

    #[tokio::test]
    async fn loopback_listener_ignores_invalid_state_and_accepts_the_matching_callback() {
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            timeout(Duration::from_secs(3), wait_for_code(&listener, "expected"))
                .await
                .unwrap()
                .unwrap()
        });
        for (state, status) in [("wrong", "400 Bad Request"), ("expected", "200 OK")] {
            let mut stream = TcpStream::connect(address).await.unwrap();
            let request = format!(
                "GET {CALLBACK_PATH}?code=fixture&state={state} HTTP/1.1\r\nHost: {address}\r\n\r\n"
            );
            stream.write_all(request.as_bytes()).await.unwrap();
            let mut response = String::new();
            stream.read_to_string(&mut response).await.unwrap();
            assert!(response.starts_with(&format!("HTTP/1.1 {status}")));
            assert!(!response.contains("fixture"));
        }
        assert_eq!(&*server.await.unwrap(), "fixture");
    }

    #[test]
    fn recognizes_personal_gmail_aliases_only() {
        assert!(same_mailbox(
            " First.Last+tag@GOOGLEMAIL.COM ",
            "firstlast@gmail.com"
        ));
        assert!(!same_mailbox(
            "first.last@gmail.com",
            "firstlast@example.com"
        ));
        assert!(!same_mailbox("first.last@gmail.com", "another@gmail.com"));
        assert!(!same_mailbox(
            "first.last@gmail.com.example.com",
            "firstlast@gmail.com"
        ));
    }

    #[test]
    fn rejects_a_token_with_only_identity_scope() {
        let response: TokenResponse = serde_json::from_str(
            r#"{"access_token":"fixture","token_type":"Bearer","expires_in":3600,"scope":"openid email"}"#,
        ).unwrap();
        assert_eq!(response.into_tokens().err(), Some(MailError::GoogleConsent));
    }
}
