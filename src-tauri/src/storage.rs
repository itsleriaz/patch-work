//! Moving assets between storage modes: packing them into the board file, collecting linked
//! files into a folder next to the board, unpacking embedded ones into that folder, and
//! relinking missing files. Also the relative paths that keep links working when a board and
//! its images move together.
//!
//! Every operation takes the board's assets and returns them updated (same ids and hashes), so
//! the caller can swap them in; files on disk are only ever added, never moved or deleted.

use crate::assets::{blob_ext, hash_file, read_head, store_blob_file, Asset, Storage};
use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// `<board name> files`, next to the board file.
pub fn files_dir(project: &Path) -> PathBuf {
    let stem = project.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    project.with_file_name(format!("{stem} files"))
}

/// `path` relative to the folder `base`, with "/" separators; `..` steps out of it. None when
/// they share no root (another drive on Windows).
pub fn relative(path: &Path, base: &Path) -> Option<String> {
    let (path, base): (Vec<_>, Vec<_>) = (path.components().collect(), base.components().collect());
    let common = path.iter().zip(&base).take_while(|(a, b)| a == b).count();
    if common == 0 || matches!(path.first(), Some(Component::Prefix(_))) && common < 2 {
        return None;
    }
    let up = std::iter::repeat_n("..".to_string(), base.len() - common);
    let down = path[common..].iter().map(|c| c.as_os_str().to_string_lossy().into_owned());
    Some(up.chain(down).collect::<Vec<_>>().join("/"))
}

/// Resolves a stored relative path against the board's folder.
pub fn resolve(rel: &str, base: &Path) -> PathBuf {
    rel.split('/').fold(base.to_path_buf(), |p, part| if part == ".." { p.parent().map(Path::to_path_buf).unwrap_or(p) } else { p.join(part) })
}

/// Paths relative to their deepest common folder: the layout a set of files keeps when copied.
fn layout(paths: &[&Path]) -> Vec<String> {
    let mut common: Option<PathBuf> = None;
    for p in paths {
        let parent = p.parent().unwrap_or(p);
        common = Some(match common {
            None => parent.to_path_buf(),
            Some(c) => c.components().zip(parent.components()).take_while(|(a, b)| a == b).map(|(a, _)| a).collect(),
        });
    }
    let common = common.unwrap_or_default();
    paths
        .iter()
        .map(|p| relative(p, &common).unwrap_or_else(|| file_name(p)))
        .collect()
}

fn file_name(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// A path for a new file named `name` in `dir` that nothing is at yet: `name` itself, or with
/// " (2)", " (3)"… before its extension. Characters that can't be in a file name become "-".
pub fn free_path(dir: &Path, name: &str) -> PathBuf {
    let clean: String = name
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '-' } else { c })
        .collect();
    let clean = clean.trim().trim_start_matches('.');
    let wanted = dir.join(if clean.is_empty() { "Export" } else { clean });
    let stem = wanted.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = wanted.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..)
        .map(|n| if n == 1 { wanted.clone() } else { wanted.with_file_name(format!("{stem} ({n}){ext}")) })
        .find(|p| !p.exists())
        .unwrap()
}

/// Copies `src` to `dir/rel`. An identical file already there is reused; a different one gets
/// a " (2)", " (3)"… suffix instead of being overwritten.
fn place(dir: &Path, rel: &str, src: &Path, hash: &str) -> Result<PathBuf, String> {
    let wanted = resolve(rel, dir);
    let stem = wanted.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = wanted.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    for n in 1.. {
        let target = if n == 1 { wanted.clone() } else { wanted.with_file_name(format!("{stem} ({n}){ext}")) };
        if target.exists() {
            if hash_file(&target).is_ok_and(|h| h == hash) {
                return Ok(target);
            }
            continue;
        }
        fs::create_dir_all(target.parent().unwrap_or(dir)).map_err(|e| e.to_string())?;
        fs::copy(src, &target).map_err(|e| format!("Couldn't copy {}: {e}", file_name(src)))?;
        return Ok(target);
    }
    unreachable!()
}

