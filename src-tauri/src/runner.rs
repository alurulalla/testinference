//! Running the tests and keeping what happened.
//!
//! It replays the plan the written file was made from, so what you watch
//! here and what runs in CI cannot disagree.
//!
//! Two things are kept apart on purpose. The result — which step failed,
//! what the message was, how long it took — is small text and lives with
//! the project, so a history exists and travels to git. The screenshot is
//! large and binary and goes beside the application's own data, because
//! nobody wants a megabyte of PNG in a commit.

use std::path::Path;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::store;
use crate::worker::Worker;

/// Where the pictures go: outside the project, like the document index.
fn shots_dir(app: &AppHandle, project_id: &str, attempt: &str) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("no application folder: {error}"))?
        .join("shots")
        .join(project_id)
        .join(attempt);
    std::fs::create_dir_all(&dir).map_err(|error| format!("could not create {dir:?}: {error}"))?;
    Ok(dir)
}

pub async fn run(
    app: AppHandle,
    worker: &Worker,
    project_path: String,
    only: Option<String>,
    watch: bool,
) -> Result<store::Attempt, String> {
    let project = Path::new(&project_path);
    let context = store::read_context(project)?;

    let plans: Vec<store::Plan> = store::list_plans(project)
        .into_iter()
        .filter(|plan| only.as_ref().is_none_or(|id| &plan.id == id))
        .collect();
    if plans.is_empty() {
        return Err("there is nothing to run — write the tests first".to_string());
    }
    if context.app_url.trim().is_empty() {
        return Err("set the application URL on the project first".to_string());
    }

    let began = std::time::Instant::now();
    let answer = worker
        .call(
            "run.play",
            json!({
                "plans": plans,
                "startUrl": context.app_url,
                "watch": watch,
            }),
        )
        .await?;

    let id = store::next_attempt_id(project);
    let shots = shots_dir(&app, &context.id, &id)?;

    let mut cases: Vec<store::CaseResult> = Vec::new();
    for entry in answer.get("results").and_then(Value::as_array).cloned().unwrap_or_default() {
        let mut result: store::CaseResult = match serde_json::from_value(entry.clone()) {
            Ok(result) => result,
            Err(_) => continue,
        };

        // The picture comes back as text and is written out as a file, so
        // the result that goes to git stays small.
        if let Some(encoded) = entry.get("shot").and_then(Value::as_str) {
            use base64::Engine as _;
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(encoded) {
                let target = shots.join(format!("{}.png", result.id));
                if std::fs::write(&target, bytes).is_ok() {
                    result.shot = Some(target.to_string_lossy().to_string());
                } else {
                    result.shot = None;
                }
            } else {
                result.shot = None;
            }
        } else {
            result.shot = None;
        }
        cases.push(result);
    }

    let attempt = store::Attempt {
        id: id.clone(),
        at: store::now(),
        passed: cases.iter().filter(|case| case.state == "passed").count() as u32,
        failed: cases.iter().filter(|case| case.state == "failed").count() as u32,
        unfinished: cases.iter().filter(|case| case.state == "unfinished").count() as u32,
        ms: began.elapsed().as_millis() as u64,
        cases,
    };
    store::save_attempt(project, &attempt)?;

    let record = store::Run {
        id: store::next_run_id(project),
        kind: "test-run".to_string(),
        started_at: store::now(),
        finished_at: Some(store::now()),
        status: if attempt.failed > 0 { "failed".to_string() } else { "finished".to_string() },
        model: "browser".to_string(),
        prompt: "play/1".to_string(),
        batches: 1,
        batches_done: 1,
        attempts: 1,
        input_tokens: 0,
        output_tokens: 0,
        cost: None,
        produced: attempt.passed,
        note: Some(format!(
            "{} passed · {} failed · {} unfinished",
            attempt.passed, attempt.failed, attempt.unfinished
        )),
        judge: crate::judge::mode(project),
        pieces: Vec::new(),
    };
    store::save_run(project, &record)?;

    Ok(attempt)
}

/// Every attempt, oldest first, so the screen can show what changed.
pub fn history(project_path: &str) -> Vec<store::Attempt> {
    store::list_attempts(Path::new(project_path))
}
