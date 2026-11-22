use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, Window, WindowEvent, Wry,
};

pub(crate) const MAIN_WINDOW: &str = "main";
const TRAY_ID: &str = "lusi-background";
const MENU_ACTION: &str = "desktop:menu-action";
const ITEMS: [(&str, &str, &str); 5] = [
    ("inbox", "Open Inbox", "Gelen Kutusunu Aç"),
    ("check", "Check Mail", "Postaları Denetle"),
    ("compose", "New Message", "Yeni İleti"),
    ("settings", "Settings", "Ayarlar"),
    ("quit", "Quit Lusi", "Lusi’den Çık"),
];

struct TrayMenu {
    items: Vec<MenuItem<Wry>>,
    turkish: AtomicBool,
}

pub(crate) fn install_tray(app: &AppHandle) -> tauri::Result<()> {
    let turkish = crate::preferences::tray_is_turkish(app);
    let menu = Menu::new(app)?;
    let mut items = Vec::with_capacity(ITEMS.len());
    for (id, english, translated) in ITEMS {
        if id == "quit" {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        let text = if turkish { translated } else { english };
        let item = MenuItem::with_id(app, id, text, true, None::<&str>)?;
        menu.append(&item)?;
        items.push(item);
    }
    let icon =
        app.default_window_icon()
            .ok_or(tauri::Error::InvalidIcon(std::io::Error::other(
                "Lusi app icon is unavailable",
            )))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon.clone())
        .tooltip("Lusi")
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => app.exit(0),
            "check" => app
                .state::<crate::mail::sync::InboxSync>()
                .request_refresh(),
            action @ ("inbox" | "compose" | "settings") if show_main(app) => {
                let _ = app.emit_to(MAIN_WINDOW, MENU_ACTION, action);
            }
            _ => {}
        })
        .build(app)?;
    app.manage(TrayMenu {
        items,
        turkish: AtomicBool::new(turkish),
    });
    Ok(())
}

pub(crate) fn update_menu_language(app: &AppHandle, turkish: bool) {
    let Some(menu) = app.try_state::<TrayMenu>() else {
        return;
    };
    if menu.turkish.swap(turkish, Ordering::Relaxed) == turkish {
        return;
    }
    for (item, (_, english, translated)) in menu.items.iter().zip(ITEMS) {
        let _ = item.set_text(if turkish { translated } else { english });
    }
}

pub(crate) fn handle_window_event(window: &Window, event: &WindowEvent) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    let app = window.app_handle();
    if window.label() == MAIN_WINDOW
        && app.tray_by_id(TRAY_ID).is_some()
        && crate::preferences::keep_running_on_close(app)
        && window.hide().is_ok()
    {
        api.prevent_close();
    }
}

pub(crate) fn show_main(app: &AppHandle) -> bool {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return false;
    };
    if window.show().is_err() {
        return false;
    }
    let _ = window.unminimize();
    let _ = window.set_focus();
    true
}
