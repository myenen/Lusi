fn main() -> Result<(), Box<dyn std::error::Error>> {
    let manifest =
        tauri_build::AppManifest::new().commands(&["load_ui_preferences", "save_ui_preferences"]);
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(manifest))?;
    Ok(())
}
