import { invoke } from "@tauri-apps/api/core";

export interface FileDoc {
  text: string;
  encoding: string;
  eol: string;
}

export function readFile(path: string): Promise<FileDoc> {
  return invoke<FileDoc>("read_file", { path });
}

export function saveFile(
  path: string,
  text: string,
  encoding: string,
  eol: string,
): Promise<void> {
  return invoke<void>("save_file", { path, text, encoding, eol });
}

export function getStartupFile(): Promise<string | null> {
  return invoke<string | null>("get_startup_file");
}