//! Talking to git through the user's own setup.
//!
//! Nothing is stored and no credentials are handled here: the commands run
//! as the user would run them. The app writes and commits; pushing is always
//! the user's decision, and it asks whether the project context should go
//! along with the tests.

use std::path::Path;
use std::process::Command;

use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatus {
    pub is_repo: bool,
    pub branch: Option<String>,
    pub changed: u32,
    pub context_changed: u32,
    pub has_remote: bool,
}

fn git(project_path: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(project_path)
        .args(args)
        .output()
        .map_err(|error| format!("git could not be run: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn status(project_path: &str) -> GitStatus {
    let project = Path::new(project_path);
    let Ok(_) = git(project, &["rev-parse", "--is-inside-work-tree"]) else {
        return GitStatus { is_repo: false, branch: None, changed: 0, context_changed: 0, has_remote: false };
    };

    let lines = git(project, &["status", "--porcelain"]).unwrap_or_default();
    let changed = lines.lines().filter(|line| !line.trim().is_empty()).count() as u32;
    let context_changed = lines
        .lines()
        .filter(|line| line.contains(".testinference/"))
        .count() as u32;

    GitStatus {
        is_repo: true,
        branch: git(project, &["rev-parse", "--abbrev-ref", "HEAD"])
            .ok()
            .map(|name| name.trim().to_string()),
        changed,
        context_changed,
        has_remote: git(project, &["remote"]).map(|out| !out.trim().is_empty()).unwrap_or(false),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitResult {
    pub committed: bool,
    pub pushed: bool,
    pub detail: String,
}

/// Commits the generated tests, and the project context too if asked.
pub fn commit(
    project_path: &str,
    message: &str,
    include_context: bool,
    push: bool,
) -> Result<GitResult, String> {
    let project = Path::new(project_path);
    if git(project, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        return Err("this project folder is not a git repository".to_string());
    }

    if include_context {
        git(project, &["add", ".testinference"])?;
    } else {
        // Stage everything except the context folder.
        git(project, &["add", "--all", "--", ":!.testinference"])?;
    }

    let staged = git(project, &["diff", "--cached", "--name-only"])?;
    if staged.trim().is_empty() {
        return Ok(GitResult {
            committed: false,
            pushed: false,
            detail: "nothing to commit".to_string(),
        });
    }

    git(project, &["commit", "-m", message])?;
    let count = staged.lines().filter(|line| !line.trim().is_empty()).count();

    if !push {
        return Ok(GitResult {
            committed: true,
            pushed: false,
            detail: format!("committed {count} files — not pushed"),
        });
    }

    match git(project, &["push"]) {
        Ok(_) => Ok(GitResult {
            committed: true,
            pushed: true,
            detail: format!("committed and pushed {count} files"),
        }),
        Err(problem) => Ok(GitResult {
            committed: true,
            pushed: false,
            detail: format!("committed {count} files, but the push failed: {problem}"),
        }),
    }
}
