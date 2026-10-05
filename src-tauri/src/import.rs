//! Bringing in test cases someone already has.
//!
//! Plenty of teams arrive with a spreadsheet of cases and no interest in
//! designing them again. They should be able to start from what they have
//! and use everything after the designing: validation, Gate B, suites, BDD,
//! automation feasibility and publishing.
//!
//! What an import cannot conjure is the spine — the requirement and the
//! scenario each case came from. Where the file carries those references
//! they are kept; where it does not, the case is imported without them and
//! the screen says exactly which parts of the app go quiet as a result. The
//! alternative, inventing a requirement per case so the matrices look full,
//! would be worse than an honest gap.

use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::store;
use crate::worker::Worker;

/// How many rows the preview shows. Enough to see the mapping is right.
const PREVIEW: usize = 8;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<String>>,
    pub total: usize,
    /// Field name to column index.
    pub mapping: Value,
    /// Column index to how that mapping was arrived at.
    pub why: Value,
    pub unmapped: Vec<String>,
    /// "rules" or "jev" — who worked the mapping out.
    pub by: String,
    pub missing: Vec<String>,
    pub note: String,
}

fn read_text(source: &str) -> Result<String, String> {
    let bytes = std::fs::read(source).map_err(|error| format!("could not read the file: {error}"))?;
    // A spreadsheet exported from Excel is not always valid UTF-8, and a
    // stray byte in one cell should not cost the whole import.
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub async fn preview(
    app: &AppHandle,
    worker: &Worker,
    project_path: &str,
    source_path: &str,
) -> Result<Preview, String> {
    let text = read_text(source_path)?;
    let sheet = worker.call("import.read", json!({ "text": text })).await?;

    let columns: Vec<String> = sheet
        .get("columns")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    if columns.is_empty() {
        return Err("that file has no column headings to read".to_string());
    }

    let rows = sheet.get("rows").and_then(Value::as_array).cloned().unwrap_or_default();
    if rows.is_empty() {
        return Err("that file has headings but no rows".to_string());
    }

    let mut payload = json!({ "sheet": sheet });
    crate::judge::attach(&mut payload, &crate::judge::settings_for(app, Path::new(project_path)));
    let suggested = worker.call("import.map", payload).await?;

    let mapping = suggested.get("mapping").cloned().unwrap_or_else(|| json!({}));
    let missing: Vec<String> = ["title", "steps"]
        .iter()
        .filter(|field| mapping.get(**field).is_none())
        .map(|field| (*field).to_string())
        .collect();

    let traced = mapping.get("reqId").is_some() || mapping.get("scenarioId").is_some();
    let note = if !missing.is_empty() {
        format!("Point {} at a column before importing.", missing.join(" and "))
    } else if traced {
        "The file carries its own requirement or scenario references, so coverage and risk will still work.".to_string()
    } else {
        "Nothing in this file links a case to a requirement. They will import and go through validation, Gate B, suites, BDD and publishing — but coverage, risk and the TCER stay empty, because those are about requirements.".to_string()
    };

    Ok(Preview {
        columns,
        rows: rows
            .iter()
            .take(PREVIEW)
            .map(|row| {
                row.as_array()
                    .map(|cells| cells.iter().filter_map(Value::as_str).map(str::to_string).collect())
                    .unwrap_or_default()
            })
            .collect(),
        total: rows.len(),
        mapping,
        why: suggested.get("why").cloned().unwrap_or_else(|| json!({})),
        unmapped: suggested
            .get("unmapped")
            .and_then(Value::as_array)
            .map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect())
            .unwrap_or_default(),
        by: suggested.get("by").and_then(Value::as_str).unwrap_or("rules").to_string(),
        missing,
        note,
    })
}

/// P1/P2/P3 is the vocabulary everything downstream counts in, so a file
/// using High/Medium/Low is translated rather than carried through as a
/// fourth spelling nothing recognises.
fn priority_of(raw: &str) -> String {
    let value = raw.trim().to_lowercase();
    match value.as_str() {
        "p1" | "1" | "high" | "critical" | "blocker" | "highest" => "P1",
        "p3" | "3" | "low" | "minor" | "lowest" | "trivial" => "P3",
        "p2" | "2" | "medium" | "normal" | "major" => "P2",
        // An unrecognised word is not evidence of importance either way.
        _ => "P2",
    }
    .to_string()
}

