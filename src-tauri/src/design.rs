//! The run that turns requirements into scenarios, and the gate that decides
//! which of them are worth testing.

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

/// Requirements per request. Scenarios are long, so fewer per call than the
/// reader uses.
const BATCH: usize = 4;
const BATCH_TIMEOUT: Duration = Duration::from_secs(300);
const PROMPT: &str = "scenarios@v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesignEstimate {
    pub requirements: u32,
    pub batches: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub model: Option<String>,
    pub cost: Option<f64>,
    pub over_budget: bool,
    pub note: String,
}

pub fn estimate(app: &AppHandle, project_path: &str) -> Result<DesignEstimate, String> {
    let project = Path::new(project_path);
    let requirements = store::list_requirements(project);
    let settings = config::load(app);
    let model = settings.assignments.get("design-scenarios").cloned();

    let characters: usize = requirements
        .iter()
        .map(|requirement| requirement.title.len() + requirement.acceptance.len())
        .sum();
    let batches = requirements.len().div_ceil(BATCH);
    let input_tokens = (characters as u64 / 4) + (batches as u64 * 500);
    // Several scenarios per requirement, each a few sentences.
    let output_tokens = requirements.len() as u64 * 450;

    let cost = model.as_deref().and_then(|model| {
        let price = settings.prices.get(model)?;
        Some((input_tokens as f64 / 1_000_000.0) * price.input_per_million
            + (output_tokens as f64 / 1_000_000.0) * price.output_per_million)
    });
    let over_budget = cost.is_some_and(|cost| cost > settings.budgets.per_run);

    let note = match (&model, cost) {
        (None, _) => "no model is assigned to designing scenarios yet".to_string(),
        (Some(_), None) => "cost unknown — set this model's price to have the budget enforced".to_string(),
        (Some(_), Some(cost)) if over_budget => format!(
            "about ${cost:.2}, which is over the ${:.2} limit for one run",
            settings.budgets.per_run
        ),
        (Some(_), Some(cost)) => format!("about ${cost:.2} on your own key"),
    };

    Ok(DesignEstimate {
        requirements: requirements.len() as u32,
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
    delta: bool,
) -> Result<store::Run, String> {
    let project = Path::new(&project_path);
    let settings = config::load(&app);
    let model = settings
        .assignments
        .get("design-scenarios")
        .cloned()
        .ok_or_else(|| "assign a model to designing scenarios first".to_string())?;

    let planned = estimate(&app, &project_path)?;
    if planned.over_budget {
        return Err(planned.note);
    }
    if planned.requirements == 0 {
        return Err("there are no requirements to design from".to_string());
    }
    if delta && store::list_requirements(project).is_empty() {
        return Err("there are no requirements to design from".to_string());
    }

    let provider = model.split(':').next().unwrap_or_default().to_string();
    let key = crate::secrets::read(&provider)?;
    let endpoint = match provider.as_str() {
        "local" => settings.local_endpoint.clone(),
        "openai" => settings.openai_endpoint.clone(),
        _ => None,
    };

    let everything = store::list_requirements(project);
    // Which version of each requirement this run is designing from.
    let version_of: std::collections::HashMap<String, u32> = everything
        .iter()
        .map(|requirement| (requirement.id.clone(), requirement.version))
        .collect();

    // In delta mode, only requirements that have no scenarios yet are sent.
    // Scenarios already approved at Gate A stay approved.
    let requirements: Vec<store::Requirement> = if delta {
        let covered: std::collections::HashSet<String> = store::list_scenarios(project)
            .into_iter()
            .map(|scenario| scenario.req_id)
            .collect();
        everything
            .into_iter()
            .filter(|requirement| !requirement.orphaned && !covered.contains(&requirement.id))
            .collect()
    } else {
        store::clear_scenarios(project)?;
        everything
    };

    let start_at = if delta { store::next_scenario_id(project) } else { 0 };
    let batches: Vec<&[store::Requirement]> = requirements.chunks(BATCH).collect();

    let mut record = store::Run {
        id: store::next_run_id(project),
        kind: "design".to_string(),
        started_at: store::now(),
        finished_at: None,
        status: "running".to_string(),
        model: model.clone(),
        prompt: PROMPT.to_string(),
        batches: batches.len() as u32,
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

    let mut position = start_at;
    let mut skipped: Vec<String> = Vec::new();
    let mut failed: Vec<usize> = Vec::new();

    for (number, batch) in batches.iter().enumerate() {
        if cancel.0.load(Ordering::Relaxed) {
            record.status = "stopped".to_string();
            record.note = Some("you stopped it; what was designed is kept".to_string());
            break;
        }

        let payload = json!({
            "model": model,
            "key": key,
            "endpoint": endpoint,
            "requirements": batch.iter().map(|requirement| json!({
                "id": requirement.id,
                "title": requirement.title,
                "acceptance": requirement.acceptance,
                "flag": requirement.flag,
            })).collect::<Vec<_>>(),
        });

        let mut outcome = worker
            .call_with_timeout("scenarios.designBatch", payload.clone(), BATCH_TIMEOUT)
            .await;
        if outcome.is_err() && !cancel.0.load(Ordering::Relaxed) {
            tokio::time::sleep(Duration::from_secs(2)).await;
            outcome = worker
                .call_with_timeout("scenarios.designBatch", payload, BATCH_TIMEOUT)
                .await;
        }

        match outcome {
            Ok(answer) => {
                let attempts = answer.get("attempts").and_then(Value::as_u64).unwrap_or(1) as u32;
                record.attempts += attempts;
                record.input_tokens += answer.get("inputTokens").and_then(Value::as_u64).unwrap_or(0);
                record.output_tokens += answer.get("outputTokens").and_then(Value::as_u64).unwrap_or(0);

                for draft in answer.get("scenarios").and_then(Value::as_array).cloned().unwrap_or_default() {
                    let req_id = text(&draft, "reqId");
                    let scenario = store::Scenario {
                        id: store::scenario_id(position),
                        req_version: version_of.get(&req_id).copied().unwrap_or(1),
                        req_id,
                        title: text(&draft, "title"),
                        class: text(&draft, "class"),
                        priority: text(&draft, "priority"),
                        auto_feasibility: text(&draft, "autoFeasibility"),
                        precondition: text(&draft, "precondition"),
                        trigger: text(&draft, "trigger"),
                        expected: text(&draft, "expected"),
                        state: "pending".to_string(),
                        decided_at: None,
                        comment: None,
                        made_by: store::MadeBy {
                            run: record.id.clone(),
                            model: model.clone(),
                            prompt: PROMPT.to_string(),
                            attempt: attempts,
                        },
                    };
                    store::save_scenario(project, &scenario)?;
                    position += 1;
                    record.produced += 1;
                    let _ = app.emit("run:scenario", &scenario);
                }

                for entry in answer.get("skipped").and_then(Value::as_array).cloned().unwrap_or_default() {
                    skipped.push(format!("{}: {}", text(&entry, "reqId"), text(&entry, "why")));
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
            json!({
                "runId": record.id,
                "done": record.batches_done,
                "total": record.batches,
                "found": record.produced,
                "cost": record.cost,
            }),
        );
    }

    if record.status == "running" {
        record.status = "finished".to_string();
    }

    // A second opinion on the labels.
    //
    // The writing model labels what it writes, which is one job too many:
    // composing and classifying are different skills, and a model that has
    // just argued itself into a scenario is the worst judge of what kind it
    // is. A relabel is applied only where the judge is reasonably sure, and
    // the count goes in the run so the change is never silent — the class
    // and priority feed the risk score, so this moves visible numbers.
    let relabelled = relabel(&app, worker, project).await?;

    let mut notes: Vec<String> = Vec::new();
    if relabelled > 0 {
        notes.push(format!("{relabelled} scenarios were relabelled by the judge"));
    }
    if !failed.is_empty() {
        notes.push(format!("{} batches could not be designed: {failed:?}", failed.len()));
    }
    if !skipped.is_empty() {
        notes.push(format!("{} requirements were skipped as untestable", skipped.len()));
    }
    if !notes.is_empty() {
        record.note = Some(notes.join(" · "));
    }

    record.finished_at = Some(store::now());
    store::save_run(project, &record)?;
    let _ = app.emit("run:finished", &record);

    Ok(record)
}

/// Below this, the judge is not sure enough to overrule the writer.
const SURE_ENOUGH: f64 = 0.6;

/// Asks the judge to label the scenarios, and applies what it is sure of.
/// Returns how many labels changed.
async fn relabel(app: &AppHandle, worker: &Worker, project: &Path) -> Result<u32, String> {
    let judgement = crate::judge::settings_for(app, project);
    if judgement.get("mode").and_then(Value::as_str) != Some("jev") {
        return Ok(0);
    }

    let scenarios = store::list_scenarios(project);
    if scenarios.is_empty() {
        return Ok(0);
    }

    let payload_scenarios: Vec<Value> = scenarios
        .iter()
        .map(|scenario| {
            json!({ "id": scenario.id, "title": scenario.title, "expected": scenario.expected })
        })
        .collect();
    let mut payload = json!({ "scenarios": payload_scenarios });
    crate::judge::attach(&mut payload, &judgement);

    // Labelling is a second opinion, not the pipeline. If it fails, the
    // writing model's labels stand and the run is still a success.
    let Ok(answer) = worker.call("decisions.label", payload).await else {
        return Ok(0);
    };

    let mut changed = 0u32;
    for entry in answer.get("answers").and_then(Value::as_array).cloned().unwrap_or_default() {
        let Some(id) = entry.get("id").and_then(Value::as_str) else { continue };
        let Some(mut scenario) = store::get_scenario(project, id) else { continue };
        let labels = entry.get("answer").cloned().unwrap_or_default();

        // Each label stands on its own confidence. A shaky class does not
        // hold back a certain feasibility; they were separate questions.
        let mut touched = false;
        for (field, current) in [
            ("class", &mut scenario.class),
            ("feasibility", &mut scenario.auto_feasibility),
        ] {
            let Some(label) = labels.get(field) else { continue };
            if label.get("confidence").and_then(Value::as_f64).unwrap_or(0.0) < SURE_ENOUGH {
                continue;
            }
            if let Some(value) = label.get("value").and_then(Value::as_str) {
                if !value.is_empty() && value != current {
                    *current = value.to_string();
                    touched = true;
                }
            }
        }

        if touched {
            scenario.made_by.model = format!("{} · labels judged", scenario.made_by.model);
            store::save_scenario(project, &scenario)?;
            changed += 1;
        }
    }

    Ok(changed)
}

/// Gate A. Nothing moves on until a person has been through this.
pub fn decide(
    project_path: &str,
    ids: Vec<String>,
    verdict: &str,
    comment: Option<String>,
) -> Result<u32, String> {
    if !matches!(verdict, "approved" | "rejected" | "pending") {
        return Err(format!("{verdict} is not a verdict"));
    }
    let project = Path::new(project_path);
    let mut changed = 0;

    for id in ids {
        let Some(mut scenario) = store::get_scenario(project, &id) else {
            continue;
        };
        scenario.state = verdict.to_string();
        scenario.decided_at = Some(store::now());
        scenario.comment = comment.clone();
        store::save_scenario(project, &scenario)?;

        store::record_decision(
            project,
            &store::Decision {
                at: store::now(),
                gate: "A".to_string(),
                subject: scenario.id.clone(),
                verdict: verdict.to_string(),
                comment: comment.clone(),
                title: Some(scenario.title.clone()),
            },
        )?;
        changed += 1;
    }

    Ok(changed)
}

fn text(value: &Value, field: &str) -> String {
    value.get(field).and_then(Value::as_str).unwrap_or("").trim().to_string()
}
