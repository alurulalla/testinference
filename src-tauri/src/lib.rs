mod assistant;
mod bdd;
mod cases;
mod code;
mod config;
mod design;
mod import;
mod judge;
mod runner;
mod discuss;
mod drift;
mod explore;
mod extract;
mod git;
mod tcer;
mod secrets;
mod store;
mod worker;

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State};

use crate::worker::{Worker, WorkerStatus};

/// Providers the app knows about. `jev` is not a completion model — it
/// answers typed questions about a state and is used for judging only — so
/// it is never offered for the writing jobs.
const PROVIDERS: [(&str, &str); 5] = [
    ("anthropic", "Anthropic"),
    ("openai", "OpenAI-compatible"),
    ("gemini", "Google Gemini"),
    ("local", "Local model"),
    ("jev", "Jev"),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreInfo {
    pub name: String,
    pub version: String,
    pub platform: String,
    pub arch: String,
    pub tauri_version: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub state: String,
    pub detail: Option<String>,
    pub checked_at_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentAdded {
    pub outcome: String,
    pub record: store::DocumentRecord,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderStatus {
    pub id: String,
    pub label: String,
    pub has_key: bool,
    pub endpoint: Option<String>,
    pub validation: Option<ValidationResult>,
}

/// Last validation outcome per provider. In memory only — a key that was valid
/// an hour ago is not evidence that it is valid now.
#[derive(Default)]
struct Validations(Mutex<HashMap<String, ValidationResult>>);

#[tauri::command]
fn core_info() -> CoreInfo {
    CoreInfo {
        name: "TestInference core".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        tauri_version: tauri::VERSION.to_string(),
    }
}

#[tauri::command]
fn project_list(app: AppHandle) -> Result<Vec<store::ProjectRef>, String> {
    store::list_projects(&app)
}

#[tauri::command]
fn project_create(
    app: AppHandle,
    name: String,
    app_url: String,
    folder: Option<String>,
) -> Result<store::OpenProject, String> {
    store::create_project(&app, &name, &app_url, folder)
}

#[tauri::command]
fn project_open(app: AppHandle, path: String) -> Result<store::OpenProject, String> {
    let opened = store::open_project(&app, &path)?;
    let mut settings = config::load(&app);
    settings.last_project = Some(opened.path.clone());
    let _ = config::save(&app, &settings);
    Ok(opened)
}

/// The project the app was last in, so it opens where you left it.
#[tauri::command]
fn project_last(app: AppHandle) -> Option<store::OpenProject> {
    let settings = config::load(&app);
    settings
        .last_project
        .and_then(|path| store::open_project(&app, &path).ok())
}

/// Reads a document, cuts it into pieces and remembers it.
///
/// The file is copied to this machine's own library, the pieces and their
/// page and paragraph anchors are indexed locally, and only a fingerprint
/// plus the counts go into the project folder.
#[tauri::command]
async fn document_add(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
    source_path: String,
) -> Result<DocumentAdded, String> {
    let source = std::path::PathBuf::from(&source_path);
    let bytes = std::fs::read(&source).map_err(|error| format!("could not read the file: {error}"))?;
    let fingerprint = store::fingerprint(&bytes);
    let project = std::path::PathBuf::from(&project_path);
    let context = store::read_context(&project)?;

    if let Some(existing) = store::find_by_fingerprint(&project, &fingerprint) {
        return Ok(DocumentAdded { outcome: "unchanged".to_string(), record: existing });
    }

    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("document")
        .to_string();
    let id = store::id_for(&name);
    let replacing = store::list_documents(&project).into_iter().any(|record| record.id == id);

    let copy = store::keep_copy(&app, &context.id, &fingerprint, &source)?;
    let extracted = worker
        .call(
            "documents.extract",
            json!({ "path": copy.to_string_lossy() }),
        )
        .await?;

    let chunks: Vec<Value> = extracted
        .get("chunks")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    store::write_chunks(&app, &context.id, &id, &chunks)?;

    let record = store::DocumentRecord {
        id,
        name,
        kind: extracted.get("kind").and_then(Value::as_str).unwrap_or("text").to_string(),
        pages: extracted.get("pages").and_then(Value::as_u64).map(|pages| pages as u32),
        chunks: chunks.len() as u32,
        bytes: bytes.len() as u64,
        fingerprint,
        added_at: store::now(),
        warning: extracted
            .get("warning")
            .and_then(Value::as_str)
            .map(str::to_string),
    };
    store::save_document(&project, &record)?;

    Ok(DocumentAdded {
        outcome: if replacing { "replaced".to_string() } else { "added".to_string() },
        record,
    })
}

#[tauri::command]
fn document_list(project_path: String) -> Vec<store::DocumentRecord> {
    store::list_documents(std::path::Path::new(&project_path))
}

#[tauri::command]
fn document_chunks(
    app: AppHandle,
    project_path: String,
    document_id: String,
    limit: usize,
) -> Result<Vec<Value>, String> {
    let context = store::read_context(std::path::Path::new(&project_path))?;
    store::read_chunks(&app, &context.id, &document_id, limit)
}

#[tauri::command]
fn extract_estimate(app: AppHandle, project_path: String) -> Result<extract::Estimate, String> {
    extract::estimate(&app, &project_path)
}

#[tauri::command]
fn extract_plan(app: AppHandle, project_path: String) -> Result<extract::Delta, String> {
    extract::plan(&app, &project_path)
}

/// `delta` reads only what changed and keeps everything else, with its
/// edits and approvals. Without it, the read starts from scratch.
#[tauri::command]
async fn extract_run(
    app: AppHandle,
    worker: State<'_, Worker>,
    cancel: State<'_, extract::Cancel>,
    project_path: String,
    delta: bool,
) -> Result<store::Run, String> {
    extract::run(app.clone(), &worker, cancel.inner().clone(), project_path, delta).await
}

/// Removes the requirements whose paragraph has gone, once a person has
/// looked at them.
#[tauri::command]
fn requirements_drop_orphans(project_path: String, include_edited: bool) -> Result<u32, String> {
    let project = std::path::Path::new(&project_path);
    let mut dropped = 0;
    for requirement in store::list_requirements(project) {
        if !requirement.orphaned {
            continue;
        }
        // A requirement someone has worked on is not the same as one the
        // app produced and the document then dropped. Its paragraph
        // changed, but the thinking in it was a person's, and a bulk tidy
        // should not be how that disappears.
        if !requirement.edited_by.is_empty() && !include_edited {
            continue;
        }
        store::remove_requirement(project, &requirement.id)?;
        store::record_decision(
            project,
            &store::Decision {
                at: store::now(),
                gate: "requirements".to_string(),
                subject: requirement.id.clone(),
                verdict: "dropped".to_string(),
                comment: Some(if requirement.edited_by.is_empty() {
                    "its paragraph is no longer in the document".to_string()
                } else {
                    "its paragraph is no longer in the document, and it had been edited by hand"
                        .to_string()
                }),
                title: Some(requirement.title.clone()),
            },
        )?;
        dropped += 1;
    }
    Ok(dropped)
}

#[tauri::command]
fn extract_cancel(cancel: State<'_, extract::Cancel>) {
    cancel
        .0
        .store(true, std::sync::atomic::Ordering::Relaxed);
}

#[tauri::command]
fn requirement_list(project_path: String) -> Vec<store::Requirement> {
    store::list_requirements(std::path::Path::new(&project_path))
}

#[tauri::command]
fn run_list(project_path: String) -> Vec<store::Run> {
    store::list_runs(std::path::Path::new(&project_path))
}

/// Writes the wider export — the screen shows four columns, this carries ten,
/// including the source and the anchor.
#[tauri::command]
fn requirements_export(project_path: String) -> Result<String, String> {
    let project = std::path::Path::new(&project_path);
    let csv = store::to_csv(&store::list_requirements(project));
    let target = project.join(".testinference").join("exports").join("requirements.csv");
    store::atomic_write(&target, &csv)?;
    Ok(target.to_string_lossy().to_string())
}

/// Where the documents and the requirements have come apart.
#[tauri::command]
async fn document_drift(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
) -> Result<drift::Report, String> {
    drift::check(&app, &worker, &project_path).await
}

/// Writes that list as something the document's owner can read.
#[tauri::command]
async fn document_drift_export(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
) -> Result<String, String> {
    let report = drift::check(&app, &worker, &project_path).await?;
    drift::write_report(&project_path, &report)
}

/// Says something in a discussion about one requirement.
#[tauri::command]
async fn requirement_discuss(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
    req_id: String,
    said: String,
    history: Value,
) -> Result<discuss::Said, String> {
    discuss::send(&app, &worker, &project_path, &req_id, &said, history).await
}

/// Applies wording a discussion produced, and says what it disturbed.
#[tauri::command]
async fn requirement_apply_wording(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
    req_id: String,
    title: String,
    acceptance: String,
    turns: Value,
) -> Result<discuss::Applied, String> {
    discuss::apply(&app, &worker, &project_path, &req_id, &title, &acceptance, turns).await
}

/// Keeps a discussion that ended in no change.
#[tauri::command]
fn requirement_keep_discussion(
    project_path: String,
    req_id: String,
    turns: Value,
) -> Result<String, String> {
    discuss::keep(&project_path, &req_id, turns)
}

#[tauri::command]
fn requirement_discussions(project_path: String, req_id: String) -> Vec<store::Discussion> {
    store::discussions_for(std::path::Path::new(&project_path), &req_id)
}

/// Walks the application and writes down what is there.
#[tauri::command]
async fn explore_run(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
    pages: u32,
    depth: u32,
    fresh_start: bool,
) -> Result<explore::Explored, String> {
    explore::run(app.clone(), &worker, project_path, pages, depth, fresh_start).await
}

#[tauri::command]
fn explore_map(project_path: String) -> Vec<store::AppPage> {
    store::list_app_pages(std::path::Path::new(&project_path))
}

/// Remembers how to get past the login page. The password goes to the
/// keychain; nothing secret is written into the project.
#[tauri::command]
fn sign_in_set(
    project_path: String,
    username: String,
    password: String,
    submit: String,
    user: String,
    secret: String,
) -> Result<(), String> {
    let project = std::path::Path::new(&project_path);
    let context = store::read_context(project)?;

    if username.trim().is_empty() || password.trim().is_empty() || submit.trim().is_empty() {
        return Err("point all three fields at the login form".to_string());
    }
    if !secret.trim().is_empty() {
        secrets::store(&explore::secret_name(&context.id), secret.trim())?;
    } else if !secrets::has_key(&explore::secret_name(&context.id)) {
        return Err("a test account needs a password".to_string());
    }

    store::set_sign_in(
        project,
        Some(store::SignIn {
            username: username.trim().to_string(),
            password: password.trim().to_string(),
            submit: submit.trim().to_string(),
            user: user.trim().to_string(),
        }),
    )
}

#[tauri::command]
fn sign_in_clear(project_path: String) -> Result<(), String> {
    let project = std::path::Path::new(&project_path);
    let context = store::read_context(project)?;
    let _ = secrets::clear(&explore::secret_name(&context.id));
    store::set_sign_in(project, None)
}

#[tauri::command]
fn code_estimate(app: AppHandle, project_path: String) -> Result<code::CodeEstimate, String> {
    code::estimate(&app, &project_path)
}

#[tauri::command]
async fn code_run(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
) -> Result<code::Generated, String> {
    code::run(app.clone(), &worker, project_path).await
}

/// Runs the written tests and keeps what happened.
#[tauri::command]
async fn tests_run(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
    only: Option<String>,
    watch: bool,
) -> Result<store::Attempt, String> {
    runner::run(app.clone(), &worker, project_path, only, watch).await
}

#[tauri::command]
fn tests_history(project_path: String) -> Vec<store::Attempt> {
    runner::history(&project_path)
}

#[tauri::command]
fn plan_list(project_path: String) -> Vec<store::Plan> {
    store::list_plans(std::path::Path::new(&project_path))
}

#[tauri::command]
fn price_set(
    app: AppHandle,
    model: String,
    input_per_million: f64,
    output_per_million: f64,
) -> Result<(), String> {
    let mut settings = config::load(&app);
    if input_per_million <= 0.0 && output_per_million <= 0.0 {
        settings.prices.remove(&model);
    } else {
        settings.prices.insert(
            model,
            config::Price { input_per_million, output_per_million },
        );
    }
    config::save(&app, &settings)
}

#[tauri::command]
fn design_estimate(app: AppHandle, project_path: String) -> Result<design::DesignEstimate, String> {
    design::estimate(&app, &project_path)
}

#[tauri::command]
async fn design_run(
    app: AppHandle,
    worker: State<'_, Worker>,
    cancel: State<'_, extract::Cancel>,
    project_path: String,
    delta: bool,
) -> Result<store::Run, String> {
    design::run(app.clone(), &worker, cancel.inner().clone(), project_path, delta).await
}

/// How many requirements have no scenarios yet — what a delta design would do.
#[tauri::command]
fn design_plan(project_path: String) -> Value {
    let project = std::path::Path::new(&project_path);
    let covered: std::collections::HashSet<String> = store::list_scenarios(project)
        .into_iter()
        .map(|scenario| scenario.req_id)
        .collect();
    let requirements = store::list_requirements(project);
    let todo = requirements
        .iter()
        .filter(|requirement| !requirement.orphaned && !covered.contains(&requirement.id))
        .count();

    json!({
        "requirements": requirements.len(),
        "withScenarios": covered.len(),
        "toDesign": todo,
        "orphaned": requirements.iter().filter(|requirement| requirement.orphaned).count(),
    })
}

#[tauri::command]
fn scenario_list(project_path: String) -> Vec<store::Scenario> {
    store::list_scenarios(std::path::Path::new(&project_path))
}

/// Gate A: approve, reject, or put back to pending — recorded either way.
#[tauri::command]
fn scenario_decide(
    project_path: String,
    ids: Vec<String>,
    verdict: String,
    comment: Option<String>,
) -> Result<u32, String> {
    design::decide(&project_path, ids, &verdict, comment)
}

/// Riskiest first, and which requirements are missing a failure case.
#[tauri::command]
async fn scenario_review(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
) -> Result<Value, String> {
    let project = std::path::Path::new(&project_path);
    let scenarios = store::list_scenarios(project);
    let requirement_ids: Vec<String> = store::list_requirements(project)
        .into_iter()
        .map(|requirement| requirement.id)
        .collect();

    let as_json: Vec<Value> = scenarios
        .iter()
        .map(|scenario| {
            json!({
                "id": scenario.id,
                "reqId": scenario.req_id,
                "title": scenario.title,
                "class": scenario.class,
                "priority": scenario.priority,
                "autoFeasibility": scenario.auto_feasibility,
                "included": scenario.state != "rejected",
            })
        })
        .collect();

    let ranked = worker.call("engines.rank", json!({ "scenarios": as_json })).await?;
    let balance = worker
        .call(
            "engines.balance",
            json!({ "requirementIds": requirement_ids, "scenarios": as_json }),
        )
        .await?;

    // The same question again, but as judgement rather than counting: the
    // rule only knows whether a failing case exists, not whether the ones
    // written actually cover the requirement.
    let requirements: Vec<Value> = store::list_requirements(project)
        .into_iter()
        .map(|requirement| {
            json!({
                "id": requirement.id,
                "title": requirement.title,
                "acceptance": requirement.acceptance,
            })
        })
        .collect();
    let mut payload = json!({ "requirements": requirements, "scenarios": as_json });
    judge::attach(&mut payload, &judge::settings_for(&app, project));
    let enough = worker.call("decisions.enough", payload).await?;

    Ok(json!({ "ranked": ranked, "balance": balance, "enough": enough }))
}

#[tauri::command]
fn tcer_estimate(app: AppHandle, project_path: String) -> Result<tcer::TcerEstimate, String> {
    tcer::estimate(&app, &project_path)
}

#[tauri::command]
async fn tcer_run(
    app: AppHandle,
    worker: State<'_, Worker>,
    cancel: State<'_, extract::Cancel>,
    project_path: String,
) -> Result<store::Run, String> {
    tcer::run(app.clone(), &worker, cancel.inner().clone(), project_path).await
}

#[tauri::command]
fn tcer_list(project_path: String) -> Vec<store::TcerRow> {
    store::list_tcer(std::path::Path::new(&project_path))
}

/// An SME takes a row out of scope, or says why it is wrong. Either way the
/// row stays, and the totals are recalculated without it.
#[tauri::command]
async fn tcer_amend(
    worker: State<'_, Worker>,
    project_path: String,
    tc_id: String,
    removed: Option<bool>,
    comment: Option<String>,
) -> Result<Vec<store::TcerRow>, String> {
    let project = std::path::Path::new(&project_path);
    let mut row = store::get_tcer(project, &tc_id).ok_or_else(|| format!("no row called {tc_id}"))?;

    if let Some(removed) = removed {
        row.removed = removed;
        store::record_decision(
            project,
            &store::Decision {
                at: store::now(),
                gate: "TCER".to_string(),
                subject: tc_id.clone(),
                verdict: if removed { "removed" } else { "restored" }.to_string(),
                comment: comment.clone(),
                title: Some(row.title.clone()),
            },
        )?;
    }
    if comment.is_some() {
        row.comment = comment;
    }
    store::save_tcer(project, &row)?;

    // A removed row changes the average and the coverage, so everything is
    // scored again rather than patched.
    let rescored = tcer::score(&worker, &store::list_tcer(project)).await?;
    for row in &rescored {
        store::save_tcer(project, row)?;
    }
    Ok(rescored)
}

/// The traceability matrix and the risk ranking, both computed fresh.
#[tauri::command]
async fn coverage_get(worker: State<'_, Worker>, project_path: String) -> Result<Value, String> {
    let project = std::path::Path::new(&project_path);

    let requirements: Vec<Value> = store::list_requirements(project)
        .into_iter()
        .map(|requirement| {
            json!({
                "id": requirement.id,
                "title": requirement.title,
                "acceptance": requirement.acceptance,
                "source": requirement.source.document,
            })
        })
        .collect();

    let scenarios: Vec<Value> = store::list_scenarios(project)
        .into_iter()
        .map(|scenario| {
            json!({
                "id": scenario.id,
                "reqId": scenario.req_id,
                "title": scenario.title,
                "class": scenario.class,
                "priority": scenario.priority,
                "autoFeasibility": scenario.auto_feasibility,
                "included": scenario.state == "approved",
            })
        })
        .collect();

    let rows: Vec<Value> = store::list_tcer(project)
        .into_iter()
        .map(|row| {
            json!({
                "tcId": row.tc_id,
                "scenarioId": row.id,
                "reqId": row.req_id,
                "title": row.title,
                "score": row.score,
                "verdict": row.verdict,
                "removed": row.removed,
            })
        })
        .collect();

    let coverage = worker
        .call(
            "engines.coverage",
            json!({ "requirements": requirements, "scenarios": scenarios, "rows": rows }),
        )
        .await?;
    let risk = worker.call("engines.rank", json!({ "scenarios": scenarios })).await?;
    let needs = worker
        .call("engines.needs", json!({ "scenarios": scenarios, "rows": rows }))
        .await?;

    Ok(json!({ "coverage": coverage, "risk": risk, "needs": needs }))
}

#[tauri::command]
fn cases_estimate(app: AppHandle, project_path: String) -> Result<cases::CasesEstimate, String> {
    cases::estimate(&app, &project_path)
}

#[tauri::command]
async fn cases_run(
    app: AppHandle,
    worker: State<'_, Worker>,
    cancel: State<'_, extract::Cancel>,
    project_path: String,
) -> Result<store::Run, String> {
    cases::run(app.clone(), &worker, cancel.inner().clone(), project_path).await
}

#[tauri::command]
fn case_list(project_path: String) -> Vec<store::TestCase> {
    store::list_cases(std::path::Path::new(&project_path))
}

/// The five checks. Rules only — no model is called.
#[tauri::command]
async fn cases_validate(worker: State<'_, Worker>, project_path: String) -> Result<Value, String> {
    let project = std::path::Path::new(&project_path);
    let payload: Vec<Value> = store::list_cases(project)
        .into_iter()
        .map(|case| {
            json!({
                "id": case.id,
                "scenarioId": case.scenario_id,
                "reqId": case.req_id,
                "title": case.title,
                "type": case.case_type,
                "priority": case.priority,
                "precondition": case.precondition,
                "steps": case.steps,
                "expected": case.expected,
                "autoFeasibility": case.auto_feasibility,
            })
        })
        .collect();

    worker.call("engines.validate", json!({ "cases": payload })).await
}

/// Does each case actually test the scenario it claims to?
///
/// Deliberately separate from the five checks above. Those count whether
/// the fields are filled in, and their score is published arithmetic we
/// reproduce on purpose — a sixth check folded into it would change a
/// number that is meant to match. This sits beside the score instead, and
/// it is the one question nothing can answer without a judge: a case can
/// pass all five checks while testing the wrong thing entirely.
#[tauri::command]
async fn cases_verify(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
) -> Result<Value, String> {
    let project = std::path::Path::new(&project_path);
    let scenarios = store::list_scenarios(project);

    let payload: Vec<Value> = store::list_cases(project)
        .into_iter()
        .map(|case| {
            let scenario = scenarios.iter().find(|entry| entry.id == case.scenario_id);
            json!({
                "id": case.id,
                "title": case.title,
                "steps": case.steps,
                "expected": case.expected,
                "scenario": scenario.map(|scenario| json!({
                    "title": scenario.title,
                    "expected": scenario.expected,
                })),
            })
        })
        .collect();

    if payload.is_empty() {
        return Err("there are no test cases to check yet".to_string());
    }

    let judgement = judge::settings_for(&app, project);
    if judgement.get("mode").and_then(Value::as_str) != Some("jev") {
        return Err(
            "nothing can answer this without a judge — switch judgement to Jev in Settings"
                .to_string(),
        );
    }

    let mut call = json!({ "cases": payload });
    judge::attach(&mut call, &judgement);
    worker.call("decisions.verify", call).await
}

/// Reads a spreadsheet of test cases and says which column is which,
/// before anything is imported.
#[tauri::command]
async fn cases_import_preview(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
    source_path: String,
) -> Result<import::Preview, String> {
    import::preview(&app, &worker, &project_path, &source_path).await
}

#[tauri::command]
async fn cases_import(
    worker: State<'_, Worker>,
    project_path: String,
    source_path: String,
    mapping: std::collections::BTreeMap<String, usize>,
) -> Result<import::Imported, String> {
    import::import(&worker, project_path, source_path, mapping).await
}

/// Proposes a requirement for each untraced case. Writes nothing.
#[tauri::command]
async fn cases_link_propose(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
) -> Result<Value, String> {
    import::propose_links(&app, &worker, &project_path).await
}

/// Applies the links a person accepted.
#[tauri::command]
fn cases_link_apply(project_path: String, links: Vec<(String, String)>) -> Result<u32, String> {
    import::apply_links(&project_path, links)
}

/// Builds the scenario and TCER row each linked case implies, so coverage,
/// risk and the TCER have something to work with.
#[tauri::command]
async fn cases_derive_spine(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
) -> Result<import::Derived, String> {
    import::derive_spine(&app, &worker, &project_path).await
}

#[tauri::command]
fn bdd_estimate(app: AppHandle, project_path: String) -> Result<bdd::BddEstimate, String> {
    bdd::estimate(&app, &project_path)
}

#[tauri::command]
async fn bdd_run(
    app: AppHandle,
    worker: State<'_, Worker>,
    cancel: State<'_, extract::Cancel>,
    project_path: String,
) -> Result<store::Run, String> {
    bdd::run(app.clone(), &worker, cancel.inner().clone(), project_path).await
}

#[tauri::command]
fn bdd_list(project_path: String) -> Vec<store::BddCase> {
    store::list_bdd(std::path::Path::new(&project_path))
}

#[tauri::command]
fn steps_list(project_path: String) -> Vec<String> {
    store::read_library(std::path::Path::new(&project_path))
}

/// Gate B. Only approved cases reach the suites.
#[tauri::command]
fn case_decide(
    project_path: String,
    ids: Vec<String>,
    verdict: String,
    comment: Option<String>,
) -> Result<u32, String> {
    if !matches!(verdict.as_str(), "approved" | "rework" | "rejected" | "pending") {
        return Err(format!("{verdict} is not a verdict"));
    }
    let project = std::path::Path::new(&project_path);
    let mut changed = 0;

    for id in ids {
        let Some(mut case) = store::get_case(project, &id) else { continue };
        case.state = verdict.clone();
        case.decided_at = Some(store::now());
        if comment.is_some() {
            case.comment = comment.clone();
        }
        store::save_case(project, &case)?;
        store::record_decision(
            project,
            &store::Decision {
                at: store::now(),
                gate: "B".to_string(),
                subject: case.id.clone(),
                verdict: verdict.clone(),
                comment: comment.clone(),
                title: Some(case.title.clone()),
            },
        )?;
        changed += 1;
    }
    Ok(changed)
}

#[tauri::command]
fn suite_list(project_path: String) -> Vec<store::Suite> {
    store::list_suites(std::path::Path::new(&project_path))
}

#[tauri::command]
fn suite_toggle(project_path: String, suite_id: String, case_id: String) -> Result<store::Suite, String> {
    store::toggle_suite(std::path::Path::new(&project_path), &suite_id, &case_id)
}

/// Fills a suite from the risk bands, which is the sensible default: band P1
/// belongs in the release suite.
#[tauri::command]
async fn suite_fill_from_risk(
    worker: State<'_, Worker>,
    project_path: String,
    suite_id: String,
    band: String,
) -> Result<store::Suite, String> {
    let project = std::path::Path::new(&project_path);
    let scenarios: Vec<Value> = store::list_scenarios(project)
        .into_iter()
        .map(|scenario| {
            json!({
                "id": scenario.id,
                "reqId": scenario.req_id,
                "title": scenario.title,
                "class": scenario.class,
                "priority": scenario.priority,
                "autoFeasibility": scenario.auto_feasibility,
                "included": scenario.state == "approved",
            })
        })
        .collect();

    let ranked = worker.call("engines.rank", json!({ "scenarios": scenarios })).await?;
    let wanted: std::collections::HashSet<String> = ranked
        .get("ranked")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter(|entry| entry.get("band").and_then(Value::as_str) == Some(band.as_str()))
                .filter_map(|entry| entry.get("id").and_then(Value::as_str).map(str::to_string))
                .collect()
        })
        .unwrap_or_default();

    let mut suite = store::list_suites(project)
        .into_iter()
        .find(|suite| suite.id == suite_id)
        .ok_or_else(|| format!("no suite called {suite_id}"))?;

    for case in store::list_cases(project) {
        if case.state == "approved" && wanted.contains(&case.scenario_id) && !suite.cases.contains(&case.id) {
            suite.cases.push(case.id);
        }
    }
    suite.cases.sort();
    store::save_suite(project, &suite)?;
    Ok(suite)
}

/// Exports the approved cases and stamps each with a receipt.
///
/// This writes the receipt and the export file; it does not call an ALM API
/// yet, and the screen says so rather than implying a real integration.
#[tauri::command]
fn publish_run(project_path: String, target: String) -> Result<Value, String> {
    let project = std::path::Path::new(&project_path);
    let stamp = store::now();
    let short: String = stamp.chars().filter(|c| c.is_ascii_digit()).take(8).collect();
    let label = target.to_uppercase();

    let mut published = 0u32;
    let mut rows = Vec::new();
    for (position, mut case) in store::list_cases(project).into_iter().enumerate() {
        if case.state != "approved" {
            continue;
        }
        let receipt = format!("{label}-{short}-{:03}", position + 1);
        case.publish_id = Some(receipt.clone());
        case.publish_target = Some(target.clone());
        case.published_at = Some(stamp.clone());
        store::save_case(project, &case)?;
        rows.push(json!({ "id": case.id, "title": case.title, "receipt": receipt }));
        published += 1;
    }

    if published == 0 {
        return Err("no approved cases to publish".to_string());
    }

    let export = serde_json::to_string_pretty(&json!({
        "target": target,
        "publishedAt": stamp,
        "cases": rows,
    }))
    .map_err(|error| error.to_string())?;
    let path = project.join(".testinference").join("exports").join(format!("publish-{short}.json"));
    store::atomic_write(&path, &export)?;

    Ok(json!({ "published": published, "target": target, "file": path.to_string_lossy() }))
}

/// Automatable, partial or manual — rules only.
#[tauri::command]
async fn feasibility_get(worker: State<'_, Worker>, project_path: String) -> Result<Value, String> {
    let project = std::path::Path::new(&project_path);
    let payload: Vec<Value> = store::list_cases(project)
        .into_iter()
        .filter(|case| case.state == "approved")
        .map(|case| {
            json!({
                "id": case.id,
                "title": case.title,
                "type": case.case_type,
                "priority": case.priority,
                "autoFeasibility": case.auto_feasibility,
                "scenarioId": case.scenario_id,
                "reqId": case.req_id,
                "precondition": case.precondition,
                "steps": case.steps,
                "expected": case.expected,
            })
        })
        .collect();

    worker.call("engines.classify", json!({ "cases": payload })).await
}

#[tauri::command]
fn git_status(project_path: String) -> git::GitStatus {
    git::status(&project_path)
}

#[tauri::command]
fn git_commit(
    project_path: String,
    message: String,
    include_context: bool,
    push: bool,
) -> Result<git::GitResult, String> {
    git::commit(&project_path, &message, include_context, push)
}

#[tauri::command]
async fn assistant_ask(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
    question: String,
    history: Value,
) -> Result<assistant::Answer, String> {
    assistant::ask(&app, &worker, &project_path, &question, history).await
}

/// Applies a proposal the person agreed to. The model never reaches this.
#[tauri::command]
fn assistant_apply(project_path: String, proposal: Value) -> Result<String, String> {
    assistant::apply(&project_path, &proposal)
}

#[tauri::command]
fn assistant_undo(project_path: String) -> Result<String, String> {
    assistant::undo(&project_path)
}

/// The counts the rail and the progress strip need, in one call.
#[tauri::command]
fn project_edit(
    app: AppHandle,
    path: String,
    name: String,
    app_url: String,
) -> Result<store::OpenProject, String> {
    store::edit_project(&app, &path, &name, &app_url)
}

#[tauri::command]
fn project_summary(project_path: String) -> Value {
    let project = std::path::Path::new(&project_path);
    let requirements = store::list_requirements(project);
    let scenarios = store::list_scenarios(project);
    let rows = store::list_tcer(project);
    let cases = store::list_cases(project);

    json!({
        "documents": store::list_documents(project).len(),
        "requirements": requirements.len(),
        "vague": requirements.iter().filter(|r| r.flag == "vague").count(),
        "orphaned": requirements.iter().filter(|r| r.orphaned).count(),
        "scenarios": scenarios.len(),
        "pendingGateA": scenarios.iter().filter(|s| s.state == "pending").count(),
        "approvedScenarios": scenarios.iter().filter(|s| s.state == "approved").count(),
        "rows": rows.iter().filter(|r| !r.removed).count(),
        "cases": cases.len(),
        "pendingGateB": cases.iter().filter(|c| c.state == "pending").count(),
        "approvedCases": cases.iter().filter(|c| c.state == "approved").count(),
        "published": cases.iter().filter(|c| c.publish_id.is_some()).count(),
        "bdd": store::list_bdd(project).len(),
        "steps": store::read_library(project).len(),
        "decisions": store::count_decisions(project),
    })
}

#[tauri::command]
fn worker_status(worker: State<'_, Worker>) -> WorkerStatus {
    worker.status()
}

#[tauri::command]
async fn worker_ping(worker: State<'_, Worker>) -> Result<Value, String> {
    worker.call("worker.ping", json!({})).await
}

#[tauri::command]
async fn worker_crash(worker: State<'_, Worker>) -> Result<Value, String> {
    // Deliberately kills the worker so the supervisor's restart path is
    // exercised by hand rather than only when something goes wrong for real.
    worker.call("worker.crash", json!({})).await
}

#[tauri::command]
async fn start_demo_job(worker: State<'_, Worker>) -> Result<Value, String> {
    worker.call("job.start", json!({ "kind": "demo" })).await
}

#[tauri::command]
async fn cancel_job(worker: State<'_, Worker>, job_id: String) -> Result<Value, String> {
    worker.call("job.cancel", json!({ "jobId": job_id })).await
}

#[tauri::command]
fn provider_list(app: AppHandle, validations: State<'_, Validations>) -> Vec<ProviderStatus> {
    let settings = config::load(&app);
    let seen = validations.0.lock().expect("validation lock poisoned");

    PROVIDERS
        .iter()
        .map(|(id, label)| ProviderStatus {
            id: (*id).to_string(),
            label: (*label).to_string(),
            has_key: secrets::has_key(id),
            endpoint: match *id {
                "local" => settings.local_endpoint.clone(),
                "jev" => settings.jev_endpoint.clone(),
                _ => None,
            },
            validation: seen.get(*id).cloned(),
        })
        .collect()
}

#[tauri::command]
fn provider_set_key(provider: String, key: String) -> Result<(), String> {
    if key.trim().is_empty() {
        return Err("that key is empty".to_string());
    }
    secrets::store(&provider, key.trim())
}

#[tauri::command]
fn provider_clear_key(provider: String, validations: State<'_, Validations>) -> Result<(), String> {
    validations
        .0
        .lock()
        .expect("validation lock poisoned")
        .remove(&provider);
    secrets::clear(&provider)
}

#[tauri::command]
fn provider_set_endpoint(app: AppHandle, provider: String, endpoint: String) -> Result<(), String> {
    let mut settings = config::load(&app);
    let trimmed = endpoint.trim();
    let value = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };

    match provider.as_str() {
        "local" => settings.local_endpoint = value,
        "openai" => settings.openai_endpoint = value,
        "jev" => settings.jev_endpoint = value,
        other => return Err(format!("{other} does not take an endpoint")),
    }
    config::save(&app, &settings)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub label: String,
    pub model: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub jobs: Vec<Job>,
    pub budgets: config::Budgets,
    pub capabilities: std::collections::BTreeMap<String, Value>,
    pub prices: std::collections::BTreeMap<String, config::Price>,
    pub local_endpoint: Option<String>,
    pub openai_endpoint: Option<String>,
    pub jev_endpoint: Option<String>,
    pub jev_model: Option<String>,
    pub private_mode: bool,
}

