//! `pw://` protocol serving asset bytes to the webview:
//!   lod/<asset-id>/<size>  downscaled level (generated on first request)
//!   file/<asset-id>        the original file; honors `Range`. (Video and audio go through
//!                          `media_server` instead: WebKitGTK can't play media from custom schemes.)
//!   poster/<asset-id>      a video's poster frame, once the webview has captured one
//!   wave/<asset-id>        an audio file's waveform as JSON (decoded on first request)
//!   sprite/<asset-id>/meta          an Aseprite file's size, frame durations, layers and tags (JSON)
//!   sprite/<asset-id>/sheet/<mask>  every frame in a grid (PNG); `mask` is "file" or one 0/1 per layer

use crate::lod::{Encoded, LOD_SIZES};
use crate::AppState;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::Arc;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::{Manager, Runtime, UriSchemeContext, UriSchemeResponder};

type Resp = Response<Vec<u8>>;

/// The most an open-ended range (`bytes=n-`) returns at once: players ask again for more.
const CHUNK: u64 = 2 << 20;

pub fn handle<R: Runtime>(ctx: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let state = ctx.app_handle().state::<Arc<AppState>>().inner().clone();
    let path = request.uri().path().trim_start_matches('/').to_string();
    let range = request.headers().get(header::RANGE).and_then(|v| v.to_str().ok()).map(str::to_owned);
    tauri::async_runtime::spawn_blocking(move || route(state, &path, range.as_deref(), responder));
}

fn route(state: Arc<AppState>, path: &str, range: Option<&str>, responder: UriSchemeResponder) {
    let parts: Vec<&str> = path.split('/').collect();
    let (route, id) = match parts.as_slice() {
        [route @ ("file" | "poster" | "wave" | "lod" | "sprite"), id, ..] => (*route, *id),
        _ => return responder.respond(status(StatusCode::NOT_FOUND)),
    };
    let Some(asset) = state.asset(id) else {
        return responder.respond(status(StatusCode::NOT_FOUND));
    };

    match (route, parts.get(2)) {
        ("file", None) => responder.respond(file(&asset.path, range)),
        ("poster", None) => match state.media.poster_path(&asset.hash) {
            Some(p) => responder.respond(file(&p.to_string_lossy(), None)),
            None => responder.respond(status(StatusCode::NOT_FOUND)),
        },
        ("wave", None) => {
            let st = state.clone();
            state.lods.pool.spawn(move || {
                let resp = match st.media.waveform(&asset.hash, std::path::Path::new(&asset.path)) {
                    Ok(json) => ok(Encoded { bytes: json, mime: "application/json" }),
                    Err(e) => {
                        eprintln!("waveform failed for {}: {e}", asset.path);
                        status(StatusCode::UNPROCESSABLE_ENTITY)
                    }
                };
                responder.respond(resp);
            });
        }
        ("sprite", Some(&"meta")) => sprite(&asset, "application/json", |a| state.sprites.meta(a), responder),
        ("sprite", Some(&"sheet")) => match parts.get(3) {
            Some(mask) => sprite(&asset, "image/png", |a| state.sprites.sheet(a, mask), responder),
            None => responder.respond(status(StatusCode::BAD_REQUEST)),
        },
        ("lod", Some(size)) => match size.parse::<u32>() {
            Ok(size) => lod(state, asset, size, responder),
            Err(_) => responder.respond(status(StatusCode::BAD_REQUEST)),
        },
        _ => responder.respond(status(StatusCode::NOT_FOUND)),
    }
}

fn sprite(
    asset: &crate::assets::Asset,
    mime: &'static str,
    get: impl FnOnce(&crate::assets::Asset) -> Result<Arc<Vec<u8>>, String>,
    responder: UriSchemeResponder,
) {
    responder.respond(match get(asset) {
        Ok(bytes) => ok(Encoded { bytes: bytes.as_ref().clone(), mime }),
        Err(e) => {
            eprintln!("sprite failed for {}: {e}", asset.path);
            status(StatusCode::UNPROCESSABLE_ENTITY)
        }
    });
}

fn lod(state: Arc<AppState>, asset: crate::assets::Asset, size: u32, responder: UriSchemeResponder) {
    // Smallest level that covers the request; none means the original is best.
    let level = LOD_SIZES.iter().copied().find(|&l| l >= size && l < asset.max_dim());
    let Some(level) = level else {
        return responder.respond(file(&asset.path, None));
    };
    if let Some(hit) = state.lods.cached(&asset.hash, level) {
        return responder.respond(ok(hit));
    }
    let st = state.clone();
    state.lods.pool.spawn(move || {
        let resp = match st.lods.generate(&asset, level) {
            Ok(encoded) => ok(encoded),
            Err(e) => {
                eprintln!("LOD generation failed for {}: {e}", asset.path);
                file(&asset.path, None)
            }
        };
        responder.respond(resp);
    });
}

