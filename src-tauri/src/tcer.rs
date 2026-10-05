//! Completing scenarios into executable rows, then scoring them.
//!
//! The model only sees rows that are actually missing something. Everything
//! else passes through untouched, and all of them are scored by the same
//! arithmetic afterwards.

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

const BATCH: usize = 8;
const BATCH_TIMEOUT: Duration = Duration::from_secs(300);
const PROMPT: &str = "tcer@v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TcerEstimate {
    pub approved: u32,
    pub complete: u32,
    pub to_complete: u32,
    pub batches: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub model: Option<String>,
    pub cost: Option<f64>,
    pub over_budget: bool,
    pub note: String,
}

fn incomplete(scenario: &store::Scenario) -> bool {
    scenario.precondition.trim().is_empty()
        || scenario.trigger.trim().is_empty()
        || scenario.expected.trim().is_empty()
}

fn approved(project: &Path) -> Vec<store::Scenario> {
    store::list_scenarios(project)
        .into_iter()
        .filter(|scenario| scenario.state == "approved")
        .collect()
}

pub fn estimate(app: &AppHandle, project_path: &str) -> Result<TcerEstimate, String> {
    let project = Path::new(project_path);
    let scenarios = approved(project);
    let todo: Vec<&store::Scenario> = scenarios.iter().filter(|scenario| incomplete(scenario)).collect();

    let settings = config::load(app);
    let model = settings.assignments.get("complete-tcer").cloned();

    let characters: usize = todo.iter().map(|scenario| scenario.title.len() + 160).sum();
    let batches = todo.len().div_ceil(BATCH);
    let input_tokens = (characters as u64 / 4) + (batches as u64 * 400);
    let output_tokens = todo.len() as u64 * 140;

    let cost = model.as_deref().and_then(|model| {
        let price = settings.prices.get(model)?;
        Some((input_tokens as f64 / 1_000_000.0) * price.input_per_million
            + (output_tokens as f64 / 1_000_000.0) * price.output_per_million)
    });
    let over_budget = cost.is_some_and(|cost| cost > settings.budgets.per_run);

    let note = if scenarios.is_empty() {
        "nothing is approved yet — approve some scenarios at Gate A first".to_string()
    } else if todo.is_empty() {
        "every approved scenario is already complete, so this costs nothing".to_string()
    } else if model.is_none() {
        "no model is assigned to completing rows yet".to_string()
    } else if cost.is_none() {
        "cost unknown — set this model's price to have the budget enforced".to_string()
    } else if over_budget {
        format!(
            "about ${:.2}, which is over the ${:.2} limit for one run",
            cost.unwrap_or_default(),
            settings.budgets.per_run
        )
    } else {
        format!("about ${:.2} — only the {} incomplete rows are sent", cost.unwrap_or_default(), todo.len())
    };

    Ok(TcerEstimate {
        approved: scenarios.len() as u32,
        complete: (scenarios.len() - todo.len()) as u32,
        to_complete: todo.len() as u32,
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
    let scenarios = approved(project);
    if scenarios.is_empty() {
        return Err("nothing is approved yet".to_string());
    }

    let planned = estimate(&app, &project_path)?;
    if planned.over_budget {
        return Err(planned.note);
    }

    let settings = config::load(&app);
    let model = settings.assignments.get("complete-tcer").cloned();
    let needs_model = planned.to_complete > 0;
    if needs_model && model.is_none() {
        return Err("assign a model to completing rows first".to_string());
    }

    let (key, endpoint) = match model.as_deref() {
        Some(model) => {
            let provider = model.split(':').next().unwrap_or_default().to_string();
            let endpoint = match provider.as_str() {
                "local" => settings.local_endpoint.clone(),
                "openai" => settings.openai_endpoint.clone(),
                _ => None,
            };
            (crate::secrets::read(&provider)?, endpoint)
        }
        None => (None, None),
    };

    let mut record = store::Run {
        id: store::next_run_id(project),
        kind: "tcer".to_string(),
        started_at: store::now(),
        finished_at: None,
        status: "running".to_string(),
        model: model.clone().unwrap_or_else(|| "none needed".to_string()),
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

    // Anything a person said about an old row is kept across a re-run.
    let previous = store::list_tcer(project);
    store::clear_tcer(project)?;

    let mut filled: std::collections::HashMap<String, (String, String, String)> = std::collections::HashMap::new();
    let todo: Vec<&store::Scenario> = scenarios.iter().filter(|scenario| incomplete(scenario)).collect();

    for (number, batch) in todo.chunks(BATCH).enumerate() {
        if cancel.0.load(Ordering::Relaxed) {
            record.status = "stopped".to_string();
            break;
        }

        let payload = json!({
            "model": model,
            "key": key,
            "endpoint": endpoint,
            "rows": batch.iter().map(|scenario| json!({
                "id": scenario.id,
                "title": scenario.title,
                "precondition": scenario.precondition,
                "trigger": scenario.trigger,
                "expected": scenario.expected,
            })).collect::<Vec<_>>(),
        });

        match worker
            .call_with_timeout("tcer.enrichBatch", payload, BATCH_TIMEOUT)
            .await
        {
            Ok(answer) => {
                record.attempts += answer.get("attempts").and_then(Value::as_u64).unwrap_or(1) as u32;
                record.input_tokens += answer.get("inputTokens").and_then(Value::as_u64).unwrap_or(0);
                record.output_tokens += answer.get("outputTokens").and_then(Value::as_u64).unwrap_or(0);

                for row in answer.get("rows").and_then(Value::as_array).cloned().unwrap_or_default() {
                    let id = row.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                    filled.insert(
                        id,
                        (
                            text(&row, "precondition"),
                            text(&row, "trigger"),
                            text(&row, "expected"),
                        ),
                    );
                }
            }
            Err(problem) => {
                let _ = app.emit("run:problem", json!({ "batch": number + 1, "detail": problem }));
            }
        }

        record.batches_done = number as u32 + 1;
        store::save_run(project, &record)?;
        let _ = app.emit(
            "run:progress",
            json!({ "runId": record.id, "done": record.batches_done, "total": record.batches, "found": filled.len(), "cost": record.cost }),
        );
    }

    // Build the rows, then let the arithmetic score them.
    let mut rows = Vec::new();
    for (position, scenario) in scenarios.iter().enumerate() {
        let completed = filled.get(&scenario.id);
        let earlier = previous.iter().find(|row| row.id == scenario.id);

        rows.push(store::TcerRow {
            id: scenario.id.clone(),
            tc_id: store::tcer_id(position),
            req_id: scenario.req_id.clone(),
            req_version: scenario.req_version,
            title: scenario.title.clone(),
            precondition: completed.map(|row| row.0.clone()).unwrap_or_else(|| scenario.precondition.clone()),
            trigger: completed.map(|row| row.1.clone()).unwrap_or_else(|| scenario.trigger.clone()),
            expected: completed.map(|row| row.2.clone()).unwrap_or_else(|| scenario.expected.clone()),
            priority: scenario.priority.clone(),
            score: 0,
            verdict: String::new(),
            reasons: Vec::new(),
            removed: earlier.is_some_and(|row| row.removed),
            comment: earlier.and_then(|row| row.comment.clone()),
            made_by: completed.map(|_| store::MadeBy {
                run: record.id.clone(),
                model: model.clone().unwrap_or_default(),
                prompt: PROMPT.to_string(),
                attempt: 1,
            }),
        });
    }

    let scored = score(worker, &rows).await?;
    for row in &scored {
        store::save_tcer(project, row)?;
    }
    record.produced = scored.len() as u32;

    record.cost = model.as_deref().and_then(|model| {
        let price = settings.prices.get(model)?;
        Some((record.input_tokens as f64 / 1_000_000.0) * price.input_per_million
            + (record.output_tokens as f64 / 1_000_000.0) * price.output_per_million)
    });
    if record.status == "running" {
        record.status = "finished".to_string();
    }
    record.note = Some(format!(
        "{} rows · {} completed by the model, {} already complete",
        scored.len(),
        filled.len(),
        scored.len() - filled.len()
    ));
    record.finished_at = Some(store::now());
    store::save_run(project, &record)?;
    let _ = app.emit("run:finished", &record);

    Ok(record)
}

/// Runs the four checks over every row. No model is involved.
pub async fn score(worker: &Worker, rows: &[store::TcerRow]) -> Result<Vec<store::TcerRow>, String> {
    let payload: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({
                "id": row.id,
                "tcId": row.tc_id,
                "reqId": row.req_id,
                "title": row.title,
                "trigger": row.trigger,
                "expected": row.expected,
                "priority": row.priority,
                "removed": row.removed,
            })
        })
        .collect();

    let answer = worker.call("engines.score", json!({ "rows": payload })).await?;
    let scored = answer.get("rows").and_then(Value::as_array).cloned().unwrap_or_default();

    let mut out = rows.to_vec();
    for result in scored {
        let tc_id = result.get("tcId").and_then(Value::as_str).unwrap_or_default();
        let Some(row) = out.iter_mut().find(|row| row.tc_id == tc_id) else { continue };
        row.score = result.get("score").and_then(Value::as_f64).unwrap_or(0.0).round() as u32;
        row.verdict = result.get("verdict").and_then(Value::as_str).unwrap_or("Reject").to_string();
        row.reasons = result
            .get("reasons")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|reason| reason.as_str().map(str::to_string))
                    .collect()
            })
            .unwrap_or_default();
    }

    Ok(out)
}

fn text(value: &Value, field: &str) -> String {
    value.get(field).and_then(Value::as_str).unwrap_or("").trim().to_string()
}
