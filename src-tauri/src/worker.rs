//! Supervises the Node worker process and carries messages to and from it.
//!
//! One long-lived task owns the child: it writes requests to the worker's
//! stdin, reads replies and events from its stdout, and restarts it with
//! backoff when it dies. Requests are correlated by id, so a slow call never
//! blocks a fast one.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot};

/// Tauri only accepts alphanumerics, '-', '/', ':' and '_' in an event name.
/// A '.' makes emit fail silently at runtime, so names live here as constants
/// and are covered by a test rather than written inline at each call site.
pub const EVENT_STATUS: &str = "worker:status";
pub const EVENT_LOG: &str = "worker:log";

/// Give up after this many crashes in a row; a worker that cannot stay up is
/// a bug to surface, not something to restart forever.
const MAX_RESTARTS: u32 = 5;
/// Enough for a status call or a key check. Work that asks a model to write
/// something passes its own, longer limit.
const CALL_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerStatus {
    pub state: String,
    pub pid: Option<u32>,
    pub restarts: u32,
    pub detail: Option<String>,
}

struct Shared {
    status: Mutex<WorkerStatus>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
}

pub struct Worker {
    shared: Arc<Shared>,
    outbound: mpsc::UnboundedSender<String>,
    next_id: AtomicU64,
}

/// Why the worker stopped. A rebuild is not a crash and must not count
/// against the restart budget, or editing worker code would exhaust it.
enum Stopped {
    Crashed(String),
    CodeChanged,
}

impl Worker {
    pub fn spawn(app: AppHandle) -> Self {
        let (outbound, inbox) = mpsc::unbounded_channel::<String>();
        let (reload_tx, reload_rx) = mpsc::unbounded_channel::<()>();
        let shared = Arc::new(Shared {
            status: Mutex::new(WorkerStatus {
                state: "starting".to_string(),
                pid: None,
                restarts: 0,
                detail: None,
            }),
            pending: Mutex::new(HashMap::new()),
        });

        tauri::async_runtime::spawn(supervise(app, shared.clone(), inbox, reload_rx));

        // Dev only: pick up a recompiled worker without restarting the app.
        if cfg!(debug_assertions) {
            tauri::async_runtime::spawn(watch_for_rebuilds(reload_tx));
        }

        Worker {
            shared,
            outbound,
            next_id: AtomicU64::new(1),
        }
    }

    pub fn status(&self) -> WorkerStatus {
        self.shared
            .status
            .lock()
            .expect("worker status lock poisoned")
            .clone()
    }

    /// Sends one request and waits for its reply.
    pub async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        self.call_with_timeout(method, params, CALL_TIMEOUT).await
    }

    /// For work that legitimately takes minutes — an agent writing from a
    /// batch of document pieces, say.
    pub async fn call_with_timeout(
        &self,
        method: &str,
        params: Value,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (reply_tx, reply_rx) = oneshot::channel();

        self.shared
            .pending
            .lock()
            .expect("worker pending lock poisoned")
            .insert(id, reply_tx);

        let line = serde_json::to_string(&json!({ "id": id, "method": method, "params": params }))
            .map_err(|error| error.to_string())?;

        if self.outbound.send(line).is_err() {
            self.forget(id);
            return Err("the worker is not running".to_string());
        }

        match tokio::time::timeout(timeout, reply_rx).await {
            Ok(Ok(reply)) => reply,
            Ok(Err(_)) => Err("the worker stopped before answering".to_string()),
            Err(_) => {
                self.forget(id);
                Err(format!(
                    "the worker did not answer {method} within {} seconds",
                    timeout.as_secs()
                ))
            }
        }
    }

    fn forget(&self, id: u64) {
        self.shared
            .pending
            .lock()
            .expect("worker pending lock poisoned")
            .remove(&id);
    }
}

/// Emits an event, complaining loudly if Tauri refuses the name. Swallowing
/// this error is how an entire event stream goes missing without a trace.
fn emit_event(app: &AppHandle, event: &str, payload: Value) {
    if let Err(error) = app.emit(event, payload) {
        eprintln!("[testinference] could not emit {event}: {error}");
    }
}

fn event_name_is_valid(event: &str) -> bool {
    !event.is_empty()
        && event
            .chars()
            .all(|c| c.is_alphanumeric() || c == '-' || c == '/' || c == ':' || c == '_')
}

