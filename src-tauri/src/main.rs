#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fs_cmds;

use serde::Serialize;
use tauri::{Emitter, Manager};

/// Payload forwarded from a second OS-launched klad process to the first.
/// `cwd` is unused in v1 but kept for forward-compat (e.g. "Open File from CWD")
/// so the contract doesn't need a second breaking change later.
#[derive(Clone, Serialize)]
struct Payload {
    argv: Vec<String>,
    cwd: String,
}

fn main() {
    tauri::Builder::default()
        // Single-instance MUST be first: its lock check runs before any other
        // plugin or window construction. A second process exits inside this
        // plugin before the rest of the builder executes.
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            let _ = app.emit_to("main", "single-instance", Payload { argv, cwd });
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.show();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs_cmds::read_file,
            fs_cmds::save_file,
            fs_cmds::get_startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Klad");
}