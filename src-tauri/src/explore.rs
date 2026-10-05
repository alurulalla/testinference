//! Walking the application to see what is really there.
//!
//! Everything before this stage reads documents. This stage reads the
//! product, and the difference matters: a test written from a document
//! guesses at the markup, while a test written from the map points at
//! controls that were observed to exist.
//!
//! The explorer follows links and reads pages. It clicks nothing and
//! submits nothing, with one exception a person configures: the sign-in,
//! because most applications are a login page and nothing else until you
//! are through it. That restraint is the design, not a limitation to be
//! removed later — a crawler that presses whatever it finds will one day
//! press "Delete account" on someone's staging environment.

use std::path::Path;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use crate::store;
use crate::worker::Worker;

/// How a project's sign-in is named in the keychain.
pub fn secret_name(project_id: &str) -> String {
    format!("signin:{project_id}")
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Explored {
    pub pages: u32,
    /// Addresses that turned out to be a screen already mapped.
    pub repeats: u32,
    /// Pages whose controls differ from the last time we looked.
    pub changed: u32,
    pub fresh: u32,
    pub skipped: Vec<String>,
    /// True when the only thing found was a login page.
    pub needs_sign_in: bool,
    pub note: String,
    pub run: store::Run,
}

/// Does this page look like the way in rather than the application?
fn looks_like_a_door(page: &store::AppPage) -> bool {
    let fields = page.elements.iter().filter(|element| element.kind == "input").count();
    let buttons = page.elements.iter().filter(|element| element.kind == "control").count();
    let links = page.elements.iter().filter(|element| element.kind == "link").count();
    fields >= 2 && buttons >= 1 && links <= 2
}

pub async fn run(
    app: AppHandle,
    worker: &Worker,
    project_path: String,
    pages: u32,
    depth: u32,
    fresh_start: bool,
) -> Result<Explored, String> {
    let project = Path::new(&project_path);
    let context = store::read_context(project)?;
    if context.app_url.trim().is_empty() {
        return Err("set the application URL on the project first".to_string());
    }

    // The sign-in, if one is configured and its password is in the keychain.
    let sign_in = match &context.sign_in {
        Some(how) => match crate::secrets::read(&secret_name(&context.id))? {
            Some(secret) => Some(json!({
                "username": how.username,
                "password": how.password,
                "submit": how.submit,
                "user": how.user,
                "secret": secret,
            })),
            None => None,
        },
        None => None,
    };

    let before = store::list_app_pages(project);
    if fresh_start {
        store::clear_app_map(project)?;
    }

    let walk = worker
        .call(
            "explore.crawl",
            json!({
                "url": context.app_url,
                "pages": pages,
                "depth": depth,
                "signIn": sign_in,
                // Used only to confirm that two addresses are one screen.
                "judge": crate::judge::settings_for(&app, project),
            }),
        )
        .await?;

    let found = walk.get("pages").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut changed = 0u32;
    let mut saved = Vec::new();
    let mut unreadable: Vec<String> = Vec::new();

    for entry in &found {
        // A page that will not parse is reported, not skipped in silence.
        // Skipping quietly is what let an empty map sit behind a screen
        // saying pages had been found.
        let mut page = match serde_json::from_value::<store::AppPage>(entry.clone()) {
            Ok(page) => page,
            Err(error) => {
                unreadable.push(format!(
                    "{}: {error}",
                    entry.get("url").and_then(Value::as_str).unwrap_or("a page")
                ));
                continue;
            }
        };
        page.seen_at = store::now();

        // A page whose controls are the same as last time is not news.
        let known = before.iter().find(|earlier| earlier.url == page.url);
        if known.map(|earlier| earlier.fingerprint != page.fingerprint).unwrap_or(true) {
            changed += 1;
        }
        store::save_app_page(project, &page)?;
        saved.push(page);
    }

    let fresh = saved.iter().filter(|page| !before.iter().any(|old| old.url == page.url)).count() as u32;
    let needs_sign_in = sign_in.is_none() && saved.len() == 1 && saved.first().is_some_and(looks_like_a_door);

    let mut skipped: Vec<String> = walk
        .get("skipped")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(Value::as_str).map(str::to_string).collect())
        .unwrap_or_default();
    skipped.extend(unreadable);

    let note = if needs_sign_in {
        "This application is a login page and nothing else until you are through it. Point the three fields below at the form and give it a test account, and the next run will go further.".to_string()
    } else {
        walk.get("note").and_then(Value::as_str).unwrap_or_default().to_string()
    };

    let record = store::Run {
        id: store::next_run_id(project),
        kind: "explore".to_string(),
        started_at: store::now(),
        finished_at: Some(store::now()),
        status: "finished".to_string(),
        model: "browser".to_string(),
        prompt: "explore/1".to_string(),
        batches: 1,
        batches_done: 1,
        attempts: 1,
        input_tokens: 0,
        output_tokens: 0,
        cost: None,
        produced: saved.len() as u32,
        note: Some(format!(
            "{} pages · {fresh} new · {changed} changed{}",
            saved.len(),
            if skipped.is_empty() { String::new() } else { format!(" · {} could not be read", skipped.len()) }
        )),
        judge: crate::judge::mode(project),
        pieces: saved.iter().map(|page| page.fingerprint.clone()).collect(),
    };
    store::save_run(project, &record)?;

    let _ = app;
    let repeats = walk.get("repeats").and_then(Value::as_u64).unwrap_or(0) as u32
        + walk.get("folded").and_then(Value::as_u64).unwrap_or(0) as u32;

    Ok(Explored {
        pages: saved.len() as u32,
        repeats,
        changed,
        fresh,
        skipped,
        needs_sign_in,
        note,
        run: record,
    })
}