/// Embeds every linked, present asset. Originals stay where they are; `rel` remembers their
/// layout so unpacking can recreate it.
pub fn pack(mut assets: Vec<Asset>, blobs: &Path) -> Result<Vec<Asset>, String> {
    let picked: Vec<usize> = (0..assets.len()).filter(|&i| assets[i].storage == Storage::Linked && !assets[i].missing).collect();
    let paths: Vec<PathBuf> = picked.iter().map(|&i| PathBuf::from(&assets[i].path)).collect();
    let rels = layout(&paths.iter().map(PathBuf::as_path).collect::<Vec<_>>());
    for ((&i, path), rel) in picked.iter().zip(&paths).zip(rels) {
        // Streamed and hashed in one pass: big videos never sit in memory, and the hash covers
        // exactly what was stored, even if the file changed since it was checked.
        let ext = blob_ext(assets[i].kind, &assets[i].name, &read_head(path));
        let (hash, stored) = store_blob_file(blobs, path, &ext).map_err(|_| format!("Couldn't read {}", file_name(path)))?;
        let a = &mut assets[i];
        a.hash = hash;
        a.path = stored.to_string_lossy().into_owned();
        a.storage = Storage::Embedded;
        a.rel = Some(rel);
    }
    Ok(assets)
}

/// Copies linked files that live outside the board's files folder into it.
pub fn collect(mut assets: Vec<Asset>, project: &Path) -> Result<Vec<Asset>, String> {
    let dir = files_dir(project);
    let picked: Vec<usize> = (0..assets.len())
        .filter(|&i| assets[i].storage == Storage::Linked && !assets[i].missing && !Path::new(&assets[i].path).starts_with(&dir))
        .collect();
    let paths: Vec<PathBuf> = picked.iter().map(|&i| PathBuf::from(&assets[i].path)).collect();
    let rels = layout(&paths.iter().map(PathBuf::as_path).collect::<Vec<_>>());
    for ((&i, src), rel) in picked.iter().zip(&paths).zip(rels) {
        let a = &mut assets[i];
        a.path = place(&dir, &rel, src, &a.hash)?.to_string_lossy().into_owned();
    }
    Ok(assets)
}

/// Writes embedded assets into the board's files folder and links to them. Pasted images
/// (no recorded layout) go to "Pasted images/".
pub fn unpack(mut assets: Vec<Asset>, project: &Path) -> Result<Vec<Asset>, String> {
    let dir = files_dir(project);
    for a in assets.iter_mut().filter(|a| a.storage == Storage::Embedded && !a.missing) {
        let rel = a.rel.clone().unwrap_or_else(|| format!("Pasted images/{}", a.name));
        a.path = place(&dir, &rel, Path::new(&a.path), &a.hash)?.to_string_lossy().into_owned();
        a.storage = Storage::Linked;
        a.rel = None;
    }
    Ok(assets)
}

const RELINK_MAX_FILES: usize = 200_000;

/// How a search for missing files is going, sent to the page while it runs.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelinkProgress {
    /// Files looked at so far.
    pub scanned: usize,
    /// Missing files found so far (by content), of `missing`.
    pub found: usize,
    pub missing: usize,
    /// The folder being looked through.
    pub folder: String,
}

