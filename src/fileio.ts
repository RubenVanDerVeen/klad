import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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

/**
 * Pull the forwarded file paths out of a "single-instance" event payload.
 * Returns argv[1..] (argv[0] is the executable name) when the payload is the
 * expected shape, otherwise []. Defensive: the payload crosses a process
 * boundary and a malformed one must never crash the listener.
 *
 * `cwd` is currently ignored (spec §5: forward-compat field only).
 */
export function extractPaths(payload: unknown): string[] {
  if (typeof payload !== "object" || payload === null) return [];
  const argv = (payload as { argv?: unknown }).argv;
  if (!Array.isArray(argv)) return [];
  if (!argv.every((x) => typeof x === "string")) return [];
  return argv.slice(1) as string[];
}

/**
 * Subscribe to single-instance file-forward events. Each forwarded path
 * (argv[1..]) is passed to `handler`. Returns a Promise that resolves to
 * the Tauri unlisten function once the backend acknowledges the subscription
 * (Tauri's `listen` is async).
 *
 * Note on the return type: spec §5 notates the wrapper as `UnlistenFn`, but
 * the honest surface is `Promise<UnlistenFn>` because that is what
 * `@tauri-apps/api/event`'s `listen()` returns.
 */
export function listenOpenFile(handler: (path: string) => void): Promise<UnlistenFn> {
  return listen("single-instance", (event) => {
    for (const path of extractPaths(event.payload)) handler(path);
  });
}