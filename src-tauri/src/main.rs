#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;

mod mail;
mod preferences;

fn main() -> tauri::Result<()> {
    tauri::Builder::default()
        .enable_macos_default_menu(false)
        .manage(mail::MailOperations::default())
        .manage(mail::GmailSession::default())
        .manage(mail::AttachmentPreviews::default())
        .invoke_handler(tauri::generate_handler![
            preferences::load_ui_preferences,
            preferences::save_ui_preferences,
            mail::load_connected_inbox,
            mail::list_connected_accounts,
            mail::switch_connected_account,
            mail::discovery::discover_imap_settings,
            mail::check_imap_settings,
            mail::connect_imap_account,
            mail::connect_gmail_account,
            mail::refresh_connected_inbox,
            mail::list_connected_folders,
            mail::read_connected_folder,
            mail::read_connected_message,
            mail::download_connected_attachment,
            mail::open_connected_attachment,
            mail::send_connected_message,
            mail::update_connected_message,
            mail::update_connected_messages
        ])
        .build(tauri::generate_context!())?
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<mail::AttachmentPreviews>().cleanup();
            }
        });
    Ok(())
}
