//! Asset registry types and import: hashing, kind detection, dimension probing, and the
//! content-addressed blob store for embedded assets.

use image::metadata::Orientation;
use image::{ImageDecoder, ImageFormat, ImageReader};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AssetKind {
    Image,
    Gif,
    Video,
    Audio,
    /// Pages are rendered by the webview (pdf.js), which also reads the page size.
    Pdf,
    /// An Aseprite file: frames, layers and tags (see `sprite.rs`).
    Sprite,
}

impl AssetKind {
    pub fn from_path(path: &Path) -> Option<Self> {
        let ext = path.extension()?.to_str()?.to_ascii_lowercase();
        match ext.as_str() {
            "png" | "jpg" | "jpeg" | "jfif" | "webp" | "bmp" => Some(Self::Image),
            "gif" => Some(Self::Gif),
            "mp4" | "m4v" | "mov" | "webm" | "mkv" | "ogv" => Some(Self::Video),
            "mp3" | "wav" | "ogg" | "oga" | "opus" | "flac" | "m4a" | "aac" | "aif" | "aiff" => Some(Self::Audio),
            "pdf" => Some(Self::Pdf),
            "aseprite" | "ase" => Some(Self::Sprite),
            _ => None,
        }
    }

    /// Images have pixels Rust decodes; video, audio and PDFs are probed by the webview.
    pub fn is_image(self) -> bool {
        matches!(self, Self::Image | Self::Gif)
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Gif => "gif",
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Pdf => "pdf",
            Self::Sprite => "sprite",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "image" => Some(Self::Image),
            "gif" => Some(Self::Gif),
            "video" => Some(Self::Video),
            "audio" => Some(Self::Audio),
            "pdf" => Some(Self::Pdf),
            "sprite" => Some(Self::Sprite),
            _ => None,
        }
    }
}

/// How an asset's bytes are stored. Storage lives on the asset, not the node, so
/// "copy next to project" and "packed" modes only need to change assets.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Storage {
    /// A file somewhere on disk; `path` points at it.
    Linked,
    /// Bytes that belong to the board (e.g. a pasted image). Saved inside the project file;
    /// while the app runs they live in the blob store and `path` points there.
    Embedded,
}

impl Storage {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Linked => "linked",
            Self::Embedded => "embedded",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "linked" => Some(Self::Linked),
            "embedded" => Some(Self::Embedded),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    /// Stable identity; equals the content hash at import time.
    pub id: String,
    /// Current content hash (BLAKE3). Changes if the linked file changes on disk.
    pub hash: String,
    pub kind: AssetKind,
    pub storage: Storage,
    pub path: String,
    pub name: String,
    /// Display size in pixels. Video sizes come from the webview after import (0 until then);
    /// audio has none.
    pub width: u32,
    pub height: u32,
    pub size: u64,
    /// Modification time in ms since the Unix epoch.
    pub mtime: i64,
    #[serde(default)]
    pub missing: bool,
    /// Linked: the path relative to the board file, so moving both together keeps the link.
    /// Embedded: where unpacking puts the file inside the board's files folder.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rel: Option<String>,
}

