use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::context_dir;

/// Every human decision, appended and never rewritten.
///
/// This is the audit trail. A gate that only sets a flag on a record cannot
/// answer "who approved this, and what did it look like then?".
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub at: String,
    pub gate: String,
    pub subject: String,
    pub verdict: String,
    #[serde(default)]
    pub comment: Option<String>,
    /// What the artifact said at the moment it was decided.
    #[serde(default)]
    pub title: Option<String>,
}

pub fn record(project_path: &Path, decision: &Decision) -> Result<(), String> {
    let folder = context_dir(project_path).join("decisions");
    fs::create_dir_all(&folder)
        .map_err(|error| format!("could not create {}: {error}", folder.display()))?;

    let day = decision.at.get(..10).unwrap_or("undated").to_string();
    let file = folder.join(format!("{day}.jsonl"));
    let line = serde_json::to_string(decision).map_err(|error| error.to_string())?;

    let mut handle = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&file)
        .map_err(|error| format!("could not open {}: {error}", file.display()))?;
    writeln!(handle, "{line}").map_err(|error| format!("could not record the decision: {error}"))
}

pub fn count(project_path: &Path) -> usize {
    let folder = context_dir(project_path).join("decisions");
    let Ok(entries) = fs::read_dir(folder) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .map(|text| text.lines().filter(|line| !line.trim().is_empty()).count())
        .sum()
}
