use super::MailError;
use async_imap::imap_proto::{BodyContentCommon, BodyParams, BodyStructure, ContentEncoding};
use mail_parser::{Encoding, MessageParser};
use serde::Serialize;
use std::{
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_BYTES: usize = 50 * 1024 * 1024;
pub(super) const MAX_PART_DEPTH: usize = 32;

pub(super) fn wire_limit(encoding: Encoding) -> usize {
    match encoding {
        Encoding::Base64 => 72 * 1024 * 1024,
        Encoding::QuotedPrintable => 157 * 1024 * 1024,
        Encoding::None => MAX_BYTES,
    }
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Attachment {
    pub part: Vec<u32>,
    pub name: Option<String>,
    is_image: bool,
    can_open: bool,
}

pub(super) struct AttachmentPart {
    pub attachment: Attachment,
    pub octets: u32,
    pub encoding: Option<Encoding>,
}

pub(super) fn list(structure: &BodyStructure<'_>) -> impl Iterator<Item = AttachmentPart> {
    let mut parts = Vec::new();
    collect(structure, &mut Vec::new(), &mut parts);
    parts.into_iter()
}

fn collect(structure: &BodyStructure<'_>, path: &mut Vec<u32>, parts: &mut Vec<AttachmentPart>) {
    if path.len() > MAX_PART_DEPTH || parts.len() >= 256 {
        return;
    }
    let (common, other) = match structure {
        BodyStructure::Multipart { bodies, .. } => {
            for (index, child) in bodies.iter().enumerate() {
                path.push(index as u32 + 1);
                collect(child, path, parts);
                path.pop();
            }
            return;
        }
        BodyStructure::Basic { common, other, .. }
        | BodyStructure::Text { common, other, .. }
        | BodyStructure::Message { common, other, .. } => (common, other),
    };
    let name = filename(common);
    let explicit = common
        .disposition
        .as_ref()
        .is_some_and(|item| item.ty.eq_ignore_ascii_case("attachment"));
    let forwarded = matches!(structure, BodyStructure::Message { .. });
    if explicit || (other.id.is_none() && (name.is_some() || forwarded)) {
        let name = name.or_else(|| forwarded.then(|| "message.eml".to_owned()));
        parts.push(AttachmentPart {
            attachment: Attachment {
                part: if path.is_empty() {
                    vec![1]
                } else {
                    path.clone()
                },
                can_open: name.as_deref().is_some_and(can_open),
                name,
                is_image: common.ty.ty.eq_ignore_ascii_case("image"),
            },
            octets: other.octets,
            encoding: match other.transfer_encoding {
                ContentEncoding::SevenBit | ContentEncoding::EightBit | ContentEncoding::Binary => {
                    Some(Encoding::None)
                }
                ContentEncoding::Base64 => Some(Encoding::Base64),
                ContentEncoding::QuotedPrintable => Some(Encoding::QuotedPrintable),
                ContentEncoding::Other(_) => None,
            },
        });
    }
}

fn can_open(name: &str) -> bool {
    let extension = Path::new(name).extension().and_then(|value| value.to_str());
    extension.is_some_and(|extension| {
        matches!(
            extension.to_ascii_lowercase().as_str(),
            "pdf"
                | "txt"
                | "csv"
                | "rtf"
                | "png"
                | "jpg"
                | "jpeg"
                | "gif"
                | "webp"
                | "bmp"
                | "tiff"
                | "tif"
                | "docx"
                | "xlsx"
                | "xls"
                | "pptx"
                | "odt"
                | "ods"
                | "odp"
                | "eml"
                | "mp3"
                | "mp4"
                | "wav"
        )
    })
}

#[derive(Default)]
pub(crate) struct AttachmentPreviews(Mutex<Option<tempfile::TempDir>>);

impl AttachmentPreviews {
    pub(crate) fn cleanup(&self) {
        if let Ok(mut directory) = self.0.lock() {
            directory.take();
        }
    }

    pub(super) fn open(&self, attachment: &Attachment, bytes: &[u8]) -> Result<(), MailError> {
        if !attachment.can_open {
            return Err(MailError::AttachmentOpenUnsupported);
        }
        let directory = {
            let mut directory = self.0.lock().map_err(|_| MailError::AttachmentOpen)?;
            if directory.is_none() {
                *directory = Some(
                    tempfile::Builder::new()
                        .prefix("lusi-attachments-")
                        .tempdir()
                        .map_err(|_| MailError::AttachmentOpen)?,
                );
            }
            directory
                .as_ref()
                .ok_or(MailError::AttachmentOpen)?
                .path()
                .to_owned()
        };
        let file = save(&directory, attachment, bytes).map_err(|_| MailError::AttachmentOpen)?;
        if launch(&file).is_err() {
            let _ = std::fs::remove_file(file);
            return Err(MailError::AttachmentOpen);
        }
        Ok(())
    }
}

pub(super) fn launch(file: &Path) -> std::io::Result<()> {
    // Keep the system's downloaded-file protections when opening mail attachments.
    #[cfg(target_os = "macos")]
    {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(std::io::Error::other)?
            .as_secs();
        let status = std::process::Command::new("/usr/bin/xattr")
            .args(["-w", "com.apple.quarantine"])
            .arg(format!("0081;{timestamp:x};Lusi;"))
            .arg(file)
            .status()?;
        if !status.success() {
            return Err(std::io::Error::other("could not mark mail attachment"));
        }
    }
    #[cfg(target_os = "windows")]
    {
        let mut zone = file.as_os_str().to_owned();
        zone.push(":Zone.Identifier");
        std::fs::write(zone, b"[ZoneTransfer]\r\nZoneId=3\r\n")?;
    }
    open::that(file)
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadResult {
    Saved,
    Opened,
    OpenFailed,
}

pub(super) fn save_download(
    downloads: &Path,
    attachment: &Attachment,
    bytes: &[u8],
    open_file: impl FnOnce(&Path) -> std::io::Result<()>,
) -> Result<DownloadResult, MailError> {
    let path = save(downloads, attachment, bytes)?;
    if !attachment.can_open {
        return Ok(DownloadResult::Saved);
    }
    Ok(if open_file(&path).is_ok() {
        DownloadResult::Opened
    } else {
        DownloadResult::OpenFailed
    })
}

fn parameter<'a>(params: &'a BodyParams<'_>, key: &str) -> Option<&'a str> {
    params
        .as_ref()?
        .iter()
        .find_map(|(name, value)| name.eq_ignore_ascii_case(key).then_some(value.as_ref()))
}

fn filename(common: &BodyContentCommon<'_>) -> Option<String> {
    let name = common
        .disposition
        .as_ref()
        .and_then(|value| parameter(&value.params, "filename"))
        .or_else(|| parameter(&common.ty.params, "name"))?;
    let cleaned = name
        .chars()
        .filter(|ch| !ch.is_control())
        .take(512)
        .collect::<String>();
    // Some senders encode filename parameters as RFC 2047 words.
    let header = format!("Subject: {cleaned}\r\n\r\n");
    let parsed = MessageParser::default().parse_headers(header.as_bytes());
    let decoded = parsed
        .as_ref()
        .and_then(|message| message.subject())
        .unwrap_or(&cleaned);
    let safe = decoded
        .chars()
        .filter(|ch| {
            !ch.is_control() && !matches!(ch, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
        })
        .map(|ch| if "/\\:*?\"<>|".contains(ch) { '_' } else { ch })
        .collect::<String>();
    limit_filename(&safe)
}

fn limit_filename(safe: &str) -> Option<String> {
    let safe = safe.trim_matches(|ch: char| ch == '.' || ch.is_whitespace());
    if safe.is_empty() {
        return None;
    }
    const MAX_CHARS: usize = 60;
    if safe.chars().count() <= MAX_CHARS {
        return Some(safe.to_owned());
    }
    Some(if let Some((stem, extension)) = safe.rsplit_once('.') {
        let extension: String = extension.chars().take(20).collect();
        let stem: String = stem
            .chars()
            .take(MAX_CHARS - 1 - extension.chars().count())
            .collect();
        format!("{}.{extension}", stem.trim_end())
    } else {
        safe.chars()
            .take(MAX_CHARS)
            .collect::<String>()
            .trim_end()
            .to_owned()
    })
}

pub(super) fn decode(bytes: &[u8], encoding: Encoding) -> Result<Vec<u8>, MailError> {
    let (decoded, malformed) = encoding.decode_checked(bytes);
    if malformed {
        return Err(MailError::AttachmentUnavailable);
    }
    if decoded.len() > MAX_BYTES {
        return Err(MailError::AttachmentTooLarge);
    }
    Ok(decoded.into_owned())
}

pub(super) fn save(
    downloads: &Path,
    attachment: &Attachment,
    bytes: &[u8],
) -> Result<PathBuf, MailError> {
    let fallback = format!(
        "attachment-{}",
        attachment
            .part
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join("-")
    );
    let name = attachment.name.as_deref().unwrap_or(&fallback);
    let name = Path::new(name);
    let stem = name
        .file_stem()
        .and_then(|value| value.to_str())
        .ok_or(MailError::AttachmentSave)?;
    let extension = name.extension().and_then(|value| value.to_str());
    let mut file =
        tempfile::NamedTempFile::new_in(downloads).map_err(|_| MailError::AttachmentSave)?;
    file.write_all(bytes)
        .map_err(|_| MailError::AttachmentSave)?;
    for index in 0..1000 {
        let target = match (index, extension) {
            (0, _) => downloads.join(name),
            (_, Some(extension)) => downloads.join(format!("{stem} ({index}).{extension}")),
            (_, None) => downloads.join(format!("{stem} ({index})")),
        };
        match file.persist_noclobber(&target) {
            Ok(_) => return Ok(target),
            Err(error) if error.error.kind() == std::io::ErrorKind::AlreadyExists => {
                file = error.file
            }
            Err(_) => return Err(MailError::AttachmentSave),
        }
    }
    Err(MailError::AttachmentSave)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_document_and_media_extensions() {
        for name in ["fiyat.xls", "fiyat.xlsx", "plan.PDF", "photo.jpeg"] {
            assert!(can_open(name), "{name}");
        }
        for name in [
            "invoice.pdf.exe",
            "workflow.command",
            "report.xlsm",
            "link.url",
            "page.html",
        ] {
            assert!(!can_open(name), "{name}");
        }
    }

    #[test]
    fn opens_the_completed_download_and_keeps_it_if_opening_fails() {
        let downloads = tempfile::tempdir().unwrap();
        let attachment = Attachment {
            part: vec![2],
            name: Some("prices.xls".into()),
            is_image: false,
            can_open: true,
        };
        let result = save_download(downloads.path(), &attachment, b"workbook", |file| {
            assert_eq!(std::fs::read(file).unwrap(), b"workbook");
            Err(std::io::Error::other("no default app"))
        })
        .unwrap();
        assert_eq!(result, DownloadResult::OpenFailed);
        assert!(downloads.path().join("prices.xls").is_file());

        let result = save_download(downloads.path(), &attachment, b"second workbook", |file| {
            assert_eq!(file, downloads.path().join("prices (1).xls"));
            Ok(())
        })
        .unwrap();
        assert_eq!(result, DownloadResult::Opened);

        let executable = Attachment {
            name: Some("tool.exe".into()),
            can_open: false,
            ..attachment
        };
        let result = save_download(downloads.path(), &executable, b"fixture", |_| {
            panic!("executable attachment must not be opened")
        })
        .unwrap();
        assert_eq!(result, DownloadResult::Saved);
    }

    #[test]
    fn wire_limits_fit_standard_encodings_of_a_fifty_mib_attachment() {
        let bytes = 50 * 1024 * 1024usize;
        let base64 = bytes.div_ceil(3) * 4;
        assert_eq!(wire_limit(Encoding::None), bytes);
        assert!(wire_limit(Encoding::Base64) >= base64 + base64.div_ceil(76) * 2);
        assert!(wire_limit(Encoding::QuotedPrintable) >= bytes * 3 + bytes.div_ceil(25) * 3);
    }

    #[test]
    fn saving_an_attachment_keeps_an_existing_file() {
        let downloads = tempfile::tempdir().unwrap();
        let attachment = Attachment {
            part: vec![2],
            name: Some("Fiyat listesi.pdf".into()),
            is_image: false,
            can_open: true,
        };
        save(downloads.path(), &attachment, b"first").unwrap();
        save(downloads.path(), &attachment, b"second").unwrap();
        assert_eq!(
            std::fs::read(downloads.path().join("Fiyat listesi.pdf")).unwrap(),
            b"first"
        );
        assert_eq!(
            std::fs::read(downloads.path().join("Fiyat listesi (1).pdf")).unwrap(),
            b"second"
        );
    }
}
#[test]
fn keeps_real_file_extensions_when_shortening_long_names() {
    let stem = "Fiyat listesi ".repeat(8);
    let name = limit_filename(&format!("{stem}.xlsx")).unwrap();
    assert!(name.chars().count() <= 60);
    assert!(name.ends_with(".xlsx"));
    assert!(can_open(&name));

    let name = limit_filename(&format!("{stem}.xlsx.exe")).unwrap();
    assert!(name.ends_with(".exe"));
    assert!(!can_open(&name));
}
