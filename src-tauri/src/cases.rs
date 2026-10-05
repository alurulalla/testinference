//! Writing test cases from completed rows.
//!
//! Rows that failed scoring are not written up. The old app wrote a case
//! from every active row regardless, which is how an empty row became a test
//! case that looked half-acceptable.

use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::config;
use crate::extract::Cancel;
use crate::store;
use crate::worker::Worker;

const BATCH: usize = 5;
const BATCH_TIMEOUT: Duration = Duration::from_secs(300);
const PROMPT: &str = "cases@v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CasesEstimate {
    pub rows: u32,
    pub skipped_rejected: u32,
    pub skipped_removed: u32,
    pub batches: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub model: Option<String>,
    pub cost: Option<f64>,
    pub over_budget: bool,
    pub note: String,
}

fn writable(project: &Path) -> (Vec<store::TcerRow>, u32, u32) {
    let all = store::list_tcer(project);
    let removed = all.iter().filter(|row| row.removed).count() as u32;
    let rejected = all
        .iter()
        .filter(|row| !row.removed && row.verdict == "Reject")
        .count() as u32;
    let rows = all
        .into_iter()
        .filter(|row| !row.removed && row.verdict != "Reject")
        .collect();
    (rows, rejected, removed)
}

pub fn estimate(app: &AppHandle, project_path: &str) -> Result<CasesEstimate, String> {
    let project = Path::new(project_path);
    let (rows, rejected, removed) = writable(project);
    let settings = config::load(app);
    let model = settings.assignments.get("write-cases").cloned();

    let characters: usize = rows
        .iter()
        .map(|row| row.title.len() + row.precondition.len() + row.trigger.len() + row.expected.len())
        .sum();
    let batches = rows.len().div_ceil(BATCH);
    let input_tokens = (characters as u64 / 4) + (batches as u64 * 450);
    // Steps and matching results run longer than the row they came from.
    let output_tokens = rows.len() as u64 * 400;

    let cost = model.as_deref().and_then(|model| {
        let price = settings.prices.get(model)?;
        Some((input_tokens as f64 / 1_000_000.0) * price.input_per_million
            + (output_tokens as f64 / 1_000_000.0) * price.output_per_million)
    });
    let over_budget = cost.is_some_and(|cost| cost > settings.budgets.per_run);

    let skipped = match (rejected, removed) {
        (0, 0) => String::new(),
        _ => format!(" · {rejected} rejected and {removed} removed rows are left out"),
    };
    let note = if rows.is_empty() {
        "no rows are ready — complete and score some first".to_string()
    } else if model.is_none() {
        "no model is assigned to writing test cases yet".to_string()
    } else if cost.is_none() {
        format!("cost unknown — set this model's price to have the budget enforced{skipped}")
    } else if over_budget {
        format!(
            "about ${:.2}, which is over the ${:.2} limit for one run",
            cost.unwrap_or_default(),
            settings.budgets.per_run
        )
    } else {
        format!("about ${:.2} on your own key{skipped}", cost.unwrap_or_default())
    };

    Ok(CasesEstimate {
        rows: rows.len() as u32,
        skipped_rejected: rejected,
        skipped_removed: removed,
        batches: batches as u32,
        input_tokens,
        output_tokens,
        model,
        cost,
        over_budget,
        note,
    })
}

