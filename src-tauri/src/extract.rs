//! The run that turns documents into requirements.
//!
//! The manager lives here: it decides what to send, in what order, keeps the
//! run's state on disk as it goes, and stops when the budget says so. It is
//! ordinary code, not a model — it cannot improvise, forget, or loop.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::config::{self, AppConfig};
use crate::store;
use crate::worker::Worker;

/// Pieces per request. Small enough that one failure is cheap, large enough
/// that a requirement spanning two paragraphs is still seen whole.
const BATCH_PIECES: usize = 6;
/// A batch writes up to a few thousand tokens and may repair itself once, so
/// minutes is normal. A timeout here costs real money to redo.
const BATCH_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(300);
const PROMPT: &str = "requirements@v1";

#[derive(Debug, Clone, Default)]
pub struct Cancel(pub Arc<AtomicBool>);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Estimate {
    pub documents: u32,
    pub pieces: u32,
    pub batches: u32,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub model: Option<String>,
    pub cost: Option<f64>,
    pub over_budget: bool,
    pub note: String,
}

struct Piece {
    document: String,
    page: Option<u32>,
    block: u32,
    hash: String,
    text: String,
}

fn gather(app: &AppHandle, project: &Path) -> Result<Vec<Piece>, String> {
    let context = store::read_context(project)?;
    let mut pieces = Vec::new();

    for document in store::list_documents(project) {
        for chunk in store::read_chunks(app, &context.id, &document.id, 100_000)? {
            pieces.push(Piece {
                document: document.name.clone(),
                page: chunk.get("page").and_then(Value::as_u64).map(|page| page as u32),
                block: chunk.get("block").and_then(Value::as_u64).unwrap_or(0) as u32,
                hash: chunk.get("hash").and_then(Value::as_str).unwrap_or("").to_string(),
                text: chunk.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
            });
        }
    }

    Ok(pieces)
}

fn price_of(settings: &AppConfig, model: &str, input: u64, output: u64) -> Option<f64> {
    let price = settings.prices.get(model)?;
    Some((input as f64 / 1_000_000.0) * price.input_per_million
        + (output as f64 / 1_000_000.0) * price.output_per_million)
}

/// What a second read would actually do.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delta {
    pub first_run: bool,
    pub unchanged_pieces: u32,
    pub new_pieces: u32,
    pub gone_pieces: u32,
    pub keep: u32,
    pub orphaned: u32,
    pub estimate: Estimate,
    pub note: String,
}

/// Compares the document pieces as they are now against the ones the last
/// read saw. Nothing is regenerated until the person has seen this.
pub fn plan(app: &AppHandle, project_path: &str) -> Result<Delta, String> {
    let project = Path::new(project_path);
    let pieces = gather(app, project)?;
    let current: std::collections::HashSet<String> =
        pieces.iter().map(|piece| piece.hash.clone()).collect();

    let last = store::list_runs(project)
        .into_iter()
        .filter(|run| run.kind == "extract" && !run.pieces.is_empty())
        .next_back();

    let Some(last) = last else {
        let estimate = estimate(app, project_path)?;
        let note = format!("nothing has been read yet — all {} pieces are new", pieces.len());
        return Ok(Delta {
            first_run: true,
            unchanged_pieces: 0,
            new_pieces: pieces.len() as u32,
            gone_pieces: 0,
            keep: 0,
            orphaned: 0,
            estimate,
            note,
        });
    };

    let previous: std::collections::HashSet<String> = last.pieces.into_iter().collect();
    let fresh: Vec<&Piece> = pieces.iter().filter(|piece| !previous.contains(&piece.hash)).collect();
    let gone = previous.difference(&current).count() as u32;

    let requirements = store::list_requirements(project);
    let orphaned = requirements
        .iter()
        .filter(|requirement| !current.contains(&requirement.source.piece))
        .count() as u32;
    let keep = requirements.len() as u32 - orphaned;

    let mut estimate = estimate_for(app, &fresh.iter().map(|piece| piece.text.len()).sum::<usize>(), fresh.len())?;
    estimate.pieces = fresh.len() as u32;
    estimate.documents = store::list_documents(project).len() as u32;

    let note = if fresh.is_empty() && gone == 0 {
        format!("nothing has changed — all {keep} requirements stay as they are, and this costs nothing")
    } else {
        format!(
            "{} new pieces to read · {keep} requirements kept with their edits and approvals · {orphaned} no longer have a source",
            fresh.len()
        )
    };

    Ok(Delta {
        first_run: false,
        unchanged_pieces: (pieces.len() - fresh.len()) as u32,
        new_pieces: fresh.len() as u32,
        gone_pieces: gone,
        keep,
        orphaned,
        estimate,
        note,
    })
}

