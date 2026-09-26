import { defineConfig } from "vite";

export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    // src-tauri holds the cargo build tree (target/ = tens of thousands of
    // artifacts); watching it exhausts inotify (ENOSPC) and serves no purpose
    // — Rust change notifications come from the tauri CLI, not Vite.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2022" },
});