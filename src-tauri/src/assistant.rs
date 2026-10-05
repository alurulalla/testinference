//! The assistant: context in, answer out, and a proposal a person applies.
//!
//! Two things make this safe enough to ship. The context is selected rather
//! than dumped, and the screen is told what was left out. And nothing the
//! model returns is applied here — applying is a separate command, after a
//! person has read the proposal, with the previous values saved so it can be
//! undone.

use std::collections::HashSet;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::config;
use crate::store;
use crate::worker::Worker;

/// How many of each kind of record the assistant may see at once. Enough to
/// answer a real question, small enough to stay affordable.
const SLICE: usize = 40;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub answer: String,
    pub proposal: Option<Value>,
    pub destructive: bool,
    /// What the assistant was shown, and what it was not.
    pub context_note: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

#[derive(Debug, Serialize, Deserialize)]
struct Undo {
    at: String,
    action: String,
    requirements: Vec<store::Requirement>,
    scenarios: Vec<store::Scenario>,
    cases: Vec<store::TestCase>,
    tcer: Vec<store::TcerRow>,
}

/// Picks the records worth showing for this question: anything whose
/// identifier is mentioned, anything whose words overlap, then the rest in
/// order until the slice is full.
fn context_for(project: &Path, question: &str) -> (String, String) {
    let lowered = question.to_lowercase();
    let words: HashSet<String> = lowered
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| word.len() > 3)
        .map(str::to_string)
        .collect();

    let mentions = |text: &str| {
        let text = text.to_lowercase();
        words.iter().any(|word| text.contains(word.as_str()))
    };

    let requirements = store::list_requirements(project);
    let scenarios = store::list_scenarios(project);
    let cases = store::list_cases(project);
    let rows = store::list_tcer(project);

    let pick = |relevant: Vec<String>, all: usize| -> (Vec<String>, usize) {
        let shown = relevant.len().min(SLICE);
        (relevant.into_iter().take(SLICE).collect(), all - shown)
    };

    let (requirement_lines, requirements_left) = pick(
        requirements
            .iter()
            .filter(|requirement| {
                words.is_empty() || mentions(&requirement.id) || mentions(&requirement.title)
            })
            .chain(requirements.iter())
            .map(|requirement| {
                format!(
                    "{} [{}] {} — {}",
                    requirement.id,
                    requirement.flag,
                    requirement.title,
                    requirement.acceptance
                )
            })
            .collect::<Vec<_>>()
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect(),
        requirements.len(),
    );

    let (scenario_lines, scenarios_left) = pick(
        scenarios
            .iter()
            .filter(|scenario| words.is_empty() || mentions(&scenario.id) || mentions(&scenario.title))
            .chain(scenarios.iter())
            .map(|scenario| {
                format!(
                    "{} [{} {} {}] {} (from {})",
                    scenario.id,
                    scenario.state,
                    scenario.class,
                    scenario.priority,
                    scenario.title,
                    scenario.req_id
                )
            })
            .collect::<Vec<_>>()
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect(),
        scenarios.len(),
    );

    let (case_lines, cases_left) = pick(
        cases
            .iter()
            .filter(|case| words.is_empty() || mentions(&case.id) || mentions(&case.title))
            .chain(cases.iter())
            .map(|case| format!("{} [{}] {} (from {})", case.id, case.state, case.title, case.req_id))
            .collect::<Vec<_>>()
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>()
            .into_iter()
            .collect(),
        cases.len(),
    );

    let context = format!(
        "Counts: {} requirements, {} scenarios, {} rows, {} test cases.\n\nREQUIREMENTS\n{}\n\nSCENARIOS\n{}\n\nTEST CASES\n{}",
        requirements.len(),
        scenarios.len(),
        rows.len(),
        cases.len(),
        requirement_lines.join("\n"),
        scenario_lines.join("\n"),
        case_lines.join("\n"),
    );

    let left_out = requirements_left + scenarios_left + cases_left;
    let note = if left_out == 0 {
        "it saw everything in this project".to_string()
    } else {
        format!(
            "it saw {} requirements, {} scenarios and {} cases — {left_out} records were left out, so ask about them by name if you need them",
            requirement_lines.len(),
            scenario_lines.len(),
            case_lines.len()
        )
    };

    (context, note)
}

