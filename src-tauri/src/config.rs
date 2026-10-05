//! Non-secret settings: which model does which job, what the budgets are,
//! and what each model proved it could do. Anything sensitive belongs in
//! secrets.rs instead.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};

/// The jobs a model can be assigned to. They are not equally hard, which is
/// the whole point of assigning them separately.
pub const JOBS: [(&str, &str); 7] = [
    ("read-documents", "Reading documents"),
    ("design-scenarios", "Designing scenarios"),
    ("complete-tcer", "Completing TCER rows"),
    ("write-cases", "Writing test cases"),
    ("write-bdd", "Writing BDD"),
    ("judge", "Judging and labelling"),
    ("summarise", "Summaries"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Budgets {
    /// A single run stops here rather than quietly spending more.
    pub per_run: f64,
    pub monthly: f64,
    /// How many model calls may be in flight at once.
    pub max_parallel: u32,
}

impl Default for Budgets {
    fn default() -> Self {
        Budgets { per_run: 10.0, monthly: 150.0, max_parallel: 4 }
    }
}

/// What a model costs, per million tokens. Nothing is hardcoded: published
/// prices change, and a wrong number in a budget is worse than no number.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Price {
    pub input_per_million: f64,
    pub output_per_million: f64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AppConfig {
    pub prices: BTreeMap<String, Price>,
    /// OpenAI-compatible endpoint for a locally hosted model.
    pub local_endpoint: Option<String>,
    /// For anything else OpenAI-shaped that is not OpenAI itself.
    pub openai_endpoint: Option<String>,
    /// Where Jev answers. There is no default: an unset endpoint is how the
    /// app knows Jev is not available yet.
    pub jev_endpoint: Option<String>,
    /// Which Jev model to ask for, if it offers more than one.
    pub jev_model: Option<String>,
    /// Job name to "provider:model".
    pub assignments: BTreeMap<String, String>,
    pub budgets: Budgets,
    /// What the last self-test found, per model.
    pub capabilities: BTreeMap<String, Value>,
    /// Local models only; no falling back to a cloud provider.
    pub private_mode: bool,
    /// So the app opens where you left it.
    pub last_project: Option<String>,
}

pub fn load(app: &AppHandle) -> AppConfig {
    let Ok(path) = config_path(app) else {
        return AppConfig::default();
    };
    let Ok(text) = fs::read_to_string(path) else {
        return AppConfig::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

pub fn save(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| format!("could not create {parent:?}: {error}"))?;
    }
    let text = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(&path, text).map_err(|error| format!("could not write {path:?}: {error}"))
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("config.json"))
        .map_err(|error| format!("no config directory: {error}"))
}
