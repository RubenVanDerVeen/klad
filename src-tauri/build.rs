fn main() {
    // ponytail: brief omits an icon, but tauri-build requires icons/icon.ico for the
    // Windows resource file regardless of bundle.active. Replace with a real icon set
    // (32/128/128@2x png + .icns) before any release build.
    tauri_build::build()
}