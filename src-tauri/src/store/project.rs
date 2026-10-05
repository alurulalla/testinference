use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::journal::recover;
use super::paths::{atomic_write, context_dir, projects_root, registry_path, slugify, FOLDERS};

/// What `context.yaml` holds: the project itself, and the vocabulary it has
/// learned from the documents. Deliberately small — everything else lives in
/// its own file beside it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Context {
    pub version: u32,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub app_url: String,
    pub created_at: String,
    #[serde(default)]
    pub glossary: Vec<String>,
    /// How to get past the application's login page, when it has one.
    /// The selectors and the username live here and travel to git; the
    /// password never does — it goes in the keychain like any other secret.
    #[serde(default)]
    pub sign_in: Option<SignIn>,
    /// Who answers the small judgement calls: "rules", "model" or "jev".
    /// It lives with the project rather than the app, because it travels
    /// with the project to git and the next person should inherit it.
    #[serde(default = "default_judge_mode")]
    pub judge_mode: String,
}

/// The one deliberate interaction the explorer performs.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignIn {
    /// Playwright expressions, taken from the explored login page.
    pub username: String,
    pub password: String,
    pub submit: String,
    /// The test account. Not a secret, and useful to see in the record.
    pub user: String,
}

fn default_judge_mode() -> String {
    "rules".to_string()
}

/// A project as the project list sees it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRef {
    pub id: String,
    pub name: String,
    pub path: String,
}

/// A project as the app sees it once open, with what is actually stored.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProject {
    pub id: String,
    pub name: String,
    pub app_url: String,
    pub path: String,
    pub context_path: String,
    pub created_at: String,
    pub counts: Vec<FolderCount>,
    /// Set when an interrupted write had to be finished on open.
    pub recovered: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCount {
    pub folder: String,
    pub files: usize,
}

pub fn list_projects(app: &AppHandle) -> Result<Vec<ProjectRef>, String> {
    let path = registry_path(app)?;
    let Ok(text) = fs::read_to_string(&path) else {
        return Ok(Vec::new());
    };
    let mut projects: Vec<ProjectRef> =
        serde_json::from_str(&text).map_err(|error| format!("the project list is unreadable: {error}"))?;

    // A project whose folder has been moved or deleted is not shown as if it
    // were still there.
    projects.retain(|project| context_dir(Path::new(&project.path)).exists());
    Ok(projects)
}

fn save_registry(app: &AppHandle, projects: &[ProjectRef]) -> Result<(), String> {
    let text = serde_json::to_string_pretty(projects).map_err(|error| error.to_string())?;
    atomic_write(&registry_path(app)?, &text)
}

pub fn create_project(
    app: &AppHandle,
    name: &str,
    app_url: &str,
    folder: Option<String>,
) -> Result<OpenProject, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("give the project a name".to_string());
    }

    let id = slugify(name);
    let path = match folder {
        Some(chosen) if !chosen.trim().is_empty() => PathBuf::from(chosen.trim()),
        _ => projects_root(app)?.join(&id),
    };

    if context_dir(&path).exists() {
        return Err(format!(
            "{} already holds a project — open it instead",
            path.display()
        ));
    }

    for folder in FOLDERS {
        let target = context_dir(&path).join(folder);
        fs::create_dir_all(&target)
            .map_err(|error| format!("could not create {}: {error}", target.display()))?;
    }
    let decisions = context_dir(&path).join("decisions");
    fs::create_dir_all(&decisions)
        .map_err(|error| format!("could not create {}: {error}", decisions.display()))?;

    let context = Context {
        version: 1,
        id: id.clone(),
        name: name.to_string(),
        app_url: app_url.trim().to_string(),
        created_at: now(),
        glossary: Vec::new(),
        sign_in: None,
        judge_mode: default_judge_mode(),
    };
    write_context(&path, &context)?;

    let mut projects = list_projects(app)?;
    projects.retain(|project| project.id != id);
    projects.push(ProjectRef {
        id: id.clone(),
        name: name.to_string(),
        path: path.to_string_lossy().to_string(),
    });
    save_registry(app, &projects)?;

    open_project(app, &path.to_string_lossy())
}

/// The project's own record, used by anything that needs its id.
pub fn read_context(project_path: &Path) -> Result<Context, String> {
    let file = context_dir(project_path).join("context.yaml");
    let text = fs::read_to_string(&file)
        .map_err(|_| format!("no project found in {}", project_path.display()))?;
    serde_yaml_ng::from_str(&text).map_err(|error| format!("the project file is unreadable: {error}"))
}

