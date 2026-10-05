use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager};

/// The folder every project carries. The name is deliberate: when a project
/// lives in a test repository, this is the folder that gets committed.
pub const CONTEXT_DIR: &str = ".testinference";

/// Created up front so the layout is identical everywhere, empty or not.
pub const FOLDERS: [&str; 13] = [
    "documents",
    "requirements",
    "scenarios",
    "tcer",
    "cases",
    "bdd",
    "steps",
    "suites",
    "runs",
    "discussions",
    "app",
    "plans",
    "results",
];

/// Where projects live when the user does not choose a folder of their own.
pub fn projects_root(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("projects"))
        .map_err(|error| format!("no application folder: {error}"))
}

/// The list of projects this machine knows about.
pub fn registry_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join("projects.json"))
        .map_err(|error| format!("no application folder: {error}"))
}

pub fn context_dir(project_path: &Path) -> PathBuf {
    project_path.join(CONTEXT_DIR)
}

/// Writes a file so that it either lands whole or not at all.
pub fn atomic_write(path: &Path, contents: &str) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("{} has no parent folder", path.display()))?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;

    let temporary = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("write")
    ));

    {
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("could not open {}: {error}", temporary.display()))?;
        file.write_all(contents.as_bytes())
            .map_err(|error| format!("could not write {}: {error}", temporary.display()))?;
        file.sync_all()
            .map_err(|error| format!("could not flush {}: {error}", temporary.display()))?;
    }

    fs::rename(&temporary, path)
        .map_err(|error| format!("could not finish writing {}: {error}", path.display()))
}

/// Turns a project name into something safe to use as a folder name.
pub fn slugify(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = true; // also trims any leading dash

    for character in name.chars() {
        if character.is_ascii_alphanumeric() {
            slug.push(character.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }

    while slug.ends_with('-') {
        slug.pop();
    }

    if slug.is_empty() {
        "project".to_string()
    } else {
        slug.chars().take(60).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugs_are_safe_folder_names() {
        assert_eq!(slugify("Metrolinx PRESTO App"), "metrolinx-presto-app");
        assert_eq!(slugify("  Fare / Rules  "), "fare-rules");
        assert_eq!(slugify("...."), "project");
    }

    #[test]
    fn a_write_either_lands_whole_or_not_at_all() {
        let dir = std::env::temp_dir().join(format!("ti-paths-{}", std::process::id()));
        let target = dir.join("sub").join("thing.yaml");

        atomic_write(&target, "one: 1\n").expect("first write");
        assert_eq!(fs::read_to_string(&target).unwrap(), "one: 1\n");

        atomic_write(&target, "two: 2\n").expect("overwrite");
        assert_eq!(fs::read_to_string(&target).unwrap(), "two: 2\n");

        let leftovers: Vec<_> = fs::read_dir(target.parent().unwrap())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "a temporary file was left behind");

        let _ = fs::remove_dir_all(dir);
    }
}
