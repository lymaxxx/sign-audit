use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

/// A menu click is forwarded to the web layer as an event, so the front end
/// owns what each command means and the Rust side stays a shell.
fn emit(app: &tauri::AppHandle, action: &str) {
    let _ = app.emit("menu", action);
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let file = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &MenuItem::with_id(app, "new", "New Project", true, Some("CmdOrCtrl+N"))?,
            &MenuItem::with_id(app, "open", "Open Project…", true, Some("CmdOrCtrl+O"))?,
            &MenuItem::with_id(app, "save", "Save Project…", true, Some("CmdOrCtrl+S"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "import", "Import Timetable…", true, Some("CmdOrCtrl+I"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "load-template", "Open Template…", true, None::<&str>)?,
            &MenuItem::with_id(app, "save-template", "Save Template…", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "export", "Export PDF…", true, Some("CmdOrCtrl+E"))?,
            &MenuItem::with_id(
                app,
                "export-all",
                "Export Every Stop…",
                true,
                Some("CmdOrCtrl+Shift+E"),
            )?,
        ],
    )?;

    let edit = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &MenuItem::with_id(app, "undo", "Undo", true, Some("CmdOrCtrl+Z"))?,
            &MenuItem::with_id(app, "redo", "Redo", true, Some("CmdOrCtrl+Shift+Z"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &MenuItem::with_id(app, "zoom-in", "Zoom In", true, Some("CmdOrCtrl+Plus"))?,
            &MenuItem::with_id(app, "zoom-out", "Zoom Out", true, Some("CmdOrCtrl+-"))?,
            &MenuItem::with_id(app, "zoom-fit", "Fit to Window", true, Some("CmdOrCtrl+0"))?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, "toggle-guides", "Show Guides", true, Some("CmdOrCtrl+;"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let app_menu = Submenu::with_items(
        app,
        "Algach",
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(AboutMetadata::default()))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &file, &edit, &view])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let handle = app.handle();
            let menu = build_menu(handle)?;
            app.set_menu(menu)?;

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_title("Algach");
            }
            Ok(())
        })
        .on_menu_event(|app, event| emit(app, event.id().as_ref()))
        .run(tauri::generate_context!())
        .expect("error while running Algach");
}