fn estimate_for(app: &AppHandle, characters: &usize, pieces: usize) -> Result<Estimate, String> {
    let settings = config::load(app);
    let model = settings.assignments.get("read-documents").cloned();
    let batches = pieces.div_ceil(BATCH_PIECES);
    let input_tokens = (*characters as u64 / 4) + (batches as u64 * 400);
    let output_tokens = pieces as u64 * 120;

    let cost = model
        .as_deref()
        .and_then(|model| price_of(&settings, model, input_tokens, output_tokens));
    let over_budget = cost.is_some_and(|cost| cost > settings.budgets.per_run);

    Ok(Estimate {
        documents: 0,
        pieces: pieces as u32,
        batches: batches as u32,
        input_tokens,
        output_tokens,
        model,
        cost,
        over_budget,
        note: match cost {
            Some(cost) => format!("about ${cost:.2} on your own key"),
            None => "cost unknown — set this model's price to have the budget enforced".to_string(),
        },
    })
}

pub fn estimate(app: &AppHandle, project_path: &str) -> Result<Estimate, String> {
    let project = Path::new(project_path);
    let pieces = gather(app, project)?;
    let settings = config::load(app);
    let model = settings.assignments.get("read-documents").cloned();

    let characters: usize = pieces.iter().map(|piece| piece.text.len()).sum();
    let batches = pieces.len().div_ceil(BATCH_PIECES).max(if pieces.is_empty() { 0 } else { 1 });
    // The prompt itself rides along with every batch.
    let input_tokens = (characters as u64 / 4) + (batches as u64 * 400);
    let output_tokens = pieces.len() as u64 * 120;

    let cost = model
        .as_deref()
        .and_then(|model| price_of(&settings, model, input_tokens, output_tokens));
    let over_budget = cost.is_some_and(|cost| cost > settings.budgets.per_run);

    let note = match (&model, cost) {
        (None, _) => "no model is assigned to reading documents yet".to_string(),
        (Some(_), None) => "cost unknown — set this model's price to have the budget enforced".to_string(),
        (Some(_), Some(cost)) if over_budget => {
            format!("about ${cost:.2}, which is over the ${:.2} limit for one run", settings.budgets.per_run)
        }
        (Some(_), Some(cost)) => format!("about ${cost:.2} on your own key"),
    };

    Ok(Estimate {
        documents: store::list_documents(project).len() as u32,
        pieces: pieces.len() as u32,
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
        .get("read-documents")
        .cloned()
        .ok_or_else(|| "assign a model to reading documents first".to_string())?;

    let estimate = estimate(&app, &project_path)?;
    if estimate.over_budget {
        return Err(estimate.note);
    }
    if estimate.pieces == 0 && !delta {
        return Err("there are no documents to read".to_string());
    }

    let provider = model.split(':').next().unwrap_or_default().to_string();
    let key = crate::secrets::read(&provider)?;
    let endpoint = match provider.as_str() {
        "local" => settings.local_endpoint.clone(),
        "openai" => settings.openai_endpoint.clone(),
        _ => None,
    };

    let pieces = gather(&app, project)?;
    let all_hashes: Vec<String> = pieces.iter().map(|piece| piece.hash.clone()).collect();
    let current: std::collections::HashSet<&String> = all_hashes.iter().collect();

    // In delta mode only pieces the last read never saw are sent. Everything
    // else keeps the requirements it already produced, along with whatever a
    // person has since edited or approved.
    let previous: std::collections::HashSet<String> = if delta {
        store::list_runs(project)
            .into_iter()
            .filter(|run| run.kind == "extract" && !run.pieces.is_empty())
            .next_back()
            .map(|run| run.pieces.into_iter().collect())
            .unwrap_or_default()
    } else {
        std::collections::HashSet::new()
    };

    let to_read: Vec<Piece> = if delta {
        pieces
            .into_iter()
            .filter(|piece| !previous.contains(&piece.hash))
            .collect()
    } else {
        pieces
    };

    let mut start_at = 0usize;
    let mut orphaned = 0u32;
    if delta {
        // A requirement whose paragraph has gone is flagged, never deleted.
        for mut requirement in store::list_requirements(project) {
            let missing = !current.contains(&requirement.source.piece);
            if missing != requirement.orphaned {
                requirement.orphaned = missing;
                store::save_requirement(project, &requirement)?;
            }
            if missing {
                orphaned += 1;
            }
        }
        start_at = store::next_requirement_id(project);
    } else {
        store::clear_requirements(project)?;
    }

    // Which of these pieces actually carry a requirement.
    //
    // With nothing judging, every piece is read — a table of contents costs
    // a little money and produces a requirement someone has to delete. With
    // Jev on, a piece is dropped only when it is sure, because a piece
    // wrongly skipped is a requirement nobody knows is missing. Skipped
    // pieces still count as read, so a later delta run does not keep
    // re-offering them.
    let judgement = crate::judge::settings_for(&app, project);
    let mut skipped = 0usize;
    let to_read: Vec<Piece> = if judgement.get("mode").and_then(Value::as_str) == Some("jev")
        && !to_read.is_empty()
    {
        let chunks: Vec<Value> = to_read
            .iter()
            .map(|piece| json!({ "id": piece.hash, "text": piece.text }))
            .collect();
        let mut payload = json!({ "chunks": chunks });
        crate::judge::attach(&mut payload, &judgement);

        match worker.call("decisions.carries", payload).await {
            Ok(answer) => {
                let drop: std::collections::HashSet<String> = answer
                    .get("answers")
                    .and_then(Value::as_array)
                    .map(|list| {
                        list.iter()
                            .filter(|entry| entry.get("answer").and_then(Value::as_bool) == Some(false))
                            .filter_map(|entry| entry.get("id").and_then(Value::as_str))
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                skipped = drop.len();
                to_read.into_iter().filter(|piece| !drop.contains(&piece.hash)).collect()
            }
            // Judging is an optimisation. If it fails, read everything.
            Err(_) => to_read,
        }
    } else {
        to_read
    };

    let batches: Vec<&[Piece]> = to_read.chunks(BATCH_PIECES).collect();

    let mut record = store::Run {
        id: store::next_run_id(project),
        kind: "extract".to_string(),
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
    let mut failed_batches: Vec<usize> = Vec::new();

    for (number, batch) in batches.iter().enumerate() {
        if cancel.0.load(Ordering::Relaxed) {
            record.status = "stopped".to_string();
            record.note = Some("you stopped it; what was read is kept".to_string());
            break;
        }

        let payload = json!({
            "model": model,
            "key": key,
            "endpoint": endpoint,
            "pieces": batch.iter().enumerate().map(|(index, piece)| json!({
                "index": index,
                "text": piece.text,
            })).collect::<Vec<_>>(),
        });

        // One retry: a timeout or a dropped connection usually succeeds the
        // second time, and re-reading the whole document is expensive.
        let mut outcome = worker
            .call_with_timeout("requirements.readBatch", payload.clone(), BATCH_TIMEOUT)
            .await;
        if outcome.is_err() && !cancel.0.load(Ordering::Relaxed) {
            let _ = app.emit(
                "run:problem",
                json!({ "batch": number + 1, "detail": "no answer — trying once more" }),
            );
            tokio::time::sleep(std::time::Duration::from_secs(2)).await;
            outcome = worker
                .call_with_timeout("requirements.readBatch", payload, BATCH_TIMEOUT)
                .await;
        }

        match outcome {
            Ok(answer) => {
                let attempts = answer.get("attempts").and_then(Value::as_u64).unwrap_or(1) as u32;
                record.attempts += attempts;
                record.input_tokens += answer.get("inputTokens").and_then(Value::as_u64).unwrap_or(0);
                record.output_tokens += answer.get("outputTokens").and_then(Value::as_u64).unwrap_or(0);

                let drafted = answer
                    .get("requirements")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();

                for draft in drafted {
                    let within = draft.get("piece").and_then(Value::as_u64).unwrap_or(0) as usize;
                    let Some(piece) = batch.get(within) else { continue };

                    let vague = draft.get("vague").and_then(Value::as_bool).unwrap_or(false);
                    let requirement = store::Requirement {
                        id: store::requirement_id(position),
                        title: text_of(&draft, "title"),
                        acceptance: text_of(&draft, "acceptance"),
                        domain: text_of(&draft, "domain"),
                        impacted: text_of(&draft, "impacted"),
                        flag: if vague { "vague".into() } else { "clear".into() },
                        version: 1,
                        // Kept from the start, so a change years later can
                        // still be shown against what the document said.
                        as_extracted: Some(store::Wording {
                            title: text_of(&draft, "title"),
                            acceptance: text_of(&draft, "acceptance"),
                        }),
                        clarification: draft
                            .get("clarification")
                            .and_then(Value::as_str)
                            .filter(|value| !value.trim().is_empty())
                            .map(str::to_string),
                        source: store::Source {
                            document: piece.document.clone(),
                            page: piece.page,
                            block: piece.block,
                            piece: piece.hash.clone(),
                        },
                        made_by: store::MadeBy {
                            run: record.id.clone(),
                            model: model.clone(),
                            prompt: PROMPT.to_string(),
                            attempt: attempts,
                        },
                        edited_by: Vec::new(),
                        orphaned: false,
                    };

                    // Written as it arrives: quitting mid-run loses nothing.
                    store::save_requirement(project, &requirement)?;
                    position += 1;
                    record.produced += 1;
                    let _ = app.emit("run:requirement", &requirement);
                }
            }
            Err(problem) => {
                // One bad batch does not end the run — it is reported and the
                // rest carries on.
                failed_batches.push(number + 1);
                let _ = app.emit("run:problem", json!({ "batch": number + 1, "detail": problem }));
            }
        }

        record.batches_done = number as u32 + 1;
        record.cost = price_of(&settings, &model, record.input_tokens, record.output_tokens);

        if record.cost.is_some_and(|cost| cost > settings.budgets.per_run) {
            record.status = "stopped".to_string();
            record.note = Some(format!(
                "stopped at the ${:.2} limit for one run",
                settings.budgets.per_run
            ));
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
    if !failed_batches.is_empty() {
        record.note = Some(format!(
            "{} of {} batches could not be read: {:?}. Everything else was kept.",
            failed_batches.len(),
            record.batches,
            failed_batches
        ));
    }
    if delta {
        let kept = store::list_requirements(project).len() as u32 - record.produced;
        record.note = Some(format!(
            "{} new · {kept} kept · {orphaned} without a source{}",
            record.produced,
            record.note.map(|note| format!(" · {note}")).unwrap_or_default()
        ));
    }
    record.pieces = all_hashes;
    if skipped > 0 {
        let said = format!("{skipped} pieces were judged not to carry a requirement");
        record.note = Some(match record.note.take() {
            Some(note) => format!("{note} · {said}"),
            None => said,
        });
    }
    record.finished_at = Some(store::now());
    store::save_run(project, &record)?;
    let _ = app.emit("run:finished", &record);

    Ok(record)
}

fn text_of(value: &Value, field: &str) -> String {
    value.get(field).and_then(Value::as_str).unwrap_or("").trim().to_string()
}
