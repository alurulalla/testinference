use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use super::paths::{atomic_write, context_dir, slugify};

/// What the application actually looks like, as opposed to what the
/// documents say about it.
///
/// This is the half of the app context that no document can provide: the
/// real pages, the real controls, and a way of finding each one again
/// tomorrow. Test code written without it is guessing at someone's HTML.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Element {
    pub tag: String,
    pub role: Option<String>,
    pub name: Option<String>,
    /// testId · role · label · placeholder · text · css
    pub how: String,
    pub selector: String,
    /// How well this selector should survive a redesign, 0 to 1.
    pub sturdiness: f64,
    /// How many elements it matched when it was tried. Anything but one
    /// means a test using it would act on whichever came first.
    #[serde(default)]
    pub matches: u32,
    /// Whether the selector was tried. Not every one is: a page with a
    /// thousand links is capped, and untried is not the same as broken.
    #[serde(default)]
    pub checked: bool,
    /// input · control · link · text
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPage {
    pub url: String,
    pub title: String,
    /// Changes when the page's controls change, so a re-explore knows what
    /// is new without re-reading everything.
    pub fingerprint: String,
    /// The address with its identifiers removed, as in /product/{}.
    #[serde(default)]
    pub pattern: String,
    /// What the page is made of, with the words left out. Two product
    /// pages differ in every name and in nothing else.
    #[serde(default)]
    pub shape: String,
    /// Other addresses that turned out to be this same screen.
    #[serde(default)]
    pub examples: Vec<String>,
    pub elements: Vec<Element>,
    #[serde(default)]
    pub links: Vec<String>,
    pub from: Option<String>,
    pub seen_at: String,
}

fn folder(project_path: &Path) -> std::path::PathBuf {
    context_dir(project_path).join("app")
}

/// A filename from a URL. The host is dropped: a project explores one
/// application, and the path is what distinguishes its pages.
fn name_for(url: &str) -> String {
    let path = url
        .split("://")
        .nth(1)
        .and_then(|rest| rest.split_once('/'))
        .map(|(_, path)| path)
        .unwrap_or("");
    let slug = slugify(path);
    if slug == "project" || slug.is_empty() { "index".to_string() } else { slug }
}

pub fn list(project_path: &Path) -> Vec<AppPage> {
    let Ok(entries) = fs::read_dir(folder(project_path)) else {
        return Vec::new();
    };
    let mut pages: Vec<AppPage> = entries
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().is_some_and(|ext| ext == "yaml"))
        .filter_map(|entry| fs::read_to_string(entry.path()).ok())
        .filter_map(|text| serde_yaml_ng::from_str(&text).ok())
        .collect();
    pages.sort_by(|left, right| left.url.cmp(&right.url));
    pages
}

pub fn save(project_path: &Path, page: &AppPage) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(page).map_err(|error| error.to_string())?;
    atomic_write(&folder(project_path).join(format!("{}.yaml", name_for(&page.url))), &text)
}

pub fn clear(project_path: &Path) -> Result<(), String> {
    let target = folder(project_path);
    if target.exists() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("could not clear {}: {error}", target.display()))?;
    }
    fs::create_dir_all(&target).map_err(|error| format!("could not create {target:?}: {error}"))
}
