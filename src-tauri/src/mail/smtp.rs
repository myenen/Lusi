use super::{
    html::sanitize_outgoing_html, reply::ReplyThread, setup_diagnostics, Account, MailAuth,
    MailError,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use lettre::transport::smtp::{
    authentication::{Credentials, Mechanism, DEFAULT_MECHANISMS},
    client::{AsyncSmtpConnection, TlsParameters, TlsVersion},
    extension::ClientId,
    Error,
};
use lettre::{
    message::{header::ContentType, Attachment, Mailbox, MultiPart, SinglePart},
    Address, Message,
};
use mail_parser::decoders::html::{html_to_text, text_to_html};
use serde::{Deserialize, Serialize};
use std::time::Duration;

const ATTACHMENT_LIMIT: usize = 5 * 1024 * 1024;
const BODY_LIMIT: usize = 1024 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OutgoingMessage {
    pub(super) to: Vec<String>,
    cc: Vec<String>,
    bcc: Vec<String>,
    pub(super) subject: String,
    body: String,
    html: Option<String>,
    attachments: Vec<OutgoingAttachment>,
    reply_thread: Option<ReplyThread>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OutgoingAttachment {
    name: String,
    data: String,
}

impl OutgoingMessage {
    pub(super) fn visible_recipients(&self) -> Vec<String> {
        self.to
            .iter()
            .chain(&self.cc)
            .map(|address| address.trim().to_owned())
            .collect()
    }

    pub(super) fn bodies(&self) -> (String, String) {
        match &self.html {
            Some(html) => {
                let html = sanitize_outgoing_html(html);
                let mut text_markup = html.clone();
                // The MIME decoder recognizes paragraph and line breaks. Keep editor
                // line blocks and list items on separate lines in the fallback too.
                for block_end in [
                    "</div>",
                    "</li>",
                    "</blockquote>",
                    "</h1>",
                    "</h2>",
                    "</h3>",
                    "</pre>",
                ] {
                    text_markup = text_markup.replace(block_end, "</p>");
                }
                (html_to_text(&text_markup), html)
            }
            None => {
                let html = text_to_html(&self.body);
                (self.body.clone(), html)
            }
        }
    }

    pub(super) fn attachment_names(&self) -> Vec<String> {
        self.attachments
            .iter()
            .map(|file| file.name.clone())
            .collect()
    }

    pub(super) fn build(&self, sender: &str) -> Result<Message, MailError> {
        if self.to.is_empty()
            || self.to.len() + self.cc.len() + self.bcc.len() > 50
            || self.subject.len() > 998
            || self.subject.chars().any(char::is_control)
            || self.body.len() > BODY_LIMIT
            || self
                .html
                .as_ref()
                .is_some_and(|html| html.len() > BODY_LIMIT)
            || self.attachments.len() > 10
            || self
                .attachments
                .iter()
                .map(|file| file.data.len())
                .sum::<usize>()
                > ATTACHMENT_LIMIT.div_ceil(3) * 4 + 40
        {
            return Err(MailError::InvalidMessage);
        }
        let mailbox = |address: &str| {
            address
                .trim()
                .parse::<Address>()
                .map(|address| Mailbox::new(None, address))
                .map_err(|_| MailError::InvalidMessage)
        };
        let mut builder = Message::builder()
            .from(mailbox(sender)?)
            .subject(self.subject.clone())
            .message_id(None);
        if let Some(thread) = &self.reply_thread {
            let (parent, references) = thread.headers()?;
            builder = builder.in_reply_to(parent).references(references);
        }
        for address in &self.to {
            builder = builder.to(mailbox(address)?);
        }
        for address in &self.cc {
            builder = builder.cc(mailbox(address)?);
        }
        for address in &self.bcc {
            builder = builder.bcc(mailbox(address)?);
        }
        let (plain, html) = self.bodies();
        let body = MultiPart::alternative()
            .singlepart(SinglePart::plain(plain))
            .singlepart(SinglePart::html(html));
        if self.attachments.is_empty() {
            return builder
                .multipart(body)
                .map_err(|_| MailError::InvalidMessage);
        }
        let mut parts = MultiPart::mixed().multipart(body);
        let mut total_bytes = 0;
        for file in &self.attachments {
            if file.name.trim().is_empty()
                || file.name.len() > 255
                || file
                    .name
                    .chars()
                    .any(|character| character.is_control() || matches!(character, '/' | '\\'))
            {
                return Err(MailError::InvalidMessage);
            }
            let data = STANDARD
                .decode(&file.data)
                .map_err(|_| MailError::InvalidMessage)?;
            total_bytes += data.len();
            if total_bytes > ATTACHMENT_LIMIT {
                return Err(MailError::InvalidMessage);
            }
            parts = parts.singlepart(
                Attachment::new(file.name.clone()).body(
                    data,
                    ContentType::parse("application/octet-stream")
                        .map_err(|_| MailError::InvalidMessage)?,
                ),
            );
        }
        builder
            .multipart(parts)
            .map_err(|_| MailError::InvalidMessage)
    }
}

pub(super) struct SentMessage {
    pub(super) id: String,
    pub(super) mime: Vec<u8>,
}

pub(super) async fn send(
    settings: &SmtpSettings,
    email: &str,
    auth: &MailAuth,
    message: OutgoingMessage,
) -> Result<SentMessage, MailError> {
    let message = message.build(email)?;
    let id = message
        .headers()
        .get_raw("Message-ID")
        .ok_or(MailError::InvalidMessage)?
        .to_owned();
    let mime = message.formatted();
    let mut session =
        tokio::time::timeout(Duration::from_secs(15), authenticate(settings, email, auth))
            .await
            .map_err(|_| MailError::SmtpUnavailable)??;
    match tokio::time::timeout(
        Duration::from_secs(35),
        session.send(message.envelope(), &mime),
    )
    .await
    {
        Ok(Ok(_)) => {
            let _ = tokio::time::timeout(Duration::from_secs(1), session.quit()).await;
            Ok(SentMessage { id, mime })
        }
        Ok(Err(error)) if error.status().is_some() || error.is_client() => {
            Err(MailError::SendRejected)
        }
        _ => Err(MailError::SendUncertain),
    }
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SmtpSettings {
    pub(super) host: String,
    pub(super) port: u16,
    pub(super) username: Option<String>,
    #[serde(default)]
    pub(super) start_tls: bool,
}

impl SmtpSettings {
    pub(super) fn validated(self, email: &str) -> Result<Self, MailError> {
        let account = Account {
            email: email.into(),
            host: self.host,
            port: self.port,
            username: self.username,
            start_tls: self.start_tls,
        }
        .validated()
        .map_err(|error| match error {
            MailError::InvalidSettings => MailError::SmtpSettings,
            error => error,
        })?;
        Ok(Self::from_server(account))
    }

    pub(super) fn from_server(account: Account) -> Self {
        Self {
            host: account.host,
            port: account.port,
            username: account.username,
            // The submission service on port 465 starts TLS before the SMTP greeting.
            start_tls: account.start_tls && account.port != 465,
        }
    }

    pub(super) fn login<'a>(&'a self, email: &'a str) -> &'a str {
        self.username.as_deref().unwrap_or(email)
    }
}

pub(super) async fn verify(
    settings: &SmtpSettings,
    email: &str,
    auth: &MailAuth,
) -> Result<(), MailError> {
    setup_diagnostics::record(format_args!(
        "smtp start port={} security={}",
        settings.port,
        if settings.start_tls {
            "starttls"
        } else {
            "tls"
        }
    ));
    let verification =
        tokio::time::timeout(Duration::from_secs(15), authenticate(settings, email, auth)).await;
    let mut session = match verification {
        Ok(result) => result?,
        Err(_) => {
            setup_diagnostics::record(format_args!("smtp timeout"));
            return Err(MailError::SmtpUnavailable);
        }
    };
    // Authentication already succeeded. The response to QUIT is diagnostic only.
    match tokio::time::timeout(Duration::from_secs(1), session.quit()).await {
        Ok(Ok(reply)) => {
            setup_diagnostics::record(format_args!("smtp quit status={}", u16::from(reply.code())))
        }
        Ok(Err(error)) => {
            report_error("quit", &error);
        }
        Err(_) => setup_diagnostics::record(format_args!("smtp quit timeout")),
    }
    Ok(())
}

async fn authenticate(
    settings: &SmtpSettings,
    email: &str,
    auth: &MailAuth,
) -> Result<AsyncSmtpConnection, MailError> {
    let parameters = TlsParameters::builder(settings.host.clone())
        .set_min_tls_version(TlsVersion::Tlsv12)
        .build_native()
        .map_err(|error| report_error("tls_setup", &error))?;
    let hello = ClientId::default();
    setup_diagnostics::record(format_args!("smtp connect start"));
    let mut session = AsyncSmtpConnection::connect_tokio1(
        (settings.host.as_str(), settings.port),
        Some(Duration::from_secs(10)),
        &hello,
        (!settings.start_tls).then(|| parameters.clone()),
        None,
    )
    .await
    .map_err(|error| report_error("connect", &error))?;
    setup_diagnostics::record(format_args!("smtp connect ok"));
    if settings.start_tls {
        setup_diagnostics::record(format_args!("smtp starttls start"));
        if !session.can_starttls() {
            setup_diagnostics::record(format_args!("smtp starttls not_advertised"));
            return Err(MailError::SmtpTls);
        }
        session
            .starttls(parameters, &hello)
            .await
            .map_err(|error| {
                report_error("starttls", &error);
                MailError::SmtpTls
            })?;
    }
    if !session.is_encrypted() {
        setup_diagnostics::record(format_args!("smtp tls not_encrypted"));
        return Err(MailError::SmtpTls);
    }
    setup_diagnostics::record(format_args!("smtp tls ok"));
    let mechanisms = match auth {
        MailAuth::Password(_) => DEFAULT_MECHANISMS,
        MailAuth::OAuth(_) => &[Mechanism::Xoauth2],
    };
    let Some(mechanism) = session.server_info().get_auth_mechanism(mechanisms) else {
        setup_diagnostics::record(format_args!("smtp auth no_compatible_mechanism"));
        return Err(MailError::SmtpUnavailable);
    };
    setup_diagnostics::record(format_args!("smtp auth start mechanism={mechanism}"));
    let credential = Credentials::new(settings.login(email).to_owned(), auth.secret().to_owned());
    let reply = session
        .auth(&[mechanism], &credential)
        .await
        .map_err(|error| report_error("auth", &error))?;
    setup_diagnostics::record(format_args!("smtp auth status={}", u16::from(reply.code())));
    if !reply.has_code(235) {
        return Err(MailError::SmtpLoginRejected);
    }
    Ok(session)
}

fn report_error(stage: &str, error: &Error) -> MailError {
    let status = error.status().map(u16::from);
    let kind = if status.is_some() {
        "smtp_status"
    } else if error.is_tls() {
        "tls"
    } else if error.is_timeout() {
        "timeout"
    } else if error.is_response() {
        "invalid_reply"
    } else if error.is_client() {
        "client"
    } else {
        "connection_or_io"
    };
    setup_diagnostics::record(format_args!(
        "smtp {stage} failed category={kind} status={status:?}"
    ));
    match (stage, status) {
        ("auth", Some(534 | 535)) => MailError::SmtpLoginRejected,
        ("tls_setup", _) => MailError::SmtpTls,
        _ if error.is_tls() => MailError::SmtpTls,
        _ => MailError::SmtpUnavailable,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::{
        io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
        net::TcpListener,
    };

    #[test]
    fn builds_a_mime_message_and_keeps_bcc_out_of_its_headers() {
        let outgoing = OutgoingMessage {
            reply_thread: None,
            to: vec!["to@example.test".into()],
            cc: vec![],
            bcc: vec!["private@example.test".into()],
            subject: "Deneme mesajı".into(),
            body: "Merhaba".into(),
            html: None,
            attachments: vec![OutgoingAttachment {
                name: "notes.txt".into(),
                data: "SGVsbG8=".into(),
            }],
        };
        let message = outgoing.build("mail@example.test").unwrap();
        let data = message.formatted();
        let text = std::str::from_utf8(&data).unwrap();
        assert!(!text.contains("private@example.test"));
        assert!(text.contains("multipart/mixed"));
        assert!(text.contains("multipart/alternative"));
        assert!(text.contains("notes.txt"));
        let parsed = mail_parser::MessageParser::default().parse(&data).unwrap();
        assert_eq!(parsed.body_text(0).as_deref(), Some("Merhaba"));
        assert!(parsed
            .body_html(0)
            .unwrap()
            .contains("<body>Merhaba</body>"));
        assert_eq!(message.envelope().to().len(), 2);
    }

    #[test]
    fn sends_sanitized_html_with_a_plain_text_alternative() {
        let outgoing: OutgoingMessage = serde_json::from_value(serde_json::json!({
            "to": ["to@example.test"],
            "cc": [],
            "bcc": [],
            "subject": "Biçimli ileti",
            "body": "Initial draft",
            "html": "<div><b>Merhaba!</b></div><div><a href='javascript:void(0)'>Bağlantı</a></div><ul><li>Bir</li><li>İki</li></ul><script>Ignored</script>",
            "attachments": [],
        }))
        .unwrap();
        let data = outgoing.build("mail@example.test").unwrap().formatted();
        let parsed = mail_parser::MessageParser::default().parse(&data).unwrap();
        let html = parsed.body_html(0).unwrap();
        assert!(html.contains("<b>Merhaba!</b>"));
        assert!(!html.contains("javascript:") && !html.contains("Ignored"));
        let plain = parsed.body_text(0).unwrap();
        assert_eq!(
            plain.lines().collect::<Vec<_>>(),
            ["Merhaba!", "Bağlantı", "Bir", "İki"]
        );
        assert!(!plain.contains("<b>") && !plain.contains("Initial draft"));
    }

    #[test]
    fn selects_implicit_tls_on_port_465() {
        let settings = |port| SmtpSettings {
            host: "smtp.example.test".into(),
            port,
            username: None,
            start_tls: true,
        };
        assert!(
            !settings(465)
                .validated("test@example.test")
                .unwrap()
                .start_tls
        );
        assert!(
            settings(587)
                .validated("test@example.test")
                .unwrap()
                .start_tls
        );
    }

    #[test]
    fn rejects_a_plaintext_server_before_authentication() {
        tauri::async_runtime::block_on(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let settings = SmtpSettings {
                host: "127.0.0.1".into(),
                port: listener.local_addr().unwrap().port(),
                username: None,
                start_tls: true,
            };
            let server = tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut stream = BufReader::new(stream);
                stream
                    .get_mut()
                    .write_all(b"220 fixture.test ESMTP\r\n")
                    .await
                    .unwrap();
                let mut command = String::new();
                stream.read_line(&mut command).await.unwrap();
                assert!(command.starts_with("EHLO "));
                stream
                    .get_mut()
                    .write_all(b"250-fixture.test\r\n250 AUTH PLAIN LOGIN\r\n")
                    .await
                    .unwrap();
                command.clear();
                stream.read_line(&mut command).await.unwrap();
                assert!(command.is_empty() || command == "QUIT\r\n");
            });
            assert!(verify(
                &settings,
                "test@example.test",
                &MailAuth::Password(zeroize::Zeroizing::new("fixture-only".into()))
            )
            .await
            .is_err());
            tokio::time::timeout(Duration::from_secs(2), server)
                .await
                .unwrap()
                .unwrap();
        });
    }
}
