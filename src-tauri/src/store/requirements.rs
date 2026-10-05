use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir};

/// Where a requirement came from, down to the piece of the document. The
/// export needs it, and a reviewer needs to be able to go and read the
/// sentence for themselves.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub document: String,
    pub page: Option<u32>,
    pub block: u32,
    pub piece: String,
}

/// What produced it. Without this, "why did this change?" has no answer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MadeBy {
    pub run: String,
    pub model: String,
    pub prompt: String,
    pub attempt: u32,
}

/// A requirement's wording at one point in its life.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Wording {
    pub title: String,
    pub acceptance: String,
}

fn first_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Requirement {
    pub id: String,
    pub title: String,
    pub acceptance: String,
    #[serde(default)]
    pub domain: String,
    #[serde(default)]
    pub impacted: String,
    /// "clear" or "vague" — one controlled word, not a free-text label.
    pub flag: String,
    /// Bumped every time the wording changes. Everything built from this
    /// requirement records the version it was built from, so "out of date"
    /// is a comparison rather than a guess.
    #[serde(default = "first_version")]
    pub version: u32,
    /// What it said when it was read out of the document. Kept so a change
    /// can be shown as a before and after, however many times it changes.
    #[serde(default)]
    pub as_extracted: Option<Wording>,
    #[serde(default)]
    pub clarification: Option<String>,
    pub source: Source,
    pub made_by: MadeBy,
    #[serde(default)]
    pub edited_by: Vec<String>,
    /// True when the piece of the document it came from has gone. Kept
    /// rather than deleted, because a disappeared requirement is a decision
    /// for a person, not for us.
    #[serde(default)]
    pub orphaned: bool,
}

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("requirements")
}

pub fn list(project_path: &Path) -> Vec<Requirement> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Vec::new();
    };

    let mut requirements: Vec<Requirement> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();

    requirements.sort_by(|left, right| left.id.cmp(&right.id));
    requirements
}

pub fn save(project_path: &Path, requirement: &Requirement) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(requirement).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", requirement.id)), &text)
}

/// Removes one requirement — used when a person confirms that a paragraph
/// has genuinely gone.
pub fn remove(project_path: &Path, id: &str) -> Result<(), String> {
    let path = folder(project_path).join(format!("{id}.yaml"));
    if path.exists() {
        fs::remove_file(&path).map_err(|error| format!("could not remove {id}: {error}"))?;
    }
    Ok(())
}

/// Clears what a previous extract produced. Called only when the user asks
/// to read everything again from scratch.
pub fn clear(project_path: &Path) -> Result<(), String> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Ok(());
    };
    for entry in entries.filter_map(Result::ok) {
        if entry.path().extension().is_some_and(|ext| ext == "yaml") {
            fs::remove_file(entry.path())
                .map_err(|error| format!("could not remove an old requirement: {error}"))?;
        }
    }
    Ok(())
}

/// Identifiers are ours, never the model's. A model that renumbers on a
/// re-run would break every link in the traceability matrix.
pub fn id_for(position: usize) -> String {
    format!("REQ-{:02}", position + 1)
}

/// The next free identifier, so a second read adds to the set rather than
/// renumbering what is already approved.
pub fn next_id(project_path: &Path) -> usize {
    list(project_path)
        .iter()
        .filter_map(|requirement| requirement.id.rsplit('-').next()?.parse::<usize>().ok())
        .max()
        .unwrap_or(0)
}

/// The export carries more than the screen does — source and anchor above
/// all, because that is what makes a requirement checkable.
pub fn to_csv(requirements: &[Requirement]) -> String {
    let mut out = String::from("ID,Title,Acceptance,Source,Page,Anchor,Domain,Impacted,Flag,Clarification\n");
    for requirement in requirements {
        let page = requirement
            .source
            .page
            .map(|page| page.to_string())
            .unwrap_or_default();
        out.push_str(&format!(
            "{},{},{},{},{},{},{},{},{},{}\n",
            quote(&requirement.id),
            quote(&requirement.title),
            quote(&requirement.acceptance),
            quote(&requirement.source.document),
            quote(&page),
            quote(&format!("block {}", requirement.source.block)),
            quote(&requirement.domain),
            quote(&requirement.impacted),
            quote(&requirement.flag),
            quote(requirement.clarification.as_deref().unwrap_or("")),
        ));
    }
    out
}

fn quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn identifiers_are_padded_and_start_at_one() {
        assert_eq!(id_for(0), "REQ-01");
        assert_eq!(id_for(11), "REQ-12");
    }

    #[test]
    fn the_export_escapes_quotes_and_keeps_the_anchor() {
        let requirement = Requirement {
            version: 1,
            as_extracted: None,
            id: "REQ-01".into(),
            title: "User can say \"no\"".into(),
            acceptance: "it works".into(),
            domain: "Auth".into(),
            impacted: "login".into(),
            flag: "clear".into(),
            clarification: None,
            source: Source {
                document: "requirements.pdf".into(),
                page: Some(12),
                block: 3,
                piece: "abc123".into(),
            },
            made_by: MadeBy {
                run: "run-001".into(),
                model: "anthropic:claude-sonnet-5".into(),
                prompt: "requirements@v1".into(),
                attempt: 1,
            },
            edited_by: Vec::new(),
            orphaned: false,
        };

        let csv = to_csv(&[requirement]);
        assert!(csv.contains("\"User can say \"\"no\"\"\""), "quotes should be doubled");
        assert!(csv.contains("\"12\""), "the page should be in the export");
        assert!(csv.contains("\"block 3\""));
    }
}
