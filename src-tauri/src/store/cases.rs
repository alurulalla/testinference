use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};
use super::requirements::MadeBy;

/// A test case someone could execute.
///
/// Its identity is the TCER row's — a case is not renumbered when it crosses
/// from one stage to the next, because every join in the traceability matrix
/// depends on that staying still.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestCase {
    pub id: String,
    pub scenario_id: String,
    pub req_id: String,
    /// The requirement version this case was written against.
    ///
    /// Older than the requirement's own version means the requirement has
    /// been changed since, and this was built from wording that no longer
    /// exists.
    #[serde(default = "first_req_version")]
    pub req_version: u32,
    pub title: String,
    #[serde(default)]
    pub description: String,
    pub case_type: String,
    pub priority: String,
    #[serde(default)]
    pub precondition: String,
    #[serde(default)]
    pub test_data: String,
    #[serde(default)]
    pub steps: String,
    #[serde(default)]
    pub expected: String,
    #[serde(default)]
    pub platform: String,
    /// Carried from the scenario. Without it the automation stage can never
    /// class anything as automatable.
    #[serde(default)]
    pub auto_feasibility: String,
    /// pending · approved · rework · rejected — decided at Gate B.
    pub state: String,
    #[serde(default)]
    pub decided_at: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    pub made_by: MadeBy,
    /// The file this case was imported from, empty when it was written
    /// here. A case that came from somewhere else should never be mistaken
    /// for one this app designed.
    #[serde(default)]
    pub imported_from: String,
    /// Set when the case has been exported to an ALM tool.
    #[serde(default)]
    pub publish_id: Option<String>,
    #[serde(default)]
    pub publish_target: Option<String>,
    #[serde(default)]
    pub published_at: Option<String>,
}

fn first_req_version() -> u32 {
    1
}

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("cases")
}

pub fn list(project_path: &Path) -> Vec<TestCase> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Vec::new();
    };
    let mut cases: Vec<TestCase> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();
    cases.sort_by(|left, right| left.id.cmp(&right.id));
    cases
}

pub fn get(project_path: &Path, id: &str) -> Option<TestCase> {
    let text = fs::read_to_string(folder(project_path).join(format!("{id}.yaml"))).ok()?;
    serde_yaml_ng::from_str(&text).ok()
}

pub fn save(project_path: &Path, case: &TestCase) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(case).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", case.id)), &text)
}

/// The app's own identifier for a case in a given position.
pub fn id_for(position: usize) -> String {
    format!("TC-{:03}", position + 1)
}

/// The next free position, counted from the highest `TC-nnn` already here
/// rather than from how many cases there are. Imported cases keep their own
/// identifiers, so the two numbers are not the same and counting would
/// hand out one that is already taken.
pub fn next_id(project_path: &Path) -> usize {
    list(project_path)
        .iter()
        .filter_map(|case| case.id.strip_prefix("TC-"))
        .filter_map(|number| number.parse::<usize>().ok())
        .max()
        .unwrap_or(0)
}

pub fn clear(project_path: &Path) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Ok(());
    };
    for entry in entries.filter_map(Result::ok) {
        if entry.path().extension().is_some_and(|ext| ext == "yaml") {
            fs::remove_file(entry.path())
                .map_err(|error| format!("could not remove an old case: {error}"))?;
        }
    }
    Ok(())
}