async fn supervise(
    app: AppHandle,
    shared: Arc<Shared>,
    mut outbound: mpsc::UnboundedReceiver<String>,
    mut reload: mpsc::UnboundedReceiver<()>,
) {
    let entry = worker_entry();
    let node = match node_command() {
        Ok(path) => path,
        Err(why) => {
            set_status(&app, &shared, "failed", None, Some(why));
            return;
        }
    };
    let mut restarts: u32 = 0;

    loop {
        set_status(&app, &shared, "starting", None, None);

        let spawned = Command::new(&node)
            .arg(&entry)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn();

        let mut child = match spawned {
            Ok(child) => child,
            Err(error) => {
                set_status(
                    &app,
                    &shared,
                    "failed",
                    None,
                    Some(format!(
                        "could not start {} for {}: {error}",
                        node.display(),
                        entry.display()
                    )),
                );
                return;
            }
        };

        let pid = child.id();
        let mut stdin = child.stdin.take().expect("stdin was piped");
        let stdout = child.stdout.take().expect("stdout was piped");
        let stderr = child.stderr.take().expect("stderr was piped");
        let mut replies = BufReader::new(stdout).lines();

        // The worker logs to stderr; stdout is reserved for the protocol.
        let log_app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut logs = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = logs.next_line().await {
                emit_event(&log_app, EVENT_LOG, json!({ "line": line }));
            }
        });

        set_status(&app, &shared, "ready", pid, None);

        let stopped = loop {
            tokio::select! {
                Some(()) = reload.recv() => {
                    let _ = child.start_kill();
                    break Stopped::CodeChanged;
                }
                Some(line) = outbound.recv() => {
                    if stdin.write_all(line.as_bytes()).await.is_err()
                        || stdin.write_all(b"\n").await.is_err()
                    {
                        break Stopped::Crashed("lost the pipe to the worker".to_string());
                    }
                    let _ = stdin.flush().await;
                }
                line = replies.next_line() => {
                    match line {
                        Ok(Some(line)) => handle_line(&app, &shared, &line),
                        Ok(None) => break Stopped::Crashed("the worker closed its output".to_string()),
                        Err(error) => {
                            break Stopped::Crashed(format!("could not read from the worker: {error}"))
                        }
                    }
                }
                exit = child.wait() => {
                    break Stopped::Crashed(match exit {
                        Ok(status) => format!("the worker exited ({status})"),
                        Err(error) => format!("lost track of the worker: {error}"),
                    });
                }
            }
        };

        // Nobody is going to answer these now.
        let orphaned: Vec<_> = shared
            .pending
            .lock()
            .expect("worker pending lock poisoned")
            .drain()
            .map(|(_, tx)| tx)
            .collect();
        for tx in orphaned {
            let _ = tx.send(Err("the worker stopped before answering".to_string()));
        }

        let stopped_because = match stopped {
            Stopped::CodeChanged => {
                let _ = child.wait().await;
                set_status(
                    &app,
                    &shared,
                    "restarting",
                    None,
                    Some("the worker's code changed".to_string()),
                );
                tokio::time::sleep(Duration::from_millis(150)).await;
                continue;
            }
            Stopped::Crashed(reason) => reason,
        };

        restarts += 1;
        shared
            .status
            .lock()
            .expect("worker status lock poisoned")
            .restarts = restarts;

        if restarts > MAX_RESTARTS {
            set_status(
                &app,
                &shared,
                "failed",
                None,
                Some(format!("{stopped_because} — gave up after {MAX_RESTARTS} restarts")),
            );
            return;
        }

        set_status(&app, &shared, "restarting", None, Some(stopped_because));
        tokio::time::sleep(backoff(restarts)).await;
    }
}

fn handle_line(app: &AppHandle, shared: &Arc<Shared>, line: &str) {
    let Ok(message) = serde_json::from_str::<Value>(line) else {
        // Anything that is not protocol is treated as a log line, never dropped.
        emit_event(app, EVENT_LOG, json!({ "line": line }));
        return;
    };

    if let Some(id) = message.get("id").and_then(Value::as_u64) {
        let waiting = shared
            .pending
            .lock()
            .expect("worker pending lock poisoned")
            .remove(&id);

        if let Some(reply_tx) = waiting {
            let reply = if message.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                Ok(message.get("result").cloned().unwrap_or(Value::Null))
            } else {
                Err(message
                    .get("error")
                    .and_then(|error| error.get("message"))
                    .and_then(Value::as_str)
                    .unwrap_or("the worker refused the request")
                    .to_string())
            };
            let _ = reply_tx.send(reply);
        }
        return;
    }

    if let Some(event) = message.get("event").and_then(Value::as_str) {
        let payload = message.get("payload").cloned().unwrap_or(Value::Null);
        if event_name_is_valid(event) {
            emit_event(app, event, payload);
        } else {
            eprintln!("[testinference] the worker sent an unusable event name: {event}");
        }
    }
}

fn set_status(
    app: &AppHandle,
    shared: &Arc<Shared>,
    state: &str,
    pid: Option<u32>,
    detail: Option<String>,
) {
    let snapshot = {
        let mut status = shared.status.lock().expect("worker status lock poisoned");
        status.state = state.to_string();
        status.pid = pid;
        status.detail = detail;
        status.clone()
    };
    emit_event(app, EVENT_STATUS, serde_json::to_value(snapshot).unwrap_or(Value::Null));
}

/// Watches the built worker entry and asks the supervisor to reload when it
/// changes, so editing worker code behaves like editing the UI. Waits for the
/// file to settle first — a compiler mid-write would start a broken worker.
async fn watch_for_rebuilds(reload: mpsc::UnboundedSender<()>) {
    let entry = worker_entry();
    let mut seen = modified_at(&entry);

    loop {
        tokio::time::sleep(Duration::from_millis(750)).await;

        let current = modified_at(&entry);
        if current == seen {
            continue;
        }

        tokio::time::sleep(Duration::from_millis(400)).await;
        if modified_at(&entry) != current {
            continue; // still being written; catch it on the next pass
        }

        seen = current;
        if reload.send(()).is_err() {
            return;
        }
    }
}

