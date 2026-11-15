// Drives the running desktop app over the Chrome DevTools Protocol (Windows/WebView2).
//
// Start the app with:  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333 pnpm tauri dev
// Then:                node scripts/cdp.mjs <body.js | -> [screenshot.png]
//
// <body.js> is the body of an async function evaluated in the page; `return` a JSON-able value.
// It can use window.__pw (dev hooks) and window.__TAURI_INTERNALS__.invoke(...).
import { readFileSync, writeFileSync } from "node:fs";

const [, , jsFile, shotPath] = process.argv;
const port = process.env.CDP_PORT ?? "9333";
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find((t) => t.type === "page");
if (!page) throw new Error("No page target; is the app running with remote debugging?");

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));

let nextId = 1;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  pending.get(msg.id)?.(msg);
});
const send = (method, params) =>
  new Promise((resolve) => {
    const id = nextId++;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });

if (jsFile && jsFile !== "-") {
  const body = readFileSync(jsFile, "utf8");
  const { result } = await send("Runtime.evaluate", {
    expression: `(async () => { ${body} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  const value = result?.exceptionDetails?.exception?.description ?? result?.result?.value ?? result;
  console.log(JSON.stringify(value, null, 2));
}
if (shotPath) {
  const { result } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(shotPath, Buffer.from(result.data, "base64"));
  console.log("screenshot:", shotPath);
}
ws.close();
