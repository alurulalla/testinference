//! Turning approved test cases into a file a browser can run.
//!
//! The map earns its keep here. Every other tool that writes test code
//! asks a model to invent a selector from prose, which produces code that
//! reads perfectly and matches nothing. This asks a narrower question —
//! here are the controls that were observed to exist, which one does this
//! step mean — and refuses to write a line when the answer is none.
//!
//! What it will not do is produce a test that passes without checking
//! anything. An unfinished test is marked as unfinished, because a green
//! tick nobody earned is worse than a gap everybody can see.

use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::store;
use crate::worker::Worker;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeEstimate {
    pub cases: u32,
    pub pages: u32,
    pub controls: u32,
    pub model: Option<String>,
    pub note: String,
}

/// Which cases are eligible: approved, and not manual-only.
fn eligible(project: &Path) -> Vec<store::TestCase> {
    store::list_cases(project)
        .into_iter()
        .filter(|case| case.state == "approved")
        .filter(|case| !case.auto_feasibility.eq_ignore_ascii_case("Manual"))
        .collect()
}

pub fn estimate(app: &AppHandle, project_path: &str) -> Result<CodeEstimate, String> {
    let project = Path::new(project_path);
    let cases = eligible(project);
    let pages = store::list_app_pages(project);
    let controls: usize =
        pages.iter().map(|page| page.elements.iter().filter(|e| e.kind != "text").count()).sum();

    let settings = crate::config::load(app);
    let model = settings.assignments.get("write-cases").cloned();

    let note = if pages.is_empty() {
        "Explore the application first. Without a map, every selector would be a guess.".to_string()
    } else if cases.is_empty() {
        "No approved test cases that a tool could run. Approve some at Gate B, or check they are not all marked manual.".to_string()
    } else if model.is_none() {
        "Assign a model to writing test cases in Settings — reading the steps needs one.".to_string()
    } else {
        format!("{} cases against {} controls on {} pages.", cases.len(), controls, pages.len())
    };

    Ok(CodeEstimate {
        cases: cases.len() as u32,
        pages: pages.len() as u32,
        controls: controls as u32,
        model,
        note,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Generated {
    pub path: String,
    pub runnable: u32,
    pub unfinished: u32,
    /// Per case: what could not be written, so it can be shown rather
    /// than left in a file nobody opens.
    pub gaps: Vec<Value>,
    pub run: store::Run,
    pub note: String,
}

pub async fn run(
    app: AppHandle,
    worker: &Worker,
    project_path: String,
) -> Result<Generated, String> {
    let project = Path::new(&project_path);
    let planned = estimate(&app, &project_path)?;
    let model = planned.model.clone().ok_or(planned.note.clone())?;
    if planned.pages == 0 || planned.cases == 0 {
        return Err(planned.note);
    }

    let context = store::read_context(project)?;
    let pages = store::list_app_pages(project);

    // Every control on every mapped page, with the page it is on.
    let controls: Vec<Value> = pages
        .iter()
        .flat_map(|page| {
            // Text is included here, unlike in the counts: a heading is
            // not something to click, but it is exactly what a check
            // reads.
            page.elements
                .iter()
                .map(|element| {
                    json!({
                        "page": page.url,
                        "role": element.role,
                        "name": element.name,
                        "selector": element.selector,
                        "kind": element.kind,
                        "matches": element.matches,
                        "sturdiness": element.sturdiness,
                    })
                })
                .collect::<Vec<Value>>()
        })
        .collect();

    let payload: Vec<Value> = eligible(project)
        .into_iter()
        .map(|case| {
            json!({
                "id": case.id,
                "title": case.title,
                "precondition": case.precondition,
                "testData": case.test_data,
                "steps": case.steps,
                "expected": case.expected,
            })
        })
        .collect();

    let provider = model.split(':').next().unwrap_or_default().to_string();
    let endpoint = match provider.as_str() {
        "local" => crate::config::load(&app).local_endpoint.clone(),
        "openai" => crate::config::load(&app).openai_endpoint.clone(),
        _ => None,
    };

    let run_id = store::next_run_id(project);
    let answer = worker
        .call(
            "code.generate",
            json!({
                "model": model,
                "key": crate::secrets::read(&provider)?,
                "endpoint": endpoint,
                "cases": payload,
                "controls": controls,
                "startUrl": context.app_url,
                "runId": run_id,
                "judge": crate::judge::settings_for(&app, project),
            }),
        )
        .await?;

    // The plan is saved beside the file, because the in-app runner
    // replays it. Generated separately they would drift, and a test that
    // behaves differently here than in CI is worse than either alone.
    store::clear_plans(project)?;
    for entry in answer.get("plans").and_then(Value::as_array).cloned().unwrap_or_default() {
        if let Ok(plan) = serde_json::from_value::<store::Plan>(entry) {
            store::save_plan(project, &plan)?;
        }
    }

    let text = answer.get("file").and_then(Value::as_str).unwrap_or_default().to_string();
    // Beside the project, not inside its context folder: this is source
    // code, and it belongs where a developer would look for it.
    let target = project.join("tests").join("generated.spec.ts");
    store::atomic_write(&target, &text)?;

    let runnable = answer.get("runnable").and_then(Value::as_u64).unwrap_or(0) as u32;
    let unfinished = answer.get("unfinished").and_then(Value::as_u64).unwrap_or(0) as u32;

    let record = store::Run {
        id: run_id,
        kind: "code".to_string(),
        started_at: store::now(),
        finished_at: Some(store::now()),
        status: "finished".to_string(),
        model: model.clone(),
        prompt: "intents@v1".to_string(),
        batches: 1,
        batches_done: 1,
        attempts: 1,
        input_tokens: answer.get("inputTokens").and_then(Value::as_u64).unwrap_or(0),
        output_tokens: answer.get("outputTokens").and_then(Value::as_u64).unwrap_or(0),
        cost: None,
        produced: runnable,
        note: Some(format!("{runnable} runnable · {unfinished} unfinished")),
        judge: crate::judge::mode(project),
        pieces: Vec::new(),
    };
    store::save_run(project, &record)?;

    let gaps = answer
        .get("specs")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|spec| {
                    spec.get("unfinished").and_then(Value::as_u64).unwrap_or(0) > 0
                        || spec.get("checks").and_then(Value::as_u64).unwrap_or(0) == 0
                })
                .cloned()
                .collect()
        })
        .unwrap_or_default();

    Ok(Generated {
        path: target.to_string_lossy().to_string(),
        runnable,
        unfinished,
        gaps,
        run: record,
        note: format!(
            "{runnable} tests can run. {unfinished} are marked unfinished — they are in the file, \
             but marked so they report as not done rather than quietly passing."
        ),
    })
}