fn modified_at(path: &std::path::Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
}

fn backoff(restarts: u32) -> Duration {
    let millis = 500u64.saturating_mul(1 << restarts.min(5));
    Duration::from_millis(millis.min(10_000))
}

/// Where the worker's entry script lives.
///
/// Dev reads it straight from the repo. Packaging a Node runtime into the
/// bundle is a later slice; until then TESTINFERENCE_SIDECAR can point anywhere.
/// What the file is called on this platform.
const NODE: &str = if cfg!(windows) { "node.exe" } else { "node" };

/// Where Node might be, when nobody has told us.
///
/// An application launched from the Finder inherits almost no PATH —
/// `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else — so the `node` that
/// works perfectly in a terminal is invisible to it. Every model-backed
/// feature would fail with "could not start node", on a machine where
/// node is plainly installed, which is a maddening thing to debug.
#[cfg(windows)]
const KNOWN_NODE: [&str; 2] =
    [r"C:\Program Files\nodejs\node.exe", r"C:\Program Files (x86)\nodejs\node.exe"];

#[cfg(not(windows))]
const KNOWN_NODE: [&str; 5] = [
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    "/opt/local/bin/node",
    "/usr/bin/node",
    "/snap/bin/node",
];

fn on_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    std::env::split_paths(&path).map(|dir| dir.join(name)).find(|full| full.is_file())
}

/// The newest Node a version manager has installed.
///
/// nvm keeps them under `~/.nvm/versions/node/<version>/bin`, and
/// nvm-windows under `%APPDATA%\nvm\<version>`. Neither puts anything on
/// the PATH that an application launched from a desktop will see.
fn from_version_manager() -> Option<PathBuf> {
    let (root, inner): (PathBuf, &[&str]) = if cfg!(windows) {
        (PathBuf::from(std::env::var_os("APPDATA")?).join("nvm"), &[])
    } else {
        (
            PathBuf::from(std::env::var_os("HOME")?).join(".nvm").join("versions").join("node"),
            &["bin"],
        )
    };

    let mut found: Vec<PathBuf> = std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| {
            let mut path = entry.path();
            for part in inner {
                path = path.join(part);
            }
            path.join(NODE)
        })
        .filter(|path| path.is_file())
        .collect();
    found.sort();
    found.pop()
}

pub fn node_command() -> Result<PathBuf, String> {
    if let Ok(given) = std::env::var("TESTINFERENCE_NODE") {
        return Ok(PathBuf::from(given));
    }
    // On Windows the file is node.exe, and looking for "node" finds
    // nothing at all — including on a machine where it is on the PATH.
    if let Some(found) = on_path(NODE) {
        return Ok(found);
    }
    if let Some(found) = KNOWN_NODE.iter().map(PathBuf::from).find(|path| path.is_file()) {
        return Ok(found);
    }
    if let Some(found) = from_version_manager() {
        return Ok(found);
    }
    Err(format!(
        "Node could not be found. Looked on the PATH for {NODE}, in {}, and where nvm keeps \
         its versions. Install Node, or set TESTINFERENCE_NODE to where it is.",
        KNOWN_NODE.join(", ")
    ))
}

fn worker_entry() -> PathBuf {
    if let Ok(path) = std::env::var("TESTINFERENCE_SIDECAR") {
        return PathBuf::from(path);
    }
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .parent()
        .unwrap_or(&manifest)
        .join("sidecar")
        .join("dist")
        .join("index.js")
}

#[cfg(test)]
mod tests {
    use super::{event_name_is_valid, node_command, EVENT_LOG, EVENT_STATUS};

    #[test]
    fn node_is_found_even_without_a_useful_path() {
        // What an application launched from the Finder gets. The terminal
        // this test runs in has a rich PATH, so it is stripped to prove
        // the fallbacks work rather than the PATH working.
        let before = std::env::var_os("PATH");
        unsafe { std::env::set_var("PATH", "/usr/sbin:/sbin") };
        let found = node_command();
        if let Some(path) = before {
            unsafe { std::env::set_var("PATH", path) };
        }

        let found = found.expect("node should be found without a PATH");
        assert!(found.is_file(), "{} should exist", found.display());
        assert!(found.ends_with(super::NODE), "it should be the right filename for this platform");
    }

    #[test]
    fn our_event_names_are_acceptable_to_tauri() {
        for name in [EVENT_STATUS, EVENT_LOG, "worker:hello", "job:event"] {
            assert!(event_name_is_valid(name), "{name} would be rejected by Tauri");
        }
    }

    #[test]
    fn dotted_names_are_rejected() {
        // The bug this guards: emit() fails and the UI simply never updates.
        assert!(!event_name_is_valid("job.event"));
    }
}
