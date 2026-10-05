//! The judgement switch.
//!
//! Small yes/no calls — is this requirement too vague, do these two say the
//! same thing — can be answered three ways:
//!
//! * `rules`  plain code. Free, instant, and right most of the time.
//! * `model`  the model assigned to judging answers what the rules are
//!            unsure about, in one batched call.
//! * `jev`    the same, routed to Jev.
//!
//! Rules always run first, whichever mode is on: there is no reason to pay
//! for a question code already answers confidently. The mode only decides
//! who gets the leftovers.
//!
//! Jev is TypeSafe's System One model. It is not a chat model: it takes the
//! material to judge as a `state` and a map of typed questions about it, and
//! answers a graded yes/no for each — 0.95 a confident yes, 0.5 "I don't
//! know". That is the shape this layer wanted, so with Jev on there is no
//! prose to parse and no schema to repair.

use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::store;
use crate::worker::Worker;

/// Which mode this project is on. Falls back to rules when the project
/// cannot be read, because rules never fail and never cost anything.
pub fn mode(project_path: &Path) -> String {
    store::read_context(project_path)
        .map(|context| context.judge_mode)
        .unwrap_or_else(|_| "rules".to_string())
}

/// What a mode needs before it can run, and what it would cost.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Readiness {
    pub mode: String,
    pub ready: bool,
    pub model: Option<String>,
    pub note: String,
}

pub fn readiness(app: &AppHandle, project_path: &str) -> Readiness {
    let current = mode(Path::new(project_path));
    let settings = crate::config::load(app);
    let model = settings.assignments.get("judge").cloned();

    match current.as_str() {
        "rules" => Readiness {
            mode: current,
            ready: true,
            model: None,
            note: "Code answers these. Nothing is sent anywhere and nothing is charged."
                .to_string(),
        },
        "jev" => {
            // Only the key is required. TypeSafe's own address is the
            // default; an endpoint is for a proxy or a private deployment.
            let ready = crate::secrets::has_key("jev");
            let model = settings.jev_model.clone().unwrap_or_else(|| JEV_MODEL.to_string());
            let note = if ready {
                format!("{model} answers every question, and says how sure it is.")
            } else {
                "Add the Jev key in Settings. Until then the rules answer alone.".to_string()
            };
            Readiness { mode: current, ready, model: Some(model), note }
        }
        _ => {
            let ready = model.is_some();
            let note = match &model {
                Some(model) => format!("{model} answers what the rules are unsure about."),
                None => "Assign a model to judging in Settings. Until then the rules answer alone."
                    .to_string(),
            };
            Readiness { mode: current, ready, model, note }
        }
    }
}

/// Everything a worker method needs to route a judgement call: the mode in
/// force and, when it is Jev, the credentials to reach it.
///
/// A mode that is chosen but not set up comes back as `rules`, so a call
/// site never has to ask whether the key is there — the fallback is already
/// the answer.
pub fn settings_for(app: &AppHandle, project_path: &Path) -> Value {
    let state = readiness(app, &project_path.to_string_lossy());
    let settings = crate::config::load(app);
    let effective = if state.ready { state.mode.clone() } else { "rules".to_string() };

    let key = if effective == "jev" {
        crate::secrets::read("jev").ok().flatten()
    } else {
        None
    };

    json!({
        "mode": effective,
        "key": key,
        "endpoint": settings.jev_endpoint,
        "model": settings.jev_model.clone().unwrap_or_else(|| JEV_MODEL.to_string()),
        "atOnce": settings.budgets.max_parallel,
    })
}

/// Folds the judgement settings into a call's own arguments.
pub fn attach(payload: &mut Value, judgement: &Value) {
    let (Some(target), Some(source)) = (payload.as_object_mut(), judgement.as_object()) else {
        return;
    };
    for (name, value) in source {
        target.insert(name.clone(), value.clone());
    }
}

/// TypeSafe's flagship model, and the name their own examples use.
pub const JEV_MODEL: &str = "jev-latest";

/// How many questions one model-backed review may ask. A review is a
/// background nicety, not a run; it should never become the expensive thing.
const LIMIT: u32 = 60;

