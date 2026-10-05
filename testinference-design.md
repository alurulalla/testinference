# TestInference — Design Document
### Test Design and Test Cases on the desktop app

Draft 3 · 3 October 2026 · for review

*Draft 3: renamed from Bedrock to TestInference; the app shell now carries the full product navigation, with the later sections visible but marked as not yet built.*

*Draft 2: every defect found in the existing app is now corrected rather than carried over — see section 6.*

---

## 1. What this covers

The two modules that turn documents into test assets: **Test Design** (five stages) and **Test Cases** (seven stages). Nothing in them touches the application under test.

**In scope:** reading requirement documents, writing scenarios, completing and scoring them, writing test cases and BDD, validating, human review, suites, publishing, coverage and risk views, CSV exports.

**Out of scope for now:** crawling the app, running tests, devices, self-healing, the failure inbox, the CI loop.

**But present in the shell.** The navigation carries the whole product from day one — Explore, Tests, Runs, Devices, Failures, Fixes, Reports, Dashboards and App Context all appear, marked as not yet built. Nothing moves when they arrive, and anyone shown the app can see where it is going.

**One honest consequence.** Without execution there are no pass or fail results. "Coverage 75%" means three of four requirements have a test case written — not that anything was proven to work. The screen must say so in those words.

---

## 2. Three principles

**AI drafts, rules decide, you approve.** Models write text. Arithmetic decides scores, coverage and risk, so a customer can check the numbers by hand. A person approves at two gates. Keeping that order is what stops this being a plausible-text generator.

**The engine stores, the worker computes, the window shows.** Three processes, already built: a Rust core that owns storage and scheduling, a Node worker that does every computation, and a React window that holds no business logic.

**Nothing leaves the machine.** Documents, requirements and test assets stay local. The only outbound calls are to the model provider you chose, with your own key.

---

## 3. The pipeline

| # | Stage | Who does it | Produces |
|---|---|---|---|
| TD1 | Requirement Intelligence | AI + checks | requirements, summary, clarifications, inferred items |
| TD2 | Scenario Design | AI + checks | scenarios, classed and prioritised |
| — | **Gate A** | you | approved scenario set |
| TD3 | TCER Creation | AI + arithmetic | completed rows with scores and verdicts |
| TD4 | Coverage and RTM | arithmetic | covered / partial / gap per requirement |
| TD5 | Risk Analysis | arithmetic | ranked scenarios with bands |
| TC1 | Test Case Authoring | AI + checks | test cases with numbered steps |
| TC2 | BDD Authoring | AI + checks | Gherkin outlines, step library |
| TC3 | Validation | arithmetic | issues, score, verdict |
| — | **Gate B** | you | approved / rework / rejected |
| TC5 | Suite Structuring | you | Feature, Regression, Release suites |
| TC6 | Publishing | rules | publish records with receipts |
| TC7 | Automation Feasibility | arithmetic | automatable / partial / manual, tool, ROI |

Five stages use a model. Seven are pure arithmetic. Two are human.

---

## 4. The data

Everything hangs off one spine: `reqId`. It travels from the requirement to the scenario, the TCER row, the test case, the BDD case and into the exports. The traceability matrix is only possible because that link is never broken.

### Requirement
`id · title · acceptance · source (file) · anchor (page/paragraph) · impactedAreas · domain · ambiguous · confidence · inferred`

`anchor` is new and matters: the CSV export requires it, and it is what lets a reviewer jump from a requirement back to the sentence it came from. Ingestion must preserve it.

### Scenario
`id · reqId · title · class · priority · precondition · trigger · expected · autoFeasibility · domain · included`

`class` is one of Positive, Negative, Boundary, Security, Edge. `priority` is P1, P2 or P3. `autoFeasibility` is Automatable, Partial or Manual. These are controlled lists, enforced at the schema — they feed the risk arithmetic, and drift breaks it.

### TCER row
`id · scenarioId · reqId · tcId · title · trigger · expected · priority · checks(A,T,V,R) · score · verdict · reasons · comment · removed`

### Test case
`id · scenarioId · reqId · title · description · type · priority · precondition · testData · steps · expected · platform · autoFeasibility · status · approved · reviewer · comment · published · publishId`