pub async fn ask(
    app: &AppHandle,
    worker: &Worker,
    project_path: &str,
    question: &str,
    history: Value,
) -> Result<Answer, String> {
    let project = Path::new(project_path);
    let settings = config::load(app);
    let model = settings
        .assignments
        .get("summarise")
        .or_else(|| settings.assignments.get("read-documents"))
        .cloned()
        .ok_or_else(|| "assign a model to summaries first".to_string())?;

    let provider = model.split(':').next().unwrap_or_default().to_string();
    let key = crate::secrets::read(&provider)?;
    let endpoint = match provider.as_str() {
        "local" => settings.local_endpoint.clone(),
        "openai" => settings.openai_endpoint.clone(),
        _ => None,
    };

    let (context, context_note) = context_for(project, question);

    let answer = worker
        .call(
            "assistant.ask",
            json!({
                "model": model,
                "key": key,
                "endpoint": endpoint,
                "question": question,
                "context": context,
                "history": history,
            }),
        )
        .await?;

    let proposal = answer.get("proposal").cloned().filter(|value| !value.is_null());
    let action = proposal
        .as_ref()
        .and_then(|proposal| proposal.get("action"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    // The list of actions that always need confirming is never overruled.
    // A judge can only add to it: an action whose name looks harmless but
    // whose effect, in this request, would throw work away.
    let known = matches!(action.as_str(), "delete_requirements" | "remove_tcer");
    let destructive = if known || action.is_empty() {
        known
    } else {
        let mut gate = json!({ "action": action, "message": question, "known": false });
        crate::judge::attach(&mut gate, &crate::judge::settings_for(&app, project));
        worker
            .call("decisions.gateAction", gate)
            .await
            .ok()
            .and_then(|verdict| verdict.get("answer").and_then(Value::as_bool))
            // A judge that cannot be reached does not get to wave it through.
            .unwrap_or(known)
    };

    Ok(Answer {
        answer: answer
            .get("answer")
            .and_then(Value::as_str)
            .unwrap_or("no answer came back")
            .to_string(),
        proposal,
        destructive,
        context_note,
        input_tokens: answer.get("inputTokens").and_then(Value::as_u64).unwrap_or(0),
        output_tokens: answer.get("outputTokens").and_then(Value::as_u64).unwrap_or(0),
    })
}

/// Applies a proposal a person has agreed to, after saving what it replaces.
pub fn apply(project_path: &str, proposal: &Value) -> Result<String, String> {
    let project = Path::new(project_path);
    let action = proposal
        .get("action")
        .and_then(Value::as_str)
        .ok_or_else(|| "that proposal has no action".to_string())?;
    let ids: Vec<String> = proposal
        .get("ids")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(|id| id.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    if ids.is_empty() {
        return Err("that proposal names nothing to change".to_string());
    }

    // Everything the change touches, saved first so it can be put back.
    let undo = Undo {
        at: store::now(),
        action: action.to_string(),
        requirements: store::list_requirements(project)
            .into_iter()
            .filter(|requirement| ids.contains(&requirement.id))
            .collect(),
        scenarios: store::list_scenarios(project)
            .into_iter()
            .filter(|scenario| ids.contains(&scenario.id))
            .collect(),
        cases: store::list_cases(project)
            .into_iter()
            .filter(|case| ids.contains(&case.id))
            .collect(),
        tcer: store::list_tcer(project)
            .into_iter()
            .filter(|row| ids.contains(&row.tc_id))
            .collect(),
    };
    store::atomic_write(
        &project.join(".testinference").join(".undo.json"),
        &serde_json::to_string_pretty(&undo).map_err(|error| error.to_string())?,
    )?;

    let text = |field: &str| proposal.get(field).and_then(Value::as_str).map(str::to_string);
    let mut changed = 0u32;

    match action {
        "update_requirement" => {
            for id in &ids {
                let Some(mut requirement) = store::list_requirements(project)
                    .into_iter()
                    .find(|requirement| &requirement.id == id)
                else {
                    continue;
                };
                if let Some(title) = text("title") {
                    requirement.title = title;
                }
                if let Some(acceptance) = text("acceptance") {
                    requirement.acceptance = acceptance;
                }
                if let Some(flag) = text("flag") {
                    if flag == "clear" || flag == "vague" {
                        requirement.flag = flag;
                    }
                }
                requirement.edited_by.push(format!("assistant {}", store::now()));
                store::save_requirement(project, &requirement)?;
                changed += 1;
            }
        }
        "delete_requirements" => {
            for id in &ids {
                store::remove_requirement(project, id)?;
                changed += 1;
            }
        }
        "decide_scenarios" => {
            let verdict = text("verdict").unwrap_or_else(|| "approved".to_string());
            changed = crate::design::decide(project_path, ids.clone(), &verdict, Some("by the assistant, with your approval".to_string()))?;
        }
        "decide_cases" => {
            let verdict = text("verdict").unwrap_or_else(|| "approved".to_string());
            for id in &ids {
                let Some(mut case) = store::get_case(project, id) else { continue };
                case.state = verdict.clone();
                case.decided_at = Some(store::now());
                case.comment = Some("by the assistant, with your approval".to_string());
                store::save_case(project, &case)?;
                changed += 1;
            }
        }
        "remove_tcer" => {
            for id in &ids {
                let Some(mut row) = store::get_tcer(project, id) else { continue };
                row.removed = true;
                store::save_tcer(project, &row)?;
                changed += 1;
            }
        }
        other => return Err(format!("{other} is not something the assistant can do")),
    }

    store::record_decision(
        project,
        &store::Decision {
            at: store::now(),
            gate: "assistant".to_string(),
            subject: ids.join(", "),
            verdict: action.to_string(),
            comment: text("why"),
            title: None,
        },
    )?;

    Ok(format!("{changed} changed — undo is available until the next change"))
}

/// Puts back whatever the last applied proposal replaced.
pub fn undo(project_path: &str) -> Result<String, String> {
    let project = Path::new(project_path);
    let file = project.join(".testinference").join(".undo.json");
    let text = std::fs::read_to_string(&file).map_err(|_| "there is nothing to undo".to_string())?;
    let undo: Undo = serde_json::from_str(&text).map_err(|error| error.to_string())?;

    for requirement in &undo.requirements {
        store::save_requirement(project, requirement)?;
    }
    for scenario in &undo.scenarios {
        store::save_scenario(project, scenario)?;
    }
    for case in &undo.cases {
        store::save_case(project, case)?;
    }
    for row in &undo.tcer {
        store::save_tcer(project, row)?;
    }

    let count = undo.requirements.len() + undo.scenarios.len() + undo.cases.len() + undo.tcer.len();
    std::fs::remove_file(&file).ok();

    store::record_decision(
        project,
        &store::Decision {
            at: store::now(),
            gate: "assistant".to_string(),
            subject: undo.action.clone(),
            verdict: "undone".to_string(),
            comment: None,
            title: None,
        },
    )?;

    Ok(format!("put back {count} records from before {}", undo.at))
}