fn feasibility_of(raw: &str) -> String {
    let value = raw.trim().to_lowercase();
    if value.is_empty() {
        return String::new();
    }
    if value.contains("partial") || value.contains("semi") {
        return "Partial".to_string();
    }
    // Negations first. "Not automated" contains "automated", and reading it
    // as automatable would send a manual test to the automation pile.
    let denied = value.starts_with("not ")
        || value.starts_with("non")
        || value.contains("not auto")
        || value.contains("no auto")
        || value.contains("cannot")
        || value.contains("can't");
    if denied || value.contains("manual") || matches!(value.as_str(), "no" | "false" | "n" | "none") {
        return "Manual".to_string();
    }
    if value.contains("auto") || matches!(value.as_str(), "yes" | "true" | "y") {
        return "Automatable".to_string();
    }
    String::new()
}

/// Keeps the identifier a case already has, when it can be kept.
///
/// These identifiers are in the team's bug reports and CI output, and
/// renumbering them would quietly break every reference. One is only
/// refused when it would collide with a case already here or cannot be a
/// filename.
fn id_for(
    raw: &str,
    position: usize,
    taken: &std::collections::HashSet<String>,
) -> (String, Option<String>) {
    let candidate = raw.trim();
    let usable = !candidate.is_empty()
        && candidate.len() <= 64
        && candidate
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character));

    if usable && !taken.contains(candidate) {
        return (candidate.to_string(), None);
    }

    let fresh = store::case_id_for(position);
    let why = if candidate.is_empty() {
        None
    } else if taken.contains(candidate) {
        Some(format!("{candidate} was already taken, so it came in as {fresh}"))
    } else {
        Some(format!("{candidate} could not be used as an identifier, so it came in as {fresh}"))
    };
    (fresh, why)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub added: u32,
    pub skipped: u32,
    pub renamed: Vec<String>,
    pub run: store::Run,
    pub note: String,
}

pub async fn import(
    worker: &Worker,
    project_path: String,
    source_path: String,
    mapping: std::collections::BTreeMap<String, usize>,
) -> Result<Imported, String> {
    let project = Path::new(&project_path);
    for required in ["title", "steps"] {
        if !mapping.contains_key(required) {
            return Err(format!("say which column holds the {required} before importing"));
        }
    }

    let text = read_text(&source_path)?;
    let sheet = worker.call("import.read", json!({ "text": text })).await?;
    let rows = sheet.get("rows").and_then(Value::as_array).cloned().unwrap_or_default();

    let file = Path::new(&source_path)
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| source_path.clone());

    let mut taken: std::collections::HashSet<String> =
        store::list_cases(project).into_iter().map(|case| case.id).collect();
    let version_of: std::collections::HashMap<String, u32> = store::list_requirements(project)
        .into_iter()
        .map(|requirement| (requirement.id, requirement.version))
        .collect();

    let mut record = store::Run {
        id: store::next_run_id(project),
        kind: "import".to_string(),
        started_at: store::now(),
        finished_at: None,
        status: "running".to_string(),
        model: "imported".to_string(),
        prompt: "import/1".to_string(),
        batches: 1,
        batches_done: 0,
        attempts: 1,
        input_tokens: 0,
        output_tokens: 0,
        cost: None,
        produced: 0,
        note: None,
        judge: crate::judge::mode(project),
        pieces: Vec::new(),
    };

    let at = |row: &Vec<Value>, name: &str| -> String {
        mapping
            .get(name)
            .and_then(|index| row.get(*index))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_string()
    };

    let mut added = 0u32;
    let mut skipped = 0u32;
    let mut renamed: Vec<String> = Vec::new();
    let mut position = store::next_case_id(project);

    for row in rows.iter().filter_map(Value::as_array) {
        let row = row.to_vec();
        let title = at(&row, "title");
        // A row with no title is a spacer or a section heading, not a case.
        if title.is_empty() {
            skipped += 1;
            continue;
        }

        let (id, why) = id_for(&at(&row, "id"), position, &taken);
        if let Some(why) = why {
            renamed.push(why);
        }
        taken.insert(id.clone());
        position += 1;

        let case_type = at(&row, "caseType");
        let req_id = at(&row, "reqId");
        let case = store::TestCase {
            id: id.clone(),
            scenario_id: at(&row, "scenarioId"),
            req_version: version_of.get(&req_id).copied().unwrap_or(1),
            req_id,
            title,
            description: at(&row, "description"),
            case_type: if case_type.is_empty() { "Functional".to_string() } else { case_type },
            priority: priority_of(&at(&row, "priority")),
            precondition: at(&row, "precondition"),
            test_data: at(&row, "testData"),
            steps: at(&row, "steps"),
            expected: at(&row, "expected"),
            platform: at(&row, "platform"),
            auto_feasibility: feasibility_of(&at(&row, "autoFeasibility")),
            state: "pending".to_string(),
            decided_at: None,
            comment: None,
            made_by: store::MadeBy {
                run: record.id.clone(),
                model: "imported".to_string(),
                prompt: "import/1".to_string(),
                attempt: 1,
            },
            imported_from: file.clone(),
            publish_id: None,
            publish_target: None,
            published_at: None,
        };
        store::save_case(project, &case)?;
        added += 1;
    }

    record.produced = added;
    record.batches_done = 1;
    record.status = "finished".to_string();
    record.finished_at = Some(store::now());
    record.note = Some(format!(
        "{added} cases imported from {file}{}",
        if skipped > 0 { format!(", {skipped} rows had no title and were left out") } else { String::new() }
    ));
    store::save_run(project, &record)?;

    let linked = store::list_cases(project)
        .iter()
        .filter(|case| case.imported_from == file && !case.req_id.is_empty())
        .count();

    let note = if linked == added as usize && added > 0 {
        "Every one came with a requirement reference, so coverage and risk have something to work with.".to_string()
    } else if linked > 0 {
        format!("{linked} of {added} came with a requirement reference. The rest will show as untraced.")
    } else {
        "None of them reference a requirement, so they will fail the \"no link to a scenario\" check at validation and the coverage and risk screens stay empty. Everything else — Gate B, suites, BDD, feasibility, publishing — works as normal.".to_string()
    };

    Ok(Imported { added, skipped, renamed, run: record, note })
}