`type` is Functional, Regression, Smoke, Traditional or BDD. Steps and expected results are numbered lists that correspond one to one.

### BDD case and step library
`id · scenarioId · reqId · feature · title · description · given · when · then · examples · testData · platform · priority · newSteps[]`
Step library: `id · step · firstSeenIn · usageCount`

### Suite, publish record
Suite: `id · name · view · caseIds[]` — a case may be in several.
Publish record: `caseId · publishId · target · publishedAt`

### Run and lineage
Every artifact records how it was made: `runId · nodeId · attempt · model · promptVersion · inputHash · tokens · cost · jevMode · createdAt · createdBy`.

This is the audit trail. It answers "why did this change", and it makes re-running cheap, because an unchanged input hash with an unchanged prompt reuses the previous answer instead of paying again.

### ID rules
The app assigns every ID, never the model. IDs are allocated once and never renumbered — a test case keeps the same number from TCER through to publishing. (The current web app renumbers between modules; that is one of the defects listed in section 6.)

---

## 5. The arithmetic

These must reproduce exactly. No model is involved in any of them.

**TCER score.** Four checks, 25% each.
- A — title and expected result both present
- T — expected result and trigger both present
- V — expected result contains real text
- R — linked to a requirement ID

Score = checks passed ÷ 4. Pass at ≥75, Rework at ≥50, otherwise Reject. A duplicate title caps the score at 60%, forcing Rework. The average runs over active rows only.

> These are presence checks, not quality measures. The columns will be labelled for what they do, not for what we wish they did.

**Coverage.** Per requirement: **Gap** if no scenarios and no TCER rows, **Partial** if scenarios exist but no active row, **Covered** if at least one active row exists. Verdicts are ignored — a rejected row still counts as covered. Coverage % = covered ÷ total requirements.

**Risk.** `score = (priority × 3) + feasibility + class`
- priority: P1=3, P2=2, P3=1
- feasibility: Manual=3, Partial=2, Automatable=1
- class: Security=3; Negative, Boundary, Error, Recovery=2; Positive, Edge=1

Bands: ≥13 is P1, ≥9 is P2, otherwise P3. Sorted highest first. Targets of five test cases per P1 requirement and three per P2. Cycle C1 for the top row and all P1 rows, C2 for the rest.

**Validation.** Five rules: missing expected result, missing precondition, fewer than two steps, no scenario ID, duplicate title. Score = (1 − issues ÷ 5) × 100 — divided by the real number of rules. Pass at zero issues, Rework at one, Reject at two or more.

**Automation feasibility.** First match wins: `autoFeasibility` contains "auto" → Automatable; contains "partial" → Partial; type is BDD → Automatable; priority is P1 → Partial; otherwise Manual. The scenario's own `autoFeasibility` is carried onto the test case, so the first two rules actually fire. Automatable maps to Selenium/Playwright and high ROI, Partial to manual plus API tests and medium, Manual to low.

---

## 6. Corrections — decided

Everything the existing app gets wrong is corrected here rather than carried over. Five of these change numbers you may be comparing against; those are marked, and the reason is in the row.

