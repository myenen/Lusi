#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::{Manager, RunEvent};

mod desktop;
mod mail;
mod preferences;
mod unread_badge;

fn main() -> tauri::Result<()> {
    let builder = tauri::Builder::default();
    #[cfg(windows)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if !mail::notifications::activation::activate(app, args.into_iter().skip(1)) {
                desktop::show_main(app);
            }
        }))
        .manage(mail::notifications::activation::PendingNotification::default());

    builder
        .enable_macos_default_menu(false)
        .plugin(tauri_plugin_notification::init())
        .manage(mail::MailOperations::default())
        .manage(mail::GmailSession::default())
        .manage(mail::ImapSessions::default())
        .manage(mail::AttachmentPreviews::default())
        .manage(mail::sync::InboxSync::default())
        .manage(mail::scheduled::ScheduledMail::default())
        .manage(unread_badge::UnreadBadge::default())
        .on_window_event(desktop::handle_window_event)
        .setup(|app| {
            #[cfg(not(windows))]
            mail::notifications::install(app.handle())?;
            #[cfg(windows)]
            mail::notifications::activation::activate(app.handle(), std::env::args().skip(1));
            if let Err(error) = desktop::install_tray(app.handle()) {
                log::warn!("Could not initialize Lusi's system tray: {error}");
            }
            tauri::async_runtime::spawn(mail::sync::run(app.handle().clone()));
            tauri::async_runtime::spawn(mail::scheduled::run(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            preferences::load_ui_preferences,
            preferences::save_ui_preferences,
            mail::load_connected_inbox,
            mail::notifications::take_notification_open,
            mail::list_connected_accounts,
            mail::switch_connected_account,
            mail::discovery::discover_imap_settings,
            mail::check_imap_settings,
            mail::connect_imap_account,
            mail::connect_gmail_account,
            mail::refresh_connected_inbox,
            mail::list_connected_folders,
            mail::read_connected_folder,
            mail::read_older_connected_messages,
            mail::search_connected_messages,
            mail::read_connected_message,
            mail::conversation::read_conversation,
            mail::correspondents::suggest_recipients,
            mail::save_account_signature,
            mail::download_connected_attachment,
            mail::open_connected_attachment,
            mail::send_connected_message,
            mail::scheduled::schedule_message,
            mail::scheduled::list_scheduled_messages,
            mail::scheduled::read_scheduled_message,
            mail::scheduled::cancel_scheduled_message,
            mail::update_connected_message,
            mail::update_connected_messages
        ])
        .build(tauri::generate_context!())?
        .run(|app, event| match event {
            RunEvent::Exit => app.state::<mail::AttachmentPreviews>().cleanup(),
            #[cfg(target_os = "macos")]
            RunEvent::Reopen {
                has_visible_windows: false,
                ..
            } => {
                desktop::show_main(app);
            }
            _ => {}
        });
    Ok(())
}