/// Changes a project's name or the application it tests.
///
/// When the project lives in the app's own area the folder is renamed too,
/// so the path on disk does not keep saying something that is no longer
/// true. A project inside a folder the user chose — their test repository,
/// typically — keeps its folder, because moving that would break a git
/// checkout.
pub fn edit_project(
    app: &AppHandle,
    path: &str,
    name: &str,
    app_url: &str,
) -> Result<OpenProject, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("give the project a name".to_string());
    }

    let mut project = PathBuf::from(path);
    let mut context = read_context(&project)?;
    let managed = projects_root(app)
        .map(|root| project.starts_with(&root))
        .unwrap_or(false);

    context.name = name.to_string();
    context.app_url = app_url.trim().to_string();

    let new_id = slugify(name);
    if managed && new_id != context.id {
        let target = projects_root(app)?.join(&new_id);
        if target.exists() {
            return Err(format!("there is already a project folder called {new_id}"));
        }
        context.id = new_id;
        write_context(&project, &context)?;
        fs::rename(&project, &target)
            .map_err(|error| format!("could not rename the folder: {error}"))?;
        project = target;
    } else {
        write_context(&project, &context)?;
    }

    let new_path = project.to_string_lossy().to_string();
    let mut projects = list_projects(app)?;
    projects.retain(|entry| entry.path != path && entry.path != new_path);
    projects.push(ProjectRef {
        id: context.id.clone(),
        name: name.to_string(),
        path: new_path.clone(),
    });
    save_registry(app, &projects)?;

    open_project(app, &new_path)
}

pub fn open_project(app: &AppHandle, path: &str) -> Result<OpenProject, String> {
    let path = PathBuf::from(path);
    let file = context_dir(&path).join("context.yaml");
    let text = fs::read_to_string(&file)
        .map_err(|_| format!("no project found in {}", path.display()))?;
    let context: Context = serde_yaml_ng::from_str(&text)
        .map_err(|error| format!("the project file is unreadable: {error}"))?;

    // Finish anything an earlier crash left half done, before reading counts.
    let recovered = recover(&path)?;

    let counts = FOLDERS
        .iter()
        .map(|folder| FolderCount {
            folder: (*folder).to_string(),
            files: count_files(&context_dir(&path).join(folder)),
        })
        .collect();

    // Keep the registry honest about names that changed on disk.
    let mut projects = list_projects(app)?;
    if !projects.iter().any(|project| project.id == context.id) {
        projects.push(ProjectRef {
            id: context.id.clone(),
            name: context.name.clone(),
            path: path.to_string_lossy().to_string(),
        });
        save_registry(app, &projects)?;
    }

    Ok(OpenProject {
        id: context.id,
        name: context.name,
        app_url: context.app_url,
        path: path.to_string_lossy().to_string(),
        context_path: context_dir(&path).to_string_lossy().to_string(),
        created_at: context.created_at,
        counts,
        recovered,
    })
}

/// What happened when a project was removed, so the screen can say it
/// rather than guess.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Removed {
    /// Where the files went, if they went anywhere.
    pub trashed: Option<String>,
    pub note: String,
}

/// Takes a project off the list, and optionally puts its files in the Trash.
///
/// Two rules keep this from being the destructive thing it looks like.
/// Files always go to the Trash, never straight out — a project is weeks of
/// a person's review decisions, and "are you sure?" is not a backup. And a
/// project living in a folder the user chose, typically their test
/// repository, only ever loses its own `.testinference` folder; deleting the
/// repository around it is not ours to do, whatever the button says.
pub fn remove_project(app: &AppHandle, path: &str, delete_files: bool) -> Result<Removed, String> {
    let project = Path::new(path);

    let mut projects = list_projects(app)?;
    let before = projects.len();
    projects.retain(|entry| Path::new(&entry.path) != project);
    if projects.len() == before && !context_dir(project).exists() {
        return Err("that project is not on the list".to_string());
    }
    save_registry(app, &projects)?;

    if !delete_files {
        return Ok(Removed {
            trashed: None,
            note: "Taken off the list. Nothing on disk was touched, so adding the folder again brings it all back.".to_string(),
        });
    }

    let managed = projects_root(app)
        .map(|root| project.starts_with(&root))
        .unwrap_or(false);
    let target = if managed { project.to_path_buf() } else { context_dir(project) };

    match to_trash(&target) {
        Ok(moved) => Ok(Removed {
            trashed: Some(moved.to_string_lossy().to_string()),
            note: if managed {
                "The project folder is in the Trash. It is recoverable until you empty it.".to_string()
            } else {
                "Its .testinference folder is in the Trash. The folder you chose, and anything else in it, is untouched.".to_string()
            },
        }),
        Err(error) => Ok(Removed {
            trashed: None,
            note: format!("Taken off the list, but the files are still there: {error}"),
        }),
    }
}