#[tauri::command]
fn settings_get(app: AppHandle) -> Settings {
    let settings = config::load(&app);
    Settings {
        jobs: config::JOBS
            .iter()
            .map(|(id, label)| Job {
                id: (*id).to_string(),
                label: (*label).to_string(),
                model: settings.assignments.get(*id).cloned(),
            })
            .collect(),
        budgets: settings.budgets.clone(),
        capabilities: settings.capabilities.clone(),
        prices: settings.prices.clone(),
        local_endpoint: settings.local_endpoint.clone(),
        openai_endpoint: settings.openai_endpoint.clone(),
        jev_endpoint: settings.jev_endpoint.clone(),
        jev_model: settings.jev_model.clone(),
        private_mode: settings.private_mode,
    }
}

/// Which judgement mode this project is on, and whether it can actually run.
/// Takes a project off the list. With `delete_files`, its files go to the
/// Trash — never straight out, and never the folder the user chose around
/// it. See `store::remove_project`.
#[tauri::command]
fn project_remove(app: AppHandle, path: String, delete_files: bool) -> Result<store::Removed, String> {
    let removed = store::remove_project(&app, &path, delete_files)?;

    // Do not reopen a project that is no longer there.
    let mut settings = config::load(&app);
    if settings.last_project.as_deref() == Some(path.as_str()) {
        settings.last_project = None;
        config::save(&app, &settings)?;
    }
    Ok(removed)
}