/// Works out which requirement each untraced case is a test of.
///
/// Proposals only — nothing is written. A wrong link is worse than no link,
/// because it makes a requirement look tested when it is not, so a person
/// sees the matches and the confidence before any of it is applied.
pub async fn propose_links(
    app: &AppHandle,
    worker: &Worker,
    project_path: &str,
) -> Result<Value, String> {
    let project = Path::new(project_path);

    let untraced: Vec<Value> = store::list_cases(project)
        .into_iter()
        .filter(|case| case.req_id.trim().is_empty())
        .map(|case| {
            json!({
                "id": case.id,
                "title": case.title,
                "steps": case.steps,
                "expected": case.expected,
            })
        })
        .collect();
    if untraced.is_empty() {
        return Err("every case already traces to a requirement".to_string());
    }

    let requirements: Vec<Value> = store::list_requirements(project)
        .into_iter()
        .filter(|requirement| !requirement.orphaned)
        .map(|requirement| {
            json!({
                "id": requirement.id,
                "title": requirement.title,
                "acceptance": requirement.acceptance,
            })
        })
        .collect();
    if requirements.is_empty() {
        return Err(
            "there are no requirements to link to — read a document first, or leave the cases untraced"
                .to_string(),
        );
    }

    let mut payload = json!({ "cases": untraced, "requirements": requirements });
    crate::judge::attach(&mut payload, &crate::judge::settings_for(app, project));
    worker.call("decisions.link", payload).await
}

/// Writes the links a person accepted, and nothing else.
pub fn apply_links(
    project_path: &str,
    links: Vec<(String, String)>,
) -> Result<u32, String> {
    let project = Path::new(project_path);
    let requirements: std::collections::HashSet<String> = store::list_requirements(project)
        .into_iter()
        .map(|requirement| requirement.id)
        .collect();

    let mut linked = 0u32;
    for (case_id, req_id) in links {
        if !requirements.contains(&req_id) {
            return Err(format!("there is no requirement called {req_id}"));
        }
        let Some(mut case) = store::get_case(project, &case_id) else { continue };
        if case.req_id == req_id {
            continue;
        }
        case.req_id = req_id;
        store::save_case(project, &case)?;
        linked += 1;
    }
    Ok(linked)
}

/// The one field a case does not already carry.
///
/// First rule that matches wins, in the same spirit as the automation
/// classifier: crude, repeatable, and easy to argue with. It stands in when
/// nothing is judging; with Jev on, the judge answers this at 88% and only
/// falls back to here when it is unsure.
fn class_of(title: &str, expected: &str) -> &'static str {
    let text = format!("{title} {expected}").to_lowercase();
    let has = |words: &[&str]| words.iter().any(|word| text.contains(word));

    if has(&["unauthor", "permission", "injection", "xss", "csrf", "token", "privilege"]) {
        "Security"
    } else if has(&["boundary", "maximum", "minimum", "limit", "longest", "exceed", "one character", "zero"]) {
        "Boundary"
    } else if has(&["timeout", "unavailable", "network", "server error", "crash", "500"]) {
        "Error"
    } else if has(&["recover", "retry", "resume", "restore", "after a failure"]) {
        "Recovery"
    } else if has(&["invalid", "reject", "error", "fail", "denied", "blocked", "locked", "empty", "blank", "incorrect", "wrong", "not allowed", "cannot"]) {
        "Negative"
    } else {
        "Positive"
    }
}

