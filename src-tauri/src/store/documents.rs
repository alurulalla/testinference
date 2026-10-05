use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager};

use super::paths::{atomic_write, context_dir, slugify};

/// What the project remembers about a document.
///
/// Note what is absent: the text. The document itself stays on this machine,
/// outside the folder that gets committed, because a requirements document is
/// often more sensitive than the test repository that would carry it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRecord {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub pages: Option<u32>,
    pub chunks: u32,
    pub bytes: u64,
    /// Of the file's contents — this is what makes a second import cheap.
    pub fingerprint: String,
    pub added_at: String,
    pub warning: Option<String>,
}

pub fn fingerprint(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())[..16].to_string()
}

pub fn list(project_path: &Path) -> Vec<DocumentRecord> {
    let folder = context_dir(project_path).join("documents");
    let Ok(entries) = fs::read_dir(folder) else {
        return Vec::new();
    };

    let mut documents: Vec<DocumentRecord> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();

    documents.sort_by(|left, right| left.added_at.cmp(&right.added_at));
    documents
}

pub fn find_by_fingerprint(project_path: &Path, fingerprint: &str) -> Option<DocumentRecord> {
    list(project_path)
        .into_iter()
        .find(|record| record.fingerprint == fingerprint)
}

pub fn save(project_path: &Path, record: &DocumentRecord) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(record).map_err(|error| error.to_string())?;
    atomic_write(
        &context_dir(project_path).join("documents").join(format!("{}.yaml", record.id)),
        &text,
    )
}

pub fn id_for(name: &str) -> String {
    slugify(name)
}

/// Where this machine keeps the document itself and the pieces it was cut
/// into. Both are local and neither is committed: one is confidential, the
/// other is rebuildable.
fn local_dir(app: &AppHandle, project_id: &str, folder: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("no application folder: {error}"))?
        .join(folder)
        .join(project_id);
    fs::create_dir_all(&dir).map_err(|error| format!("could not create {}: {error}", dir.display()))?;
    Ok(dir)
}

pub fn keep_copy(
    app: &AppHandle,
    project_id: &str,
    fingerprint: &str,
    source: &Path,
) -> Result<PathBuf, String> {
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("bin");
    let target = local_dir(app, project_id, "library")?.join(format!("{fingerprint}.{extension}"));

    if !target.exists() {
        fs::copy(source, &target)
            .map_err(|error| format!("could not copy the document: {error}"))?;
    }
    Ok(target)
}

pub fn write_chunks(
    app: &AppHandle,
    project_id: &str,
    document_id: &str,
    chunks: &[serde_json::Value],
) -> Result<(), String> {
    let lines: Vec<String> = chunks
        .iter()
        .map(|chunk| chunk.to_string())
        .collect();
    let target = local_dir(app, project_id, "index")?.join(format!("{document_id}.jsonl"));
    atomic_write(&target, &format!("{}\n", lines.join("\n")))
}

pub fn read_chunks(
    app: &AppHandle,
    project_id: &str,
    document_id: &str,
    limit: usize,
) -> Result<Vec<serde_json::Value>, String> {
    let target = local_dir(app, project_id, "index")?.join(format!("{document_id}.jsonl"));
    let Ok(text) = fs::read_to_string(target) else {
        return Ok(Vec::new());
    };
    Ok(text
        .lines()
        .filter(|line| !line.trim().is_empty())
        .take(limit)
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect())
}

pub fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_same_bytes_fingerprint_the_same_way() {
        assert_eq!(fingerprint(b"hello"), fingerprint(b"hello"));
        assert_ne!(fingerprint(b"hello"), fingerprint(b"hello "));
        assert_eq!(fingerprint(b"hello").len(), 16);
    }
}
