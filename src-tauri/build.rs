fn main() {
    // tauri_build embeds icons/icon.ico into libresource.a but does not declare the icon
    // files as cargo:rerun-if-changed, so an incremental build silently keeps the old icon.
    for icon in ["icon.ico", "icon.png", "32x32.png", "128x128.png", "128x128@2x.png"] {
        println!("cargo:rerun-if-changed=icons/{icon}");
    }
    tauri_build::build()
}