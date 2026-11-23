use super::MailError;
use lettre::Address;
use mail_parser::{AddressList, MessageParser};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ReplyDetails {
    to: Vec<String>,
    cc: Vec<String>,
    thread: Option<ReplyThread>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ReplyThread {
    in_reply_to: String,
    references: Vec<String>,
}

impl ReplyThread {
    pub(super) fn headers(&self) -> Result<(String, String), MailError> {
        let parent = valid_id(&self.in_reply_to).ok_or(MailError::InvalidMessage)?;
        if self.references.len() > 20 {
            return Err(MailError::InvalidMessage);
        }
        let mut references = self
            .references
            .iter()
            .map(|id| {
                valid_id(id)
                    .map(|id| format!("<{id}>"))
                    .ok_or(MailError::InvalidMessage)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let parent = format!("<{parent}>");
        references.retain(|reference| reference != &parent);
        references.push(parent.clone());
        Ok((parent, references.join(" ")))
    }
}

pub(super) fn details(message: &[u8], email: &str) -> Option<ReplyDetails> {
    let message = MessageParser::default().parse_headers(message)?;
    let mut used = HashSet::from([email.to_ascii_lowercase()]);
    let mut to = recipients(message.reply_to(), &mut used);
    if to.is_empty() {
        to = recipients(message.from(), &mut used);
    }
    if to.is_empty() {
        to = recipients(message.to(), &mut used);
    }
    let mut cc = recipients(message.to(), &mut used);
    cc.extend(recipients(message.cc(), &mut used));
    let thread = message.message_id().and_then(valid_id).map(|parent| {
        let mut references = message
            .references()
            .or_else(|| message.in_reply_to().filter(|ids| ids.len() == 1))
            .into_iter()
            .flat_map(|ids| ids.iter())
            .filter_map(valid_id)
            .filter(|id| *id != parent)
            .rev()
            .take(20)
            .map(str::to_owned)
            .collect::<Vec<_>>();
        references.reverse();
        ReplyThread {
            in_reply_to: parent.to_owned(),
            references,
        }
    });
    Some(ReplyDetails { to, cc, thread })
}

fn recipients(addresses: Option<AddressList<'_>>, used: &mut HashSet<String>) -> Vec<String> {
    addresses
        .into_iter()
        .flat_map(|list| list.mailboxes())
        .filter_map(|entry| entry.address())
        .filter(|address| {
            address.len() <= 254
                && !address.chars().any(char::is_control)
                && !address.contains([',', ';'])
                && address.parse::<Address>().is_ok()
                && used.insert(address.to_ascii_lowercase())
        })
        .map(str::to_owned)
        .collect()
}

fn valid_id(value: &str) -> Option<&str> {
    let value = value
        .strip_prefix('<')
        .and_then(|value| value.strip_suffix('>'))
        .unwrap_or(value);
    (value.len() <= 254
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() && !matches!(byte, b'<' | b'>'))
        && value.parse::<Address>().is_ok())
    .then_some(value)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replies_to_the_author_selected_address_and_omits_self_and_blind_copies() {
        let raw = b"From: sender@example.test\r\nReply-To: reply@example.test\r\n\
            To: me@example.test, team@example.test\r\nCc: TEAM@example.test, other@example.test\r\n\
            Bcc: hidden@example.test\r\nMessage-ID: <parent@example.test>\r\n\
            References: <earlier@example.test>\r\n\r\nMessage.";
        let reply = details(raw, "me@example.test").unwrap();
        assert_eq!(reply.to, ["reply@example.test"]);
        assert_eq!(reply.cc, ["team@example.test", "other@example.test"]);
        assert_eq!(
            reply.thread.unwrap().headers().unwrap(),
            (
                "<parent@example.test>".into(),
                "<earlier@example.test> <parent@example.test>".into(),
            )
        );
    }
}