| # | Issue | The existing app | TestInference | Numbers change |
|---|---|---|---|---|
| 1 | Feasibility input | the scenario's `autoFeasibility` is never copied onto the generated case, so nothing can ever be classified Automatable | copied onto every case | **yes** |
| 2 | ID stability | cases are renumbered between modules — the same case is TC-012 in one and TC-011 in the next | allocated once, never renumbered | no |
| 3 | Validation score | divides by 4 while having 5 rules, so a case failing all five scores below zero | divides by 5 | **yes** |
| 4 | Empty fields | blanks are filled with "System is in a stable state" and "The system responds correctly", hiding the gap until a later stage | left empty and shown as missing | **yes** |
| 5 | Duplicate detection | exact title match only, which misses every duplicate that matters | meaning-based, on your own machine; exact matches still count | possibly |
| 6 | Priority vocabulary | "High" and "P1" both used for the same field | one list — P1, P2, P3 — enforced at the schema | no |
| 7 | TCER column names | named for quality (atomicity, testability) but implemented as presence checks | named for what they actually check | no |
| 8 | Security class | weighted in the risk formula but never produced by scenario design, so the top risk band is unreachable | produced and allowed by the schema | possibly |
| 9 | Coverage and verdicts | a rejected row still counts as Covered, silently | the number is unchanged, but each row shows how many of its rows are rejected or removed | no |
| 10 | "TCs now" fallback | shows the risk score as the current count when a requirement has no rows — REQ-07 reads 6 | shows 0 | **yes** |
| 11 | Model output | "return ONLY valid JSON" with a simplified retry | the answer shape is enforced; one repair; the raw reply is kept for debugging | no |
| 12 | Assistant context | silently truncated at 12,000 characters | reads only what it needs from the store, and says what it could not see | no |
| 13 | Assistant deletions | applied directly from a model's reply | confirmed by a person, recorded, undoable | no |
| 14 | Model confidence | treated as meaningful | used only for sorting; vagueness is judged separately | no |
| 15 | Module handoff | a browser global, `window.__bedrockTCER` | the project store | no |
| 16 | Authoring from bad rows | writes a test case from every active row, rejected ones included | rejected rows are skipped and listed with their reason | **yes** |

On number 9: changing the coverage formula would break comparison with every report your users already have, so the arithmetic stays and the honesty is added beside it rather than inside it.

## 7. The agents

Six agents that produce work, plus three that support. Each has one job, a fixed shape of input and output, a checker, and a budget. No agent writes to the store — it returns data, and the engine saves it with lineage.

| Agent | Gets | Hands back | Checked by | Budget |
|---|---|---|---|---|
| Ingestor | files | text, chunks, source, anchor | schema | none — no model |
| Requirement Analyst | tagged chunks | requirements, clarifications, inferred | schema, then ambiguity and duplicate checks | 1 repair |
| Scenario Designer | approved requirements | scenarios per requirement | schema, then coverage check | 1 repair, 1 escalation |
| TCER Enricher | included scenarios, in batches | precondition, trigger, expected | TCER arithmetic | 1 repair per row |
| Test Case Writer | active TCER rows, rejected ones skipped | steps, expected results, data | validation rules | 1 repair |
| BDD Author | TCER rows, step library | Gherkin outlines, new steps | Gherkin parser, step matcher | 1 repair |

**Rejected rows are not authored.** A row that failed TCER scoring does not become a test case. It stays visible with its reason, and a row can be sent back for authoring by hand once it is fixed. Nothing disappears silently: the authoring screen states how many rows were left out and why.

Support: the **Clarifier** (the BA chat), the **Reporter** (summaries, cheapest model), and the **Assistant** (the chat box that can change data — the only one that uses tools).

**The loop.** Agent drafts → checker checks → if it fails, the agent gets one more try and is told exactly which checks failed → if it fails again, a stronger model tries → if that fails, it comes to you. Every attempt and escalation is recorded.

**Empty fields stay empty.** The current app fills blanks with "The system responds correctly", which hides the gap until validation finds it a stage later. We leave it blank and show it as missing.

---

## 8. The nine decisions, and the Jev switch

Jev is one switch per project, in Settings → Judgement, stored in the project's
`context.yaml` so it travels to git. Rules by default.

Jev is TypeSafe's System One model: `POST https://api.typesafe.ai/v1/systemone`, bearer key.
It takes the material to judge as a `state` and a map of typed questions about it, and
answers every question against that state in parallel. Three question types: **noul** (a
graded yes/no returned as a probability), **choice** (one option from a set, with the full
distribution), **score** (a rubric, probability-weighted). It returns no prose, so there is
no schema to coax and nothing to repair.

A noul carries no separate confidence, because the number *is* the confidence: 0.95 is a
confident yes, 0.05 a confident no, 0.5 the model saying it does not know. On the same
scale as choice and score confidence that is `|2p − 1|`, which is what the gate uses.

All nine, with what was measured against the live API on 2026-10-05 using the
120-requirement project. ✔ means wired and in use; ✘ means deliberately not sent to Jev.

