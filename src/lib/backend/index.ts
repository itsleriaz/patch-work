import { tauriBackend } from "./tauri";
import type { Backend } from "./types";
import { webBackend } from "./web";

export type { Backend, Level } from "./types";

export const backend: Backend = "__TAURI_INTERNALS__" in window ? tauriBackend : webBackend;
