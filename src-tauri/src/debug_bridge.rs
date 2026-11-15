//! Dev-only HTTP bridge for driving the running app from scripts (`scripts/drive.mjs`).
//!
//! Compiled into debug builds only, and started only when `PATCHWORK_DEBUG_PORT` is set.
//! It listens on 127.0.0.1 and serves:
//! - `POST /eval`: the body is the body of an async JS function, run in the main webview.
//!   Responds with `{"ok":true,"value":…}` or `{"ok":false,"error":"…"}`.
//! - `GET /screenshot`: a PNG of the visible webview (Linux and macOS).
//! - `POST /command`: runs a native editing command (body `Copy`, `Cut` or `Paste`) as if its
//!   shortcut were pressed, so clipboard handling can be tested (Linux and macOS).
//!
//! Every request must carry `X-Patchwork-Debug: 1` and a localhost `Host`, and must not carry
//! `Origin`. Browsers can't send a custom header cross-origin without a preflight (which is never
//! answered), and the `Host` check defeats DNS rebinding, so web pages can't reach the bridge.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const EVAL_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_BODY: usize = 8 << 20;

#[derive(Default)]
pub struct Bridge {
    next_id: AtomicU64,
    /// Evals waiting for the webview to report back through `debug_result`.
    pending: Mutex<HashMap<u64, mpsc::SyncSender<String>>>,
}

/// Called by the eval wrapper with the JSON-encoded outcome.
#[tauri::command]
pub fn debug_result(bridge: State<'_, Arc<Bridge>>, id: u64, payload: String) {
    if let Some(tx) = bridge.pending.lock().unwrap().remove(&id) {
        let _ = tx.send(payload);
    }
}

/// Starts the bridge if `PATCHWORK_DEBUG_PORT` is set.
pub fn start(app: &AppHandle, bridge: Arc<Bridge>) {
    let Ok(port) = std::env::var("PATCHWORK_DEBUG_PORT") else { return };
    let listener = match TcpListener::bind(("127.0.0.1", port.parse::<u16>().unwrap_or(9334))) {
        Ok(l) => l,
        Err(e) => return eprintln!("[debug-bridge] can't listen: {e}"),
    };
    eprintln!("[debug-bridge] listening on http://{}", listener.local_addr().unwrap());
    let app = app.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (app, bridge) = (app.clone(), bridge.clone());
            std::thread::spawn(move || {
                if let Err(e) = serve(stream, &app, &bridge) {
                    eprintln!("[debug-bridge] {e}");
                }
            });
        }
    });
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

fn read_request(stream: &TcpStream) -> Result<Request, String> {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    reader.read_line(&mut line).map_err(|e| e.to_string())?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();

    let mut headers = HashMap::new();
    loop {
        line.clear();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    let len: usize = headers.get("content-length").and_then(|v| v.parse().ok()).unwrap_or(0);
    if len > MAX_BODY {
        return Err("body too large".into());
    }
    let mut body = vec![0; len];
    reader.read_exact(&mut body).map_err(|e| e.to_string())?;
    let body = String::from_utf8(body).map_err(|e| e.to_string())?;
    Ok(Request { method, path, headers, body })
}

fn respond(mut stream: TcpStream, status: &str, content_type: &str, body: &[u8]) -> Result<(), String> {
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    );
    stream.write_all(head.as_bytes()).and_then(|_| stream.write_all(body)).map_err(|e| e.to_string())
}

fn allowed(req: &Request) -> bool {
    let host = req.headers.get("host").map(String::as_str).unwrap_or_default();
    let host = host.rsplit_once(':').map_or(host, |(h, _)| h);
    req.headers.get("x-patchwork-debug").is_some_and(|v| v == "1")
        && !req.headers.contains_key("origin")
        && matches!(host, "127.0.0.1" | "localhost")
}

fn serve(stream: TcpStream, app: &AppHandle, bridge: &Bridge) -> Result<(), String> {
    let req = read_request(&stream)?;
    if !allowed(&req) {
        return respond(stream, "403 Forbidden", "text/plain", b"forbidden");
    }
    let text = "text/plain; charset=utf-8";
    match (req.method.as_str(), req.path.as_str()) {
        ("GET", "/") => respond(stream, "200 OK", text, b"patchwork debug bridge"),
        ("POST", "/eval") => match eval(app, bridge, &req.body) {
            Ok(json) => respond(stream, "200 OK", "application/json", json.as_bytes()),
            Err(e) => respond(stream, "500 Internal Server Error", text, e.as_bytes()),
        },
        ("GET", "/screenshot") => match screenshot(app) {
            Ok(png) => respond(stream, "200 OK", "image/png", &png),
            Err(e) => respond(stream, "500 Internal Server Error", text, e.as_bytes()),
        },
        ("POST", "/command") => match command(app, req.body.trim()) {
            Ok(()) => respond(stream, "200 OK", text, b"ok"),
            Err(e) => respond(stream, "500 Internal Server Error", text, e.as_bytes()),
        },
        _ => respond(stream, "404 Not Found", text, b"not found"),
    }
}

