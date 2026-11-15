mod assets;
mod clipboard;
#[cfg(debug_assertions)]
mod debug_bridge;
mod lod;
mod media;
mod media_server;
mod project;
mod protocol;
mod recovery;
mod sprite;
mod storage;

use assets::{Asset, ImportResult};
use clipboard::{Pasted, SystemClipboard};
use lod::LodCache;
use media::MediaCache;
use media_server::MediaServer;
use project::ProjectDoc;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, RwLock};
use std::time::Duration;
use tauri::{Emitter, Manager, State};

pub struct AppState {
    /// Every asset the webview may request through `pw://`, by id.
    assets: RwLock<HashMap<String, Asset>>,
    lods: LodCache,
    /// Video posters and audio waveforms.
    media: MediaCache,
    /// Where embedded assets' bytes live while the app runs (content-addressed files).
    blobs: PathBuf,
    clipboard: SystemClipboard,
    /// Set to stop a search for missing files.
    relink_cancel: AtomicBool,
    /// Recovery copies of unsaved boards (one JSON file per board).
    recovery: PathBuf,
    /// Aseprite descriptions and sprite sheets.
    sprites: sprite::SpriteCache,
}

impl AppState {
    fn asset(&self, id: &str) -> Option<Asset> {
        self.assets.read().unwrap().get(id).cloned()
    }

    fn register(&self, list: &[Asset]) {
        let mut map = self.assets.write().unwrap();
        for a in list.iter().filter(|a| !a.missing) {
            map.insert(a.id.clone(), a.clone());
        }
    }
}

/// Watches linked sprites (Aseprite files) for changes on disk, about once a second, so saving in
/// Aseprite updates the board: a changed file is hashed again and `asset-changed` carries the
/// updated asset to the webview (same id, new hash).
fn watch_sprites(app: tauri::AppHandle, state: Arc<AppState>) {
    use tauri::Emitter;
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(800));
        let sprites: Vec<Asset> = state
            .assets
            .read()
            .unwrap()
            .values()
            .filter(|a| a.kind == assets::AssetKind::Sprite && a.storage == assets::Storage::Linked)
            .cloned()
            .collect();
        for mut a in sprites {
            let path = std::path::Path::new(&a.path);
            let Ok(stamp) = assets::file_stamp(path) else { continue };
            if stamp == (a.size, a.mtime) {
                continue;
            }
            // Aseprite may still be writing: wait for the file to hold still (next round otherwise).
            std::thread::sleep(std::time::Duration::from_millis(150));
            if assets::file_stamp(path).ok() != Some(stamp) {
                continue;
            }
            let Ok(hash) = assets::hash_file(path) else { continue };
            (a.size, a.mtime) = stamp;
            let changed = hash != a.hash;
            a.hash = hash;
            if let Ok((w, h)) = sprite::dimensions(path) {
                (a.width, a.height) = (w, h);
            }
            state.assets.write().unwrap().insert(a.id.clone(), a.clone());
            if changed {
                let _ = app.emit("asset-changed", &a);
            }
        }
    });
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
async fn import_files(state: State<'_, Arc<AppState>>, paths: Vec<PathBuf>) -> Result<ImportResult, String> {
    let result = blocking(move || Ok(assets::import_paths(&paths))).await?;
    state.register(&result.assets);
    Ok(result)
}

/// Raw image bytes (the request body) become an embedded asset. The `x-name` header
/// carries the URI-encoded name, without extension.
#[tauri::command]
async fn import_bytes(state: State<'_, Arc<AppState>>, request: tauri::ipc::Request<'_>) -> Result<Asset, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode)
        .unwrap_or_else(|| "Pasted image".into());
    let (bytes, blobs) = (bytes.clone(), state.blobs.clone());
    let asset = blocking(move || assets::import_bytes(&bytes, &name, &blobs)).await?;
    state.register(std::slice::from_ref(&asset));
    Ok(asset)
}

