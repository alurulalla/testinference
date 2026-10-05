use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};
use super::requirements::MadeBy;

/// A Gherkin scenario, kept as a record so it can be rewritten, plus the
/// real `.feature` files generated beside them for a framework to run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BddCase {
    pub id: String,
    pub case_id: String,
    pub req_id: String,
    pub feature: String,
    pub title: String,
    pub given: String,
    pub when: String,
    pub then: String,
    #[serde(default)]
    pub examples: String,
    #[serde(default)]
    pub test_data: String,
    #[serde(default)]
    pub platform: String,
    pub priority: String,
    #[serde(default)]
    pub new_steps: Vec<String>,
    pub made_by: MadeBy,
}

fn records(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("bdd").join("records")
}

fn features(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("bdd")
}

pub fn list(project_path: &Path) -> Vec<BddCase> {
    let Ok(entries) = fs::read_dir(records(project_path)) else {
        return Vec::new();
    };
    let mut cases: Vec<BddCase> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();
    cases.sort_by(|left, right| left.id.cmp(&right.id));
    cases
}

pub fn save(project_path: &Path, case: &BddCase) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(case).map_err(|error| error.to_string())?;
    atomic_write(&records(project_path).join(format!("{}.yaml", case.id)), &text)
}

/// Writes a `.feature` file a framework can run as-is.
pub fn save_feature(project_path: &Path, feature: &str, contents: &str) -> Result<(), String> {
    atomic_write(&features(project_path).join(format!("{feature}.feature")), contents)
}

pub fn clear(project_path: &Path) -> Result<(), String> {
    for folder in [records(project_path), features(project_path)] {
        let Ok(entries) = fs::read_dir(&folder) else { continue };
        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "yaml" || ext == "feature") {
                fs::remove_file(path).map_err(|error| format!("could not clear BDD: {error}"))?;
            }
        }
    }
    Ok(())
}

pub fn id_for(position: usize) -> String {
    format!("BDD-{:03}", position + 1)
}

/// The step library, kept as one file because it is read and rewritten whole.
pub fn read_library(project_path: &Path) -> Vec<String> {
    let file = context_dir(project_path).join("steps").join("library.yaml");
    fs::read_to_string(file)
        .ok()
        .and_then(|text| serde_yaml_ng::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn write_library(project_path: &Path, library: &[String]) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(library).map_err(|error| error.to_string())?;
    atomic_write(&context_dir(project_path).join("steps").join("library.yaml"), &text)
}
