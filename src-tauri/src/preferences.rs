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
    #[default]
    System,
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
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            theme: Appearance::System,
            theme_id: "default".into(),
            language: Language::System,
            sidebar_collapsed: false,
            sidebar_width: 222,
            list_width: 348,
        }
    }
}

impl Preferences {
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
    write_preferences(&preferences_path(&app)?, preferences)
        .map_err(|_| "Could not save appearance preferences.")
}

#[cfg(test)]
mod tests {
    use super::*;

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
                saved.list_width
            ),
            (Appearance::Dark, "forest", Language::Tr, true, 244, 386)
        );
        fs::write(&path, "invalid preferences")?;
        assert_eq!(read_preferences(&path)?, Preferences::default());
        fs::remove_file(path)?;
        fs::remove_dir(directory)
    }
}
