//! The project store.
//!
//! Everything a project knows is kept as small files under a `.testinference`
//! folder — one file per record, so a diff shows exactly what changed and two
//! people editing different records never collide. There is no database.
//!
//! Two guarantees this module adds, because files alone do not give them:
//!   * a single write is atomic — written beside the target, then renamed, so
//!     a crash can never leave half a file;
//!   * a write spanning several files is journalled first and replayed on the
//!     next open, so a crash halfway through cannot leave the project in a
//!     state that never existed.

mod app_map;
mod bdd;
mod cases;
mod decisions;
mod discussions;
mod documents;
mod journal;
mod paths;
mod plans;
mod results;
mod project;
mod requirements;
mod runs;
mod suites;
mod scenarios;
mod tcer;

pub use documents::{
    fingerprint, find_by_fingerprint, id_for, keep_copy, list as list_documents, now, read_chunks,
    save as save_document, write_chunks, DocumentRecord,
};
pub use bdd::{
    clear as clear_bdd, id_for as bdd_id, list as list_bdd, read_library, save as save_bdd,
    save_feature, write_library, BddCase,
};
pub use cases::{
    clear as clear_cases, id_for as case_id_for, list as list_cases, next_id as next_case_id,
    save as save_case, TestCase,
};
pub use app_map::{
    clear as clear_app_map, list as list_app_pages, save as save_app_page, AppPage,
};
pub use plans::{
    clear as clear_plans, list as list_plans, save as save_plan, Plan,
};
pub use results::{
    list as list_attempts, next_id as next_attempt_id, save as save_attempt, Attempt, CaseResult,
};
pub use discussions::{
    for_requirement as discussions_for, next_id as next_discussion_id, save as save_discussion,
    Discussion,
};
pub use decisions::{count as count_decisions, record as record_decision, Decision};
pub use paths::atomic_write;
pub use tcer::{
    clear as clear_tcer, get as get_tcer, id_for as tcer_id, list as list_tcer, save as save_tcer,
    TcerRow,
};
pub use scenarios::{
    clear as clear_scenarios, get as get_scenario, id_for as scenario_id, list as list_scenarios,
    next_id as next_scenario_id,
    save as save_scenario, Scenario,
};
pub use requirements::{
    Wording,
    clear as clear_requirements, id_for as requirement_id, list as list_requirements,
    next_id as next_requirement_id, remove as remove_requirement, save as save_requirement,
    to_csv, MadeBy, Requirement,
    Source,
};
pub use suites::{list as list_suites, save as save_suite, toggle as toggle_suite, Suite};
pub use cases::get as get_case;
pub use runs::{list as list_runs, next_id as next_run_id, save as save_run, Run};
pub use project::{
    create_project, edit_project, list_projects, open_project, read_context, remove_project,
    set_judge_mode, set_sign_in, OpenProject, ProjectRef, Removed, SignIn,
};
