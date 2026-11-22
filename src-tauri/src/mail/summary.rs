use super::html::HtmlBody;
use ammonia::Builder;
use mail_parser::decoders::html::html_to_text;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::LazyLock,
};
use unicode_segmentation::UnicodeSegmentation;

const MAX_POINTS: usize = 3;
const MAX_POINT_LENGTH: usize = 240;

const DEADLINE: &str = concat!(
    r"(?i)\b(?:deadline|due (?:by|on|date|today|tomorrow)|no later than|en geç|teslim tarihi|son (?:teslim|tarih|başvuru))\b",
    r"|\bby (?:today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(?::\d{2}|\s*(?:am|pm)))\b",
    r"|\b(?:tarihine|gününe|akşama|sabaha|mesai bitimine|bugüne|yarına|pazartesiye|salıya|çarşambaya|perşembeye|cumaya|cumartesiye|pazara) kadar\b",
    r"|\b\d{1,2}[:.]\d{2}(?:[’']?\p{L}+)? kadar\b",
);
const ACTION: &str = concat!(
    r"(?i)\b(?:please|can you|could you|would you|you (?:must|need to|should)|action required|lütfen|rica ediyorum|rica ederim|(?:geri dönüş|yanıt|onay) bekliyorum)\b",
    r"|\b(?:gönder|paylaş|onayla|yanıtla|cevapla|kontrol e[td]|incele|tamamla|güncelle|doldur|imzala|ile[td])",
    r"(?:yin|in|yın|ın|yün|ün|yiniz|iniz|yınız|ınız|(?:yabilir|ebilir|ir|er|ar|r) misin(?:iz)?)\b",
    r"|^(?:send|confirm|review|reply|sign|submit|complete|approve|check|gönder|paylaş|onayla|yanıtla|incele)\b",
);
const DECISION: &str = r"(?i)\b(?:approved|cancelled|canceled|confirmed|postponed|rescheduled|rejected|decided|will meet|updated|onaylandı|iptal edildi|ertelendi|güncellendi|değiştirildi|karar verildi|kesinleşti|buluşuyoruz|reddedildi)\b";
const GREETING: &str = r"(?i)^(?:hi|hello|dear|merhaba|selam)(?:\s+[\p{L}]+){0,3}[!,.:]\s*$";
const FOOTER: &str = r"(?i)^(?:--\s*$|[-_]+\s*(?:original|forwarded) message\s*[-_]+|[-_]+\s*(?:orijinal|iletilen) ileti\s*[-_]+|on .+ wrote:\s*$|.+ (?:şunu )?yazdı:\s*$|(?:best regards|kind regards|regards|sincerely|saygılarımla|görüşmek üzere)[,!.]?\s*$|(?:unsubscribe\b|you are receiving this email\b|abonelikten çık\b|bu e-postayı alıyorsunuz\b))";

static DEADLINE_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(DEADLINE).expect("deadline patterns are valid"));
static ACTION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(ACTION).expect("action patterns are valid"));
static DECISION_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(DECISION).expect("decision patterns are valid"));
static GREETING_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(GREETING).expect("greeting patterns are valid"));
static FOOTER_RE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(FOOTER).expect("footer patterns are valid"));

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct MessageSummary {
    points: Vec<SummaryPoint>,
}

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
struct SummaryPoint {
    kind: PointKind,
    text: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum PointKind {
    KeyPoint,
    Action,
    Deadline,
}

pub(super) struct MessageSummarizer;

impl MessageSummarizer {
    pub(super) fn summarize(
        plain: Option<&str>,
        html: Option<&HtmlBody>,
    ) -> Option<MessageSummary> {
        html.and_then(|body| Self::summarize_text(&html_text(body.sanitized_content())))
            .or_else(|| plain.and_then(Self::summarize_text))
    }