impl Asset {
    pub fn max_dim(&self) -> u32 {
        self.width.max(self.height)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub assets: Vec<Asset>,
    /// Markdown and plain-text files, read in full; the webview makes text cards of them.
    pub texts: Vec<TextFile>,
    pub skipped: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct TextFile {
    pub name: String,
    pub text: String,
}

/// Text files larger than this are skipped: a card isn't the place for them.
const MAX_TEXT_BYTES: u64 = 1024 * 1024;

fn is_text_file(path: &Path) -> bool {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    matches!(ext.as_deref(), Some("md" | "markdown" | "txt"))
}

/// A text file's contents (invalid UTF-8 replaced), if it's small enough for a card.
fn read_text(path: &Path) -> Result<TextFile, String> {
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_TEXT_BYTES {
        return Err("too large".into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(TextFile { name, text: String::from_utf8_lossy(&bytes).into_owned() })
}

pub fn hash_file(path: &Path) -> std::io::Result<String> {
    let mut hasher = blake3::Hasher::new();
    hasher.update_reader(fs::File::open(path)?)?;
    Ok(hasher.finalize().to_hex().to_string())
}

/// File size and modification time (ms since epoch).
pub fn file_stamp(path: &Path) -> std::io::Result<(u64, i64)> {
    let meta = fs::metadata(path)?;
    let mtime = meta
        .modified()?
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Ok((meta.len(), mtime))
}

pub fn open_reader(path: &Path) -> image::ImageResult<ImageReader<std::io::BufReader<fs::File>>> {
    let mut reader = ImageReader::open(path)?.with_guessed_format()?;
    reader.no_limits();
    Ok(reader)
}

/// Display dimensions (EXIF orientation applied) without decoding pixel data.
pub fn probe_dimensions(path: &Path) -> image::ImageResult<(u32, u32)> {
    let mut decoder = open_reader(path)?.into_decoder()?;
    let (w, h) = decoder.dimensions();
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    Ok(match orientation {
        Orientation::Rotate90
        | Orientation::Rotate270
        | Orientation::Rotate90FlipH
        | Orientation::Rotate270FlipH => (h, w),
        _ => (w, h),
    })
}

fn describe(path: &Path, kind: AssetKind) -> Result<Asset, String> {
    let hash = hash_file(path).map_err(|e| e.to_string())?;
    let (size, mtime) = file_stamp(path).map_err(|e| e.to_string())?;
    let (width, height) = match kind {
        _ if kind.is_image() => probe_dimensions(path).map_err(|e| e.to_string())?,
        AssetKind::Sprite => crate::sprite::dimensions(path)?,
        _ => (0, 0),
    };
    Ok(Asset {
        id: hash.clone(),
        hash,
        kind,
        storage: Storage::Linked,
        path: path.to_string_lossy().into_owned(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        width,
        height,
        size,
        mtime,
        missing: false,
        rel: None,
    })
}

/// Writes via a temporary file and a rename, so readers never see a partial file.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Kind and file extension for image bytes we can show, from their content.
fn sniff(bytes: &[u8]) -> Result<(AssetKind, &'static str), String> {
    match image::guess_format(bytes) {
        Ok(ImageFormat::Png) => Ok((AssetKind::Image, "png")),
        Ok(ImageFormat::Jpeg) => Ok((AssetKind::Image, "jpg")),
        Ok(ImageFormat::WebP) => Ok((AssetKind::Image, "webp")),
        Ok(ImageFormat::Bmp) => Ok((AssetKind::Image, "bmp")),
        Ok(ImageFormat::Gif) => Ok((AssetKind::Gif, "gif")),
        Ok(other) => Err(format!("unsupported image format {other:?}")),
        Err(_) => Err("not an image".into()),
    }
}

/// The lowercase extension of a file name, which also tells the protocol its MIME type.
pub fn extension(name: &str) -> String {
    Path::new(name).extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_else(|| "bin".into())
}

/// Where an embedded blob lives in the blob store: content-addressed, so storing the
/// same bytes twice is free and a file never changes under its name.
fn blob_path(blobs: &Path, hash: &str, ext: &str) -> PathBuf {
    blobs.join(format!("{hash}.{ext}"))
}

/// A temporary file in the blob store that nothing else will pick.
fn blob_tmp(blobs: &Path) -> PathBuf {
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    blobs.join(format!(".incoming-{}-{n}.tmp", std::process::id()))
}

/// Streams bytes whose hash is known into the blob store, unless they're there already.
/// Large media never sits in memory.
pub fn store_blob(blobs: &Path, hash: &str, ext: &str, mut reader: impl Read) -> Result<PathBuf, String> {
    let path = blob_path(blobs, hash, ext);
    if path.exists() {
        touch(&path);
        return Ok(path);
    }
    fs::create_dir_all(blobs).map_err(|e| e.to_string())?;
    let tmp = blob_tmp(blobs);
    let copied = fs::File::create(&tmp).and_then(|mut f| std::io::copy(&mut reader, &mut f).and_then(|_| f.sync_all()));
    match copied.and_then(|_| fs::rename(&tmp, &path)) {
        Ok(()) => Ok(path),
        Err(e) => {
            fs::remove_file(&tmp).ok();
            Err(e.to_string())
        }
    }
}

/// The extension a blob is stored under: images by their content (as when pasted), media by
/// their name. `head` is the first bytes of the file.
pub fn blob_ext(kind: AssetKind, name: &str, head: &[u8]) -> String {
    match kind.is_image().then(|| sniff(head).ok()).flatten() {
        Some((_, ext)) => ext.into(),
        None => extension(name),
    }
}

/// The first bytes of a file, enough to sniff its format.
pub fn read_head(path: &Path) -> Vec<u8> {
    let mut head = Vec::with_capacity(64);
    fs::File::open(path).and_then(|f| f.take(64).read_to_end(&mut head)).ok();
    head
}

/// Copies a file into the blob store under `ext`, hashing it on the way (one pass, so the
/// hash always matches what was stored). Returns the hash and the stored path.
pub fn store_blob_file(blobs: &Path, src: &Path, ext: &str) -> Result<(String, PathBuf), String> {
    fs::create_dir_all(blobs).map_err(|e| e.to_string())?;
    let tmp = blob_tmp(blobs);
    let result = (|| -> std::io::Result<String> {
        let mut input = fs::File::open(src)?;
        let mut output = fs::File::create(&tmp)?;
        let mut hasher = blake3::Hasher::new();
        let mut buf = vec![0u8; 1 << 20];
        loop {
            let n = input.read(&mut buf)?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            output.write_all(&buf[..n])?;
        }
        output.sync_all()?;
        Ok(hasher.finalize().to_hex().to_string())
    })();
    let hash = result.map_err(|e| {
        fs::remove_file(&tmp).ok();
        format!("Couldn't read {}: {e}", src.display())
    })?;
    let path = blob_path(blobs, &hash, ext);
    if path.exists() {
        fs::remove_file(&tmp).ok();
        touch(&path);
    } else {
        fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    }
    Ok((hash, path))
}

/// Marks a blob as used now (its modification time), so cleaning up keeps it a while longer.
fn touch(path: &Path) {
    if let Ok(f) = fs::File::options().write(true).open(path) {
        f.set_modified(SystemTime::now()).ok();
    }
}

/// What a blob store cleanup removed.
#[derive(Debug, Default, Serialize)]
pub struct Cleaned {
    pub removed: usize,
    pub bytes: u64,
}

/// Deletes blobs not used for `max_age` (written, pasted, packed or loaded from a board) whose
/// hash isn't in `keep`, and leftover partial writes. Safe for saved boards: their embedded bytes
/// are in the board file and come back into the store when the board is opened. `keep` holds
/// what the open board (and its undo history, and the clipboard) may still need, since unsaved
/// pasted images exist only here.
pub fn clean_blobs(blobs: &Path, keep: &HashSet<String>, max_age: Duration) -> Cleaned {
    let mut cleaned = Cleaned::default();
    let Ok(entries) = fs::read_dir(blobs) else { return cleaned };
    let now = SystemTime::now();
    for e in entries.flatten() {
        let p = e.path();
        let name = p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
        let Ok(meta) = e.metadata() else { continue };
        let age = meta.modified().ok().and_then(|m| now.duration_since(m).ok()).unwrap_or_default();
        let partial = name.starts_with(".incoming-");
        let hash = name.split('.').next().unwrap_or_default();
        let stale = if partial { age > Duration::from_secs(24 * 3600) } else { age > max_age && !keep.contains(hash) };
        if meta.is_file() && stale && fs::remove_file(&p).is_ok() {
            cleaned.removed += 1;
            cleaned.bytes += meta.len();
        }
    }
    cleaned
}

/// Turns image bytes (e.g. from the clipboard) into an embedded asset. `name` gets the
/// right extension appended, so unpacking a board later can write a sensible file.
pub fn import_bytes(bytes: &[u8], name: &str, blobs: &Path) -> Result<Asset, String> {
    let (kind, ext) = sniff(bytes)?;
    let hash = blake3::hash(bytes).to_hex().to_string();
    let path = store_blob(blobs, &hash, ext, bytes)?;
    let (width, height) = probe_dimensions(&path).map_err(|e| e.to_string())?;
    Ok(Asset {
        id: hash.clone(),
        hash,
        kind,
        storage: Storage::Embedded,
        path: path.to_string_lossy().into_owned(),
        name: format!("{name}.{ext}"),
        width,
        height,
        size: bytes.len() as u64,
        mtime: now_ms(),
        missing: false,
        rel: None,
    })
}

/// Expands directories recursively (sorted) into a flat file list.
fn expand(paths: &[PathBuf], out: &mut Vec<PathBuf>) {
    for path in paths {
        if path.is_dir() {
            let mut children: Vec<PathBuf> = fs::read_dir(path)
                .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
                .unwrap_or_default();
            children.sort();
            expand(&children, out);
        } else {
            out.push(path.clone());
        }
    }
}

/// Hashes and probes the given files/folders in parallel; reads text files. Order is preserved.
pub fn import_paths(paths: &[PathBuf]) -> ImportResult {
    let mut all = Vec::new();
    expand(paths, &mut all);
    let (text_files, files): (Vec<PathBuf>, Vec<PathBuf>) = all.into_iter().partition(|p| is_text_file(p));

    let mut texts = Vec::new();
    let mut skipped = Vec::new();
    for path in &text_files {
        match read_text(path) {
            Ok(text) => texts.push(text),
            Err(_) => skipped.push(path.to_string_lossy().into_owned()),
        }
    }

    let results: Vec<Result<Asset, String>> = files
        .par_iter()
        .map(|path| match AssetKind::from_path(path) {
            Some(kind) => describe(path, kind),
            None => Err("unsupported".into()),
        })
        .collect();

    let mut assets = Vec::new();
    for (path, result) in files.iter().zip(results) {
        match result {
            Ok(asset) => assets.push(asset),
            Err(_) => skipped.push(path.to_string_lossy().into_owned()),
        }
    }
    ImportResult { assets, texts, skipped }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_old_unkept_blobs() {
        let dir = std::env::temp_dir().join(format!("pw-blobs-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let old = SystemTime::now() - Duration::from_secs(40 * 24 * 3600);
        let write = |name: &str, aged: bool| {
            let path = dir.join(name);
            fs::write(&path, b"bytes").unwrap();
            if aged {
                fs::File::options().write(true).open(&path).unwrap().set_modified(old).unwrap();
            }
        };
        write("aaa.png", true); // old, not kept: goes
        write("bbb.png", true); // old but kept (the open board uses it): stays
        write("ccc.png", false); // recent: stays
        write(".incoming-1-0.tmp", true); // an old partial write: goes
        let keep: HashSet<String> = ["bbb".to_string()].into();
        let cleaned = clean_blobs(&dir, &keep, Duration::from_secs(30 * 24 * 3600));
        assert_eq!(cleaned.removed, 2);
        assert!(!dir.join("aaa.png").exists() && !dir.join(".incoming-1-0.tmp").exists());
        assert!(dir.join("bbb.png").exists() && dir.join("ccc.png").exists());

        // Storing an existing blob again marks it as used.
        fs::File::options().write(true).open(dir.join("bbb.png")).unwrap().set_modified(old).unwrap();
        store_blob(&dir, "bbb", "png", &b"bytes"[..]).unwrap();
        assert_eq!(clean_blobs(&dir, &HashSet::new(), Duration::from_secs(30 * 24 * 3600)).removed, 0);
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn imports_pdfs_unprobed() {
        let dir = std::env::temp_dir().join(format!("pw-pdf-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("Paper.PDF"), b"%PDF-1.7\n").unwrap();
        let result = import_paths(&[dir.join("Paper.PDF")]);
        let a = &result.assets[0];
        // The webview reads the page size; Rust doesn't open PDFs.
        assert_eq!((a.kind, a.width, a.height), (AssetKind::Pdf, 0, 0));
        assert_eq!(AssetKind::parse(a.kind.as_str()), Some(AssetKind::Pdf));
        assert_eq!(blob_ext(a.kind, &a.name, b"%PDF"), "pdf");
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn imports_text_files_as_texts() {
        let dir = std::env::temp_dir().join(format!("pw-import-test-{}", std::process::id()));
        fs::create_dir_all(dir.join("notes")).unwrap();
        fs::write(dir.join("notes/a.md"), "# Title\n\nbody").unwrap();
        fs::write(dir.join("notes/b.TXT"), "plain").unwrap();
        fs::write(dir.join("notes/c.xyz"), "nope").unwrap();
        fs::write(dir.join("big.txt"), vec![b'x'; (MAX_TEXT_BYTES + 1) as usize]).unwrap();

        let result = import_paths(&[dir.join("notes"), dir.join("big.txt")]);
        let names: Vec<&str> = result.texts.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["a.md", "b.TXT"]);
        assert_eq!(result.texts[0].text, "# Title\n\nbody");
        assert!(result.assets.is_empty());
        assert_eq!(result.skipped.len(), 2, "unknown and too-large files are skipped: {:?}", result.skipped);

        fs::remove_dir_all(&dir).unwrap();
    }
}
