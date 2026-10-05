use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};

/// A conversation about one requirement, kept with the project.
///
/// The point is not the chat. It is that a year later, "why does this
/// requirement say 400ms?" has an answer better than a timestamp: here is
/// what was asked, here is what the person said, here is the wording it
/// produced. A discussion that changed nothing is kept too — someone
/// looking at a requirement and being satisfied is also evidence.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    /// "person" or "app".
    pub from: String,
    pub text: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Discussion {
    pub id: String,
    pub req_id: String,
    pub started_at: String,
    pub turns: Vec<Turn>,
    /// The version this produced, when it produced one.
    #[serde(default)]
    pub produced_version: Option<u32>,
    #[serde(default)]
    pub before: Option<super::requirements::Wording>,
    #[serde(default)]
    pub after: Option<super::requirements::Wording>,
    /// How far the edit moved it: wording · sharper · different.
    #[serde(default)]
    pub change: Option<String>,
    pub model: String,
    pub prompt: String,
    #[serde(default)]
    pub input_tokens: u64,
    #[serde(default)]
    pub output_tokens: u64,
}

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("discussions")
}

pub fn list(project_path: &Path) -> Vec<Discussion> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Vec::new();
    };
    let mut found: Vec<Discussion> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();
    found.sort_by(|left, right| left.id.cmp(&right.id));
    found
}

pub fn for_requirement(project_path: &Path, req_id: &str) -> Vec<Discussion> {
    list(project_path).into_iter().filter(|entry| entry.req_id == req_id).collect()
}

pub fn next_id(project_path: &Path) -> String {
    format!("talk-{:03}", list(project_path).len() + 1)
}

pub fn save(project_path: &Path, discussion: &Discussion) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(discussion).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", discussion.id)), &text)
}
