use super::{MailError, MessageKey};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) enum GmailCategory {
    Primary,
    Promotions,
    Social,
    Updates,
    Forums,
}

impl GmailCategory {
    pub(super) fn name(self) -> &'static str {
        match self {
            Self::Primary => "primary",
            Self::Promotions => "promotions",
            Self::Social => "social",
            Self::Updates => "updates",
            Self::Forums => "forums",
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SearchRequest {
    pub(super) query: String,
    pub(super) category: Option<GmailCategory>,
    pub(super) unread_only: bool,
    pub(super) oldest_first: bool,
    pub(super) cursor: Option<MessageKey>,
}

impl SearchRequest {
    pub(super) fn validate(&mut self) -> Result<(), MailError> {
        if self.query.chars().any(char::is_control)
            || self
                .cursor
                .is_some_and(|key| key.uid == 0 || key.uid_validity == 0)
        {
            return Err(MailError::InvalidSettings);
        }
        let query = self.query.trim();
        if (query.is_empty() && self.category.is_none()) || query.len() > 1024 {
            return Err(MailError::InvalidSettings);
        }
        self.query = query.to_owned();
        Ok(())
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub(super) headers: Vec<super::MailHeader>,
    pub(super) next_cursor: Option<MessageKey>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_multiline_queries_and_invalid_cursors() {
        let mut request = SearchRequest {
            query: "name\r\n".into(),
            category: None,
            unread_only: false,
            oldest_first: false,
            cursor: None,
        };
        assert_eq!(request.validate(), Err(MailError::InvalidSettings));
        request.query = "  name@example.test  ".into();
        request.validate().unwrap();
        assert_eq!(request.query, "name@example.test");
        request.cursor = Some(MessageKey {
            uid_validity: 1,
            uid: 0,
        });
        assert_eq!(request.validate(), Err(MailError::InvalidSettings));
    }
}
