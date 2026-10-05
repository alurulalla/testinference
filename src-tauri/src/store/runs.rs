use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};

/// What happened, in enough detail to explain any artifact it produced.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: String,
    pub kind: String,
    pub started_at: String,
    pub finished_at: Option<String>,
    /// running · finished · stopped · failed
    pub status: String,
    pub model: String,
    pub prompt: String,
    pub batches: u32,
    pub batches_done: u32,
    pub attempts: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cost: Option<f64>,
    pub produced: u32,
    pub note: Option<String>,
    /// Which judgement mode was switched on while this ran. Two runs over
    /// the same documents can differ for this reason alone, so it is part of
    /// the record rather than a setting you have to remember.
    #[serde(default = "default_judge")]
    pub judge: String,
    /// Fingerprints of the document pieces this run read. The next run
    /// compares against these to know what actually changed.
    #[serde(default)]
    pub pieces: Vec<String>,
}

fn default_judge() -> String {
    "rules".to_string()
}

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("runs")
}

pub fn list(project_path: &Path) -> Vec<Run> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Vec::new();
    };
    let mut runs: Vec<Run> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();
    runs.sort_by(|left, right| left.id.cmp(&right.id));
    runs
}

pub fn next_id(project_path: &Path) -> String {
    format!("run-{:03}", list(project_path).len() + 1)
}

pub fn save(project_path: &Path, run: &Run) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(run).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", run.id)), &text)
}