| Decision | Jev on | Jev off |
|---|---|---|
| Which chunks carry requirements ✔ | one noul per piece; dropped only at ≥70% certainty | read everything |
| Is this requirement too vague ✔ | Jev judges, one noul each | a keyword rule: a promise with no number |
| Have we seen this requirement before ✔ | Jev compares meaning, one noul per shortlisted pair | on-device similarity, no AI |
| Class and feasibility ✔ | one choice each, applied above 60% | the writing model labels |
| Priority ✘ | not asked — see below | the writing model labels |
| Are these scenarios enough ✔ | two nouls: is it tested working, is it tested failing | rule: at least one positive and one negative per requirement |
| Is this step already in the library ✔ | one noul against the closest candidate, no word threshold | on-device similarity, no AI |
| Does this case match its scenario ✔ | one noul per case | skipped, and the screen says so |
| Is the chat asking to delete ✔ | one noul, and it can only add to the list, never remove | always confirm with the user |
| Which model for this job ✘ | not built — see below | the fixed assignment table |

Jev never writes content. It answers typed questions — a label, a yes/no, a score — and nothing else.

### The two that are not sent to Jev

**Priority.** Measured on 20 real scenarios: 51% mean confidence as a `choice`, 50% as an
ordered `score`, agreeing with the writing model 6 and 7 times out of 20. Passing the parent
requirement alongside made it slightly worse and cost 17% more tokens. Two primitives both
landing on a coin flip is the material saying it does not contain the answer — what a
failure costs the business is not in a scenario title. Priority feeds the risk score
(priority × 3), so acting on a 50% answer would move a visible number on a guess. Class and
feasibility come back at 88% and 95%, agreeing 19 out of 20, which is why those are asked.

**Model routing.** Deliberately not built. It would put a judgement call before every model
call, and make two runs over the same documents differ for a reason nobody can see. The
assignment table is a decision a person makes once, visibly, in Settings — that is better
than a routing choice made 300 times a run and recorded nowhere.

Behind one interface with three implementations: the rules, a small model with a
constrained answer shape, or Jev. Same call sites either way. Every run records which mode
it used, because the three can produce different results.

The modes are not simply better and worse. With rules or a model, code answers first and
only what it is unsure about is passed on — there is no reason to pay for a question code
already answers confidently. With Jev every question goes to Jev, because a graded answer
with honest uncertainty is worth more than a keyword rule and costs a fraction of a cent.
The one thing the rules keep doing under Jev is shortlisting which requirement pairs are
worth comparing at all: every pair is every pair, and a hundred requirements is five
thousand of them.

The risk formula, TCER scoring, validation, coverage and feasibility stay arithmetic in both modes. They are never handed to a model.

---

## 9. The model socket

Agents ask for "my assigned model", never for a named vendor.

**Three connection shapes cover the field:** Anthropic (Claude Opus 5, Sonnet 5, Haiku 4.5); OpenAI-shaped (OpenAI, Azure OpenAI, Groq, Together, OpenRouter, DeepInfra, and every local runner — Ollama, LM Studio, vLLM); and Google Gemini.

**Model names are fetched live** from each provider, never hardcoded. You pick from what your key can actually see.

**Self-test on add.** When you add a model the app runs a small version of each real job and records what it can do: structured answers or not, how much text it holds, how fast, what it costs. The per-job picker then only offers models that can do that job, and warns if you override.

**Per-job assignment.** Judging and labelling on a small cheap model, scenario design on your strongest, writing in the middle, summaries on the cheapest. Set per project.

**Private mode.** Local models only, no cloud fallback. If the local model fails, the run stops and says so rather than quietly sending your requirements elsewhere.

**Keys** live in the OS keychain, one per provider, never on disk, never returned to the window. Local endpoints usually need none.

**Spend guards.** An estimate before every run, a hard stop per run, and a cap on how many model calls run at once.

---

## 10. The manager

Ordinary code, not a model. It knows the order of the stages, hands work to the agents, and writes down what happened.

A **run** is rows in the database: the run, its nodes, and each attempt. The manager picks the next node, sends it to the worker, saves the result, and moves on. Because the state is in the database and the worker holds none, a worker crash costs one node, not the run — and quitting the app mid-run is safe.

Three kinds of node: an **agent** node, a **compute** node (the arithmetic), and a **gate** node, which parks the run until a person acts.