    fn summarize_text(text: &str) -> Option<MessageSummary> {
        let mut candidates: Vec<_> = message_sentences(text)
            .enumerate()
            .map(|(position, text)| Candidate::new(text, position))
            .collect();
        let mut frequencies = HashMap::<&str, usize>::new();
        for candidate in &candidates {
            for term in &candidate.terms {
                *frequencies.entry(term).or_default() += 1;
            }
        }
        let scores: Vec<_> = candidates
            .iter()
            .map(|candidate| candidate.score(&frequencies))
            .collect();
        candidates.sort_by_key(|candidate| {
            (
                std::cmp::Reverse(scores[candidate.position]),
                candidate.position,
            )
        });

        let mut selected: Vec<Candidate> = Vec::new();
        for candidate in candidates {
            if selected.iter().any(|point| candidate.repeats(point)) {
                continue;
            }
            selected.push(candidate);
            if selected.len() == MAX_POINTS {
                break;
            }
        }
        // Show deadlines and requests first, preserving reading order for each kind.
        selected.sort_by_key(|candidate| {
            let priority = match candidate.kind {
                PointKind::Deadline => 0,
                PointKind::Action => 1,
                PointKind::KeyPoint => 2,
            };
            (priority, candidate.position)
        });
        let points: Vec<_> = selected
            .into_iter()
            .map(|candidate| SummaryPoint {
                kind: candidate.kind,
                text: truncate(&candidate.text),
            })
            .collect();
        (!points.is_empty()).then_some(MessageSummary { points })
    }
}

struct Candidate {
    text: String,
    kind: PointKind,
    decision: bool,
    terms: HashSet<String>,
    position: usize,
}

impl Candidate {
    fn new(text: String, position: usize) -> Self {
        let normalized = text.to_lowercase().replace('\u{307}', "");
        let kind = if DEADLINE_RE.is_match(&normalized) {
            PointKind::Deadline
        } else if ACTION_RE.is_match(&normalized) {
            PointKind::Action
        } else {
            PointKind::KeyPoint
        };
        Self {
            decision: DECISION_RE.is_match(&normalized),
            terms: normalized
                .unicode_words()
                .filter(|word| is_topic_term(word))
                .map(str::to_owned)
                .collect(),
            text,
            kind,
            position,
        }
    }

    fn score(&self, frequencies: &HashMap<&str, usize>) -> usize {
        let priority = match self.kind {
            PointKind::Deadline => 48,
            PointKind::Action => 36,
            PointKind::KeyPoint => 0,
        };
        let topic = self
            .terms
            .iter()
            .filter(|term| frequencies[term.as_str()] > 1)
            .count()
            .min(6);
        let context = self.terms.len().min(6);
        priority
            + usize::from(self.decision) * 14
            + topic
            + context
            + 5_usize.saturating_sub(self.position)
    }

    fn repeats(&self, other: &Self) -> bool {
        if self.text.eq_ignore_ascii_case(&other.text) {
            return true;
        }
        let shared = self.terms.intersection(&other.terms).count();
        let total = self.terms.len() + other.terms.len() - shared;
        self.kind == PointKind::KeyPoint
            && other.kind == PointKind::KeyPoint
            && shared >= 3
            && shared * 5 >= total * 4
            && self
                .terms
                .symmetric_difference(&other.terms)
                .all(|term| !term.contains(|c: char| c.is_numeric()))
    }
}

fn is_topic_term(word: &str) -> bool {
    (word.chars().count() > 2 || word.chars().all(char::is_numeric))
        && !matches!(
            word,
            "the"
                | "and"
                | "you"
                | "your"
                | "this"
                | "that"
                | "for"
                | "with"
                | "from"
                | "our"
                | "are"
                | "was"
                | "have"
                | "has"
                | "will"
                | "veya"
                | "için"
                | "ile"
                | "bir"
                | "olarak"
                | "olan"
                | "daha"
                | "gibi"
                | "çok"
                | "kadar"
        )
}

fn message_sentences(text: &str) -> impl Iterator<Item = String> + '_ {
    text.lines()
        .map(str::trim)
        .take_while(|line| !FOOTER_RE.is_match(line))
        .filter(|line| {
            !line.starts_with('>') && !line.starts_with("https://") && !line.starts_with("http://")
        })
        .flat_map(UnicodeSegmentation::unicode_sentences)
        .map(|sentence| sentence.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|sentence| {
            sentence.chars().any(char::is_alphanumeric) && !GREETING_RE.is_match(sentence)
        })
}

fn html_text(html: &str) -> String {
    let content = Builder::default()
        .tags(
            [
                "p", "br", "div", "li", "table", "thead", "tbody", "tr", "td", "th", "h1", "h2",
                "h3", "h4", "h5", "h6",
            ]
            .into(),
        )
        .clean_content_tags(["blockquote", "script", "style", "template"].into())
        .tag_attributes([].into())
        .generic_attributes([].into())
        .clean(html)
        .to_string();
    let with_breaks = [
        "</div>", "</li>", "</td>", "</th>", "</h1>", "</h2>", "</h3>", "</h4>", "</h5>", "</h6>",
    ]
    .into_iter()
    .fold(content, |text, end| text.replace(end, "</p>"));
    html_to_text(&with_breaks)
}

