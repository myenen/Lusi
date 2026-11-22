use ammonia::{Builder, Url, UrlRelative};
use base64::{engine::general_purpose::STANDARD, Engine};
use cssparser::{parse_important, Parser};
use mail_parser::{MessageParser, MessageRef, PartKind};
use serde::{Deserialize, Serialize};
use std::{borrow::Cow, collections::HashMap, sync::Mutex};

const MAX_EMBEDDED_BYTES: usize = 512 * 1024;
const MAX_EMBEDDED_MARKUP: usize = 1024 * 1024;

#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(super) struct HtmlBody {
    content: String,
}

impl HtmlBody {
    pub(super) fn sanitized_content(&self) -> &str {
        &self.content
    }
}

pub(super) fn sanitize_outgoing_html(html: &str) -> String {
    Builder::default()
        .tags(
            [
                "a",
                "b",
                "blockquote",
                "br",
                "code",
                "del",
                "div",
                "em",
                "h1",
                "h2",
                "h3",
                "hr",
                "i",
                "li",
                "ol",
                "p",
                "pre",
                "s",
                "span",
                "strike",
                "strong",
                "sub",
                "sup",
                "u",
                "ul",
            ]
            .into(),
        )
        .generic_attributes([].into())
        .tag_attributes([("a", ["href"].into())].into())
        .clean_content_tags(
            [
                "iframe", "math", "object", "script", "style", "svg", "template", "title",
            ]
            .into(),
        )
        .url_schemes(["https", "http", "mailto"].into())
        .url_relative(UrlRelative::Deny)
        .clean(html)
        .to_string()
}

pub(super) fn read_body(bytes: &[u8]) -> (Option<String>, Option<HtmlBody>) {
    let Some(parsed) = MessageParser::default().parse(bytes) else {
        return (None, None);
    };
    let root = parsed.root();
    let text = root
        .text_bodies()
        .map(|part| part.into_owned())
        .collect::<Vec<_>>()
        .join("\n\n");
    let html = root
        .html_body()
        .filter(|part| matches!(part.kind(), PartKind::Html))
        .filter_map(|part| part.text())
        .collect::<Vec<_>>()
        .join("\n");
    let html = (!html.trim().is_empty())
        .then(|| HtmlBody {
            content: sanitize(&html, embedded_images(&root)),
        })
        .filter(|html| !html.content.trim().is_empty());
    ((!text.trim().is_empty()).then_some(text), html)
}

fn embedded_images(message: &MessageRef<'_>) -> HashMap<String, String> {
    let mut images = HashMap::new();
    let mut remaining = MAX_EMBEDDED_BYTES;
    for part in message.parts() {
        let Some(id) = part.content_id().filter(|id| id.len() <= 512) else {
            continue;
        };
        let Some(kind) = part.content_type() else {
            continue;
        };
        if !kind.ctype().eq_ignore_ascii_case("image") {
            continue;
        }
        let subtype = kind.subtype().unwrap_or_default().to_ascii_lowercase();
        if !matches!(subtype.as_str(), "png" | "jpeg" | "gif" | "webp")
            || images.contains_key(id)
            || part.decoded_len() > remaining
        {
            continue;
        }
        let data = part.decoded();
        let valid = match subtype.as_str() {
            "png" => data.starts_with(b"\x89PNG\r\n\x1a\n"),
            "jpeg" => data.starts_with(b"\xff\xd8\xff"),
            "gif" => data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a"),
            "webp" => data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP"),
            _ => false,
        };
        if valid && data.len() <= remaining {
            remaining -= data.len();
            images.insert(
                id.to_owned(),
                format!("data:image/{subtype};base64,{}", STANDARD.encode(&data)),
            );
        }
    }
    images
}

fn sanitize(html: &str, images: HashMap<String, String>) -> String {
    let embedded_budget = Mutex::new(MAX_EMBEDDED_MARKUP);
    Builder::default()
        .tags(
            [
                "a",
                "b",
                "blockquote",
                "br",
                "caption",
                "code",
                "col",
                "colgroup",
                "dd",
                "del",
                "div",
                "dl",
                "dt",
                "em",
                "font",
                "h1",
                "h2",
                "h3",
                "h4",
                "h5",
                "h6",
                "hr",
                "i",
                "img",
                "li",
                "ol",
                "p",
                "pre",
                "s",
                "small",
                "span",
                "strong",
                "sub",
                "sup",
                "table",
                "tbody",
                "td",
                "tfoot",
                "th",
                "thead",
                "tr",
                "u",
                "ul",
            ]
            .into(),
        )
        .clean_content_tags(
            [
                "button", "form", "iframe", "math", "object", "script", "select", "style", "svg",
                "template", "textarea", "title",
            ]
            .into(),
        )
        .generic_attributes(["dir", "lang", "style", "title"].into())
        .tag_attributes(
            [
                ("font", ["color", "face", "size"].into()),
                ("img", ["alt", "height", "src", "width"].into()),
                (
                    "table",
                    [
                        "align",
                        "bgcolor",
                        "border",
                        "cellpadding",
                        "cellspacing",
                        "width",
                    ]
                    .into(),
                ),
                (
                    "td",
                    ["align", "bgcolor", "colspan", "rowspan", "valign", "width"].into(),
                ),
                (
                    "th",
                    [
                        "align", "bgcolor", "colspan", "rowspan", "scope", "valign", "width",
                    ]
                    .into(),
                ),
                ("tr", ["align", "bgcolor", "valign"].into()),
            ]
            .into(),
        )
        .filter_style_properties(
            [
                "background-color",
                "border",
                "border-bottom",
                "border-collapse",
                "border-color",
                "border-radius",
                "border-spacing",
                "border-style",
                "border-top",
                "border-width",
                "color",
                "font-family",
                "font-size",
                "font-style",
                "font-weight",
                "height",
                "line-height",
                "margin",
                "margin-bottom",
                "margin-left",
                "margin-right",
                "margin-top",
                "max-width",
                "padding",
                "padding-bottom",
                "padding-left",
                "padding-right",
                "padding-top",
                "text-align",
                "text-decoration",
                "vertical-align",
                "white-space",
                "width",
            ]
            .into(),
        )
        .link_rel(None)
        .url_relative(UrlRelative::Deny)
        .url_schemes(["cid", "https"].into())
        .attribute_filter(move |tag, attribute, value| {
            if attribute == "style" && value.contains('!') {
                return Some(Cow::Owned(without_style_priority(value)));
            }
            if (tag, attribute) != ("img", "src") {
                return Some(Cow::Borrowed(value));
            }
            let url = Url::parse(value).ok()?;
            match url.scheme() {
                "cid" => {
                    let data = images.get(url.path())?;
                    let mut remaining = embedded_budget.lock().ok()?;
                    *remaining = remaining.checked_sub(data.len())?;
                    Some(Cow::Owned(data.clone()))
                }
                "https"
                    if url.domain().is_some()
                        && url.username().is_empty()
                        && url.password().is_none() =>
                {
                    Some(Cow::Owned(url.into()))
                }
                _ => None,
            }
        })
        .clean(html)
        .to_string()
}

