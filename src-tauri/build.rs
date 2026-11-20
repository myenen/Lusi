fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest = tauri_build::AppManifest::new().commands(&[
        "load_ui_preferences",
        "save_ui_preferences",
        "load_connected_inbox",
        "discover_imap_settings",
        "check_imap_settings",
        "connect_imap_account",
        "refresh_connected_inbox",
        "list_connected_folders",
        "read_connected_folder",
        "read_connected_message",
    ]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))?;
    Ok(())
}
