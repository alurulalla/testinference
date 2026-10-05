use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};

/// The steps as the runner will replay them.
///
/// The same plan produces the file a person commits and the run the app
/// performs, so the two cannot disagree. Keeping it in the project means
/// a run is reproducible by anyone who has the repository.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStep {
    pub from: String,
    pub action: String,
    pub selector: Option<String>,
    #[serde(default)]
    pub value: String,
    pub problem: Option<String>,
    #[serde(default)]
    pub first: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub title: String,
    pub steps: Vec<PlanStep>,
    pub runnable: bool,
}

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("plans")
}

pub fn list(project_path: &Path) -> Vec<Plan> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Vec::new();
    };
    let mut plans: Vec<Plan> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();
    plans.sort_by(|left, right| left.id.cmp(&right.id));
    plans
}

pub fn save(project_path: &Path, plan: &Plan) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(plan).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", plan.id)), &text)
}

pub fn clear(project_path: &Path) -> Result<(), String> {
    let target = folder(project_path);
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("could not clear {}: {error}", target.display()))?;
    }
    fs::create_dir_all(&target).map_err(|error| format!("could not create {target:?}: {error}"))
}
