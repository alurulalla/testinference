use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};

/// What happened when the tests ran.
///
/// Kept with the project so a history exists: the same test passing on
/// Monday and failing on Tuesday is the most useful thing a test suite
/// can tell you, and it cannot be seen from one run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepResult {
    pub from: String,
    /// passed · failed · skipped
    pub state: String,
    #[serde(default)]
    pub ms: u64,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseResult {
    pub id: String,
    pub title: String,
    /// passed · failed · unfinished
    pub state: String,
    #[serde(default)]
    pub ms: u64,
    pub steps: Vec<StepResult>,
    pub ended_at: Option<String>,
    pub detail: Option<String>,
    /// Where the picture of the failure was written. Outside the project:
    /// a screenshot is large, binary, and nobody wants it in a commit.
    #[serde(default)]
    pub shot: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Attempt {
    pub id: String,
    pub at: String,
    pub passed: u32,
    pub failed: u32,
    pub unfinished: u32,
    pub ms: u64,
    pub cases: Vec<CaseResult>,
}

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("results")
}

pub fn list(project_path: &Path) -> Vec<Attempt> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Vec::new();
    };
    let mut attempts: Vec<Attempt> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();
    attempts.sort_by(|left, right| left.id.cmp(&right.id));
    attempts
}

pub fn next_id(project_path: &Path) -> String {
    format!("try-{:03}", list(project_path).len() + 1)
}

pub fn save(project_path: &Path, attempt: &Attempt) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(attempt).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", attempt.id)), &text)
}