fn truncate(text: &str) -> String {
    if text.chars().count() <= MAX_POINT_LENGTH {
        return text.to_owned();
    }
    let mut prefix: String = text.chars().take(MAX_POINT_LENGTH - 1).collect();
    if let Some(index) = prefix
        .rfind(' ')
        .filter(|index| *index >= prefix.len() * 3 / 4)
    {
        prefix.truncate(index);
    }
    prefix.push('…');
    prefix
}

#[cfg(test)]
mod tests {
    use super::{MessageSummarizer, PointKind, MAX_POINT_LENGTH};
    use crate::mail::html::read_body;

    #[test]
    fn finds_a_late_deadline_and_action_in_turkish_html() {
        let raw = concat!(
            "Content-Type: text/html; charset=UTF-8\r\n\r\n",
            "<script>Ignored script</script><div>Merhaba Deniz,</div>",
            "<div>Dünkü görüşme için teşekkürler.</div>",
            "<div>Bu hafta birkaç farklı konuda konuştuk.</div>",
            "<div>İlgili ekiplerle bir süredir yazışıyoruz.</div>",
            "<div>Yeni bütçe onaylandı.</div>",
            "<div>Dosyanın son sürümünü <b>Cuma 17.00’ye kadar</b> paylaşın.</div>",
            "<div>Toplantı odasını kontrol eder misiniz?</div>",
            "<blockquote>Önceki ileti: Son tarih Pazartesi.</blockquote>",
            "<p>Görüşmek üzere,</p><p>Deniz</p>"
        );
        let (plain, html) = read_body(raw.as_bytes());
        let summary = MessageSummarizer::summarize(plain.as_deref(), html.as_ref()).unwrap();
        let points: Vec<_> = summary
            .points
            .iter()
            .map(|point| (point.kind, point.text.as_str()))
            .collect();
        assert_eq!(
            points,
            [
                (
                    PointKind::Deadline,
                    "Dosyanın son sürümünü Cuma 17.00’ye kadar paylaşın."
                ),
                (PointKind::Action, "Toplantı odasını kontrol eder misiniz?"),
                (PointKind::KeyPoint, "Yeni bütçe onaylandı."),
            ]
        );
    }

    #[test]
    fn preserves_changed_decisions_and_deduplicates_requests_in_english() {
        let result = MessageSummarizer::summarize(
            Some(concat!(
                "Hello Alex,\n",
                "Friday's workshop was postponed.\n",
                "Please confirm the budget owner. Please confirm the budget owner.\n",
                "The revised proposal is due on Monday.\n",
                "On Friday, Alex wrote:\nPlease submit the old form by Sunday.",
            )),
            None,
        )
        .unwrap();
        let points: Vec<_> = result
            .points
            .iter()
            .map(|point| (point.kind, point.text.as_str()))
            .collect();
        assert_eq!(
            points,
            [
                (
                    PointKind::Deadline,
                    "The revised proposal is due on Monday."
                ),
                (PointKind::Action, "Please confirm the budget owner."),
                (PointKind::KeyPoint, "Friday's workshop was postponed."),
            ]
        );
    }

    #[test]
    fn uses_plain_text_when_html_is_empty_and_skips_quote_and_signature_lines() {
        let (_, html) = read_body(b"Content-Type: text/html\r\n\r\n<img alt='logo'>");
        let result = MessageSummarizer::summarize(
            Some("Onaylandı.\n> Eski ileti\n-- \nİmza"),
            html.as_ref(),
        )
        .unwrap();
        assert_eq!(result.points.len(), 1);
        assert_eq!(result.points[0].text, "Onaylandı.");
        assert_eq!(
            MessageSummarizer::summarize(Some(" \n> önceki ileti\nMerhaba!"), None),
            None
        );
    }

    #[test]
    fn limits_long_points_at_a_utf8_boundary() {
        let text = "ç".repeat(MAX_POINT_LENGTH * 2);
        let result = MessageSummarizer::summarize(Some(&text), None).unwrap();
        assert_eq!(result.points[0].text.chars().count(), MAX_POINT_LENGTH);
        assert!(result.points[0].text.ends_with('…'));
    }
}