#[tauri::command]
fn judge_state(app: AppHandle, project_path: String) -> judge::Readiness {
    judge::readiness(&app, &project_path)
}

#[tauri::command]
fn judge_set_mode(project_path: String, mode: String) -> Result<(), String> {
    store::set_judge_mode(std::path::Path::new(&project_path), &mode)
}

/// Names the Jev model to ask for. Empty clears it.
#[tauri::command]
fn jev_set_model(app: AppHandle, model: String) -> Result<(), String> {
    let mut settings = config::load(&app);
    let trimmed = model.trim();
    settings.jev_model = if trimmed.is_empty() { None } else { Some(trimmed.to_string()) };
    config::save(&app, &settings)
}

/// Reads every requirement and says what looks wrong with the set.
#[tauri::command]
async fn judge_review(
    app: AppHandle,
    worker: State<'_, Worker>,
    project_path: String,
) -> Result<Value, String> {
    judge::review(app.clone(), &worker, project_path).await
}

#[tauri::command]
fn assignment_set(app: AppHandle, job: String, model: String) -> Result<(), String> {
    if !config::JOBS.iter().any(|(id, _)| *id == job) {
        return Err(format!("there is no job called {job}"));
    }
    let mut settings = config::load(&app);
    if model.trim().is_empty() {
        settings.assignments.remove(&job);
    } else {
        settings.assignments.insert(job, model);
    }
    config::save(&app, &settings)
}