/// Looks for missing linked files under `dir`, at most `max_depth` folders down (None: no limit),
/// skipping hidden files and folders. A file with the same content counts as found as soon as it
/// turns up (a same-named one is preferred over a renamed copy), and the search ends once every
/// missing file is found by name and content. After the walk, a missing file still not found takes
/// the only file with its name, if there's exactly one (it was edited since). Stops early when
/// `cancel` is set, keeping what was found. `progress` is called about ten times a second.
pub fn relink(
    mut assets: Vec<Asset>,
    dir: &Path,
    max_depth: Option<usize>,
    cancel: &AtomicBool,
    mut progress: impl FnMut(&RelinkProgress),
) -> Vec<Asset> {
    let wanted: Vec<usize> = (0..assets.len()).filter(|&i| assets[i].missing && assets[i].storage == Storage::Linked).collect();
    let mut by_name: HashMap<String, Vec<usize>> = HashMap::new();
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    for &i in &wanted {
        by_name.entry(assets[i].name.to_lowercase()).or_default().push(i);
        by_size.entry(assets[i].size).or_default().push(i);
    }
    // Per wanted asset: a file with its content (and whether it has its name too), and every file
    // with its name.
    let mut found: HashMap<usize, (PathBuf, bool)> = HashMap::new();
    let mut named: HashMap<usize, Vec<PathBuf>> = HashMap::new();
    let complete = |found: &HashMap<usize, (PathBuf, bool)>| wanted.iter().all(|i| found.get(i).is_some_and(|f| f.1));

    let mut report = RelinkProgress { scanned: 0, found: 0, missing: wanted.len(), folder: String::new() };
    let mut last = Instant::now();
    let mut stack = vec![(dir.to_path_buf(), 0usize)];
    while let Some((d, depth)) = stack.pop() {
        if cancel.load(Ordering::Relaxed) || complete(&found) || report.scanned > RELINK_MAX_FILES {
            break;
        }
        let Ok(entries) = fs::read_dir(&d) else { continue };
        for e in entries.flatten() {
            let p = e.path();
            let name = file_name(&p);
            if name.starts_with('.') {
                continue;
            }
            match e.file_type() {
                Ok(t) if t.is_dir() => {
                    if max_depth.is_none_or(|m| depth < m) {
                        stack.push((p, depth + 1));
                    }
                }
                Ok(t) if t.is_file() => {
                    report.scanned += 1;
                    let lower = name.to_lowercase();
                    for &i in by_name.get(&lower).into_iter().flatten() {
                        named.entry(i).or_default().push(p.clone());
                    }
                    // Hash a file only when a missing file still could be it.
                    let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                    let open: Vec<usize> =
                        by_size.get(&size).into_iter().flatten().copied().filter(|i| !found.get(i).is_some_and(|f| f.1)).collect();
                    if open.is_empty() {
                        continue;
                    }
                    let Ok(hash) = hash_file(&p) else { continue };
                    for i in open.into_iter().filter(|&i| assets[i].hash == hash) {
                        let has_name = assets[i].name.to_lowercase() == lower;
                        if has_name || !found.contains_key(&i) {
                            found.insert(i, (p.clone(), has_name));
                        }
                    }
                }
                _ => {}
            }
        }
        if last.elapsed() >= Duration::from_millis(100) {
            last = Instant::now();
            report.found = found.len();
            report.folder = d.to_string_lossy().into_owned();
            progress(&report);
        }
    }

    for &i in &wanted {
        let path = match found.remove(&i) {
            Some((p, _)) => p,
            None => match named.get(&i).map(Vec::as_slice) {
                Some([only]) => only.clone(),
                _ => continue,
            },
        };
        assets[i].path = path.to_string_lossy().into_owned();
        assets[i].missing = false;
    }
    assets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_paths_never_overwrite() {
        let dir = std::env::temp_dir().join(format!("pw-free-path-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert_eq!(free_path(&dir, "Map.png"), dir.join("Map.png"));
        fs::write(dir.join("Map.png"), b"x").unwrap();
        assert_eq!(free_path(&dir, "Map.png"), dir.join("Map (2).png"));
        assert_eq!(free_path(&dir, "a/b:c?.svg"), dir.join("a-b-c-.svg"));
        assert_eq!(free_path(&dir, "  .png"), dir.join("png"));
        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn relative_paths() {
        let base = Path::new("/home/me/boards");
        assert_eq!(relative(Path::new("/home/me/boards/refs/a.png"), base).as_deref(), Some("refs/a.png"));
        assert_eq!(relative(Path::new("/home/me/pics/a.png"), base).as_deref(), Some("../pics/a.png"));
        assert_eq!(resolve("../pics/a.png", base), Path::new("/home/me/pics/a.png"));
        assert_eq!(resolve("refs/a.png", base), Path::new("/home/me/boards/refs/a.png"));
    }

    fn png(path: &Path, rgb: [u8; 3]) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        image::RgbImage::from_pixel(4, 3, image::Rgb(rgb)).save(path).unwrap();
    }

    #[test]
    fn collect_move_pack_unpack_relink() {
        use crate::assets::import_paths;
        use crate::project::{load, refresh_assets, save, BoardSettings, Camera, ProjectDoc};

        let root = std::env::temp_dir().join(format!("pw-storage-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let (cat, dog) = (root.join("refs/cats/cat.png"), root.join("refs/dogs/dog.png"));
        png(&cat, [200, 0, 0]);
        png(&dog, [0, 200, 0]);
        let board = root.join("boards/Mood.patchwork");
        fs::create_dir_all(board.parent().unwrap()).unwrap();
        let blobs = root.join("blobs");
        let doc = |assets| ProjectDoc { camera: Camera { x: 0.0, y: 0.0, zoom: 1.0 }, assets, nodes: vec![], links: vec![], board: BoardSettings::default() };

        // Collect: copies keep their layout below the common folder.
        let assets = collect(import_paths(&[cat.clone(), dog.clone()]).assets, &board).unwrap();
        let files = root.join("boards/Mood files");
        // Compared as paths: on Windows the expected value mixes `/` and `\`.
        assert_eq!(Path::new(&assets[0].path), files.join("cats/cat.png"));
        assert!(files.join("dogs/dog.png").exists());
        save(&board, &doc(assets)).unwrap();

        // Move the whole boards folder: links follow through the relative paths.
        let moved = root.join("moved");
        fs::rename(root.join("boards"), &moved).unwrap();
        let mut loaded = load(&moved.join("Mood.patchwork"), &blobs).unwrap();
        refresh_assets(&mut loaded.assets);
        assert!(loaded.assets.iter().all(|a| !a.missing && a.path.starts_with(moved.to_str().unwrap())));

        // Pack, then unpack next to a new board: the layout comes back.
        let packed = pack(loaded.assets, &blobs).unwrap();
        assert!(packed.iter().all(|a| a.storage == Storage::Embedded));
        let board2 = root.join("other/Copy.patchwork");
        let unpacked = unpack(packed, &board2).unwrap();
        assert!(root.join("other/Copy files/cats/cat.png").exists());
        assert!(unpacked.iter().all(|a| a.storage == Storage::Linked));

        // Relink: a renamed copy is found by content.
        let mut lost = import_paths(std::slice::from_ref(&cat)).assets;
        fs::rename(&cat, root.join("refs/renamed.png")).unwrap();
        lost[0].missing = true;
        let no = AtomicBool::new(false);
        let found = relink(lost.clone(), &root.join("refs"), None, &no, |_| {});
        assert!(!found[0].missing);
        assert!(found[0].path.ends_with("renamed.png"));

        // Too deep for the limit: not found at depth 0, found at depth 1.
        fs::create_dir_all(root.join("refs/deeper")).unwrap();
        fs::rename(root.join("refs/renamed.png"), root.join("refs/deeper/renamed.png")).unwrap();
        assert!(relink(lost.clone(), &root.join("refs"), Some(0), &no, |_| {})[0].missing);
        assert!(!relink(lost.clone(), &root.join("refs"), Some(1), &no, |_| {})[0].missing);

        // Cancelled before it starts: nothing found.
        assert!(relink(lost, &root.join("refs"), None, &AtomicBool::new(true), |_| {})[0].missing);

        fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn layout_keeps_structure_below_the_common_folder() {
        let a = Path::new("/x/refs/cats/1.png");
        let b = Path::new("/x/refs/dogs/2.png");
        assert_eq!(layout(&[a, b]), vec!["cats/1.png", "dogs/2.png"]);
        assert_eq!(layout(&[a]), vec!["1.png"]);
    }
}
