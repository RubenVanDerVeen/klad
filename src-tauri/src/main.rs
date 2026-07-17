#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod fs_cmds;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            fs_cmds::read_file,
            fs_cmds::save_file,
            fs_cmds::get_startup_file
        ])
        .run(tauri::generate_context!())
        .expect("error while running Klad");
}