/// An exported file (the request body) written to the path in the URI-encoded `x-path` header,
/// which the user picked in a save dialog.
#[tauri::command]
async fn write_export(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let path = request.headers().get("x-path").and_then(|v| v.to_str().ok()).map(percent_decode).ok_or("missing x-path")?;
    let bytes = bytes.clone();
    blocking(move || assets::write_atomic(Path::new(&path), &bytes)).await
}

/// An exported file (the request body) written into the folder in the URI-encoded `x-dir`
/// header, named after `x-name` but never over an existing file. Returns the path written.
#[tauri::command]
async fn write_export_new(request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let header = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(percent_decode);
    let (dir, name) = (header("x-dir").ok_or("missing x-dir")?, header("x-name").ok_or("missing x-name")?);
    let bytes = bytes.clone();
    blocking(move || {
        let path = storage::free_path(Path::new(&dir), &name);
        assets::write_atomic(&path, &bytes)?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

/// An asset's own file exported as it is: copied to `path` (picked in a save dialog), or into
/// `dir` as `name` but never over an existing file. Copied by the OS, so a big video never
/// passes through memory. Returns the path written.
#[tauri::command]
async fn copy_export(state: State<'_, Arc<AppState>>, id: String, path: Option<String>, dir: Option<String>, name: Option<String>) -> Result<String, String> {
    let asset = state.asset(&id).ok_or("unknown asset")?;
    blocking(move || {
        let target = match (path, dir, name) {
            (Some(p), _, _) => PathBuf::from(p),
            (None, Some(d), Some(n)) => storage::free_path(Path::new(&d), &n),
            _ => return Err("expected a path, or a folder and a name".into()),
        };
        let src = PathBuf::from(&asset.path);
        if !src.is_file() {
            return Err(format!("{} is missing", asset.name));
        }
        if src == target {
            return Ok(target.to_string_lossy().into_owned());
        }
        let tmp = target.with_extension("tmp");
        std::fs::copy(&src, &tmp).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &target).map_err(|e| e.to_string())?;
        Ok(target.to_string_lossy().into_owned())
    })
    .await
}

/// A sprite exported as PNG (a frame or a sheet) or an animated GIF, returned as raw bytes.
#[tauri::command]
async fn export_sprite(state: State<'_, Arc<AppState>>, id: String, request: sprite::ExportRequest) -> Result<tauri::ipc::Response, String> {
    let asset = state.asset(&id).ok_or("unknown asset")?;
    let bytes = blocking(move || sprite::export(&asset, &request)).await?;
    Ok(tauri::ipc::Response::new(bytes))
}

/// A video's poster frame, captured by the webview as JPEG (the request body). The `x-hash`
/// header names the content hash it belongs to.
#[tauri::command]
async fn save_poster(state: State<'_, Arc<AppState>>, request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw bytes".into());
    };
    let hash = request.headers().get("x-hash").and_then(|v| v.to_str().ok()).ok_or("missing x-hash")?.to_string();
    let (bytes, st) = (bytes.clone(), state.inner().clone());
    blocking(move || st.media.save_poster(&hash, &bytes)).await
}

/// What another app put on the system clipboard. Imported files and images are registered.
#[tauri::command]
async fn read_clipboard(state: State<'_, Arc<AppState>>, image_name: String) -> Result<Pasted, String> {
    let st = state.inner().clone();
    let pasted = blocking(move || st.clipboard.read(&image_name, &st.blobs)).await?;
    match &pasted {
        Pasted::Files { result } => state.register(&result.assets),
        Pasted::Image { asset } => state.register(std::slice::from_ref(asset)),
        _ => {}
    }
    Ok(pasted)
}

/// Puts an asset's image on the system clipboard as a bitmap, for pasting into other apps.
#[tauri::command]
async fn copy_image(state: State<'_, Arc<AppState>>, asset_id: String) -> Result<(), String> {
    let asset = state.asset(&asset_id).ok_or("unknown asset")?;
    let st = state.inner().clone();
    blocking(move || st.clipboard.write_image(std::path::Path::new(&asset.path))).await
}

/// Re-checks assets that arrive from elsewhere (pasted nodes) and makes them servable.
#[tauri::command]
async fn register_assets(state: State<'_, Arc<AppState>>, assets: Vec<Asset>) -> Result<Vec<Asset>, String> {
    let assets = blocking(move || {
        let mut assets = assets;
        project::refresh_assets(&mut assets);
        Ok(assets)
    })
    .await?;
    state.register(&assets);
    Ok(assets)
}

/// Embeds every linked image in the board (written to the file on the next save).
#[tauri::command]
async fn pack_assets(state: State<'_, Arc<AppState>>, assets: Vec<Asset>) -> Result<Vec<Asset>, String> {
    let blobs = state.blobs.clone();
    let assets = blocking(move || storage::pack(assets, &blobs)).await?;
    state.register(&assets);
    Ok(assets)
}

/// Copies linked images into the folder next to the board and links to the copies.
#[tauri::command]
async fn collect_assets(state: State<'_, Arc<AppState>>, project: PathBuf, assets: Vec<Asset>) -> Result<Vec<Asset>, String> {
    let assets = blocking(move || storage::collect(assets, &project)).await?;
    state.register(&assets);
    Ok(assets)
}

/// Writes embedded images into the folder next to the board and links to them.
#[tauri::command]
async fn unpack_assets(state: State<'_, Arc<AppState>>, project: PathBuf, assets: Vec<Asset>) -> Result<Vec<Asset>, String> {
    let assets = blocking(move || storage::unpack(assets, &project)).await?;
    state.register(&assets);
    Ok(assets)
}

/// Searches `dir` (at most `max_depth` folders down) for missing linked files, reporting how it
/// goes on `on_progress`; `cancel_relink` stops it, keeping what was found.
#[tauri::command]
async fn relink_assets(
    state: State<'_, Arc<AppState>>,
    dir: PathBuf,
    assets: Vec<Asset>,
    max_depth: Option<usize>,
    on_progress: tauri::ipc::Channel<storage::RelinkProgress>,
) -> Result<Vec<Asset>, String> {
    state.relink_cancel.store(false, Ordering::Relaxed);
    let st = state.inner().clone();
    let assets = blocking(move || {
        let mut assets = storage::relink(assets, &dir, max_depth, &st.relink_cancel, |p| {
            on_progress.send(p.clone()).ok();
        });
        project::refresh_assets(&mut assets); // a file found by name alone may have new content
        Ok(assets)
    })
    .await?;
    state.register(&assets);
    Ok(assets)
}

#[tauri::command]
fn cancel_relink(state: State<'_, Arc<AppState>>) {
    state.relink_cancel.store(true, Ordering::Relaxed);
}

/// Deletes blobs unused for 30 days, except those in `keep` (hashes the open board may need).
#[tauri::command]
async fn clean_blobs(state: State<'_, Arc<AppState>>, keep: Vec<String>) -> Result<assets::Cleaned, String> {
    let blobs = state.blobs.clone();
    let recovery_dir = state.recovery.clone();
    blocking(move || {
        // Recovery copies point into the blob store too (an unsaved pasted image): keep those.
        let mut keep: HashSet<String> = keep.into_iter().collect();
        keep.extend(recovery::embedded_hashes(&recovery_dir));
        Ok(assets::clean_blobs(&blobs, &keep, Duration::from_secs(30 * 24 * 3600)))
    })
    .await
}

#[tauri::command]
async fn save_recovery(state: State<'_, Arc<AppState>>, meta: recovery::RecoveryMeta, doc: serde_json::Value) -> Result<(), String> {
    let dir = state.recovery.clone();
    blocking(move || recovery::save(&dir, meta, doc)).await
}

#[tauri::command]
async fn list_recoveries(state: State<'_, Arc<AppState>>) -> Result<Vec<recovery::RecoveryMeta>, String> {
    let dir = state.recovery.clone();
    blocking(move || Ok(recovery::list(&dir))).await
}

#[tauri::command]
async fn read_recovery(state: State<'_, Arc<AppState>>, key: String) -> Result<serde_json::Value, String> {
    let dir = state.recovery.clone();
    blocking(move || recovery::read(&dir, &key)).await
}

#[tauri::command]
async fn delete_recovery(state: State<'_, Arc<AppState>>, key: String) -> Result<(), String> {
    let dir = state.recovery.clone();
    blocking(move || {
        recovery::delete(&dir, &key);
        Ok(())
    })
    .await
}

/// The folder collected and unpacked images go to, for messages.
#[tauri::command]
fn files_dir(project: PathBuf) -> String {
    storage::files_dir(&project).to_string_lossy().into_owned()
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = (bytes[i] == b'%').then(|| s.get(i + 1..i + 3)).flatten();
        match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
            Some(b) => {
                out.push(b);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[tauri::command]
async fn save_project(path: PathBuf, doc: ProjectDoc) -> Result<(), String> {
    blocking(move || project::save(&path, &doc)).await
}

#[tauri::command]
async fn load_project(state: State<'_, Arc<AppState>>, path: PathBuf) -> Result<ProjectDoc, String> {
    let blobs = state.blobs.clone();
    let doc = blocking(move || {
        let mut doc = project::load(&path, &blobs)?;
        project::refresh_assets(&mut doc.assets);
        Ok(doc)
    })
    .await?;
    state.register(&doc.assets);
    Ok(doc)
}

/// A board file the OS asked us to open (double-click, "Open with") before the page was listening.
static PENDING_OPEN: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[tauri::command]
fn take_open_file() -> Option<String> {
    PENDING_OPEN.lock().ok()?.take()
}

fn is_board(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".patchwork")
}

/// Hands a board path to the page: now if it's listening, and kept for `take_open_file` if not yet.
fn open_board(app: &tauri::AppHandle, path: String) {
    if let Ok(mut p) = PENDING_OPEN.lock() {
        *p = Some(path);
    }
    let _ = app.emit("open-file", ());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let media_server = MediaServer::bind().expect("couldn't start the media server");
    // The page needs the media server's address synchronously, to build <video> URLs.
    let media_script = format!("window.__PATCHWORK_MEDIA__ = {};", serde_json::to_string(&media_server.base).unwrap());
    tauri::Builder::default()
        .plugin(tauri::plugin::Builder::<_, ()>::new("media-server").js_init_script(media_script).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(move |app| {
            let cache_dir = app.path().app_cache_dir()?.join("lod");
            let state = Arc::new(AppState {
                assets: RwLock::new(HashMap::new()),
                lods: LodCache::new(cache_dir),
                media: MediaCache::new(app.path().app_cache_dir()?.join("media")),
                blobs: app.path().app_data_dir()?.join("blobs"),
                clipboard: SystemClipboard::default(),
                relink_cancel: AtomicBool::new(false),
                recovery: app.path().app_data_dir()?.join("recovery"),
                sprites: sprite::SpriteCache::default(),
            });
            // Windows and Linux pass the file as an argument when it's opened with the app.
            if let Some(path) = std::env::args().skip(1).find(|a| is_board(a)) {
                *PENDING_OPEN.lock().unwrap() = Some(path);
            }
            media_server.start(state.clone());
            watch_sprites(app.handle().clone(), state.clone());
            app.manage(state);
            #[cfg(debug_assertions)]
            {
                let bridge = Arc::new(debug_bridge::Bridge::default());
                app.manage(bridge.clone());
                debug_bridge::start(app.handle(), bridge);
            }
            Ok(())
        })
        .register_asynchronous_uri_scheme_protocol("pw", protocol::handle)
        .invoke_handler(tauri::generate_handler![
            save_recovery,
            list_recoveries,
            read_recovery,
            delete_recovery,
            import_files,
            import_bytes,
            write_export,
            write_export_new,
            copy_export,
            export_sprite,
            save_poster,
            read_clipboard,
            copy_image,
            register_assets,
            pack_assets,
            collect_assets,
            unpack_assets,
            relink_assets,
            cancel_relink,
            clean_blobs,
            files_dir,
            take_open_file,
            save_project,
            load_project,
            #[cfg(debug_assertions)]
            debug_bridge::debug_result,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS delivers opened files as an event, at launch and while running.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        let path = path.to_string_lossy().into_owned();
                        if is_board(&path) {
                            open_board(app, path);
                        }
                    }
                }
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = (app, event);
        });
}
