//! The `.patchwork` project file: a SQLite database. Linked assets store their
//! path; embedded assets store their bytes in the `blobs` table of the same file.

use crate::assets::{blob_ext, file_stamp, hash_file, store_blob, Asset, AssetKind, Storage};
use crate::storage;
use rusqlite::{params, Connection, OpenFlags, MAIN_DB};
use std::io::{Read, Seek, SeekFrom};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

const APP_ID: &str = "patchwork";
/// 2 added the `blobs` table for embedded assets; 3 added `assets.rel` and the `board` meta
/// entry; 4 added the `links` table; 5 added video and audio assets; 6 added `nodes.locked`;
/// 7 added `nodes.parent`. Older files still load.
const FORMAT_VERSION: i64 = 7;

const SCHEMA: &str = "
CREATE TABLE meta   (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE assets (
    id TEXT PRIMARY KEY, hash TEXT NOT NULL, kind TEXT NOT NULL, storage TEXT NOT NULL,
    path TEXT NOT NULL, name TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
    size INTEGER NOT NULL, mtime INTEGER NOT NULL, rel TEXT
);
CREATE TABLE nodes (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, asset_id TEXT,
    x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
    rotation REAL NOT NULL, z REAL NOT NULL, data TEXT, locked INTEGER, parent TEXT
);
CREATE TABLE blobs  (hash TEXT PRIMARY KEY, data BLOB NOT NULL);
CREATE TABLE links  (id TEXT PRIMARY KEY, from_id TEXT NOT NULL, to_id TEXT NOT NULL, data TEXT);
";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct Camera {
    pub x: f64,
    pub y: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeRecord {
    pub id: String,
    pub kind: String,
    pub asset_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub rotation: f64,
    pub z: f64,
    #[serde(default)]
    pub data: serde_json::Value,
    /// Absent (not false) when unlocked, so unlocked nodes come back to the webview without it.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub locked: bool,
    /// The node this one is attached to (it follows its moves). May name a deleted node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<String>,
}

/// A connection between two nodes. Its look (arrows, color, label) lives in `data`, owned by
/// the frontend like a node's.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LinkRecord {
    pub id: String,
    pub from: String,
    pub to: String,
    #[serde(default)]
    pub data: serde_json::Value,
}