/// Moves a path to the Trash rather than deleting it.
///
/// Only implemented where there is a Trash to move it to. Everywhere else
/// this fails and says so, which leaves the files where they are — better
/// than quietly turning "delete" into something unrecoverable.
fn to_trash(target: &Path) -> Result<PathBuf, String> {
    if !target.exists() {
        return Err("there is nothing there to move".to_string());
    }
    if !cfg!(target_os = "macos") {
        return Err("this only moves files to the Trash on macOS — remove the folder yourself".to_string());
    }

    let home = std::env::var("HOME").map_err(|_| "no home folder".to_string())?;
    let trash = PathBuf::from(home).join(".Trash");
    if !trash.is_dir() {
        return Err("no Trash folder on this machine".to_string());
    }

    let name = target
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "project".to_string());

    // The Trash may already hold something of this name from an earlier
    // removal, and overwriting it would destroy the very thing this is
    // trying to protect.
    let mut destination = trash.join(&name);
    let mut attempt = 1;
    while destination.exists() {
        destination = trash.join(format!("{name} {attempt}"));
        attempt += 1;
        if attempt > 100 {
            return Err("too many of these in the Trash already".to_string());
        }
    }

    fs::rename(target, &destination)
        .map_err(|error| format!("could not move it to the Trash: {error}"))?;
    Ok(destination)
}

/// Records how to get past the login page. The password is not stored
/// here: it is handed to the keychain, and this only remembers that there
/// is one.
pub fn set_sign_in(project_path: &Path, sign_in: Option<SignIn>) -> Result<(), String> {
    let mut context = read_context(project_path)?;
    context.sign_in = sign_in;
    write_context(project_path, &context)
}

/// Switches who answers the small judgement calls for this project.
pub fn set_judge_mode(project_path: &Path, mode: &str) -> Result<(), String> {
    if !matches!(mode, "rules" | "model" | "jev") {
        return Err(format!("there is no judgement mode called {mode}"));
    }
    let mut context = read_context(project_path)?;
    context.judge_mode = mode.to_string();
    write_context(project_path, &context)
}

fn write_context(project_path: &Path, context: &Context) -> Result<(), String> {
    let text = serde_yaml_ng::to_string(context).map_err(|error| error.to_string())?;
    atomic_write(&context_dir(project_path).join("context.yaml"), &text)
}

fn count_files(folder: &Path) -> usize {
    fs::read_dir(folder)
        .map(|entries| {
            entries
                .filter_map(Result::ok)
                .filter(|entry| entry.path().is_file())
                .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
                .count()
        })
        .unwrap_or(0)
}

fn now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "unknown".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn a_project(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("ti-judge-{}-{tag}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(context_dir(&dir)).expect("make the project folder");
        let context = Context {
            version: 1,
            id: "sample".to_string(),
            name: "Sample project".to_string(),
            app_url: String::new(),
            created_at: now(),
            glossary: Vec::new(),
            sign_in: None,
            judge_mode: default_judge_mode(),
        };
        write_context(&dir, &context).expect("write the context");
        dir
    }

    #[test]
    fn a_new_project_leaves_judgement_to_the_rules() {
        let dir = a_project("default");
        assert_eq!(read_context(&dir).unwrap().judge_mode, "rules");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_switch_survives_a_reopen() {
        let dir = a_project("switch");
        set_judge_mode(&dir, "jev").expect("switch to jev");
        assert_eq!(read_context(&dir).unwrap().judge_mode, "jev");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn nothing_is_deleted_outright() {
        let dir = a_project("trash");
        let target = dir.join("something.txt");
        fs::write(&target, "work").expect("write the file");

        let moved = to_trash(&target).expect("move it to the Trash");
        assert!(!target.exists(), "it left where it was");
        assert!(moved.exists(), "and it is still somewhere");
        assert_eq!(fs::read_to_string(&moved).unwrap(), "work");
        assert!(moved.starts_with(std::env::var("HOME").unwrap() + "/.Trash"));

        let _ = fs::remove_file(&moved);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_second_removal_does_not_overwrite_the_first() {
        let dir = a_project("trash-twice");
        let first = dir.join("twice.txt");

        fs::write(&first, "the first one").expect("write");
        let one = to_trash(&first).expect("first move");
        fs::write(&first, "the second one").expect("write again");
        let two = to_trash(&first).expect("second move");

        assert_ne!(one, two, "the second must not land on the first");
        assert_eq!(fs::read_to_string(&one).unwrap(), "the first one");
        assert_eq!(fs::read_to_string(&two).unwrap(), "the second one");

        let _ = fs::remove_file(&one);
        let _ = fs::remove_file(&two);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_unknown_mode_is_refused_rather_than_stored() {
        let dir = a_project("unknown");
        assert!(set_judge_mode(&dir, "vibes").is_err());
        assert_eq!(read_context(&dir).unwrap().judge_mode, "rules");
        let _ = fs::remove_dir_all(&dir);
    }
}