Work that repeats per requirement or per batch fans out, with a limit tied to the spend guard. Re-running a node whose input and prompt are unchanged reuses the stored answer instead of paying again.

Progress streams to the window as it happens, using the event path already built.

---

## 11. The two gates

**Gate A** sits after scenario design. You approve, edit or reject the set. Rejection sends the designer back with your reason attached. Nothing is generated until this is settled.

**Gate B** is the review of each authored case: approved, rework or rejected, with a comment. Only approved cases reach suites and publishing.

A gate is a recorded state, not a screen flag: who decided, when, what they changed, and what the artifact looked like before. That record is what makes the output defensible to an auditor.

---

## 12. Ingestion

Files in, text out, with provenance. For v1: PDF, DOCX, Markdown, plain text, CSV and XLSX. Deferred: PPTX, images with OCR, video, Figma, Jira and ADO.

Every chunk keeps its file name and its location inside the file, because the requirement export must carry both. Text from documents is treated as untrusted — see section 14.

---

## 13. What the screens show, and what exports

Each stage has two views and they differ. The requirement table on screen shows ID, title, acceptance and flag; the CSV adds source, anchor, impacted areas and confidence. The same split exists at the other stages. Both are part of the contract and both get tested.

---

## 14. Safety

**Document text is untrusted.** It comes from customers and may contain anything, including sentences aimed at the model. It is fenced as data in every prompt and never treated as instruction.

**The chat box cannot quietly destroy anything.** Its changes go through the same validated commands the buttons use, with the same audit record and undo. Deletions are confirmed by a person, every time, regardless of how confident anything is.

**Secrets never reach a prompt.** Keys stay in the keychain and are used only for the call itself.

---

## 15. How we will know it works

The tab output reference carries one worked example through all twelve stages with every number reproducible. Because of the corrections in section 6, the test suite holds **two** expected sets.

**Unchanged by the corrections — these must match exactly:** 8 requirements, 12 scenarios, TCER average 93%, coverage 6 covered / 1 partial / 1 gap = 75%, risk bands 2 / 8 / 2, 10 published.

**Changed by the corrections — these are the deliberate differences:**

| Measure | Existing app | TestInference | Why |
|---|---|---|---|
| Automation feasibility | 0 automatable, 8 partial, 2 manual | 8 automatable, 2 partial, 0 manual | the scenario's feasibility is now carried through, so the real rules fire |
| Validation score, the uploaded legacy case | 25 | 40 | divided by 5 rules, not 4 |
| Test cases authored | 12 — 11 from rows, 1 uploaded | 11 — 10 from rows, 1 uploaded | the one rejected TCER row is no longer authored |
| Validation verdicts | 10 pass, 1 rework, 1 reject | 10 pass, 0 rework, 1 reject | the weak case never reaches validation; the uploaded legacy case is still rejected |

Those last two rows are the argument for corrections 4 and 16 in one line: the existing app turns an empty TCER row into a test case that looks half-acceptable. Ours declines to write it, says so, and shows you the row that needs fixing instead.

Together these two sets are our acceptance test. The arithmetic gets built and proven against those numbers **before any model is wired in**. It separates two questions that are tangled together in the current app: is the maths right, and is the AI's writing any good.

For the agents, a small set of known-good documents and their expected output, scored and tracked over time. This is also how a customer answers "is this local model good enough" — run the fixture, read the score.

---

## 16. Build order

1. The store and stable IDs
2. The five arithmetic engines, proven against the fixture
3. Ingestion with provenance
4. Requirement Intelligence end to end — the first real agent
5. Scenario Design and Gate A
6. TCER, coverage and risk
7. Test cases, BDD and the step library
8. Validation, Gate B, suites, publishing
9. The Assistant
10. The Jev implementation, when the API exists

Each step ends with something you can use and judge.

---

## 17. Still open

1. Parity or correction on the three defects in section 6.
2. Is the existing web app's source available? Reading it would settle edge cases faster than any document.
3. Which document formats are genuinely needed in v1.
4. Does the stepper-and-tabs interaction model go, or just its styling?
5. Is the account / application / journey hierarchy from the existing app in scope, or stubbed?
6. Jev's API, whenever it exists.

---

*Draft for discussion. Nothing here is built yet.*