/// Settings that belong to one board (unlike app preferences).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BoardSettings {
    /// Whether newly added images are embedded instead of linked.
    #[serde(default)]
    pub embed_new: bool,
    /// Timers' running state by node id (kept here, out of undo): passed through as is.
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub timers: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDoc {
    pub camera: Camera,
    pub assets: Vec<Asset>,
    pub nodes: Vec<NodeRecord>,
    #[serde(default)]
    pub links: Vec<LinkRecord>,
    #[serde(default)]
    pub board: BoardSettings,
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Writes a fresh database next to the target, then swaps it in, so a crash
/// mid-save never leaves a half-written project.
pub fn save(path: &Path, doc: &ProjectDoc) -> Result<(), String> {
    let tmp = path.with_extension("patchwork-tmp");
    if tmp.exists() {
        fs::remove_file(&tmp).map_err(err)?;
    }
    {
        let mut conn = Connection::open(&tmp).map_err(err)?;
        let tx = conn.transaction().map_err(err)?;
        tx.execute_batch(SCHEMA).map_err(err)?;

        let mut meta = tx.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2)").map_err(err)?;
        meta.execute(params!["app", APP_ID]).map_err(err)?;
        meta.execute(params!["format_version", FORMAT_VERSION.to_string()]).map_err(err)?;
        meta.execute(params!["camera", serde_json::to_string(&doc.camera).map_err(err)?]).map_err(err)?;
        meta.execute(params!["board", serde_json::to_string(&doc.board).map_err(err)?]).map_err(err)?;
        drop(meta);

        let mut ins = tx
            .prepare("INSERT INTO assets VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")
            .map_err(err)?;
        // Room for the bytes first, then streamed in through SQLite's blob I/O, so big media never
        // sits in memory.
        let mut blob = tx.prepare("INSERT OR IGNORE INTO blobs VALUES (?1, zeroblob(?2))").map_err(err)?;
        for a in &doc.assets {
            // An embedded asset's path is only where this machine keeps its bytes; don't save it.
            let embedded = a.storage == Storage::Embedded;
            let stored_path = if embedded { "" } else { a.path.as_str() };
            // Linked: relative to the board, recomputed on every save. Embedded: the unpack layout.
            let rel = match a.storage {
                Storage::Linked => path.parent().and_then(|dir| storage::relative(Path::new(&a.path), dir)),
                Storage::Embedded => a.rel.clone(),
            };
            ins.execute(params![
                a.id, a.hash, a.kind.as_str(), a.storage.as_str(), stored_path, a.name,
                a.width, a.height, a.size as i64, a.mtime, rel
            ])
            .map_err(err)?;
            if embedded {
                // Normally from the blob store; failing that, from the file being overwritten.
                let missing = || format!("The bytes of embedded file {} are missing", a.name);
                let previous;
                let (mut source, len): (Box<dyn Read>, u64) = match fs::File::open(&a.path) {
                    Ok(f) => {
                        let len = f.metadata().map_err(err)?.len();
                        (Box::new(f), len)
                    }
                    Err(_) => {
                        previous = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|_| missing())?;
                        let (reader, len) = open_blob(&previous, &a.hash).ok_or_else(missing)?;
                        (Box::new(reader), len)
                    }
                };
                if blob.execute(params![a.hash, len as i64]).map_err(err)? > 0 {
                    let mut writer = tx.blob_open(MAIN_DB, "blobs", "data", tx.last_insert_rowid(), false).map_err(err)?;
                    std::io::copy(&mut source, &mut writer).map_err(err)?;
                }
            }
        }
        drop(ins);
        drop(blob);

        let mut ins = tx
            .prepare("INSERT INTO nodes VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)")
            .map_err(err)?;
        for n in &doc.nodes {
            let data = (!n.data.is_null()).then(|| n.data.to_string());
            ins.execute(params![n.id, n.kind, n.asset_id, n.x, n.y, n.w, n.h, n.rotation, n.z, data, n.locked.then_some(1), n.parent])
                .map_err(err)?;
        }
        drop(ins);

        let mut ins = tx.prepare("INSERT INTO links VALUES (?1, ?2, ?3, ?4)").map_err(err)?;
        for l in &doc.links {
            let data = (!l.data.is_null()).then(|| l.data.to_string());
            ins.execute(params![l.id, l.from, l.to, data]).map_err(err)?;
        }
        drop(ins);
        tx.commit().map_err(err)?;
    }
    fs::rename(&tmp, path).map_err(err)
}

/// A reader over an embedded file's bytes inside a project, and their length.
fn open_blob<'c>(conn: &'c Connection, hash: &str) -> Option<(rusqlite::blob::Blob<'c>, u64)> {
    let rowid: i64 = conn.query_row("SELECT rowid FROM blobs WHERE hash = ?1", [hash], |r| r.get(0)).ok()?;
    let reader = conn.blob_open(MAIN_DB, "blobs", "data", rowid, true).ok()?;
    let len = reader.len() as u64;
    Some((reader, len))
}

/// Streams an embedded file out of the project into the blob store.
fn extract_blob(conn: &Connection, a: &Asset, blobs: &Path) -> Option<std::path::PathBuf> {
    let (mut reader, _) = open_blob(conn, &a.hash)?;
    let mut head = [0u8; 64];
    let n = reader.read(&mut head).ok()?;
    reader.seek(SeekFrom::Start(0)).ok()?;
    store_blob(blobs, &a.hash, &blob_ext(a.kind, &a.name, &head[..n]), reader).ok()
}

