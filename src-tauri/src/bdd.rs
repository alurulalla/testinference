//! Writing Gherkin, and keeping the step library tidy.

use std::collections::BTreeMap;
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
const PROMPT: &str = "bdd@v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BddEstimate {
    pub cases: u32,
    pub batches: u32,
    pub library: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub model: Option<String>,
    pub cost: Option<f64>,
    pub over_budget: bool,
    pub note: String,
}

pub fn estimate(app: &AppHandle, project_path: &str) -> Result<BddEstimate, String> {
    let project = Path::new(project_path);
    let cases = store::list_cases(project);
    let library = store::read_library(project);
    let settings = config::load(app);
    let model = settings.assignments.get("write-bdd").cloned();

    let characters: usize = cases.iter().map(|case| case.title.len() + case.steps.len()).sum();
    let batches = cases.len().div_ceil(BATCH);
    // The library rides along in every request, so it counts.
    let library_tokens = library.iter().map(|step| step.len() as u64 / 4).sum::<u64>();
    let input_tokens = (characters as u64 / 4) + (batches as u64 * (400 + library_tokens));
    let output_tokens = cases.len() as u64 * 320;

    let cost = model.as_deref().and_then(|model| {
        let price = settings.prices.get(model)?;
        Some((input_tokens as f64 / 1_000_000.0) * price.input_per_million
            + (output_tokens as f64 / 1_000_000.0) * price.output_per_million)
    });
    let over_budget = cost.is_some_and(|cost| cost > settings.budgets.per_run);

    let note = if cases.is_empty() {
        "no test cases to write Gherkin from yet".to_string()
    } else if model.is_none() {
        "no model is assigned to writing BDD yet".to_string()
    } else if cost.is_none() {
        "cost unknown — set this model's price to have the budget enforced".to_string()
    } else if over_budget {
        format!(
            "about ${:.2}, over the ${:.2} limit for one run",
            cost.unwrap_or_default(),
            settings.budgets.per_run
        )
    } else {
        format!(
            "about ${:.2} · {} steps already in the library will be reused",
            cost.unwrap_or_default(),
            library.len()
        )
    };

    Ok(BddEstimate {
        cases: cases.len() as u32,
        batches: batches as u32,
        library: library.len() as u32,
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
    let judgement = crate::judge::settings_for(&app, project);
    let planned = estimate(&app, &project_path)?;
    if planned.over_budget {
        return Err(planned.note);
    }
    if planned.cases == 0 {
        return Err("there are no test cases to write Gherkin from".to_string());
    }

    let settings = config::load(&app);
    let model = settings
        .assignments
        .get("write-bdd")
        .cloned()
        .ok_or_else(|| "assign a model to writing BDD first".to_string())?;
    let provider = model.split(':').next().unwrap_or_default().to_string();
    let key = crate::secrets::read(&provider)?;
    let endpoint = match provider.as_str() {
        "local" => settings.local_endpoint.clone(),
        "openai" => settings.openai_endpoint.clone(),
        _ => None,
    };

    let cases = store::list_cases(project);
    let mut library = store::read_library(project);

    let mut record = store::Run {
        id: store::next_run_id(project),
        kind: "bdd".to_string(),
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

    store::clear_bdd(project)?;
    let mut position = 0usize;
    let mut reused = 0usize;
    let mut added = 0usize;
    let mut by_feature: BTreeMap<String, Vec<Value>> = BTreeMap::new();

    for (number, batch) in cases.chunks(BATCH).enumerate() {
        if cancel.0.load(Ordering::Relaxed) {
            record.status = "stopped".to_string();
            break;
        }

        let payload = json!({
            "model": model,
            "key": key,
            "endpoint": endpoint,
            "library": library,
            "rows": batch.iter().map(|case| json!({
                "id": case.id,
                "title": case.title,
                "precondition": case.precondition,
                "trigger": case.steps,
                "expected": case.expected,
                "platform": case.platform,
            })).collect::<Vec<_>>(),
        });

        match worker.call_with_timeout("bdd.writeBatch", payload, BATCH_TIMEOUT).await {
            Ok(answer) => {
                record.attempts += answer.get("attempts").and_then(Value::as_u64).unwrap_or(1) as u32;
                record.input_tokens += answer.get("inputTokens").and_then(Value::as_u64).unwrap_or(0);
                record.output_tokens += answer.get("outputTokens").and_then(Value::as_u64).unwrap_or(0);

                for draft in answer.get("cases").and_then(Value::as_array).cloned().unwrap_or_default() {
                    let case_id = text(&draft, "id");
                    let Some(source) = cases.iter().find(|case| case.id == case_id) else { continue };

                    // Every step the model wrote is checked against the
                    // library before any of it is called new.
                    let steps = worker.call("bdd.steps", json!({ "case": draft })).await?;
                    let proposed: Vec<String> = steps
                        .as_array()
                        .map(|list| list.iter().filter_map(|step| step.as_str().map(str::to_string)).collect())
                        .unwrap_or_default();

                    let mut fold = json!({ "proposed": proposed, "library": library });
                    crate::judge::attach(&mut fold, &judgement);
                    let folded = worker.call("decisions.foldSteps", fold).await?;
                    reused += folded.get("reused").and_then(Value::as_array).map_or(0, |list| list.len());
                    let newly: Vec<String> = folded
                        .get("added")
                        .and_then(Value::as_array)
                        .map(|list| list.iter().filter_map(|step| step.as_str().map(str::to_string)).collect())
                        .unwrap_or_default();
                    added += newly.len();
                    library = folded
                        .get("library")
                        .and_then(Value::as_array)
                        .map(|list| list.iter().filter_map(|step| step.as_str().map(str::to_string)).collect())
                        .unwrap_or(library);

                    let feature = text(&draft, "feature");
                    let case = store::BddCase {
                        id: store::bdd_id(position),
                        case_id: source.id.clone(),
                        req_id: source.req_id.clone(),
                        feature: feature.clone(),
                        title: text(&draft, "title"),
                        given: text(&draft, "given"),
                        when: text(&draft, "when"),
                        then: text(&draft, "then"),
                        examples: text(&draft, "examples"),
                        test_data: text(&draft, "testData"),
                        platform: text(&draft, "platform"),
                        priority: source.priority.clone(),
                        new_steps: newly,
                        made_by: store::MadeBy {
                            run: record.id.clone(),
                            model: model.clone(),
                            prompt: PROMPT.to_string(),
                            attempt: 1,
                        },
                    };
                    store::save_bdd(project, &case)?;
                    by_feature.entry(feature).or_default().push(draft);
                    position += 1;
                    record.produced += 1;
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
            json!({ "runId": record.id, "done": record.batches_done, "total": record.batches, "found": record.produced, "cost": record.cost }),
        );
    }

    // Real .feature files, one per feature, generated from the records.
    for (feature, drafts) in &by_feature {
        let rendered = worker
            .call("bdd.render", json!({ "feature": feature, "cases": drafts }))
            .await?;
        if let Some(text) = rendered.as_str() {
            store::save_feature(project, feature, text)?;
        }
    }
    store::write_library(project, &library)?;

    record.cost = settings.prices.get(&model).map(|price| {
        (record.input_tokens as f64 / 1_000_000.0) * price.input_per_million
            + (record.output_tokens as f64 / 1_000_000.0) * price.output_per_million
    });
    if record.status == "running" {
        record.status = "finished".to_string();
    }
    record.note = Some(format!(
        "{} outlines in {} feature files · {reused} steps reused, {added} added",
        record.produced,
        by_feature.len()
    ));
    record.finished_at = Some(store::now());
    store::save_run(project, &record)?;
    let _ = app.emit("run:finished", &record);

    Ok(record)
}

fn text(value: &Value, field: &str) -> String {
    value.get(field).and_then(Value::as_str).unwrap_or("").trim().to_string()
}