fn without_style_priority(style: &str) -> String {
    // The reader's dark color rules must override sender declarations.
    let mut parser = Parser::new(style);
    let mut kept_from = 0;
    let mut output = String::with_capacity(style.len());
    while !parser.is_exhausted() {
        let position = parser.position().byte_index();
        if parser.try_parse(parse_important).is_ok() {
            output.push_str(&style[kept_from..position]);
            kept_from = parser.position().byte_index();
        } else if parser.next_including_whitespace_and_comments().is_err() {
            break;
        }
    }
    output.push_str(&style[kept_from..]);
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_sender_colors_and_layout_but_removes_priority_markers() {
        let body = br#"Content-Type: text/html

<table bgcolor="white" style="background-color: #fff !/* note */ IMPORTANT; width:640px">
<tr><td style="color: #202124!important; font-size: 18px">Welcome</td></tr></table>"#;
        let html = read_body(body).1.unwrap().content;
        assert!(html.contains("bgcolor=\"white\""));
        assert!(html.contains("background-color:#fff"));
        assert!(html.contains("color:#202124"));
        assert!(html.contains("width:640px"));
        assert!(html.contains("font-size:18px"));
        assert!(!html.to_ascii_lowercase().contains("important"));
    }

    #[test]
    fn keeps_mime_alternatives_and_only_safe_html() {
        let message = concat!(
            "Content-Type: multipart/alternative; boundary=lusi\r\n\r\n",
            "--lusi\r\nContent-Type: text/plain\r\n\r\nPlain copy.\r\n",
            "--lusi\r\nContent-Type: text/html\r\n\r\n",
            "<table><tr><td style=\"color:blue;background-image:url(https://tracker.test/css)\">",
            "<strong>Formatted copy.</strong></td></tr></table>",
            "<img src=\"https://images.example.test/logo.png\" srcset=\"https://tracker.test/set 1x\" onerror=\"steal()\">",
            "<img src=\"http://tracker.test/clear\"><img src=\"data:image/svg+xml,unsafe\">",
            "<a href=\"https://tracker.test/click\" target=\"_blank\">Read more</a>",
            "<svg><script>unsafe_svg()</script></svg><form>unsafe_form</form>",
            "<script>unsafe_script()</script><iframe src=\"https://tracker.test/frame\"></iframe>",
            "<meta http-equiv=\"refresh\" content=\"0;url=https://tracker.test/refresh\">\r\n",
            "--lusi--\r\n",
        );
        let (text, html) = read_body(message.as_bytes());
        assert!(text.unwrap().contains("Plain copy."));
        let html = html.unwrap();
        assert!(html.content.contains("<table>"));
        assert!(html.content.contains("<strong>Formatted copy.</strong>"));
        assert!(html.content.contains("color:blue"));
        assert!(html.content.contains("Read more"));
        assert!(html
            .content
            .contains("src=\"https://images.example.test/logo.png\""));
        for banned in [
            "tracker.test",
            "unsafe",
            "onerror",
            "srcset",
            "href=",
            "<form",
            "<script",
        ] {
            assert!(!html.content.contains(banned), "{banned}");
        }
    }

    #[test]
    fn shows_embedded_raster_images() {
        let raw = concat!(
            "Content-Type: multipart/related; boundary=lusi\r\n\r\n",
            "--lusi\r\nContent-Type: text/html\r\n\r\n",
            "<p>Hello<img src=\"cid:picture@example.test\"><img src=\"cid:svg@example.test\"></p>\r\n",
            "--lusi\r\nContent-Type: image/gif\r\nContent-ID: <picture@example.test>\r\n",
            "Content-Transfer-Encoding: base64\r\n\r\nR0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7\r\n",
            "--lusi\r\nContent-Type: image/svg+xml\r\nContent-ID: <svg@example.test>\r\n\r\n<svg/>\r\n",
            "--lusi--\r\n",
        );
        let html = read_body(raw.as_bytes()).1.unwrap();
        assert!(html
            .content
            .contains("src=\"data:image/gif;base64,R0lGODlh"));
        assert!(!html.content.contains("svg@example.test"));
    }

    #[test]
    fn leaves_plain_text_as_text() {
        let (body, html) = read_body(b"Content-Type: text/plain\r\n\r\nA literal <b> tag.");
        assert_eq!(body.as_deref(), Some("A literal <b> tag."));
        assert!(html.is_none());
    }
}