/// Loads a project. Embedded assets are extracted into the `blobs` store (if not
/// already there) and their `path` points at the extracted file.
pub fn load(path: &Path, blobs: &Path) -> Result<ProjectDoc, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(err)?;
    let meta = |key: &str| -> Result<String, String> {
        conn.query_row("SELECT value FROM meta WHERE key = ?1", [key], |r| r.get(0))
            .map_err(|_| "Not a Patchwork project file".to_string())
    };
    if meta("app")? != APP_ID {
        return Err("Not a Patchwork project file".into());
    }
    let version: i64 = meta("format_version")?.parse().map_err(err)?;
    if version > FORMAT_VERSION {
        return Err(format!("This project was made with a newer version of Patchwork (format {version})"));
    }
    let camera: Camera = serde_json::from_str(&meta("camera")?).map_err(err)?;
    let board: BoardSettings = meta("board").ok().and_then(|b| serde_json::from_str(&b).ok()).unwrap_or_default();

    let rel_column = if version >= 3 { "rel" } else { "NULL" };
    let mut stmt = conn
        .prepare(&format!("SELECT id, hash, kind, storage, path, name, width, height, size, mtime, {rel_column} FROM assets"))
        .map_err(err)?;
    let mut assets = stmt
        .query_map([], |r| {
            let kind: String = r.get(2)?;
            let storage: String = r.get(3)?;
            Ok(Asset {
                id: r.get(0)?,
                hash: r.get(1)?,
                kind: AssetKind::parse(&kind).unwrap_or(AssetKind::Image),
                storage: Storage::parse(&storage).unwrap_or(Storage::Linked),
                path: r.get(4)?,
                name: r.get(5)?,
                width: r.get(6)?,
                height: r.get(7)?,
                size: r.get::<_, i64>(8)? as u64,
                mtime: r.get(9)?,
                missing: false,
                rel: r.get(10)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    drop(stmt);

    // A board moved (or copied) together with its images: the relative path wins when it exists.
    let dir = path.parent().unwrap_or(Path::new("."));
    for a in assets.iter_mut().filter(|a| a.storage == Storage::Linked) {
        if let Some(candidate) = a.rel.as_deref().map(|rel| storage::resolve(rel, dir)) {
            if candidate.exists() {
                a.path = candidate.to_string_lossy().into_owned();
            }
        }
        a.rel = None;
    }

    for a in assets.iter_mut().filter(|a| a.storage == Storage::Embedded) {
        match extract_blob(&conn, a, blobs) {
            Some(p) => a.path = p.to_string_lossy().into_owned(),
            None => a.missing = true,
        }
    }

    let locked_column = if version >= 6 { "locked" } else { "NULL" };
    let parent_column = if version >= 7 { "parent" } else { "NULL" };
    let mut stmt = conn
        .prepare(&format!("SELECT id, kind, asset_id, x, y, w, h, rotation, z, data, {locked_column}, {parent_column} FROM nodes"))
        .map_err(err)?;
    let nodes = stmt
        .query_map([], |r| {
            let data: Option<String> = r.get(9)?;
            Ok(NodeRecord {
                id: r.get(0)?,
                kind: r.get(1)?,
                asset_id: r.get(2)?,
                x: r.get(3)?,
                y: r.get(4)?,
                w: r.get(5)?,
                h: r.get(6)?,
                rotation: r.get(7)?,
                z: r.get(8)?,
                data: data.and_then(|d| serde_json::from_str(&d).ok()).unwrap_or_default(),
                locked: r.get::<_, Option<i64>>(10)?.is_some_and(|v| v != 0),
                parent: r.get(11)?,
            })
        })
        .map_err(err)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(err)?;
    drop(stmt);

    let links = if version >= 4 {
        let mut stmt = conn.prepare("SELECT id, from_id, to_id, data FROM links").map_err(err)?;
        let links = stmt
            .query_map([], |r| {
                let data: Option<String> = r.get(3)?;
                Ok(LinkRecord {
                    id: r.get(0)?,
                    from: r.get(1)?,
                    to: r.get(2)?,
                    data: data.and_then(|d| serde_json::from_str(&d).ok()).unwrap_or_default(),
                })
            })
            .map_err(err)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(err)?;
        links
    } else {
        Vec::new()
    };

    Ok(ProjectDoc { camera, assets, nodes, links, board })
}

/// Marks missing linked files and re-hashes ones that changed on disk, so the
/// LOD cache (keyed by hash) never serves a stale thumbnail.
pub fn refresh_assets(assets: &mut [Asset]) {
    use rayon::prelude::*;
    assets.par_iter_mut().for_each(|a| {
        // Embedded bytes are content-addressed and never change; only their presence matters.
        if a.storage == Storage::Embedded {
            a.missing |= !Path::new(&a.path).exists();
            return;
        }
        refresh_linked(a);
    });
}

fn refresh_linked(a: &mut Asset) {
    match file_stamp(Path::new(&a.path)) {
        Err(_) => a.missing = true,
        Ok((size, mtime)) if size != a.size || mtime != a.mtime => {
            if let Ok(hash) = hash_file(Path::new(&a.path)) {
                a.hash = hash;
                a.size = size;
                a.mtime = mtime;
                // A sprite's canvas can be resized in Aseprite.
                if a.kind == AssetKind::Sprite {
                    if let Ok((w, h)) = crate::sprite::dimensions(Path::new(&a.path)) {
                        (a.width, a.height) = (w, h);
                    }
                }
            } else {
                a.missing = true;
            }
        }
        Ok(_) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_and_overwrites() {
        let path = std::env::temp_dir().join(format!("pw-project-test-{}.patchwork", std::process::id()));
        let asset = Asset {
            id: "abc".into(),
            hash: "abc".into(),
            kind: AssetKind::Gif,
            storage: Storage::Linked,
            path: "C:/nowhere/cat.gif".into(),
            name: "cat.gif".into(),
            width: 320,
            height: 240,
            size: 1234,
            mtime: 99,
            missing: false,
            rel: None,
        };
        let node = NodeRecord {
            id: "n1".into(),
            kind: "gif".into(),
            asset_id: Some("abc".into()),
            x: 10.0, y: -20.0, w: 320.0, h: 240.0, rotation: 0.0, z: 1.0,
            data: serde_json::json!({ "note": "hi" }),
            locked: true,
            parent: None,
        };
        let doc = ProjectDoc {
            // Non-trivial floats: the camera goes through JSON and must round-trip exactly.
            camera: Camera { x: 949.2284641637891, y: -2.1, zoom: 0.24888347081096457 },
            assets: vec![asset],
            nodes: vec![node.clone(), NodeRecord { id: "n2".into(), data: serde_json::Value::Null, locked: false, parent: Some("n1".into()), ..node }],
            links: vec![
                LinkRecord { id: "l1".into(), from: "n1".into(), to: "n2".into(), data: serde_json::json!({ "arrow": "both", "label": "uses" }) },
                LinkRecord { id: "l2".into(), from: "n2".into(), to: "n1".into(), data: serde_json::Value::Null },
            ],
            board: BoardSettings { embed_new: true, timers: serde_json::json!({ "n1": { "startedAt": 1_700_000_000_000_i64, "banked": 1500, "laps": [] } }) },
        };

        let blobs = std::env::temp_dir().join(format!("pw-blobs-test-{}", std::process::id()));
        save(&path, &doc).unwrap();
        save(&path, &doc).unwrap(); // overwriting an existing project works
        let loaded = load(&path, &blobs).unwrap();
        assert_eq!(loaded.camera, doc.camera);
        assert_eq!(loaded.nodes, doc.nodes);
        let mut links = loaded.links.clone();
        links.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(links, doc.links);
        assert_eq!(loaded.assets[0].kind, AssetKind::Gif);
        assert_eq!(loaded.board, doc.board);

        let mut assets = loaded.assets;
        refresh_assets(&mut assets);
        assert!(assets[0].missing);

        // A format 5 file has no `locked` or `parent` column: its nodes load unlocked and free.
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(
            "ALTER TABLE nodes DROP COLUMN locked; ALTER TABLE nodes DROP COLUMN parent;
             UPDATE meta SET value = '5' WHERE key = 'format_version';",
        )
        .unwrap();
        drop(conn);
        let old = load(&path, &blobs).unwrap();
        assert_eq!(old.nodes.len(), 2);
        assert!(old.nodes.iter().all(|n| !n.locked && n.parent.is_none()));

        fs::remove_file(&path).ok();
    }

    #[test]
    fn embedded_assets_travel_inside_the_file() {
        let dir = std::env::temp_dir().join(format!("pw-embed-test-{}", std::process::id()));
        let (store_a, store_b) = (dir.join("blobs-a"), dir.join("blobs-b"));
        let path = dir.join("board.patchwork");
        fs::create_dir_all(&dir).unwrap();

        let mut png = Vec::new();
        image::RgbaImage::from_pixel(3, 2, image::Rgba([200, 30, 40, 255]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .unwrap();
        let asset = crate::assets::import_bytes(&png, "Pasted image", &store_a).unwrap();
        assert_eq!((asset.storage, asset.width, asset.height), (Storage::Embedded, 3, 2));
        assert_eq!(asset.name, "Pasted image.png");

        let doc = ProjectDoc { camera: Camera { x: 0.0, y: 0.0, zoom: 1.0 }, assets: vec![asset.clone()], nodes: vec![], links: vec![], board: BoardSettings::default() };
        save(&path, &doc).unwrap();

        // Another machine: a fresh blob store gets the bytes from the project file.
        let mut loaded = load(&path, &store_b).unwrap();
        let a = &loaded.assets[0];
        assert!(!a.missing);
        assert!(a.path.starts_with(store_b.to_str().unwrap()));
        assert_eq!(fs::read(&a.path).unwrap(), png);
        refresh_assets(&mut loaded.assets);
        assert!(!loaded.assets[0].missing);

        // Saving again works even if the blob store lost the file: the old project has it.
        fs::remove_file(&loaded.assets[0].path).unwrap();
        save(&path, &loaded).unwrap();
        assert_eq!(fs::read(load(&path, &store_b).unwrap().assets[0].path.clone()).unwrap(), png);

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn packed_media_streams_through_the_file() {
        let dir = std::env::temp_dir().join(format!("pw-media-pack-test-{}", std::process::id()));
        let (store_a, store_b) = (dir.join("blobs-a"), dir.join("blobs-b"));
        let path = dir.join("board.patchwork");
        fs::create_dir_all(&dir).unwrap();

        // Not a real video: import doesn't decode media, and the bytes only have to survive.
        let clip = dir.join("Clip.MP4");
        let bytes: Vec<u8> = (0..5_000_000u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
        fs::write(&clip, &bytes).unwrap();
        let imported = crate::assets::import_paths(std::slice::from_ref(&clip));
        assert_eq!(imported.assets.len(), 1);
        assert_eq!((imported.assets[0].kind, imported.assets[0].width), (AssetKind::Video, 0));

        let packed = storage::pack(imported.assets, &store_a).unwrap();
        assert_eq!(packed[0].storage, Storage::Embedded);
        assert!(packed[0].path.ends_with(".mp4"), "stored as {}", packed[0].path);

        let doc = ProjectDoc { camera: Camera { x: 0.0, y: 0.0, zoom: 1.0 }, assets: packed, nodes: vec![], links: vec![], board: BoardSettings::default() };
        save(&path, &doc).unwrap();
        let loaded = load(&path, &store_b).unwrap();
        assert_eq!(loaded.assets[0].kind, AssetKind::Video);
        assert_eq!(fs::read(&loaded.assets[0].path).unwrap(), bytes);

        // Saving again with the blob store emptied streams the bytes from the old file.
        fs::remove_file(&loaded.assets[0].path).unwrap();
        save(&path, &loaded).unwrap();
        assert_eq!(fs::read(load(&path, &store_b).unwrap().assets[0].path.clone()).unwrap(), bytes);

        fs::remove_dir_all(&dir).ok();
    }
}
