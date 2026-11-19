#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod preferences;

fn main() -> tauri::Result<()> {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            preferences::load_ui_preferences,
            preferences::save_ui_preferences
        ])
        .run(tauri::generate_context!())
}
