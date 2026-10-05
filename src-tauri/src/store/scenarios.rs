use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};
use super::requirements::MadeBy;

/// A scenario, and where it stands at Gate A.
///
/// The decision is part of the record, not a flag in the interface: who
/// approved it, when, and what they said. That is what makes the output
/// defensible later.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: String,
    pub req_id: String,
    /// The requirement version this was designed from.
    ///
    /// Older than the requirement's own version means the requirement has
    /// been changed since, and this was built from wording that no longer
    /// exists.
    #[serde(default = "first_req_version")]
    pub req_version: u32,
    pub title: String,
    /// Positive · Negative · Boundary · Security · Edge
    pub class: String,
    /// P1 · P2 · P3
    pub priority: String,
    /// Automatable · Partial · Manual
    pub auto_feasibility: String,
    pub precondition: String,
    pub trigger: String,
    pub expected: String,
    /// pending · approved · rejected
    pub state: String,
    #[serde(default)]
    pub decided_at: Option<String>,
    #[serde(default)]
    pub comment: Option<String>,
    pub made_by: MadeBy,
}

fn first_req_version() -> u32 {
    1
}

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("scenarios")
}

pub fn list(project_path: &Path) -> Vec<Scenario> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Vec::new();
    };
    let mut scenarios: Vec<Scenario> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();
    scenarios.sort_by(|left, right| left.id.cmp(&right.id));
    scenarios
}

pub fn get(project_path: &Path, id: &str) -> Option<Scenario> {
    let text = fs::read_to_string(folder(project_path).join(format!("{id}.yaml"))).ok()?;
    serde_yaml_ng::from_str(&text).ok()
}

pub fn save(project_path: &Path, scenario: &Scenario) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(scenario).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", scenario.id)), &text)
}

pub fn clear(project_path: &Path) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Ok(());
    };
    for entry in entries.filter_map(Result::ok) {
        if entry.path().extension().is_some_and(|ext| ext == "yaml") {
            fs::remove_file(entry.path())
                .map_err(|error| format!("could not remove an old scenario: {error}"))?;
        }
    }
    Ok(())
}

pub fn id_for(position: usize) -> String {
    format!("TS-{:02}", position + 1)
}

/// The next free identifier, so designing for a new requirement does not
/// renumber scenarios someone has already approved.
pub fn next_id(project_path: &Path) -> usize {
    list(project_path)
        .iter()
        .filter_map(|scenario| scenario.id.rsplit('-').next()?.parse::<usize>().ok())
        .max()
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_match_the_published_shape() {
        assert_eq!(id_for(0), "TS-01");
        assert_eq!(id_for(11), "TS-12");
    }
}
