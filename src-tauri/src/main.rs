#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod mail;
mod preferences;

fn main() -> tauri::Result<()> {
    tauri::Builder::default()
        .enable_macos_default_menu(false)
        .manage(mail::MailOperations::default())
        .invoke_handler(tauri::generate_handler![
            preferences::load_ui_preferences,
            preferences::save_ui_preferences,
            mail::load_connected_inbox,
            mail::discovery::discover_imap_settings,
            mail::check_imap_settings,
            mail::connect_imap_account,
            mail::refresh_connected_inbox,
            mail::list_connected_folders,
            mail::read_connected_folder,
            mail::read_connected_message,
            mail::send_connected_message,
            mail::update_connected_message
        ])
        .run(tauri::generate_context!())
}
