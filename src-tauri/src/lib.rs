//! The shell.
//!
//! A window, a worker process, and the operating system's keychain. That
//! is all this is. Everything the application knows how to do — reading
//! documents, talking to models, driving a browser, keeping a project's
//! records — is TypeScript, in the worker, and reaches the window through
//! one relay.
//!
//! The keychain is the one thing that stays on this side, because it is
//! the one thing the operating system does better than a file. Keys are
//! read here and handed to the worker over its pipe; they live in the
//! worker's memory and are never written anywhere.

mod secrets;
mod worker;

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Listener, Manager, State};

use worker::{Worker, WorkerStatus};

/// How long the window will wait on one request.
///
/// A run can take most of an hour. What actually bounds a stuck request is
/// the worker's own timeouts on each call it makes, and a dead worker
/// fails every pending request at once — so this is a ceiling, not a
/// deadline anyone should hit.
const RELAY_TIMEOUT: Duration = Duration::from_secs(4 * 60 * 60);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CoreInfo {
    name: String,
    version: String,
    platform: String,
    arch: String,
    tauri_version: String,
}

#[tauri::command]
fn core_info() -> CoreInfo {
    CoreInfo {
        name: "TestInference".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
        tauri_version: tauri::VERSION.to_string(),
    }
}

#[tauri::command]
fn worker_status(worker: State<'_, Worker>) -> WorkerStatus {
    worker.status()
}

/// Passes a request from the window to the worker and brings back the answer.
#[tauri::command]
async fn relay(
    worker: State<'_, Worker>,
    method: String,
    params: Option<Value>,
) -> Result<Value, String> {
    worker
        .call_with_timeout(&method, params.unwrap_or_else(|| json!({})), RELAY_TIMEOUT)
        .await
}

/// Stores a secret in the keychain and tells the worker about it.
#[tauri::command]
async fn secret_set(worker: State<'_, Worker>, name: String, value: String) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("that is empty".to_string());
    }
    secrets::store(&name, value)?;
    worker
        .call("keys.remember", json!({ "name": name, "value": value }))
        .await?;
    Ok(())
}

#[tauri::command]
async fn secret_clear(worker: State<'_, Worker>, name: String) -> Result<(), String> {
    secrets::clear(&name)?;
    worker
        .call("keys.remember", json!({ "name": name, "value": Value::Null }))
        .await?;
    Ok(())
}

/// Reads every secret the worker could want and gives it over.
///
/// Done each time the worker becomes ready, not once: the worker is
/// restarted after a crash and after a rebuild, and a restarted worker
/// has an empty memory.
async fn hand_over_keys(app: AppHandle) {
    let worker = app.state::<Worker>();

    let Ok(wanted) = worker.call("keys.wanted", json!({})).await else {
        return;
    };

    for name in wanted.as_array().into_iter().flatten().filter_map(Value::as_str) {
        if let Ok(Some(value)) = secrets::read(name) {
            let _ = worker
                .call("keys.remember", json!({ "name": name, "value": value }))
                .await;
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(Worker::spawn(app.handle().clone()));

            let handle = app.handle().clone();
            app.listen(worker::EVENT_STATUS, move |event| {
                let ready = serde_json::from_str::<Value>(event.payload())
                    .ok()
                    .and_then(|status| status.get("state").and_then(Value::as_str).map(str::to_string))
                    .is_some_and(|state| state == "ready");

                if ready {
                    tauri::async_runtime::spawn(hand_over_keys(handle.clone()));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_info,
            worker_status,
            relay,
            secret_set,
            secret_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TestInference");
}
