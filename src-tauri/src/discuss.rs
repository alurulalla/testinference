//! Talking a requirement into shape.
//!
//! The conversation happens beside the requirement, in the detail column,
//! because that is where someone is already looking when they notice the
//! wording is wrong.
//!
//! Two rules hold this together. Nothing is applied without a person seeing
//! the before and the after. And when wording does change, everything built
//! from the old wording is marked rather than deleted or quietly kept — a
//! test approved against "search should be fast" was approved against a
//! sentence that no longer exists, and the record has to say so.

use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::store;
use crate::worker::Worker;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Said {
    pub reply: String,
    /// What it wants to know before it can propose anything.
    pub question: Option<String>,
    pub proposal: Option<Value>,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// How many tests this requirement already has, and what they are called.
///
/// The titles matter: without them the discussion says it cannot see the
/// test suite, which is not true — it is sitting in the same folder.
const NAMED: usize = 25;

fn built_on(project: &Path, req_id: &str) -> (u32, u32, u32, Vec<String>) {
    let scenarios = store::list_scenarios(project)
        .iter()
        .filter(|scenario| scenario.req_id == req_id)
        .count() as u32;
    let cases: Vec<store::TestCase> = store::list_cases(project)
        .into_iter()
        .filter(|case| case.req_id == req_id)
        .collect();
    let approved = cases.iter().filter(|case| case.state == "approved").count() as u32;
    let titles = cases
        .iter()
        .take(NAMED)
        .map(|case| format!("{} ({}): {}", case.id, case.state, case.title))
        .collect();
    (scenarios, cases.len() as u32, approved, titles)
}

/// The paragraph a requirement was read from, if it is still in a document.
fn paragraph_for(app: &AppHandle, project: &Path, piece: &str) -> String {
    let Ok(context) = store::read_context(project) else { return String::new() };
    for document in store::list_documents(project) {
        let Ok(chunks) = store::read_chunks(app, &context.id, &document.id, 100_000) else {
            continue;
        };
        for chunk in chunks {
            if chunk.get("hash").and_then(Value::as_str) == Some(piece) {
                return chunk.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
            }
        }
    }
    String::new()
}

pub async fn send(
    app: &AppHandle,
    worker: &Worker,
    project_path: &str,
    req_id: &str,
    said: &str,
    history: Value,
) -> Result<Said, String> {
    let project = Path::new(project_path);
    let Some(requirement) = store::list_requirements(project).into_iter().find(|entry| entry.id == req_id)
    else {
        return Err(format!("there is no requirement called {req_id}"));
    };

    let settings = crate::config::load(app);
    let model = settings
        .assignments
        .get("summarise")
        .or_else(|| settings.assignments.get("read-documents"))
        .cloned()
        .ok_or_else(|| {
            "assign a model to summaries in Settings — a discussion needs one".to_string()
        })?;

    let provider = model.split(':').next().unwrap_or_default().to_string();
    let endpoint = match provider.as_str() {
        "local" => settings.local_endpoint.clone(),
        "openai" => settings.openai_endpoint.clone(),
        _ => None,
    };
    let key = crate::secrets::read(&provider)?;

    let (scenarios, cases, approved, titles) = built_on(project, req_id);

    let answer = worker
        .call(
            "requirement.discuss",
            json!({
                "model": model,
                "key": key,
                "endpoint": endpoint,
                "said": said,
                "history": history,
                "requirement": {
                    "id": requirement.id,
                    "title": requirement.title,
                    "acceptance": requirement.acceptance,
                    "flag": requirement.flag,
                    "clarification": requirement.clarification,
                    "paragraph": paragraph_for(app, project, &requirement.source.piece),
                },
                "built": {
                    "scenarios": scenarios,
                    "cases": cases,
                    "approved": approved,
                    "titles": titles,
                },
            }),
        )
        .await?;

    Ok(Said {
        reply: answer.get("reply").and_then(Value::as_str).unwrap_or_default().to_string(),
        question: answer.get("question").and_then(Value::as_str).map(str::to_string),
        proposal: answer.get("proposal").cloned().filter(|value| !value.is_null()),
        input_tokens: answer.get("inputTokens").and_then(Value::as_u64).unwrap_or(0),
        output_tokens: answer.get("outputTokens").and_then(Value::as_u64).unwrap_or(0),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Applied {
    pub version: u32,
    /// wording · sharper · different
    pub change: String,
    /// True when the new wording still requires everything the old one did.
    pub keeps: bool,
    pub scenarios_stale: u32,
    pub cases_stale: u32,
    pub approved_stale: u32,
    pub discussion: String,
    pub note: String,
}

/// Applies new wording, bumps the version, and says what that disturbed.
///
/// Nothing downstream is deleted and no approval is withdrawn. The records
/// keep the version they were built from, which is now behind, and the
/// screens can say so.
pub async fn apply(
    app: &AppHandle,
    worker: &Worker,
    project_path: &str,
    req_id: &str,
    title: &str,
    acceptance: &str,
    turns: Value,
) -> Result<Applied, String> {
    let project = Path::new(project_path);
    let Some(mut requirement) =
        store::list_requirements(project).into_iter().find(|entry| entry.id == req_id)
    else {
        return Err(format!("there is no requirement called {req_id}"));
    };
    if title.trim().is_empty() {
        return Err("a requirement needs a title".to_string());
    }

    let before = store::Wording {
        title: requirement.title.clone(),
        acceptance: requirement.acceptance.clone(),
    };
    let after = store::Wording {
        title: title.trim().to_string(),
        acceptance: acceptance.trim().to_string(),
    };
    if before.title == after.title && before.acceptance == after.acceptance {
        return Err("that is what it already says".to_string());
    }

    // How far has it moved, and did anything fall out of it?
    let mut call = json!({ "before": before, "after": after });
    crate::judge::attach(&mut call, &crate::judge::settings_for(app, project));
    let verdict = worker.call("decisions.change", call).await?;
    let change = verdict
        .get("answer")
        .and_then(|answer| answer.get("kind"))
        .and_then(Value::as_str)
        .unwrap_or("different")
        .to_string();
    let keeps = verdict
        .get("answer")
        .and_then(|answer| answer.get("keeps"))
        .and_then(Value::as_bool)
        .unwrap_or(true);

    // A typo does not make eleven test cases suspect.
    let disturbs = change != "wording";
    if disturbs {
        requirement.version += 1;
    }
    requirement.title = after.title.clone();
    requirement.acceptance = after.acceptance.clone();
    // Wording that can be tested is no longer flagged as vague, and the
    // question that was asked about it has been answered.
    if !after.acceptance.is_empty() {
        requirement.flag = "clear".to_string();
        requirement.clarification = None;
    }
    requirement.edited_by.push(format!("discussed {}", store::now()));
    if requirement.as_extracted.is_none() {
        requirement.as_extracted = Some(before.clone());
    }
    store::save_requirement(project, &requirement)?;

    // Nothing is rewritten downstream. What was built from the old wording
    // keeps saying so, and the screens compare the two numbers.
    let scenarios_stale = store::list_scenarios(project)
        .iter()
        .filter(|scenario| scenario.req_id == req_id && scenario.req_version < requirement.version)
        .count() as u32;
    let stale_cases: Vec<store::TestCase> = store::list_cases(project)
        .into_iter()
        .filter(|case| case.req_id == req_id && case.req_version < requirement.version)
        .collect();
    let approved_stale = stale_cases.iter().filter(|case| case.state == "approved").count() as u32;

    // A person changing a requirement's wording is a decision, and until
    // now it was the one human act that never reached the decision log.
    // Scenarios get an entry at Gate A and cases at Gate B; a requirement
    // only got one when an orphan was dropped. So the log could say "0
    // decisions" on a project where someone had spent an afternoon
    // settling the wording.
    store::record_decision(
        project,
        &store::Decision {
            at: store::now(),
            gate: "requirements".to_string(),
            subject: req_id.to_string(),
            verdict: format!("reworded · {change}"),
            comment: Some(format!(
                "was: {} — {}",
                before.title,
                if before.acceptance.is_empty() { "no acceptance" } else { &before.acceptance }
            )),
            title: Some(after.title.clone()),
        },
    )?;

    let discussion = store::Discussion {
        id: store::next_discussion_id(project),
        req_id: req_id.to_string(),
        started_at: store::now(),
        turns: serde_json::from_value(turns).unwrap_or_default(),
        produced_version: Some(requirement.version),
        before: Some(before),
        after: Some(after),
        change: Some(change.clone()),
        model: "discussed".to_string(),
        prompt: "discuss@v1".to_string(),
        input_tokens: 0,
        output_tokens: 0,
    };
    store::save_discussion(project, &discussion)?;

    // Nothing built on it yet is the common case for a requirement that was
    // too vague to design from: it was skipped as untestable, and now it is
    // not. Saying so beats a bare "0 scenarios".
    let (total_scenarios, total_cases, _, _) = built_on(project, req_id);
    if total_scenarios == 0 && total_cases == 0 {
        let note = if requirement.flag == "clear" {
            "Nothing has been designed from this requirement yet. Now that it is testable, \
             Test Design → Scenarios will pick it up."
                .to_string()
        } else {
            "Nothing has been designed from this requirement yet, and it is still flagged vague, \
             so designing will skip it."
                .to_string()
        };
        return Ok(Applied {
            version: requirement.version,
            change,
            keeps,
            scenarios_stale: 0,
            cases_stale: 0,
            approved_stale: 0,
            discussion: discussion.id,
            note,
        });
    }

    let note = match change.as_str() {
        "wording" => "Only the wording changed, so nothing built on this was disturbed.".to_string(),
        "sharper" => format!(
            "This says the same thing more precisely. The {scenarios_stale} scenarios and {} cases written from the older wording are still valid, but may no longer be enough.",
            stale_cases.len()
        ),
        _ => format!(
            "This asks for something different. {scenarios_stale} scenarios and {} cases were written from the older wording.",
            stale_cases.len()
        ),
    };
    let note = if keeps {
        note
    } else {
        format!("{note} Careful: the new wording appears to drop something the old one covered.")
    };

    Ok(Applied {
        version: requirement.version,
        change,
        keeps,
        scenarios_stale,
        cases_stale: stale_cases.len() as u32,
        approved_stale,
        discussion: discussion.id,
        note,
    })
}

/// Records a discussion that changed nothing. Someone looked at this and
/// was satisfied, which is worth as much as a change.
pub fn keep(project_path: &str, req_id: &str, turns: Value) -> Result<String, String> {
    let project = Path::new(project_path);
    let discussion = store::Discussion {
        id: store::next_discussion_id(project),
        req_id: req_id.to_string(),
        started_at: store::now(),
        turns: serde_json::from_value(turns).unwrap_or_default(),
        produced_version: None,
        before: None,
        after: None,
        change: None,
        model: "discussed".to_string(),
        prompt: "discuss@v1".to_string(),
        input_tokens: 0,
        output_tokens: 0,
    };
    store::save_discussion(project, &discussion)?;
    Ok(discussion.id)
}