/// Turns the steps of a case into a scenario's trigger.
///
/// Not a summary — writing one would be composing content, which is not
/// what this is for. The steps are the action, so they are the trigger,
/// verbatim.
fn trigger_of(steps: &str) -> String {
    steps.trim().to_string()
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Derived {
    pub scenarios: u32,
    pub rows: u32,
    pub judged: u32,
    pub note: String,
}

/// Builds the scenario and TCER row that each linked case implies.
///
/// This is a projection, not an invention. A test case already carries a
/// precondition, an action and an expected result, which are a scenario's
/// own fields; the only thing genuinely inferred is the class, and that is
/// the question the judge is measurably good at. The derived records say
/// where they came from, so nobody later mistakes a reverse-engineered
/// scenario for one that was designed.
///
/// The scenarios arrive at Gate A pending, like any other. Marking them
/// approved would be recording a decision nobody made — and the decision
/// these cases represent was made by whoever wrote them, not by this app.
pub async fn derive_spine(
    app: &AppHandle,
    worker: &Worker,
    project_path: &str,
) -> Result<Derived, String> {
    let project = Path::new(project_path);

    let waiting: Vec<store::TestCase> = store::list_cases(project)
        .into_iter()
        .filter(|case| !case.req_id.trim().is_empty() && case.scenario_id.trim().is_empty())
        .collect();
    if waiting.is_empty() {
        return Err(
            "every case that traces to a requirement already has a scenario — link some cases first"
                .to_string(),
        );
    }

    // One batched question per case for the class. Everything else on the
    // scenario is carried straight across.
    let judgement = crate::judge::settings_for(app, project);
    let mut classes: std::collections::BTreeMap<String, String> = Default::default();
    if judgement.get("mode").and_then(Value::as_str) == Some("jev") {
        let payload_cases: Vec<Value> = waiting
            .iter()
            .map(|case| json!({ "id": case.id, "title": case.title, "expected": case.expected }))
            .collect();
        let mut payload = json!({ "scenarios": payload_cases });
        crate::judge::attach(&mut payload, &judgement);

        // A judge that cannot be reached costs accuracy on one field, not
        // the whole derivation.
        if let Ok(answer) = worker.call("decisions.label", payload).await {
            for entry in answer.get("answers").and_then(Value::as_array).cloned().unwrap_or_default() {
                let Some(id) = entry.get("id").and_then(Value::as_str) else { continue };
                let label = entry.get("answer").and_then(|labels| labels.get("class"));
                let sure = label
                    .and_then(|label| label.get("confidence"))
                    .and_then(Value::as_f64)
                    .unwrap_or(0.0);
                if sure < 0.6 {
                    continue;
                }
                if let Some(value) = label.and_then(|label| label.get("value")).and_then(Value::as_str) {
                    classes.insert(id.to_string(), value.to_string());
                }
            }
        }
    }
    let judged = classes.len() as u32;

    let mut record = store::Run {
        id: store::next_run_id(project),
        kind: "derive".to_string(),
        started_at: store::now(),
        finished_at: None,
        status: "running".to_string(),
        model: "derived from the cases".to_string(),
        prompt: "derive/1".to_string(),
        batches: 1,
        batches_done: 0,
        attempts: 1,
        input_tokens: 0,
        output_tokens: 0,
        cost: None,
        produced: 0,
        note: None,
        judge: crate::judge::mode(project),
        pieces: Vec::new(),
    };

    let mut position = store::next_scenario_id(project);
    let mut rows: Vec<store::TcerRow> = Vec::new();
    let mut scenarios = 0u32;

    for case in &waiting {
        let scenario_id = store::scenario_id(position);
        position += 1;

        let class = classes
            .get(&case.id)
            .cloned()
            .unwrap_or_else(|| class_of(&case.title, &case.expected).to_string());

        let made_by = store::MadeBy {
            run: record.id.clone(),
            model: format!("derived from {}", case.id),
            prompt: "derive/1".to_string(),
            attempt: 1,
        };

        let scenario = store::Scenario {
            id: scenario_id.clone(),
            req_id: case.req_id.clone(),
            req_version: case.req_version,
            title: case.title.clone(),
            class,
            priority: case.priority.clone(),
            auto_feasibility: case.auto_feasibility.clone(),
            precondition: case.precondition.clone(),
            trigger: trigger_of(&case.steps),
            expected: case.expected.clone(),
            state: "pending".to_string(),
            decided_at: None,
            comment: None,
            made_by: made_by.clone(),
        };
        store::save_scenario(project, &scenario)?;
        scenarios += 1;

        rows.push(store::TcerRow {
            id: scenario_id.clone(),
            tc_id: case.id.clone(),
            req_id: case.req_id.clone(),
            req_version: case.req_version,
            title: case.title.clone(),
            precondition: case.precondition.clone(),
            trigger: trigger_of(&case.steps),
            expected: case.expected.clone(),
            priority: case.priority.clone(),
            // The arithmetic fills these in; they are never asserted here.
            score: 0,
            verdict: String::new(),
            reasons: Vec::new(),
            removed: false,
            comment: None,
            made_by: Some(made_by),
        });

        // The case now knows which scenario it belongs to, which is what
        // the validation link check has been complaining about.
        let mut linked = case.clone();
        linked.scenario_id = scenario_id;
        store::save_case(project, &linked)?;
    }

    // Scored by the same four checks as any other row, after the fact.
    let scored = crate::tcer::score(worker, &rows).await?;
    for row in &scored {
        store::save_tcer(project, row)?;
    }

    record.produced = scenarios;
    record.batches_done = 1;
    record.status = "finished".to_string();
    record.finished_at = Some(store::now());
    record.note = Some(format!(
        "{scenarios} scenarios and {} rows derived from imported cases{}",
        scored.len(),
        if judged > 0 { format!(", {judged} classed by the judge") } else { String::new() }
    ));
    store::save_run(project, &record)?;

    Ok(Derived {
        scenarios,
        rows: scored.len() as u32,
        judged,
        note: format!(
            "Coverage, risk and the TCER now have something to work with. The {scenarios} scenarios are waiting at Gate A — they were derived, not designed, so nobody has approved them yet."
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_one_inferred_field_reads_the_case_it_came_from() {
        assert_eq!(class_of("User can sign in", "The dashboard loads"), "Positive");
        assert_eq!(class_of("Locked out user is refused", "An error banner appears"), "Negative");
        assert_eq!(class_of("Password one character short", "It is rejected"), "Boundary");
        assert_eq!(class_of("Session token of another user", "Access is denied"), "Security");
        // First match wins, and security outranks the plain refusal that
        // every security test also describes.
        assert_eq!(class_of("Unauthorised access is rejected", "Error shown"), "Security");
    }

    #[test]
    fn priorities_are_translated_into_the_one_vocabulary() {
        assert_eq!(priority_of("High"), "P1");
        assert_eq!(priority_of("  critical "), "P1");
        assert_eq!(priority_of("P3"), "P3");
        assert_eq!(priority_of("Low"), "P3");
        assert_eq!(priority_of("Medium"), "P2");
        // A word we do not know is not evidence either way, so it lands in
        // the middle rather than quietly becoming urgent.
        assert_eq!(priority_of("Showstopper-ish"), "P2");
        assert_eq!(priority_of(""), "P2");
    }

    #[test]
    fn a_denial_is_not_read_as_automatable() {
        assert_eq!(feasibility_of("Automated"), "Automatable");
        assert_eq!(feasibility_of("Not automated"), "Manual");
        assert_eq!(feasibility_of("No automation"), "Manual");
        assert_eq!(feasibility_of("non-automatable"), "Manual");
        assert_eq!(feasibility_of("Partially automated"), "Partial");
        assert_eq!(feasibility_of("Manual"), "Manual");
        // Nothing said is not the same as "manual".
        assert_eq!(feasibility_of(""), "");
    }

    #[test]
    fn a_case_keeps_the_identifier_it_arrived_with() {
        let taken = std::collections::HashSet::new();
        assert_eq!(id_for("QA-1041", 0, &taken), ("QA-1041".to_string(), None));
    }

    #[test]
    fn an_identifier_already_here_does_not_overwrite_what_has_it() {
        let taken: std::collections::HashSet<String> = ["TC-001".to_string()].into_iter().collect();
        let (id, why) = id_for("TC-001", 7, &taken);
        assert_eq!(id, "TC-008");
        assert!(why.expect("it should say why").contains("already taken"));
    }

    #[test]
    fn an_identifier_that_cannot_be_a_filename_is_replaced() {
        let taken = std::collections::HashSet::new();
        let (id, why) = id_for("../../etc/passwd", 2, &taken);
        assert_eq!(id, "TC-003");
        assert!(why.is_some());
    }

    #[test]
    fn a_row_with_no_identifier_simply_gets_one() {
        let taken = std::collections::HashSet::new();
        assert_eq!(id_for("", 4, &taken), ("TC-005".to_string(), None));
    }
}
