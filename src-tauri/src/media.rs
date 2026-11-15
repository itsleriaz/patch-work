//! Video and audio extras, cached per content hash next to the LODs:
//!   posters    a still frame of each video, captured by the webview (it can decode every
//!              format it can play) and stored here, so idle videos show as plain images
//!   waveforms  loudness (RMS) of each audio file over time, decoded here with symphonia

use crate::assets::write_atomic;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use symphonia::core::codecs::audio::AudioDecoderOptions;
use symphonia::core::errors::Error;
use symphonia::core::formats::probe::Hint;
use symphonia::core::formats::{FormatOptions, TrackType};
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;

/// Bars in a waveform: plenty for a card, a few KB of JSON.
const PEAKS: usize = 1000;
/// Loudness is first measured over windows this long, then merged down to `PEAKS` bars.
const WINDOW_SECONDS: f64 = 0.01;

pub struct MediaCache {
    dir: PathBuf,
}

#[derive(Debug, Serialize)]
pub struct Waveform {
    /// Seconds.
    pub duration: f64,
    /// Loudness (RMS) per bar, 0–255, scaled so the loudest bar is 255. RMS rather than peak
    /// level: loudly mastered music peaks at full scale nearly everywhere, which draws a block.
    pub peaks: Vec<u8>,
}

/// Content hashes are hex; anything else is refused before it becomes a file name.
fn valid_hash(hash: &str) -> bool {
    !hash.is_empty() && hash.len() <= 128 && hash.bytes().all(|b| b.is_ascii_hexdigit())
}

impl MediaCache {
    pub fn new(dir: PathBuf) -> Self {
        Self { dir }
    }

    pub fn poster_path(&self, hash: &str) -> Option<PathBuf> {
        valid_hash(hash).then(|| self.dir.join(format!("{hash}.jpg")))
    }

    pub fn save_poster(&self, hash: &str, jpeg: &[u8]) -> Result<(), String> {
        let path = self.poster_path(hash).ok_or("invalid hash")?;
        if !jpeg.starts_with(&[0xFF, 0xD8]) {
            return Err("a poster must be a JPEG".into());
        }
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        write_atomic(&path, jpeg)
    }

    /// The waveform as JSON, decoded on first request.
    pub fn waveform(&self, hash: &str, path: &Path) -> Result<Vec<u8>, String> {
        if !valid_hash(hash) {
            return Err("invalid hash".into());
        }
        let cached = self.dir.join(format!("{hash}.levels.json"));
        if let Ok(json) = fs::read(&cached) {
            return Ok(json);
        }
        let json = serde_json::to_vec(&decode_waveform(path)?).map_err(|e| e.to_string())?;
        fs::create_dir_all(&self.dir).map_err(|e| e.to_string())?;
        write_atomic(&cached, &json)?;
        Ok(json)
    }
}

/// Decodes the whole file once, measuring the loudness (RMS) of every short window.
pub fn decode_waveform(path: &Path) -> Result<Waveform, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mut format = symphonia::default::get_probe()
        .probe(&hint, mss, FormatOptions::default(), MetadataOptions::default())
        .map_err(|e| format!("unsupported audio: {e}"))?;
    let track = format.default_track(TrackType::Audio).ok_or("no audio track")?;
    let params = track.codec_params.as_ref().and_then(|p| p.audio()).ok_or("no audio parameters")?;
    let mut decoder = symphonia::default::get_codecs()
        .make_audio_decoder(params, &AudioDecoderOptions::default())
        .map_err(|e| format!("unsupported codec: {e}"))?;
    let track_id = track.id;

    let mut windows: Vec<f32> = Vec::new();
    let (mut window_len, mut in_window, mut squares) = (0usize, 0usize, 0f64);
    let (mut frames, mut rate) = (0u64, 0u32);
    let mut samples: Vec<f32> = Vec::new();
    loop {
        let packet = match format.next_packet() {
            Ok(Some(p)) => p,
            Ok(None) | Err(Error::ResetRequired) => break,
            Err(Error::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(e.to_string()),
        };
        if packet.track_id != track_id {
            continue;
        }
        let buf = match decoder.decode(&packet) {
            Ok(buf) => buf,
            Err(Error::DecodeError(_)) | Err(Error::IoError(_)) => continue,
            Err(e) => return Err(e.to_string()),
        };
        if rate == 0 {
            rate = buf.spec().rate();
            window_len = ((rate as f64 * WINDOW_SECONDS) as usize).max(1);
        }
        let channels = buf.spec().channels().count().max(1);
        samples.resize(buf.samples_interleaved(), 0.0);
        buf.copy_to_slice_interleaved(&mut samples);
        frames += buf.frames() as u64;
        for frame in samples.chunks_exact(channels) {
            squares += frame.iter().map(|&s| (s as f64) * (s as f64)).sum::<f64>() / channels as f64;
            in_window += 1;
            if in_window == window_len {
                windows.push((squares / window_len as f64).sqrt() as f32);
                (in_window, squares) = (0, 0.0);
            }
        }
    }
    if in_window > 0 {
        windows.push((squares / in_window as f64).sqrt() as f32);
    }
    if rate == 0 {
        return Err("no audio decoded".into());
    }
    Ok(Waveform { duration: frames as f64 / rate as f64, peaks: merge_levels(&windows, PEAKS) })
}

