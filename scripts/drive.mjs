// Drives the running desktop app through its dev-only debug bridge (src-tauri/src/debug_bridge.rs).
// Works with any webview; screenshots are Linux-only for now (on Windows, see scripts/cdp.mjs).
//
// Start the app with:  PATCHWORK_DEBUG_PORT=9334 pnpm tauri dev
// Then:                node scripts/drive.mjs [--wait] <body.js | -e "code" | -> [screenshot.png]
//
// The JS is the body of an async function evaluated in the page; `return` a JSON-able value.
// It can use window.__pw (dev hooks) and window.__TAURI_INTERNALS__.invoke(...).
// --wait retries until the bridge is up (the first Rust build takes minutes).
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const wait = args[0] === "--wait" && args.shift();
let body = null;
if (args[0] === "-e") {
  args.shift();
  body = args.shift();
} else {
  const file = args.shift();
  if (file && file !== "-") body = readFileSync(file, "utf8");
}
const shotPath = args.shift();

const base = `http://127.0.0.1:${process.env.PATCHWORK_DEBUG_PORT ?? "9334"}`;
const headers = { "X-Patchwork-Debug": "1" };

async function request(path, init = {}) {
  const deadline = Date.now() + (wait ? 300_000 : 0);
  for (;;) {
    try {
      const res = await fetch(base + path, { ...init, headers });
      if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
      return res;
    } catch (e) {
      if (e.cause?.code !== "ECONNREFUSED") throw e;
      if (Date.now() > deadline) throw new Error(`No debug bridge at ${base}; start the app with PATCHWORK_DEBUG_PORT set.`);
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

if (wait) await request("/");
if (body !== null) {
  const result = await (await request("/eval", { method: "POST", body })).json();
  if (result.ok) {
    console.log(JSON.stringify(result.value, null, 2));
  } else {
    console.error(result.error);
    process.exitCode = 1;
  }
}
if (shotPath) {
  const png = await (await request("/screenshot")).arrayBuffer();
  writeFileSync(shotPath, Buffer.from(png));
  console.log("screenshot:", shotPath);
}
