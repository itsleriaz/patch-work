//! The system clipboard through arboard: reading what other apps copied (files, an image,
//! text) and putting an image on it for other apps. Copying and pasting nodes within
//! Patchwork goes through the webview's copy/paste events instead (src/lib/clipboard.ts).

use crate::assets::{import_bytes, import_paths, Asset, ImportResult};
use crate::lod::decode_rgba;
use arboard::{Clipboard, ImageData};
use image::codecs::png::PngEncoder;
use image::{ExtendedColorType, ImageEncoder};
use serde::Serialize;
use std::borrow::Cow;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Pasted {
    Files { result: ImportResult },
    Image { asset: Asset },
    Text { text: String },
    /// Exactly the image we last put on the clipboard, so the caller can paste its own copy.
    Own,
    Empty,
}

/// The arboard instance is created on first use and kept for the app's lifetime: on Linux,
/// contents we put on the clipboard are served by it and would vanish if it were dropped.
#[derive(Default)]
pub struct SystemClipboard {
    clipboard: Mutex<Option<Clipboard>>,
    /// Fingerprint of the pixels we last wrote, to recognize them when pasted back.
    written: Mutex<Option<blake3::Hash>>,
}

fn fingerprint(width: usize, height: usize, rgba: &[u8]) -> blake3::Hash {
    let mut h = blake3::Hasher::new();
    h.update(&(width as u64).to_le_bytes());
    h.update(&(height as u64).to_le_bytes());
    h.update(rgba);
    h.finalize()
}

impl SystemClipboard {
    fn with<T>(&self, f: impl FnOnce(&mut Clipboard) -> Result<T, String>) -> Result<T, String> {
        let mut guard = self.clipboard.lock().unwrap();
        if guard.is_none() {
            *guard = Some(Clipboard::new().map_err(|e| e.to_string())?);
        }
        f(guard.as_mut().unwrap())
    }

    /// Files first (file managers also offer their paths as text), then an image, then text.
    /// A pasted image becomes an embedded asset named `image_name`, unless it's the one we wrote.
    pub fn read(&self, image_name: &str, blobs: &Path) -> Result<Pasted, String> {
        self.with(|cb| {
            if let Ok(files) = cb.get().file_list() {
                // arboard 3.6 splits text/uri-list on "\n" only, leaving the "\r" of its CRLF
                // line endings (RFC 2483, which file managers follow) on every path.
                let files: Vec<PathBuf> = files
                    .iter()
                    .filter_map(|p| p.to_str().map(|s| PathBuf::from(s.trim_end_matches('\r'))))
                    .filter(|p| !p.as_os_str().is_empty())
                    .collect();
                if !files.is_empty() {
                    return Ok(Pasted::Files { result: import_paths(&files) });
                }
            }
            if let Ok(img) = cb.get_image() {
                if Some(fingerprint(img.width, img.height, &img.bytes)) == *self.written.lock().unwrap() {
                    return Ok(Pasted::Own);
                }
                let png = encode_png(img.width as u32, img.height as u32, &img.bytes)?;
                return Ok(Pasted::Image { asset: import_bytes(&png, image_name, blobs)? });
            }
            match cb.get_text() {
                Ok(text) if !text.trim().is_empty() => Ok(Pasted::Text { text }),
                _ => Ok(Pasted::Empty),
            }
        })
    }

    /// Puts an image file on the clipboard as a bitmap (first frame for a GIF).
    pub fn write_image(&self, path: &Path) -> Result<(), String> {
        let rgba = decode_rgba(path)?;
        let (width, height) = (rgba.width as usize, rgba.height as usize);
        let print = fingerprint(width, height, &rgba.pixels);
        let image = ImageData { width, height, bytes: Cow::Owned(rgba.pixels) };
        self.with(|cb| cb.set_image(image).map_err(|e| e.to_string()))?;
        *self.written.lock().unwrap() = Some(print);
        Ok(())
    }
}

fn encode_png(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    let mut png = Vec::new();
    PngEncoder::new(&mut png)
        .write_image(rgba, width, height, ExtendedColorType::Rgba8)
        .map_err(|e| e.to_string())?;
    Ok(png)
}