fn eval(app: &AppHandle, bridge: &Bridge, body: &str) -> Result<String, String> {
    let webview = app.get_webview_window("main").ok_or("no main window")?;
    let id = bridge.next_id.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::sync_channel(1);
    bridge.pending.lock().unwrap().insert(id, tx);

    // The body is passed as a string and compiled inside the try, so syntax errors are reported.
    let source = serde_json::to_string(body).map_err(|e| e.to_string())?;
    let script = format!(
        r#"(async () => {{
  let payload;
  try {{
    const AsyncFunction = (async () => {{}}).constructor;
    const value = await new AsyncFunction({source})();
    payload = JSON.stringify({{ ok: true, value: value === undefined ? null : value }});
  }} catch (e) {{
    const error = e instanceof Error ? `${{e}}\n${{e.stack ?? ""}}`.trim() : String(e);
    payload = JSON.stringify({{ ok: false, error }});
  }}
  window.__TAURI_INTERNALS__.invoke("debug_result", {{ id: {id}, payload }});
}})();"#
    );

    let result = webview
        .eval(script)
        .map_err(|e| e.to_string())
        .and_then(|_| rx.recv_timeout(EVAL_TIMEOUT).map_err(|_| "timed out waiting for the webview".to_string()));
    bridge.pending.lock().unwrap().remove(&id);
    result
}

#[cfg(target_os = "linux")]
fn screenshot(app: &AppHandle) -> Result<Vec<u8>, String> {
    use webkit2gtk::{gio, SnapshotOptions, SnapshotRegion, WebViewExt};

    let webview = app.get_webview_window("main").ok_or("no main window")?;
    let (tx, rx) = mpsc::sync_channel(1);
    webview
        .with_webview(move |platform| {
            platform.inner().snapshot(
                SnapshotRegion::Visible,
                SnapshotOptions::NONE,
                None::<&gio::Cancellable>,
                move |result| {
                    let png = result.map_err(|e| e.to_string()).and_then(|surface| {
                        let mut png = Vec::new();
                        surface.write_to_png(&mut png).map_err(|e| e.to_string())?;
                        Ok(png)
                    });
                    let _ = tx.send(png);
                },
            );
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(EVAL_TIMEOUT).map_err(|_| "timed out waiting for the snapshot".to_string())?
}

/// WKWebView's `takeSnapshot` (it renders the page afresh, like WebKitGTK's), encoded as PNG at
/// the screen's scale.
#[cfg(target_os = "macos")]
fn screenshot(app: &AppHandle) -> Result<Vec<u8>, String> {
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};
    use objc2_web_kit::WKWebView;

    let webview = app.get_webview_window("main").ok_or("no main window")?;
    let (tx, rx) = mpsc::sync_channel(1);
    webview
        .with_webview(move |platform| {
            // SAFETY: on macOS the platform webview is a WKWebView, alive for this call.
            let view = unsafe { &*(platform.inner() as *const WKWebView) };
            let done = RcBlock::new(move |image: *mut NSImage, error: *mut NSError| {
                // SAFETY: WebKit passes a valid image or error (or null) for the handler's duration.
                let (image, error) = unsafe { (image.as_ref(), error.as_ref()) };
                let png = match image {
                    Some(image) => (|| {
                        let tiff = image.TIFFRepresentation().ok_or("no TIFF data")?;
                        let rep = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("no bitmap")?;
                        // SAFETY: an empty properties dictionary is valid for PNG.
                        let png = unsafe { rep.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()) };
                        png.map(|d| d.to_vec()).ok_or("PNG encoding failed")
                    })()
                    .map_err(str::to_string),
                    None => Err(error.map_or("no snapshot".to_string(), |e| e.localizedDescription().to_string())),
                };
                let _ = tx.send(png);
            });
            // SAFETY: called on the main thread (with_webview); a null configuration snapshots the visible bounds.
            unsafe { view.takeSnapshotWithConfiguration_completionHandler(None, &done) };
        })
        .map_err(|e| e.to_string())?;
    rx.recv_timeout(EVAL_TIMEOUT).map_err(|_| "timed out waiting for the snapshot".to_string())?
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn screenshot(_app: &AppHandle) -> Result<Vec<u8>, String> {
    Err("screenshots are Linux and macOS only for now; on Windows use scripts/cdp.mjs".into())
}

#[cfg(target_os = "linux")]
fn command(app: &AppHandle, name: &str) -> Result<(), String> {
    use webkit2gtk::WebViewExt;

    if !matches!(name, "Copy" | "Cut" | "Paste") {
        return Err(format!("unsupported command {name:?}"));
    }
    let name = name.to_string();
    let webview = app.get_webview_window("main").ok_or("no main window")?;
    webview
        .with_webview(move |platform| platform.inner().execute_editing_command(&name))
        .map_err(|e| e.to_string())
}

/// The webview's own `copy:` / `cut:` / `paste:` actions, as the Edit menu would send them.
#[cfg(target_os = "macos")]
fn command(app: &AppHandle, name: &str) -> Result<(), String> {
    use objc2::runtime::{AnyObject, Sel};
    use objc2::{msg_send, sel};

    let action: Sel = match name {
        "Copy" => sel!(copy:),
        "Cut" => sel!(cut:),
        "Paste" => sel!(paste:),
        _ => return Err(format!("unsupported command {name:?}")),
    };
    let webview = app.get_webview_window("main").ok_or("no main window")?;
    webview
        .with_webview(move |platform| {
            let view = platform.inner() as *mut AnyObject;
            // SAFETY: a WKWebView, on the main thread; these actions take an optional sender.
            unsafe {
                let _: *mut AnyObject = msg_send![view, performSelector: action, withObject: std::ptr::null::<AnyObject>()];
            }
        })
        .map_err(|e| e.to_string())
}

#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn command(_app: &AppHandle, _name: &str) -> Result<(), String> {
    Err("editing commands are Linux and macOS only for now".into())
}
