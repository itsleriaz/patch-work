//! A loopback HTTP server that streams video and audio to the webview.
//!
//! WebKitGTK plays media through GStreamer, whose WebKit source element only loads `http(s)` and
//! `blob` URLs, so `<video>` and `<audio>` can't use the `pw://` scheme. This server streams
//! registered assets straight from disk, honoring `Range` so players can seek, and never holds a
//! whole file in memory. It's used on every platform, so media behaves the same everywhere.
//!
//! Only this app can use it: every URL carries a random token made at startup, the `Host` must
//! be the loopback address (which defeats DNS rebinding), and only registered assets are served.

use crate::protocol::{mime_for, parse_range};
use crate::AppState;
use std::collections::HashMap;
use std::fs::File;
use std::io::{self, BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::Arc;
use std::time::Duration;

/// Longest request head accepted (the request line and headers).
const MAX_HEAD: usize = 16 << 10;

pub struct MediaServer {
    listener: TcpListener,
    token: String,
    /// `http://127.0.0.1:<port>/<token>/`; media URLs are `<base>file/<asset id>`.
    pub base: String,
}

impl MediaServer {
    pub fn bind() -> io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0))?;
        let mut bytes = [0u8; 16];
        getrandom::fill(&mut bytes).map_err(|e| io::Error::other(e.to_string()))?;
        let token: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        let base = format!("http://{}/{token}/", listener.local_addr()?);
        Ok(Self { listener, token, base })
    }

    /// Serves on a background thread, one thread per connection (players open only a few).
    pub fn start(self, state: Arc<AppState>) {
        let token = Arc::new(self.token);
        std::thread::spawn(move || {
            for stream in self.listener.incoming().flatten() {
                let (state, token) = (state.clone(), token.clone());
                std::thread::spawn(move || {
                    // A player that seeks or stops just closes the connection mid-body.
                    let _ = serve(stream, &state, &token);
                });
            }
        });
    }
}

struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
}

fn read_request(stream: &TcpStream) -> io::Result<Request> {
    let mut reader = BufReader::new(stream.take(MAX_HEAD as u64));
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or_default().to_string();
    let path = parts.next().unwrap_or_default().to_string();
    let mut headers = HashMap::new();
    loop {
        line.clear();
        if reader.read_line(&mut line)? == 0 {
            return Err(io::ErrorKind::UnexpectedEof.into());
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }
    Ok(Request { method, path, headers })
}

fn head(stream: &mut TcpStream, status: &str, headers: &[(&str, String)]) -> io::Result<()> {
    let mut out = format!("HTTP/1.1 {status}\r\nConnection: close\r\nAccess-Control-Allow-Origin: *\r\n");
    for (k, v) in headers {
        out.push_str(&format!("{k}: {v}\r\n"));
    }
    out.push_str("\r\n");
    stream.write_all(out.as_bytes())
}

fn empty(stream: &mut TcpStream, status: &str) -> io::Result<()> {
    head(stream, status, &[("Content-Length", "0".into())])
}

fn serve(mut stream: TcpStream, state: &AppState, token: &str) -> io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(10)))?;
    let req = read_request(&stream)?;
    let host = req.headers.get("host").map(String::as_str).unwrap_or_default();
    if host.rsplit_once(':').map_or(host, |(h, _)| h) != "127.0.0.1" {
        return empty(&mut stream, "403 Forbidden");
    }
    if req.method != "GET" && req.method != "HEAD" {
        return empty(&mut stream, "405 Method Not Allowed");
    }
    // /<token>/file/<asset id>[?v=…]
    let path = req.path.split('?').next().unwrap_or_default();
    let mut parts = path.trim_start_matches('/').split('/');
    let (Some(t), Some("file"), Some(id), None) = (parts.next(), parts.next(), parts.next(), parts.next()) else {
        return empty(&mut stream, "404 Not Found");
    };
    if t != token {
        return empty(&mut stream, "403 Forbidden");
    }
    let Some(asset) = state.asset(id) else {
        return empty(&mut stream, "404 Not Found");
    };
    let Ok(mut file) = File::open(&asset.path) else {
        return empty(&mut stream, "404 Not Found");
    };
    let len = file.metadata()?.len();
    let mime = mime_for(&asset.path).to_string();

    let (status, start, end) = match req.headers.get("range") {
        None => ("200 OK", 0, len.saturating_sub(1)),
        // Open-ended ranges are streamed to the end: the player closes the connection to seek.
        Some(spec) => match parse_range(spec, len, u64::MAX) {
            Some((s, e)) => ("206 Partial Content", s, e),
            None => {
                return head(&mut stream, "416 Range Not Satisfiable", &[("Content-Range", format!("bytes */{len}")), ("Content-Length", "0".into())]);
            }
        },
    };
    let count = if len == 0 { 0 } else { end - start + 1 };
    let mut headers = vec![
        ("Content-Type", mime),
        ("Content-Length", count.to_string()),
        ("Accept-Ranges", "bytes".into()),
        // URLs carry the content hash (?v=), so a cached response never goes stale.
        ("Cache-Control", "max-age=31536000, immutable".into()),
    ];
    if status.starts_with("206") {
        headers.push(("Content-Range", format!("bytes {start}-{end}/{len}")));
    }
    head(&mut stream, status, &headers)?;
    if req.method == "HEAD" || count == 0 {
        return Ok(());
    }
    file.seek(SeekFrom::Start(start))?;
    io::copy(&mut file.take(count), &mut stream)?;
    stream.flush()
}
