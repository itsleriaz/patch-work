//! Level-of-detail cache: downscaled copies of images, generated once per
//! content hash and stored on disk, so the webview never decodes a full-size
//! original just to draw a thumbnail.

use crate::assets::{open_reader, write_atomic, Asset};
use fast_image_resize as fr;
use image::codecs::jpeg::JpegEncoder;
use image::codecs::png::{CompressionType, FilterType, PngEncoder};
use image::{DynamicImage, ExtendedColorType, ImageEncoder};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// Longest-side sizes of generated levels. Mirrored in `src/lib/canvas/lod.ts`.
pub const LOD_SIZES: [u32; 3] = [256, 1024, 2048];

pub struct Encoded {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
}

pub struct LodCache {
    dir: PathBuf,
    /// One lock per hash so concurrent requests for the same image decode it once.
    inflight: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    /// Bounded pool for generation: decoding many large images at once would
    /// otherwise spike memory (a 24 MP image is ~96 MB decoded).
    pub pool: rayon::ThreadPool,
}

impl LodCache {
    pub fn new(dir: PathBuf) -> Self {
        let threads = std::thread::available_parallelism()
            .map(|n| n.get().saturating_sub(1).max(2))
            .unwrap_or(2);
        let pool = rayon::ThreadPoolBuilder::new()
            .num_threads(threads)
            .thread_name(|i| format!("lod-{i}"))
            .build()
            .expect("failed to build LOD thread pool");
        Self { dir, inflight: Mutex::new(HashMap::new()), pool }
    }

    fn path_for(&self, hash: &str, size: u32, ext: &str) -> PathBuf {
        self.dir.join(format!("{hash}_{size}.{ext}"))
    }

    pub fn cached(&self, hash: &str, size: u32) -> Option<Encoded> {
        for (ext, mime) in [("jpg", "image/jpeg"), ("png", "image/png")] {
            if let Ok(bytes) = fs::read(self.path_for(hash, size, ext)) {
                return Some(Encoded { bytes, mime });
            }
        }
        None
    }

    /// Decodes the original once and writes every level smaller than it.
    /// Returns the requested level. `size` must be one of `LOD_SIZES` and
    /// smaller than the image's longest side.
    pub fn generate(&self, asset: &Asset, size: u32) -> Result<Encoded, String> {
        let lock = {
            let mut map = self.inflight.lock().unwrap();
            map.entry(asset.hash.clone()).or_default().clone()
        };
        let result = {
            let _guard = lock.lock().unwrap();
            // Another request may have finished generating while we waited.
            match self.cached(&asset.hash, size) {
                Some(hit) => Ok(hit),
                None => self.generate_all(asset, size),
            }
        };
        self.inflight.lock().unwrap().remove(&asset.hash);
        result
    }

    fn generate_all(&self, asset: &Asset, wanted: u32) -> Result<Encoded, String> {
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        let mut current = decode_rgba(Path::new(&asset.path))?;
        let mut result = None;

        // Largest first, each level resized from the previous one.
        for &size in LOD_SIZES.iter().rev() {
            if size >= current.width.max(current.height) {
                continue;
            }
            current = current.downscale_to(size)?;
            let encoded = current.encode()?;
            let ext = if encoded.mime == "image/png" { "png" } else { "jpg" };
            write_atomic(&self.path_for(&asset.hash, size, ext), &encoded.bytes)?;
            if size == wanted {
                result = Some(encoded);
            }
        }
        result.ok_or_else(|| format!("level {wanted} not applicable"))
    }
}

pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// Decodes to RGBA with EXIF orientation applied.
pub fn decode_rgba(path: &Path) -> Result<Rgba, String> {
    let mut decoder = open_reader(path)
        .and_then(|r| r.into_decoder())
        .map_err(|e| e.to_string())?;
    let orientation = image::ImageDecoder::orientation(&mut decoder)
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    img.apply_orientation(orientation);
    let rgba = img.into_rgba8();
    Ok(Rgba { width: rgba.width(), height: rgba.height(), pixels: rgba.into_raw() })
}

impl Rgba {
    fn downscale_to(self, longest: u32) -> Result<Rgba, String> {
        let scale = longest as f64 / self.width.max(self.height) as f64;
        let w = ((self.width as f64 * scale).round() as u32).max(1);
        let h = ((self.height as f64 * scale).round() as u32).max(1);

        let src = fr::images::Image::from_vec_u8(self.width, self.height, self.pixels, fr::PixelType::U8x4)
            .map_err(|e| e.to_string())?;
        let mut dst = fr::images::Image::new(w, h, fr::PixelType::U8x4);
        let options = fr::ResizeOptions::new()
            .resize_alg(fr::ResizeAlg::Convolution(fr::FilterType::Lanczos3));
        fr::Resizer::new()
            .resize(&src, &mut dst, &options)
            .map_err(|e| e.to_string())?;
        Ok(Rgba { width: w, height: h, pixels: dst.into_vec() })
    }

    /// JPEG when fully opaque (much smaller), PNG otherwise.
    fn encode(&self) -> Result<Encoded, String> {
        let mut bytes = Vec::new();
        let opaque = self.pixels.as_chunks::<4>().0.iter().all(|p| p[3] == 255);
        if opaque {
            let rgb: Vec<u8> = self.pixels.as_chunks::<4>().0.iter().flat_map(|p| [p[0], p[1], p[2]]).collect();
            JpegEncoder::new_with_quality(&mut bytes, 88)
                .write_image(&rgb, self.width, self.height, ExtendedColorType::Rgb8)
                .map_err(|e| e.to_string())?;
            Ok(Encoded { bytes, mime: "image/jpeg" })
        } else {
            PngEncoder::new_with_quality(&mut bytes, CompressionType::Fast, FilterType::Adaptive)
                .write_image(&self.pixels, self.width, self.height, ExtendedColorType::Rgba8)
                .map_err(|e| e.to_string())?;
            Ok(Encoded { bytes, mime: "image/png" })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assets::import_paths;

    #[test]
    fn generates_levels_below_original_size() {
        let dir = std::env::temp_dir().join(format!("pw-lod-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let src = dir.join("wide.png");
        image::RgbaImage::from_fn(3000, 1500, |x, _| image::Rgba([(x % 256) as u8, 40, 90, 255]))
            .save(&src)
            .unwrap();

        let asset = import_paths(&[src]).assets.remove(0);
        assert_eq!((asset.width, asset.height), (3000, 1500));

        let cache = LodCache::new(dir.join("cache"));
        let lod = cache.generate(&asset, 1024).unwrap();
        assert_eq!(lod.mime, "image/jpeg"); // opaque PNG source becomes JPEG
        let decoded = image::load_from_memory(&lod.bytes).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (1024, 512));

        // All smaller-than-original levels are now cached.
        assert!(cache.cached(&asset.hash, 256).is_some());
        assert!(cache.cached(&asset.hash, 2048).is_some());

        fs::remove_dir_all(&dir).ok();
    }
}
