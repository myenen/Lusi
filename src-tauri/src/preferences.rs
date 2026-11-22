use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Appearance {
    System,
    #[default]
    Light,
    Dark,
}

#[derive(Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Language {
    #[default]
    System,
    Tr,
    En,
}

#[derive(Debug, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Preferences {
    theme: Appearance,
    theme_id: String,
    language: Language,
    sidebar_collapsed: bool,
    sidebar_width: u16,
    list_width: u16,
    mail_notifications: bool,
    notification_details: bool,
    keep_running_on_close: bool,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: Appearance::default(),
            theme_id: "default".into(),
            language: Language::System,
            sidebar_collapsed: false,
            sidebar_width: 222,
            list_width: 380,
            mail_notifications: true,
            notification_details: false,
            keep_running_on_close: true,
        }
    }
}

impl Preferences {
    fn is_turkish(&self) -> bool {
        match self.language {
            Language::Tr => true,
            Language::En => false,
            Language::System => sys_locale::get_locale().is_some_and(|locale| {
                locale
                    .split(['-', '_'])
                    .next()
                    .is_some_and(|code| code.eq_ignore_ascii_case("tr"))
            }),
        }
    }

    fn validated(mut self) -> Self {
        self.sidebar_width = self.sidebar_width.clamp(190, 272);
        self.list_width = self.list_width.clamp(290, 444);
        let id = self.theme_id.as_bytes();
        if id.len() > 32
            || !id.first().is_some_and(u8::is_ascii_lowercase)
            || !id
                .iter()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || *byte == b'-')
        {
            self.theme_id = "default".into();
        }
        self
    }
}

fn preferences_path(app: &AppHandle) -> Result<PathBuf, &'static str> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join("ui-preferences.json"))
        .map_err(|_| "Appearance preferences are unavailable.")
}

pub(crate) fn notification_options(app: &AppHandle) -> Option<(bool, bool)> {
    let preferences = read_preferences(&preferences_path(app).ok()?).ok()?;
    preferences
        .mail_notifications
        .then(|| (preferences.notification_details, preferences.is_turkish()))
}

pub(crate) fn keep_running_on_close(app: &AppHandle) -> bool {
    preferences_path(app)
        .ok()
        .and_then(|path| read_preferences(&path).ok())
        .is_some_and(|preferences| preferences.keep_running_on_close)
}

pub(crate) fn tray_is_turkish(app: &AppHandle) -> bool {
    preferences_path(app)
        .ok()
        .and_then(|path| read_preferences(&path).ok())
        .unwrap_or_default()
        .is_turkish()
}

fn read_preferences(path: &Path) -> io::Result<Preferences> {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Preferences::default()),
        Err(error) => return Err(error),
    };
    let mut bytes = Vec::new();
    file.take(1025).read_to_end(&mut bytes)?;
    if bytes.len() > 1024 {
        return Ok(Preferences::default());
    }

    Ok(serde_json::from_slice::<Preferences>(&bytes)
        .unwrap_or_default()
        .validated())
}

fn write_preferences(path: &Path, preferences: Preferences) -> io::Result<()> {
    let directory = path
        .parent()
        .ok_or_else(|| io::Error::other("Preferences directory is unavailable."))?;
    fs::create_dir_all(directory)?;
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    let result = (|| {
        let mut file = File::create(&temporary)?;
        serde_json::to_writer(&mut file, &preferences.validated())?;
        file.flush()?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPreferences {
    preferences: Preferences,
    system_locale: Option<String>,
}

#[tauri::command]
pub fn load_ui_preferences(app: AppHandle) -> Result<LoadedPreferences, &'static str> {
    let preferences =
        read_preferences(&preferences_path(&app)?).map_err(|_| "Could not load preferences.")?;
    Ok(LoadedPreferences {
        preferences,
        system_locale: sys_locale::get_locale(),
    })
}

#[tauri::command]
pub fn save_ui_preferences(app: AppHandle, preferences: Preferences) -> Result<(), &'static str> {
    let turkish = preferences.is_turkish();
    write_preferences(&preferences_path(&app)?, preferences)
        .map_err(|_| "Could not save appearance preferences.")?;
    crate::desktop::update_menu_language(&app, turkish);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_preferences_default_to_light_liquid_glass() -> Result<(), serde_json::Error> {
        let preferences: Preferences = serde_json::from_str("{}")?;
        assert_eq!(preferences.theme, Appearance::Light);
        assert_eq!(preferences.theme_id, "default");
        assert_eq!(preferences.language, Language::System);
        assert!(preferences.mail_notifications);
        assert!(!preferences.notification_details);
        assert!(preferences.keep_running_on_close);
        Ok(())
    }

    #[test]
    fn bounds_deserialized_widths_and_preserves_theme() -> Result<(), serde_json::Error> {
        let preferences: Preferences =
            serde_json::from_str(r#"{"theme":"dark","sidebarWidth":10,"listWidth":999}"#)?;
        assert_eq!(
            preferences.validated(),
            Preferences {
                theme: Appearance::Dark,
                theme_id: "default".into(),
                language: Language::System,
                sidebar_collapsed: false,
                sidebar_width: 190,
                list_width: 444,
                ..Preferences::default()
            }
        );
        Ok(())
    }

    #[test]
    fn replaces_invalid_theme_id_without_discarding_appearance() -> Result<(), serde_json::Error> {
        let preferences: Preferences =
            serde_json::from_str(r#"{"theme":"dark","themeId":"../invalid"}"#)?;
        let preferences = preferences.validated();
        assert_eq!(preferences.theme, Appearance::Dark);
        assert_eq!(preferences.theme_id, "default");
        Ok(())
    }

    #[test]
    fn replaces_preferences_and_falls_back_for_invalid_contents() -> io::Result<()> {
        let directory =
            std::env::temp_dir().join(format!("lusi-preferences-{}", std::process::id()));
        let path = directory.join("ui-preferences.json");
        write_preferences(&path, Preferences::default())?;
        let custom = Preferences {
            theme: Appearance::Dark,
            theme_id: "forest".into(),
            language: Language::Tr,
            sidebar_collapsed: true,
            sidebar_width: 244,
            list_width: 386,
            mail_notifications: false,
            notification_details: true,
            keep_running_on_close: false,
        };
        write_preferences(&path, custom)?;
        let saved = read_preferences(&path)?;
        assert_eq!(
            (
                saved.theme,
                saved.theme_id.as_str(),
                saved.language,
                saved.sidebar_collapsed,
                saved.sidebar_width,
                saved.list_width,
                saved.mail_notifications,
                saved.notification_details,
                saved.keep_running_on_close
            ),
            (
                Appearance::Dark,
                "forest",
                Language::Tr,
                true,
                244,
                386,
                false,
                true,
                false
            )
        );
        fs::write(&path, "invalid preferences")?;
        assert_eq!(read_preferences(&path)?, Preferences::default());
        fs::remove_file(path)?;
        fs::remove_dir(directory)
    }
}