/// Reads every requirement and reports what looks wrong with the set:
/// which are too vague to test, and which two say the same thing.
pub async fn review(app: AppHandle, worker: &Worker, project_path: String) -> Result<Value, String> {
    let project = Path::new(&project_path);
    let requirements = store::list_requirements(project);
    if requirements.is_empty() {
        return Err("there are no requirements to review yet".to_string());
    }

    let state = readiness(&app, &project_path);
    // An unready mode is not an error: the rules still answer, and the note
    // already says what is missing.
    let effective = if state.ready { state.mode.clone() } else { "rules".to_string() };

    let settings = crate::config::load(&app);
    let (model, key, endpoint) = match effective.as_str() {
        "jev" => (
            settings.jev_model.clone().unwrap_or_else(|| JEV_MODEL.to_string()),
            crate::secrets::read("jev")?,
            settings.jev_endpoint.clone(),
        ),
        "model" => {
            let model = state.model.clone().unwrap_or_default();
            let provider = model.split(':').next().unwrap_or_default().to_string();
            let endpoint = match provider.as_str() {
                "local" => settings.local_endpoint.clone(),
                "openai" => settings.openai_endpoint.clone(),
                _ => None,
            };
            (model, crate::secrets::read(&provider)?, endpoint)
        }
        _ => (String::new(), None, None),
    };

    let items: Vec<Value> = requirements
        .iter()
        .filter(|requirement| !requirement.orphaned)
        .map(|requirement| {
            json!({
                "id": requirement.id,
                "title": requirement.title,
                "acceptance": requirement.acceptance,
            })
        })
        .collect();

    let mut answer = worker
        .call(
            "decisions.review",
            json!({
                "requirements": items,
                "mode": effective,
                "model": model,
                "key": key,
                "endpoint": endpoint,
                "limit": LIMIT,
                "atOnce": settings.budgets.max_parallel,
            }),
        )
        .await?;

    if let Some(object) = answer.as_object_mut() {
        object.insert("note".to_string(), json!(state.note));
        object.insert("asked_for".to_string(), json!(state.mode));
    }

    // A review that asked a model anything is a run like any other: it cost
    // something, and the next person deserves to see what answered.
    let asked = answer.get("asked").and_then(Value::as_u64).unwrap_or(0);
    if asked > 0 {
        let spent = record_run(&app, project, &effective, &model, &answer)?;
        if let (Some(object), Some(cost)) = (answer.as_object_mut(), spent) {
            object.insert("cost".to_string(), json!(cost));
        }
    }
    Ok(answer)
}

/// Writes the review into the project's run history, with its tokens and,
/// when the price is known, its cost — which it returns so the screen can
/// say what the answer cost without reading the history back.
fn record_run(
    app: &AppHandle,
    project: &Path,
    mode: &str,
    model: &str,
    answer: &Value,
) -> Result<Option<f64>, String> {
    let number = |field: &str| answer.get(field).and_then(Value::as_u64).unwrap_or(0);
    let input = number("inputTokens");
    let output = number("outputTokens");

    let settings = crate::config::load(app);
    // Jev charges for input only, so an unset output price is not a gap.
    let cost = settings.prices.get(&format!("jev:{model}")).map(|price| {
        (input as f64 / 1_000_000.0) * price.input_per_million
            + (output as f64 / 1_000_000.0) * price.output_per_million
    });

    let findings = answer
        .get("findings")
        .and_then(Value::as_array)
        .map(|list| list.len() as u32)
        .unwrap_or(0);

    let record = store::Run {
        id: store::next_run_id(project),
        kind: "review".to_string(),
        started_at: store::now(),
        finished_at: Some(store::now()),
        status: "finished".to_string(),
        model: if mode == "jev" { format!("jev:{model}") } else { model.to_string() },
        prompt: "review/1".to_string(),
        batches: 1,
        batches_done: 1,
        attempts: 1,
        input_tokens: input,
        output_tokens: output,
        cost,
        produced: findings,
        note: answer
            .get("failure")
            .and_then(Value::as_str)
            .map(|detail| format!("some questions went unanswered: {detail}")),
        judge: mode.to_string(),
        pieces: Vec::new(),
    };
    store::save_run(project, &record)?;
    Ok(cost)
}
