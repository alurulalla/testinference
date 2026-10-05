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
    /// Filled in on this side, after the page comes back from the walk.
    /// Without a default, every page the crawler sent failed to parse and
    /// was skipped — so the map stayed empty while the screen reported
    /// finding pages.
    #[serde(default)]
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Exactly what the crawler sends back, as it sends it.
    ///
    /// This is the test that was missing. `seenAt` is filled in on this
    /// side, and while the field had no default every page failed to
    /// parse and was dropped without a word — so Explore reported finding
    /// pages and saved none of them.
    const FROM_THE_CRAWLER: &str = r#"{
        "url": "https://www.saucedemo.com",
        "title": "Swag Labs",
        "fingerprint": "76132b8b",
        "pattern": "https://www.saucedemo.com",
        "shape": "c2a20bc6",
        "examples": [],
        "links": [],
        "from": null,
        "elements": [{
            "tag": "input",
            "role": "textbox",
            "name": "Username",
            "how": "testId",
            "selector": "locator('[data-test=\"username\"]')",
            "sturdiness": 1.0,
            "matches": 1,
            "checked": true,
            "kind": "input"
        }]
    }"#;

    #[test]
    fn a_page_from_the_crawler_can_be_read() {
        let page: AppPage = serde_json::from_str(FROM_THE_CRAWLER).expect("it should parse");
        assert_eq!(page.url, "https://www.saucedemo.com");
        assert_eq!(page.elements.len(), 1);
        assert_eq!(page.elements[0].matches, 1);
        assert!(page.seen_at.is_empty(), "it is filled in after the walk");
    }

    #[test]
    fn a_page_survives_being_saved_and_read_back() {
        let dir = std::env::temp_dir().join(format!("ti-map-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(context_dir(&dir)).expect("make the project");

        let mut page: AppPage = serde_json::from_str(FROM_THE_CRAWLER).expect("parse");
        page.seen_at = "2026-10-05T00:00:00Z".to_string();
        save(&dir, &page).expect("save it");

        let read = list(&dir);
        assert_eq!(read.len(), 1, "it should come back");
        assert_eq!(read[0].elements[0].selector, page.elements[0].selector);

        let _ = fs::remove_dir_all(&dir);
    }
}
