fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "load_ui_preferences",
        "save_ui_preferences",
        "load_connected_inbox",
        "list_connected_accounts",
        "switch_connected_account",
        "discover_imap_settings",
        "check_imap_settings",
        "connect_imap_account",
        "connect_gmail_account",
        "refresh_connected_inbox",
        "list_connected_folders",
        "read_connected_folder",
        "read_older_connected_messages",
        "search_connected_messages",
        "read_connected_message",
        "download_connected_attachment",
        "open_connected_attachment",
        "send_connected_message",
        "update_connected_message",
        "update_connected_messages",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))?;
    Ok(())
}