#[tauri::command]
fn budgets_set(app: AppHandle, per_run: f64, monthly: f64, max_parallel: u32) -> Result<(), String> {
    if per_run <= 0.0 || monthly <= 0.0 || max_parallel == 0 {
        return Err("budgets have to be above zero".to_string());
    }
    let mut settings = config::load(&app);
    settings.budgets = config::Budgets { per_run, monthly, max_parallel };
    config::save(&app, &settings)
}

/// Asks the provider which models this key can actually reach. Model names
/// change every few months, so nothing is hardcoded.
#[tauri::command]
async fn models_list(
    app: AppHandle,
    worker: State<'_, Worker>,
    provider: String,
) -> Result<Value, String> {
    let settings = config::load(&app);
    let key = secrets::read(&provider)?;
    let endpoint = match provider.as_str() {
        "local" => settings.local_endpoint.clone(),
        "openai" => settings.openai_endpoint.clone(),
        _ => None,
    };

    worker
        .call(
            "models.list",
            json!({ "provider": provider, "key": key, "endpoint": endpoint }),
        )
        .await
}

/// Runs a small real request so we know what a model can do before anything
/// depends on it. The result is remembered against that model.
#[tauri::command]
async fn model_self_test(
    app: AppHandle,
    worker: State<'_, Worker>,
    model: String,
    context_window: Option<u64>,
) -> Result<Value, String> {
    let provider = model.split(':').next().unwrap_or_default().to_string();
    let settings = config::load(&app);
    let key = secrets::read(&provider)?;
    let endpoint = match provider.as_str() {
        "local" => settings.local_endpoint.clone(),
        "openai" => settings.openai_endpoint.clone(),
        _ => None,
    };

    let answer = worker
        .call(
            "models.selfTest",
            json!({
                "model": model,
                "key": key,
                "endpoint": endpoint,
                "contextWindow": context_window,
            }),
        )
        .await?;

    let mut settings = config::load(&app);
    settings.capabilities.insert(model, answer.clone());
    config::save(&app, &settings)?;

    Ok(answer)
}

