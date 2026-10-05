use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};
use super::requirements::MadeBy;

/// A scenario made executable, and what the arithmetic made of it.
///
/// The score is not the model's opinion: it is four presence checks, run
/// after the fact, which anyone can repeat by reading the row.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TcerRow {
    /// The scenario this came from.
    pub id: String,
    /// The identity it keeps for the rest of its life.
    pub tc_id: String,
    pub req_id: String,
    /// The requirement version behind this row.
    ///
    /// Older than the requirement's own version means the requirement has
    /// been changed since, and this was built from wording that no longer
    /// exists.
    #[serde(default = "first_req_version")]
    pub req_version: u32,
    pub title: String,
    pub precondition: String,
    pub trigger: String,
    pub expected: String,
    pub priority: String,
    pub score: u32,
    /// Pass · Rework · Reject
    pub verdict: String,
    #[serde(default)]
    pub reasons: Vec<String>,
    /// An SME can take a row out of scope without deleting it.
    #[serde(default)]
    pub removed: bool,
    #[serde(default)]
    pub comment: Option<String>,
    /// Absent when the row was complete already and no model was needed.
    #[serde(default)]
    pub made_by: Option<MadeBy>,
}

fn first_req_version() -> u32 {
    1
}

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("tcer")
}

pub fn list(project_path: &Path) -> Vec<TcerRow> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Vec::new();
    };
    let mut rows: Vec<TcerRow> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();
    rows.sort_by(|left, right| left.tc_id.cmp(&right.tc_id));
    rows
}

pub fn get(project_path: &Path, tc_id: &str) -> Option<TcerRow> {
    let text = fs::read_to_string(folder(project_path).join(format!("{tc_id}.yaml"))).ok()?;
    serde_yaml_ng::from_str(&text).ok()
}

pub fn save(project_path: &Path, row: &TcerRow) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(row).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", row.tc_id)), &text)
}

pub fn clear(project_path: &Path) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Ok(());
    };
    for entry in entries.filter_map(Result::ok) {
        if entry.path().extension().is_some_and(|ext| ext == "yaml") {
            fs::remove_file(entry.path())
                .map_err(|error| format!("could not remove an old row: {error}"))?;
        }
    }
    Ok(())
}

pub fn id_for(position: usize) -> String {
    format!("TC-{:03}", position + 1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_match_the_published_shape() {
        assert_eq!(id_for(0), "TC-001");
        assert_eq!(id_for(11), "TC-012");
    }
}
