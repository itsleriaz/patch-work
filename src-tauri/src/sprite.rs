//! Aseprite sprites (`.aseprite`, `.ase`), read with `ah-asefile` and served to the webview as a
//! description (size, frame durations, layers, tags) and sprite sheets: every frame in a grid,
//! composited here. A sheet shows the file's own layer visibility (Aseprite's compositing, every
//! blend mode), or the layers the node asks for (composited here in layer order, exact for Normal
//! layers, plain "over" for the other blend modes).

use crate::assets::Asset;
use ah_asefile::{AnimationDirection, AsepriteFile, BlendMode, LayerType};
use image::{imageops, ImageFormat, RgbaImage};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Cursor, Read};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::Path;
use std::sync::{Arc, Mutex};

/// Sheets kept in memory (they're small: sprites are pixel art).
const MAX_SHEETS: usize = 64;

/// Width and height from the file header, without reading the rest (for importing).
pub fn dimensions(path: &Path) -> Result<(u32, u32), String> {
    let mut header = [0u8; 12];
    fs::File::open(path).and_then(|mut f| f.read_exact(&mut header)).map_err(|e| e.to_string())?;
    if header[4..6] != [0xE0, 0xA5] {
        return Err("not an Aseprite file".into());
    }
    let word = |i: usize| u16::from_le_bytes([header[i], header[i + 1]]) as u32;
    Ok((word(8), word(10)))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Meta {
    width: u32,
    height: u32,
    /// Frames per row in a sheet (rows follow).
    columns: u32,
    /// Each frame's duration in ms.
    frames: Vec<u32>,
    /// Image layers, bottom to top (groups left out).
    layers: Vec<LayerMeta>,
    tags: Vec<TagMeta>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LayerMeta {
    /// The layer's index in the file: a sheet's mask has one character per index.
    index: u32,
    /// "Group/Layer" for layers inside groups.
    name: String,
    /// Shown in the file (its eye and its groups' eyes are on).
    visible: bool,
    blend: &'static str,
    opacity: u8,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TagMeta {
    name: String,
    from: u32,
    to: u32,
    direction: &'static str,
    /// Times to play it; none: forever.
    repeat: Option<u32>,
    /// "#rrggbb", when the file has one.
    color: Option<String>,
}

/// Frames per row: about square.
fn columns(frames: u32) -> u32 {
    (frames as f64).sqrt().ceil().max(1.0) as u32
}

fn blend_name(b: BlendMode) -> &'static str {
    match b {
        BlendMode::Normal => "normal",
        BlendMode::Multiply => "multiply",
        BlendMode::Screen => "screen",
        BlendMode::Overlay => "overlay",
        BlendMode::Darken => "darken",
        BlendMode::Lighten => "lighten",
        BlendMode::ColorDodge => "color-dodge",
        BlendMode::ColorBurn => "color-burn",
        BlendMode::HardLight => "hard-light",
        BlendMode::SoftLight => "soft-light",
        BlendMode::Difference => "difference",
        BlendMode::Exclusion => "exclusion",
        BlendMode::Hue => "hue",
        BlendMode::Saturation => "saturation",
        BlendMode::Color => "color",
        BlendMode::Luminosity => "luminosity",
        BlendMode::Addition => "addition",
        BlendMode::Subtract => "subtract",
        BlendMode::Divide => "divide",
    }
}

/// Reads a file, turning the crate's panics on malformed input into errors.
fn read(path: &Path) -> Result<AsepriteFile, String> {
    catch_unwind(AssertUnwindSafe(|| AsepriteFile::read_file(path)))
        .map_err(|_| "the file couldn't be read".to_string())?
        .map_err(|e| e.to_string())
}

/// A layer's parent group, by index.
fn parent(file: &AsepriteFile, index: u32) -> Option<u32> {
    file.layer(index).parent().map(|p| p.id())
}

/// Whether a layer and every group it's in are shown in the file.
fn shown(file: &AsepriteFile, index: u32) -> bool {
    let mut at = Some(index);
    while let Some(i) = at {
        if !file.layer(i).is_visible() {
            return false;
        }
        at = parent(file, i);
    }
    true
}

fn describe(file: &AsepriteFile) -> Meta {
    let layers = (0..file.num_layers())
        .map(|i| file.layer(i))
        .filter(|l| !matches!(l.layer_type(), LayerType::Group))
        .map(|l| {
            let mut name = l.name().to_string();
            let mut at = parent(file, l.id());
            while let Some(p) = at {
                name = format!("{}/{name}", file.layer(p).name());
                at = parent(file, p);
            }
            LayerMeta { index: l.id(), name, visible: shown(file, l.id()), blend: blend_name(l.blend_mode()), opacity: l.opacity() }
        })
        .collect();
    let tags = (0..file.num_tags())
        .map(|i| file.tag(i))
        .map(|t| TagMeta {
            name: t.name().to_string(),
            from: t.from_frame(),
            to: t.to_frame(),
            direction: match t.animation_direction() {
                AnimationDirection::Forward => "forward",
                AnimationDirection::Reverse => "reverse",
                AnimationDirection::PingPong => "pingpong",
            },
            repeat: t.repeat().map(|r| r.get()),
            color: t.user_data().and_then(|u| u.color).map(|c| format!("#{:02x}{:02x}{:02x}", c[0], c[1], c[2])),
        })
        .collect();
    Meta {
        width: file.width() as u32,
        height: file.height() as u32,
        columns: columns(file.num_frames()),
        frames: (0..file.num_frames()).map(|i| file.frame(i).duration()).collect(),
        layers,
        tags,
    }
}

/// The layers a mask (one '1' or '0' per layer index) picks; none: the file's own visibility.
fn picked(file: &AsepriteFile, mask: Option<&str>) -> Option<Vec<u32>> {
    mask.map(|m| {
        (0..file.num_layers())
            .filter(|&i| m.as_bytes().get(i as usize) == Some(&b'1') && !matches!(file.layer(i).layer_type(), LayerType::Group))
            .collect()
    })
}

/// One frame with these layers (see [`picked`]).
fn frame_image(file: &AsepriteFile, index: u32, layers: &Option<Vec<u32>>) -> RgbaImage {
    let frame = file.frame(index);
    let Some(layers) = layers else { return frame.image() };
    // Bottom to top, each layer as Aseprite renders it alone (its opacity applied).
    let mut out = RgbaImage::new(file.width() as u32, file.height() as u32);
    for &l in layers {
        let cel = frame.layer(l);
        if !cel.is_empty() {
            imageops::overlay(&mut out, &cel.image(), 0, 0);
        }
    }
    out
}

/// Every frame in a grid, with the layers `mask` picks.
fn sheet(file: &AsepriteFile, mask: Option<&str>) -> RgbaImage {
    let (w, h, n) = (file.width() as u32, file.height() as u32, file.num_frames());
    let cols = columns(n);
    let mut out = RgbaImage::new(w * cols, h * n.div_ceil(cols));
    let layers = picked(file, mask);
    for i in 0..n {
        imageops::replace(&mut out, &frame_image(file, i, &layers), (i % cols * w) as i64, (i / cols * h) as i64);
    }
    out
}

/// What an export makes of a sprite.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportKind {
    /// One frame (the first of `frames`).
    Png,
    /// `frames` side by side in one row, in order.
    Sheet,
    /// `frames` as an animated GIF with their durations, looping.
    Gif,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub kind: ExportKind,
    /// "file" or one 0/1 per layer index, as for sheets.
    pub mask: String,
    /// Frame indices in playing order (a tag's sequence, its direction applied).
    pub frames: Vec<u32>,
    /// Whole-number pixel scale (nearest neighbor), 1 to 16.
    pub scale: u32,
    /// Filled behind the frames ("#rrggbb"); none: transparent.
    pub background: Option<String>,
}

fn parse_hex(hex: &str) -> Option<image::Rgba<u8>> {
    let h = hex.strip_prefix('#').filter(|h| h.len() == 6)?;
    let v = u32::from_str_radix(h, 16).ok()?;
    Some(image::Rgba([(v >> 16) as u8, (v >> 8) as u8, v as u8, 255]))
}

/// A sprite exported as PNG or GIF bytes.
pub fn export(asset: &Asset, req: &ExportRequest) -> Result<Vec<u8>, String> {
    if !req.mask.chars().all(|c| c == '0' || c == '1') && req.mask != "file" {
        return Err("bad layer mask".into());
    }
    let file = read(Path::new(&asset.path))?;
    let n = file.num_frames();
    let frames: Vec<u32> = req.frames.iter().copied().filter(|&i| i < n).collect();
    if frames.is_empty() {
        return Err("no frames to export".into());
    }
    let scale = req.scale.clamp(1, 16);
    let background = req.background.as_deref().and_then(parse_hex);
    let layers = picked(&file, (req.mask != "file").then_some(req.mask.as_str()));
    let (w, h) = (file.width() as u32 * scale, file.height() as u32 * scale);
    let render = |i: u32| {
        let mut frame = frame_image(&file, i, &layers);
        if let Some(bg) = background {
            let mut filled = RgbaImage::from_pixel(frame.width(), frame.height(), bg);
            imageops::overlay(&mut filled, &frame, 0, 0);
            frame = filled;
        }
        if scale > 1 {
            frame = imageops::resize(&frame, w, h, imageops::FilterType::Nearest);
        }
        frame
    };
    catch_unwind(AssertUnwindSafe(|| match req.kind {
        ExportKind::Png => png(&render(frames[0])),
        ExportKind::Sheet => {
            let mut out = RgbaImage::new(w * frames.len() as u32, h);
            for (k, &i) in frames.iter().enumerate() {
                imageops::replace(&mut out, &render(i), (k as u32 * w) as i64, 0);
            }
            png(&out)
        }
        ExportKind::Gif => {
            use image::codecs::gif::{GifEncoder, Repeat};
            use image::{Delay, Frame};
            let mut bytes = Vec::new();
            {
                let mut encoder = GifEncoder::new_with_speed(&mut bytes, 10);
                encoder.set_repeat(Repeat::Infinite).map_err(|e| e.to_string())?;
                for &i in &frames {
                    let ms = file.frame(i).duration().max(10);
                    let frame = Frame::from_parts(render(i), 0, 0, Delay::from_numer_denom_ms(ms, 1));
                    encoder.encode_frame(frame).map_err(|e| e.to_string())?;
                }
            }
            Ok(bytes)
        }
    }))
    .map_err(|_| "the frames couldn't be drawn".to_string())?
}

fn png(image: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    image.write_to(&mut Cursor::new(&mut bytes), ImageFormat::Png).map_err(|e| e.to_string())?;
    Ok(bytes)
}

type Bytes = Arc<Vec<u8>>;

/// The most recent sheets, by "hash:mask", oldest first in `order`.
#[derive(Default)]
struct Sheets {
    map: HashMap<String, Bytes>,
    order: VecDeque<String>,
}

/// Descriptions and sheets by content hash, in memory.
#[derive(Default)]
pub struct SpriteCache {
    metas: Mutex<HashMap<String, Bytes>>,
    sheets: Mutex<Sheets>,
}

impl SpriteCache {
    /// The sprite's description as JSON.
    pub fn meta(&self, asset: &Asset) -> Result<Bytes, String> {
        if let Some(hit) = self.metas.lock().unwrap().get(&asset.hash) {
            return Ok(hit.clone());
        }
        let file = read(Path::new(&asset.path))?;
        let json = Arc::new(serde_json::to_vec(&describe(&file)).map_err(|e| e.to_string())?);
        self.metas.lock().unwrap().insert(asset.hash.clone(), json.clone());
        Ok(json)
    }

    /// A sheet as PNG; `mask` as in [`sheet`] ("file" for the file's own visibility).
    pub fn sheet(&self, asset: &Asset, mask: &str) -> Result<Bytes, String> {
        if !mask.chars().all(|c| c == '0' || c == '1') && mask != "file" {
            return Err("bad layer mask".into());
        }
        let key = format!("{}:{mask}", asset.hash);
        if let Some(hit) = self.sheets.lock().unwrap().map.get(&key) {
            return Ok(hit.clone());
        }
        let file = read(Path::new(&asset.path))?;
        let image = catch_unwind(AssertUnwindSafe(|| sheet(&file, (mask != "file").then_some(mask))))
            .map_err(|_| "the frames couldn't be drawn".to_string())?;
        let bytes = Arc::new(png(&image)?);
        let mut sheets = self.sheets.lock().unwrap();
        sheets.map.insert(key.clone(), bytes.clone());
        sheets.order.push_back(key);
        while sheets.order.len() > MAX_SHEETS {
            if let Some(old) = sheets.order.pop_front() {
                sheets.map.remove(&old);
            }
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn columns_are_about_square() {
        assert_eq!(columns(1), 1);
        assert_eq!(columns(4), 2);
        assert_eq!(columns(5), 3);
        assert_eq!(columns(43), 7);
    }

    #[test]
    fn reads_colors() {
        assert_eq!(parse_hex("#ff8000"), Some(image::Rgba([255, 128, 0, 255])));
        assert_eq!(parse_hex("ff8000"), None);
        assert_eq!(parse_hex("#fff"), None);
    }

    #[test]
    fn rejects_other_files() {
        let path = std::env::temp_dir().join(format!("pw-sprite-test-{}.ase", std::process::id()));
        fs::write(&path, b"not an aseprite file").unwrap();
        assert!(dimensions(&path).is_err());
        assert!(read(&path).is_err());
        fs::remove_file(&path).ok();
    }
}