/// Checks a key by actually using it. The key goes from the keychain straight
/// to the worker, which owns every outbound provider call; it is never
/// returned to the renderer and never written to disk.
#[tauri::command]
async fn provider_validate(
    app: AppHandle,
    worker: State<'_, Worker>,
    validations: State<'_, Validations>,
    provider: String,
) -> Result<ValidationResult, String> {
    let settings = config::load(&app);
    let key = secrets::read(&provider)?;

    if provider != "local" && key.is_none() {
        return Ok(remember(
            &validations,
            &provider,
            ValidationResult {
                state: "missing".to_string(),
                detail: Some("no key saved yet".to_string()),
                checked_at_ms: now_ms(),
            },
        ));
    }

    let answer = worker
        .call(
            "providers.validate",
            json!({
                "provider": provider,
                "key": key,
                "endpoint": match provider.as_str() {
                    "jev" => settings.jev_endpoint.clone(),
                    _ => settings.local_endpoint.clone(),
                },
            }),
        )
        .await?;

    let result = ValidationResult {
        state: answer
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("error")
            .to_string(),
        detail: answer
            .get("detail")
            .and_then(Value::as_str)
            .map(str::to_string),
        checked_at_ms: now_ms(),
    };

    Ok(remember(&validations, &provider, result))
}