pub async fn run(
    app: AppHandle,
    worker: &Worker,
    cancel: Cancel,
    project_path: String,
) -> Result<store::Run, String> {
    let project = Path::new(&project_path);
    let planned = estimate(&app, &project_path)?;
    if planned.over_budget {
        return Err(planned.note);
    }
    if planned.rows == 0 {
        return Err("no rows are ready to write up".to_string());
    }

    let settings = config::load(&app);
    let model = settings
        .assignments
        .get("write-cases")
        .cloned()
        .ok_or_else(|| "assign a model to writing test cases first".to_string())?;
    let provider = model.split(':').next().unwrap_or_default().to_string();
    let key = crate::secrets::read(&provider)?;
    let endpoint = match provider.as_str() {
        "local" => settings.local_endpoint.clone(),
        "openai" => settings.openai_endpoint.clone(),
        _ => None,
    };

    let (rows, _, _) = writable(project);
    // The scenario holds the automation verdict; the case needs to carry it.
    let scenarios = store::list_scenarios(project);

    let mut record = store::Run {
        id: store::next_run_id(project),
        kind: "cases".to_string(),
        started_at: store::now(),
        finished_at: None,
        status: "running".to_string(),
        model: model.clone(),
        prompt: PROMPT.to_string(),
        batches: planned.batches,
        batches_done: 0,
        attempts: 0,
        input_tokens: 0,
        output_tokens: 0,
        cost: None,
        produced: 0,
        note: None,
        judge: crate::judge::mode(project),
        pieces: Vec::new(),
    };
    store::save_run(project, &record)?;
    cancel.0.store(false, Ordering::Relaxed);

    let earlier = store::list_cases(project);
    store::clear_cases(project)?;
    let mut failed: Vec<usize> = Vec::new();

    for (number, batch) in rows.chunks(BATCH).enumerate() {
        if cancel.0.load(Ordering::Relaxed) {
            record.status = "stopped".to_string();
            break;
        }

        let payload = json!({
            "model": model,
            "key": key,
            "endpoint": endpoint,
            "rows": batch.iter().map(|row| json!({
                "id": row.tc_id,
                "title": row.title,
                "precondition": row.precondition,
                "trigger": row.trigger,
                "expected": row.expected,
                "priority": row.priority,
            })).collect::<Vec<_>>(),
        });

        let mut outcome = worker
            .call_with_timeout("cases.writeBatch", payload.clone(), BATCH_TIMEOUT)
            .await;
        if outcome.is_err() && !cancel.0.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_secs(2)).await;
            outcome = worker.call_with_timeout("cases.writeBatch", payload, BATCH_TIMEOUT).await;
        }

        match outcome {
            Ok(answer) => {
                let attempts = answer.get("attempts").and_then(Value::as_u64).unwrap_or(1) as u32;
                record.attempts += attempts;
                record.input_tokens += answer.get("inputTokens").and_then(Value::as_u64).unwrap_or(0);
                record.output_tokens += answer.get("outputTokens").and_then(Value::as_u64).unwrap_or(0);

                for draft in answer.get("cases").and_then(Value::as_array).cloned().unwrap_or_default() {
                    let id = text(&draft, "id");
                    let Some(row) = rows.iter().find(|row| row.tc_id == id) else { continue };
                    let scenario = scenarios.iter().find(|scenario| scenario.id == row.id);
                    let before = earlier.iter().find(|case| case.id == id);

                    let case = store::TestCase {
                        id: id.clone(),
                        scenario_id: row.id.clone(),
                        req_id: row.req_id.clone(),
                        req_version: row.req_version,
                        title: text(&draft, "title"),
                        description: text(&draft, "description"),
                        case_type: text(&draft, "type"),
                        priority: row.priority.clone(),
                        precondition: text(&draft, "precondition"),
                        test_data: text(&draft, "testData"),
                        steps: text(&draft, "steps"),
                        expected: text(&draft, "expected"),
                        platform: text(&draft, "platform"),
                        auto_feasibility: scenario
                            .map(|scenario| scenario.auto_feasibility.clone())
                            .unwrap_or_default(),
                        // A re-write does not silently un-approve what a
                        // person already decided.
                        state: before.map(|case| case.state.clone()).unwrap_or_else(|| "pending".to_string()),
                        decided_at: before.and_then(|case| case.decided_at.clone()),
                        comment: before.and_then(|case| case.comment.clone()),
                        made_by: store::MadeBy {
                            run: record.id.clone(),
                            model: model.clone(),
                            prompt: PROMPT.to_string(),
                            attempt: attempts,
                        },
                        imported_from: String::new(),
                        // A rewrite does not unpublish what was published.
                        publish_id: before.and_then(|case| case.publish_id.clone()),
                        publish_target: before.and_then(|case| case.publish_target.clone()),
                        published_at: before.and_then(|case| case.published_at.clone()),
                    };
                    store::save_case(project, &case)?;
                    record.produced += 1;
                    let _ = app.emit("run:case", &case);
                }
            }
            Err(problem) => {
                failed.push(number + 1);
                let _ = app.emit("run:problem", json!({ "batch": number + 1, "detail": problem }));
            }
        }

        record.batches_done = number as u32 + 1;
        record.cost = settings.prices.get(&model).map(|price| {
            (record.input_tokens as f64 / 1_000_000.0) * price.input_per_million
                + (record.output_tokens as f64 / 1_000_000.0) * price.output_per_million
        });

        if record.cost.is_some_and(|cost| cost > settings.budgets.per_run) {
            record.status = "stopped".to_string();
            record.note = Some(format!("stopped at the ${:.2} limit for one run", settings.budgets.per_run));
            store::save_run(project, &record)?;
            break;
        }

        store::save_run(project, &record)?;
        let _ = app.emit(
            "run:progress",
            json!({ "runId": record.id, "done": record.batches_done, "total": record.batches, "found": record.produced, "cost": record.cost }),
        );
    }

    if record.status == "running" {
        record.status = "finished".to_string();
    }
    let mut notes = vec![format!(
        "{} written · {} rejected and {} removed rows left out",
        record.produced, planned.skipped_rejected, planned.skipped_removed
    )];
    if !failed.is_empty() {
        notes.push(format!("{} batches failed: {failed:?}", failed.len()));
    }
    record.note = Some(notes.join(" · "));
    record.finished_at = Some(store::now());
    store::save_run(project, &record)?;
    let _ = app.emit("run:finished", &record);

    Ok(record)
}

fn text(value: &Value, field: &str) -> String {
    value.get(field).and_then(Value::as_str).unwrap_or("").trim().to_string()
}
