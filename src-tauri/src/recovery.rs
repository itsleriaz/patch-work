//! Recovery copies: a board's unsaved state, written a few seconds after each change, so a crash
//! or a forced quit loses nothing. One JSON file per board in `app_data_dir/recovery`, named by a
//! hash of the board's key (its path, or an id for an untitled board). Embedded files aren't
//! copied: the snapshot points into the blob store, and `embedded_hashes` keeps those blobs from
//! being cleaned up while a recovery copy needs them.

use crate::assets::write_atomic;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryMeta {
    /// The board's identity: "path:<file>" or "untitled:<id>".
    pub key: String,
    /// The board's file, if it has one.
    pub path: Option<String>,
    /// A name to show ("Moodboard", "Untitled").
    pub name: String,
    /// When the copy was written, ms since the epoch.
    pub time: i64,
}

#[derive(Serialize, Deserialize)]
struct RecoveryFile {
    meta: RecoveryMeta,
    /// The board as the webview snapshots it for saving (camera, assets, nodes, links, board).
    doc: Value,
}

fn file_for(dir: &Path, key: &str) -> PathBuf {
    let name = blake3::hash(key.as_bytes()).to_hex();
    dir.join(format!("{}.json", &name[..20]))
}

pub fn save(dir: &Path, meta: RecoveryMeta, doc: Value) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = file_for(dir, &meta.key);
    let bytes = serde_json::to_vec(&RecoveryFile { meta, doc }).map_err(|e| e.to_string())?;
    write_atomic(&path, &bytes)
}

fn read_file(path: &Path) -> Option<RecoveryFile> {
    serde_json::from_slice(&fs::read(path).ok()?).ok()
}

fn files(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir)
        .map(|rd| rd.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|e| e == "json")).collect())
        .unwrap_or_default()
}

/// Every recovery copy's description, newest first. Unreadable files are skipped.
pub fn list(dir: &Path) -> Vec<RecoveryMeta> {
    let mut out: Vec<RecoveryMeta> = files(dir).iter().filter_map(|p| read_file(p)).map(|f| f.meta).collect();
    out.sort_by_key(|m| std::cmp::Reverse(m.time));
    out
}

/// The board snapshot of a recovery copy.
pub fn read(dir: &Path, key: &str) -> Result<Value, String> {
    read_file(&file_for(dir, key)).map(|f| f.doc).ok_or_else(|| "This recovery copy is gone or unreadable".into())
}

pub fn delete(dir: &Path, key: &str) {
    let _ = fs::remove_file(file_for(dir, key));
}

/// Content hashes of the embedded assets recovery copies point to (blobs to keep).
pub fn embedded_hashes(dir: &Path) -> HashSet<String> {
    let mut out = HashSet::new();
    for p in files(dir) {
        let Some(f) = read_file(&p) else { continue };
        let Some(assets) = f.doc.get("assets").and_then(Value::as_array) else { continue };
        for a in assets {
            if a.get("storage").and_then(Value::as_str) == Some("embedded") {
                if let Some(h) = a.get("hash").and_then(Value::as_str) {
                    out.insert(h.to_string());
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn meta(key: &str, time: i64) -> RecoveryMeta {
        RecoveryMeta { key: key.into(), path: None, name: "Untitled".into(), time }
    }

    #[test]
    fn saves_lists_reads_and_deletes() {
        let dir = std::env::temp_dir().join(format!("pw-recovery-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);

        let doc_a = json!({ "nodes": [{ "id": "a" }], "assets": [{ "hash": "h1", "storage": "embedded" }, { "hash": "h2", "storage": "linked" }] });
        save(&dir, meta("untitled:1", 100), doc_a.clone()).unwrap();
        save(&dir, RecoveryMeta { path: Some("/b.patchwork".into()), ..meta("path:/b.patchwork", 200) }, json!({ "nodes": [], "assets": [] })).unwrap();
        // Writing the same board again replaces its copy.
        save(&dir, meta("untitled:1", 300), doc_a.clone()).unwrap();

        let keys: Vec<String> = list(&dir).into_iter().map(|m| m.key).collect();
        assert_eq!(keys, ["untitled:1", "path:/b.patchwork"], "newest first, one per board");
        assert_eq!(read(&dir, "untitled:1").unwrap(), doc_a);
        assert_eq!(embedded_hashes(&dir), HashSet::from(["h1".to_string()]));

        delete(&dir, "untitled:1");
        assert_eq!(list(&dir).len(), 1);
        assert!(read(&dir, "untitled:1").is_err());

        fs::remove_dir_all(&dir).unwrap();
    }
}