fn remember(
    validations: &State<'_, Validations>,
    provider: &str,
    result: ValidationResult,
) -> ValidationResult {
    validations
        .0
        .lock()
        .expect("validation lock poisoned")
        .insert(provider.to_string(), result.clone());
    result
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let worker = Worker::spawn(app.handle().clone());
            app.manage(worker);
            app.manage(Validations::default());
            app.manage(extract::Cancel::default());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_info,
            project_list,
            project_create,
            project_open,
            project_last,
            project_summary,
            project_edit,
            document_add,
            document_list,
            document_chunks,
            extract_estimate,
            extract_plan,
            requirements_drop_orphans,
            extract_run,
            extract_cancel,
            requirement_list,
            project_remove,
            judge_state,
            judge_set_mode,
            judge_review,
            jev_set_model,
            design_estimate,
            design_plan,
            design_run,
            scenario_list,
            scenario_decide,
            scenario_review,
            tcer_estimate,
            tcer_run,
            tcer_list,
            tcer_amend,
            coverage_get,
            cases_estimate,
            cases_run,
            case_list,
            cases_import_preview,
            cases_import,
            cases_link_propose,
            cases_link_apply,
            cases_derive_spine,
            cases_validate,
            cases_verify,
            bdd_estimate,
            bdd_run,
            bdd_list,
            steps_list,
            case_decide,
            suite_list,
            suite_toggle,
            suite_fill_from_risk,
            publish_run,
            feasibility_get,
            git_status,
            git_commit,
            assistant_ask,
            assistant_apply,
            assistant_undo,
            run_list,
            requirements_export,
            requirement_discuss,
            requirement_apply_wording,
            requirement_keep_discussion,
            requirement_discussions,
            tests_run,
            tests_history,
            plan_list,
            code_estimate,
            code_run,
            explore_run,
            explore_map,
            sign_in_set,
            sign_in_clear,
            document_drift,
            document_drift_export,
            price_set,
            worker_status,
            worker_ping,
            worker_crash,
            start_demo_job,
            cancel_job,
            provider_list,
            provider_set_key,
            provider_clear_key,
            provider_set_endpoint,
            provider_validate,
            settings_get,
            assignment_set,
            budgets_set,
            models_list,
            model_self_test
        ])
        .run(tauri::generate_context!())
        .expect("error while running TestInference");
}
