//! Where the document and the requirements have come apart.
//!
//! A requirement gets talked into shape: someone works out that "fast" meant
//! 400ms and fixes it. The document still says "fast". Nobody tells whoever
//! owns the document, and over a release the PRD and the tests drift apart
//! until neither can be trusted as the record.
//!
//! This app cannot edit someone's PRD, so what it produces instead is the
//! list: here is what your document says, here is what the team decided it
//! means, and here is where the two no longer agree. That list is the thing
//! worth having — these gaps are found in QA conversations every week and
//! almost never make it back.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::store;
use crate::worker::Worker;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gap {
    pub req_id: String,
    pub document: String,
    pub page: Option<u32>,
    /// What the document says.
    pub paragraph: String,
    /// What the requirement says now.
    pub title: String,
    pub acceptance: String,
    pub why: String,
    pub confidence: f64,
    pub edited: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub gaps: Vec<Gap>,
    pub checked: u32,
    /// Requirements whose paragraph has gone from the document entirely.
    pub orphaned: u32,
    /// Of those, the ones a person had edited — the ones worth rescuing.
    pub orphaned_and_edited: u32,
    pub by: String,
    pub note: String,
}

/// Every chunk of every document, by fingerprint, so a requirement can be
/// put back beside the paragraph it was read from.
fn paragraphs(app: &AppHandle, project: &Path) -> Result<HashMap<String, String>, String> {
    let context = store::read_context(project)?;
    let mut found = HashMap::new();

    for document in store::list_documents(project) {
        for chunk in store::read_chunks(app, &context.id, &document.id, 100_000)? {
            let (Some(hash), Some(text)) = (
                chunk.get("hash").and_then(Value::as_str),
                chunk.get("text").and_then(Value::as_str),
            ) else {
                continue;
            };
            found.insert(hash.to_string(), text.to_string());
        }
    }
    Ok(found)
}

pub async fn check(app: &AppHandle, worker: &Worker, project_path: &str) -> Result<Report, String> {
    let project = Path::new(project_path);
    let requirements = store::list_requirements(project);
    if requirements.is_empty() {
        return Err("there are no requirements to check against the documents yet".to_string());
    }

    let text_of = paragraphs(app, project)?;

    let orphaned: Vec<&store::Requirement> =
        requirements.iter().filter(|requirement| requirement.orphaned).collect();
    let orphaned_and_edited =
        orphaned.iter().filter(|requirement| !requirement.edited_by.is_empty()).count() as u32;

    let payload: Vec<Value> = requirements
        .iter()
        .filter(|requirement| !requirement.orphaned)
        .map(|requirement| {
            json!({
                "id": requirement.id,
                "title": requirement.title,
                "acceptance": requirement.acceptance,
                "paragraph": text_of.get(&requirement.source.piece).cloned().unwrap_or_default(),
                "edited": !requirement.edited_by.is_empty(),
            })
        })
        .collect();

    let mut call = json!({ "requirements": payload });
    crate::judge::attach(&mut call, &crate::judge::settings_for(app, project));
    let answer = worker.call("decisions.drift", call).await?;

    let by = answer
        .get("answers")
        .and_then(Value::as_array)
        .and_then(|list| list.first())
        .and_then(|entry| entry.get("by"))
        .and_then(Value::as_str)
        .unwrap_or("rules")
        .to_string();

    let mut gaps = Vec::new();
    for entry in answer.get("answers").and_then(Value::as_array).cloned().unwrap_or_default() {
        let Some(id) = entry.get("id").and_then(Value::as_str) else { continue };
        let Some(requirement) = requirements.iter().find(|item| item.id == id) else { continue };

        gaps.push(Gap {
            req_id: requirement.id.clone(),
            document: requirement.source.document.clone(),
            page: requirement.source.page,
            paragraph: entry
                .get("answer")
                .and_then(|value| value.get("paragraph"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string(),
            title: requirement.title.clone(),
            acceptance: requirement.acceptance.clone(),
            why: entry.get("why").and_then(Value::as_str).unwrap_or_default().to_string(),
            confidence: entry.get("confidence").and_then(Value::as_f64).unwrap_or(0.0),
            edited: !requirement.edited_by.is_empty(),
        });
    }

    let note = if by == "rules" {
        "Nothing is judging, so this is only the requirements someone changed by hand. Turn on Jev in Settings to have every requirement read against its paragraph.".to_string()
    } else if gaps.is_empty() {
        "Every requirement is still supported by the paragraph it came from.".to_string()
    } else {
        format!("{} places where the document and the requirements disagree.", gaps.len())
    };

    Ok(Report {
        gaps,
        checked: payload.len() as u32,
        orphaned: orphaned.len() as u32,
        orphaned_and_edited,
        by,
        note,
    })
}

/// Writes the list as something the person who owns the document can read.
///
/// Markdown rather than CSV: the reader is whoever maintains the PRD, not a
/// spreadsheet. Each entry is what the document says, what the team decided
/// it means, and nothing else to wade through.
pub fn write_report(project_path: &str, report: &Report) -> Result<String, String> {
    let project = Path::new(project_path);
    let mut out = String::from("# Where the documents and the tests disagree\n\n");
    out.push_str(&format!("Checked {} requirements on {}.\n\n", report.checked, store::now()));

    if report.gaps.is_empty() {
        out.push_str("Nothing to report: every requirement is still supported by its source.\n");
    } else {
        out.push_str(
            "Each entry below is a place where the test team's understanding has moved away from \
             the written document. The tests follow the second version. The document still says \
             the first.\n\n",
        );
    }

    let mut by_document: std::collections::BTreeMap<&str, Vec<&Gap>> = Default::default();
    for gap in &report.gaps {
        by_document.entry(gap.document.as_str()).or_default().push(gap);
    }

    for (document, gaps) in by_document {
        out.push_str(&format!("## {document}\n\n"));
        for gap in gaps {
            out.push_str(&format!(
                "### {}{}\n\n",
                gap.req_id,
                gap.page.map(|page| format!(" · page {page}")).unwrap_or_default()
            ));
            out.push_str("**The document says**\n\n");
            out.push_str(&format!("> {}\n\n", gap.paragraph.replace('\n', "\n> ")));
            out.push_str("**The tests are written against**\n\n");
            out.push_str(&format!("> {}\n>\n> {}\n\n", gap.title, gap.acceptance));
            out.push_str(&format!("_{}_\n\n", gap.why));
        }
    }

    if report.orphaned_and_edited > 0 {
        out.push_str(&format!(
            "---\n\n{} requirements that someone had edited no longer have a paragraph in any \
             document at all. Their source text changed or was removed. They are kept in the \
             project, not deleted.\n",
            report.orphaned_and_edited
        ));
    }

    let target = project.join(".testinference").join("exports").join("document-gaps.md");
    store::atomic_write(&target, &out)?;
    Ok(target.to_string_lossy().to_string())
}
