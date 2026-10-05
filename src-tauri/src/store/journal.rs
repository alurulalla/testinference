use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};

/// A write that spans several files, recorded before any of it happens.
///
/// Approving twelve scenarios touches twelve files. Without this, a crash in
/// the middle leaves six approved and six not — a state the user never asked
/// for and cannot see. With it, the next open finishes the job.
#[derive(Debug, Serialize, Deserialize)]
struct Journal {
    what: String,
    files: Vec<Entry>,
}

#[derive(Debug, Serialize, Deserialize)]
struct Entry {
    path: String,
    contents: String,
}

fn journal_path(project_path: &Path) -> PathBuf {
    context_dir(project_path).join(".pending.json")
}

/// Writes several files as one unit. First used when requirements start
/// being written in batches; the guarantee is needed before that, not after.
#[allow(dead_code)]
pub fn write_many(project_path: &Path, what: &str, files: Vec<(PathBuf, String)>) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }

    let journal = Journal {
        what: what.to_string(),
        files: files
            .iter()
            .map(|(path, contents)| Entry {
                path: path.to_string_lossy().to_string(),
                contents: contents.clone(),
            })
            .collect(),
    };

    let record = journal_path(project_path);
    let text = serde_json::to_string(&journal).map_err(|error| error.to_string())?;
    atomic_write(&record, &text)?;

    for (path, contents) in &files {
        atomic_write(path, contents)?;
    }

    fs::remove_file(&record)
        .map_err(|error| format!("could not clear the pending record: {error}"))
}

/// Finishes any write that was interrupted. Called when a project is opened.
/// Returns what it had to finish, so the UI can say so rather than pretending
/// nothing happened.
pub fn recover(project_path: &Path) -> Result<Option<String>, String> {
    let record = journal_path(project_path);
    if !record.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(&record)
        .map_err(|error| format!("could not read the pending record: {error}"))?;
    let journal: Journal = serde_json::from_str(&text)
        .map_err(|error| format!("the pending record is unreadable: {error}"))?;

    for entry in &journal.files {
        atomic_write(Path::new(&entry.path), &entry.contents)?;
    }

    fs::remove_file(&record)
        .map_err(|error| format!("could not clear the pending record: {error}"))?;

    Ok(Some(journal.what))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_interrupted_write_is_finished_on_the_next_open() {
        let project = std::env::temp_dir().join(format!("ti-journal-{}", std::process::id()));
        let context = context_dir(&project);
        fs::create_dir_all(&context).unwrap();

        // Pretend a multi-file write was recorded and then the app died.
        let one = context.join("requirements").join("REQ-01.yaml");
        let two = context.join("requirements").join("REQ-02.yaml");
        let journal = Journal {
            what: "approve 2 requirements".to_string(),
            files: vec![
                Entry { path: one.to_string_lossy().to_string(), contents: "id: REQ-01\n".into() },
                Entry { path: two.to_string_lossy().to_string(), contents: "id: REQ-02\n".into() },
            ],
        };
        atomic_write(&journal_path(&project), &serde_json::to_string(&journal).unwrap()).unwrap();

        let finished = recover(&project).unwrap();
        assert_eq!(finished.as_deref(), Some("approve 2 requirements"));
        assert!(one.exists() && two.exists(), "both files should exist after recovery");
        assert!(recover(&project).unwrap().is_none(), "recovery should not repeat");

        let _ = fs::remove_dir_all(project);
    }
}