/// Merges window loudness into `bars` bars (fewer for very short sounds), scaled so the loudest
/// bar is full height. Quiet recordings still read as shapes.
fn merge_levels(windows: &[f32], bars: usize) -> Vec<u8> {
    let bars = bars.min(windows.len());
    let mut out: Vec<f32> = (0..bars)
        .map(|i| {
            let (a, b) = (i * windows.len() / bars, ((i + 1) * windows.len() / bars).max(i * windows.len() / bars + 1));
            let squares: f32 = windows[a..b].iter().map(|w| w * w).sum();
            (squares / (b - a) as f32).sqrt()
        })
        .collect();
    let loudest = out.iter().copied().fold(0.0, f32::max);
    if loudest > 0.0 {
        out.iter_mut().for_each(|p| *p /= loudest);
    }
    out.into_iter().map(|p| (p.clamp(0.0, 1.0) * 255.0).round() as u8).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A 16-bit mono WAV: silence, then a full-scale square wave.
    fn wav(rate: u32, seconds: f64) -> Vec<u8> {
        let n = (rate as f64 * seconds) as usize;
        let samples: Vec<i16> = (0..n).map(|i| if i < n / 2 { 0 } else if (i / 50) % 2 == 0 { i16::MAX } else { -i16::MAX }).collect();
        let data_len = (samples.len() * 2) as u32;
        let mut out = Vec::new();
        out.extend_from_slice(b"RIFF");
        out.extend_from_slice(&(36 + data_len).to_le_bytes());
        out.extend_from_slice(b"WAVEfmt ");
        out.extend_from_slice(&16u32.to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes()); // PCM
        out.extend_from_slice(&1u16.to_le_bytes()); // mono
        out.extend_from_slice(&rate.to_le_bytes());
        out.extend_from_slice(&(rate * 2).to_le_bytes());
        out.extend_from_slice(&2u16.to_le_bytes());
        out.extend_from_slice(&16u16.to_le_bytes());
        out.extend_from_slice(b"data");
        out.extend_from_slice(&data_len.to_le_bytes());
        for s in samples {
            out.extend_from_slice(&s.to_le_bytes());
        }
        out
    }

    #[test]
    fn waveform_of_a_wav() {
        let dir = std::env::temp_dir().join(format!("pw-media-test-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("tone.wav");
        fs::write(&path, wav(8000, 2.0)).unwrap();

        let w = decode_waveform(&path).unwrap();
        assert!((w.duration - 2.0).abs() < 0.01, "duration {}", w.duration);
        assert_eq!(w.peaks.len(), 200); // 2 s of 10 ms windows: fewer than PEAKS
        assert!(w.peaks[..95].iter().all(|&p| p == 0), "first half is silent");
        assert!(w.peaks[105..].iter().all(|&p| p == 255), "second half is loud");

        let cache = MediaCache::new(dir.join("cache"));
        let json = cache.waveform("abc123", &path).unwrap();
        assert_eq!(cache.waveform("abc123", &path).unwrap(), json); // second call reads the cache
        assert!(cache.waveform("../evil", &path).is_err());
        assert!(cache.save_poster("abc123", b"not a jpeg").is_err());
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn merges_levels_as_rms() {
        // RMS of (0.1, 0.5) is 0.361, of (0.2, 0.25) is 0.226: 255 and 160 once scaled.
        assert_eq!(merge_levels(&[0.1, 0.5, 0.2, 0.25], 2), vec![255, 160]);
        assert_eq!(merge_levels(&[], 10), Vec::<u8>::new());
    }
}