fn ok(encoded: Encoded) -> Resp {
    Response::builder()
        .header(header::CONTENT_TYPE, encoded.mime)
        // URLs carry the content hash, so cached responses never go stale.
        .header(header::CACHE_CONTROL, "max-age=31536000, immutable")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCEPT_RANGES, "bytes")
        .body(encoded.bytes)
        .unwrap()
}

/// A file, whole or the byte range asked for. Media elements always ask for ranges, so a long
/// video is read a slice at a time, never all at once.
fn file(path: &str, range: Option<&str>) -> Resp {
    let Ok(mut f) = File::open(path) else {
        return status(StatusCode::NOT_FOUND);
    };
    let Ok(len) = f.metadata().map(|m| m.len()) else {
        return status(StatusCode::NOT_FOUND);
    };
    let mime = mime_for(path);
    let Some(range) = range else {
        let mut bytes = Vec::with_capacity(len as usize);
        return match f.read_to_end(&mut bytes) {
            Ok(_) => ok(Encoded { bytes, mime }),
            Err(_) => status(StatusCode::NOT_FOUND),
        };
    };
    let Some((start, end)) = parse_range(range, len, CHUNK) else {
        return Response::builder()
            .status(StatusCode::RANGE_NOT_SATISFIABLE)
            .header(header::CONTENT_RANGE, format!("bytes */{len}"))
            .body(Vec::new())
            .unwrap();
    };
    let mut bytes = vec![0; (end - start + 1) as usize];
    if f.seek(SeekFrom::Start(start)).and_then(|_| f.read_exact(&mut bytes)).is_err() {
        return status(StatusCode::INTERNAL_SERVER_ERROR);
    }
    let mut resp = ok(Encoded { bytes, mime });
    *resp.status_mut() = StatusCode::PARTIAL_CONTENT;
    resp.headers_mut().insert(header::CONTENT_RANGE, format!("bytes {start}-{end}/{len}").parse().unwrap());
    resp
}

/// The first range of a `Range` header (`bytes=a-b`, `bytes=a-` or `bytes=-n`), clamped to the
/// file. Open-ended ranges get at most `open_limit` bytes.
pub(crate) fn parse_range(spec: &str, len: u64, open_limit: u64) -> Option<(u64, u64)> {
    let spec = spec.trim().strip_prefix("bytes=")?.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    let last = len.checked_sub(1)?;
    let (start, end) = if a.is_empty() {
        let n: u64 = b.parse().ok()?;
        (len.checked_sub(n.min(len)).filter(|_| n > 0)?, last)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { start.saturating_add(open_limit - 1) } else { b.parse().ok()? };
        (start, end.min(last))
    };
    (start <= end).then_some((start, end))
}

fn status(code: StatusCode) -> Resp {
    // With the CORS header, `fetch` sees the real status rather than a network error.
    Response::builder()
        .status(code)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .body(Vec::new())
        .unwrap()
}

pub(crate) fn mime_for(path: &str) -> &'static str {
    let ext = path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" | "jfif" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "mp4" | "m4v" => "video/mp4",
        "mov" => "video/quicktime",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "aif" | "aiff" => "audio/aiff",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000, CHUNK), Some((0, 99)));
        assert_eq!(parse_range("bytes=900-2000", 1000, CHUNK), Some((900, 999)));
        assert_eq!(parse_range("bytes=-100", 1000, CHUNK), Some((900, 999)));
        assert_eq!(parse_range("bytes=-5000", 1000, CHUNK), Some((0, 999)));
        assert_eq!(parse_range("bytes=10-", 100, CHUNK), Some((10, 99)));
        assert_eq!(parse_range("bytes=0-", 10 * CHUNK, CHUNK), Some((0, CHUNK - 1)));
        assert_eq!(parse_range("bytes=1000-", 1000, CHUNK), None);
        assert_eq!(parse_range("bytes=-0", 1000, CHUNK), None);
        assert_eq!(parse_range("bytes=0-0", 0, CHUNK), None);
        assert_eq!(parse_range("items=0-1", 10, CHUNK), None);
    }
}
