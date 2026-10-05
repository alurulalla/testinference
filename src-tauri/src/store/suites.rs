use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};

/// A suite is a list of case ids and nothing more. A case belongs to as many
/// as make sense.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suite {
    pub id: String,
    pub name: String,
    pub purpose: String,
    #[serde(default)]
    pub cases: Vec<String>,
}

pub const DEFAULTS: [(&str, &str, &str); 3] = [
    ("feature", "Feature suite", "everything approved for this build"),
    ("regression", "Regression suite", "the pack that runs on every build"),
    ("release", "Release suite", "the go or no-go set before shipping"),
];

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("suites")
}

pub fn list(project_path: &Path) -> Vec<Suite> {
    let mut suites: Vec<Suite> = fs::read_dir(folder(project_path))
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
                .filter_map(|entry| fs::read_to_string(entry.path()).ok())
                .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
                .collect()
        })
        .unwrap_or_default();

    // The three standard suites always exist, even before anything is in them.
    for (id, name, purpose) in DEFAULTS {
        if !suites.iter().any(|suite| suite.id == id) {
            suites.push(Suite {
                id: id.to_string(),
                name: name.to_string(),
                purpose: purpose.to_string(),
                cases: Vec::new(),
            });
        }
    }

    suites.sort_by_key(|suite| {
        DEFAULTS.iter().position(|(id, _, _)| *id == suite.id).unwrap_or(99)
    });
    suites
}

pub fn save(project_path: &Path, suite: &Suite) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(suite).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", suite.id)), &text)
}

pub fn toggle(project_path: &Path, suite_id: &str, case_id: &str) -> Result<Suite, String> {
    let mut suites = list(project_path);
    let suite = suites
        .iter_mut()
        .find(|suite| suite.id == suite_id)
        .ok_or_else(|| format!("no suite called {suite_id}"))?;

    if let Some(at) = suite.cases.iter().position(|id| id == case_id) {
        suite.cases.remove(at);
    } else {
        suite.cases.push(case_id.to_string());
        suite.cases.sort();
    }

    save(project_path, suite)?;
    Ok(suite.clone())
}
