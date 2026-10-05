# Bedrock QE App User Flow and Unified UI Reference

This document transcribes the QE application user-flow specification and the unified UI examples shown in the supplied images.

---

# Part I — QE App User Flow

## Overview

How a QA Engineer uses the Bedrock desktop app end to end—from installation to a first full run, to everyday regression and CI-failure loops. AI agents do the heavy lifting; the tester steers, approves at **Gate A** (scenarios) and **Gate B** (fixes), and confirms real bugs.

| Stage | Activity | Summary |
|---:|---|---|
| 1 | Set up | Install, SSO, keys |
| 2 | Connect | Repository, CI, devices |
| 3 | Create project | App, surfaces, inputs |
| 4 | Explore | Watch the app model grow |
| 5 | Gate A | Approve scenarios |
| 6 | Build and run | Generate, review, run |
| 7 | Investigate | Failure Inbox, triage |
| 8 | Gate B | Approve fixes, confirm bugs |
| 9 | Ship and repeat | PR, reports, regression |

---

## 00. Personas

The QA Engineer is the primary user. Other roles touch the same project through role-aware screens or tools.

### QA Engineer

**Primary:** tester / SDET

- Creates projects and connects devices.
- Starts exploration and regression runs.
- Approves scenarios at Gate A and fixes at Gate B.
- Investigates failures and confirms bugs.

### QA Lead / PM

**Reviewer:** approver

- Reads dashboards, trends, and feature health.
- Checks traceability and coverage gaps.
- Approves scenarios when policy requires.
- Exports reports for release sign-off.

### Developer

**Consumer:** via PR and AI IDE

- Receives test PRs and fix PRs.
- Gets Jira bugs with video, logs, and steps.
- Uses Bedrock from Claude Code, Cursor, or Copilot via MCP.

### Org Admin

**Setup:** governance

- Manages SSO, organisations, roles, and licences.
- Defines AI policy and budgets.
- Approves MCP servers and releases.

---

## A. Onboarding — One-Time Setup

Estimated duration: about 15 minutes. After setup, the app works offline for up to 14 days, and nothing is uploaded by default.

### A1. Admin sets up organisation

- Web console: SSO (OIDC/SAML), roles, AI policy, and budgets.
- Owner: Org Admin.

### A2. Install desktop app

- Windows, macOS, and Linux.
- Signed binaries are verified at startup.
- Screen/action: **Installer**.

### A3. Sign in with SSO

- A signed licence is issued.
- Includes a 14-day offline grace period.
- Screen/action: **Sign-in**.

### A4. Add AI keys (BYOK)

- Add Jev and Claude keys to the OS keychain.
- Alternatively choose a local LLM for private projects.
- Screen: **Settings › AI**.

### A5. Connect integrations

- Git repository and CI: GitHub, GitLab, Jenkins, or Azure.
- Jira, Slack/Teams, and Figma.
- Screen: **Settings › Integrations**.

### A6. Connect devices

- Automatic discovery over USB/LAN and simulators.
- Optional device farm.
- Device health check runs.
- Screen: **Devices**.
- Agent note: **Jev — device health**.

---

## B. First Full Run of a New App — Swimlane

This is the main journey. Every step shows who decides; dashed cards represent decisions. A 100-test web app costs approximately **$5.50 in AI usage** on the customer’s own keys.

### Swimlanes

| Lane | Responsibility |
|---|---|
| QA Engineer | Steers and approves |
| Bedrock Desktop UI | Screens and live views |
| AI agents | Jev System-1 decides; Claude writes |
| Devices and external systems | Devices, Git, Jira, Slack |

### B1. Create project

- Supply the name and app under test.
- Supported forms shown: URL, APK/IPA, TV app, and device app.
- Define surfaces and environments.

### B2. Add inputs

- Requirements: PRD, stories, OpenAPI.
- Figma.
- Test accounts, stored in the vault.
- Existing tests.

### B3. Ingest and build context

- Documents are chunked and indexed.
- An initially empty App Context is created for the app.
- Agent note: **Jev — chunk tags**.

### B4. Start exploration

- Select devices and budget.
- Budget dimensions shown: states, time, and tokens.

### B5. Explorer loop

- Observe → decide next action → act → observe the new state.
- The guard blocks destructive actions.
- Communicates with leased device sessions for Web, Mobile, TV, and IoT through surface drivers.
- Agent notes: **Jev — approximately 90% of steps**; **Opus — feature synthesis**.

### B6. Live Device View

- Watch screens, the state graph, and coverage grow.
- Pause, steer, or stop the exploration.

### B7. Planner

- Maps requirements to features.
- Finds gaps and scores risk.
- Designs P0–P3 scenarios.
- Agent notes: **Jev — risk and deduplication**; **Opus — design**.

### B8. Gate A — Approval Center

Scenarios are listed riskiest first.

- **Approve** → generate.
- **Edit** → save as feedback.
- **Reject** → Planner re-plans.
- Decision owner: **Human**.

### B9. Test Generator

- Converts Scenario IR into stable locators, framework-native code, and page objects.
- Agent notes: **Jev — template or LLM?**; **Sonnet — code**.

### B10. Reviewer and quality gate

- Runs linting, weak-test detection, a locator dry run, and executes twice to check for flakiness.
- **Pass** → continue.
- **Block** → regenerate once, then route to a human.
- Decision sources: rules and **Jev — judge**.

### B11. Code & Diff

- The tester reviews generated tests.
- The tester commits them to a branch in the customer-owned Git test repository.
- Generated output is ordinary Playwright or WebdriverIO code.

### B12. Run tests

- Start with the Run button or `bedrock run`.

### B13. Runner

- Queue → shard → match devices → run sandboxed workers.
- Communicates with executing devices.
- Supports 16+ parallel sessions.
- Device loss causes affected shards to be rerun.
- Agent note: **Jev — test and device selection**.

### B14. Live run → Failure Inbox

- Shows progress by device.
- Failures arrive with evidence: video, trace, logs, and network data.

### B15. Triage

- Rules run first.
- Jev classifies clusters.
- Opus determines root cause when confidence is low.
- A human decides if uncertainty remains.
- Agent notes: **Jev — class and severity**; **Opus — root cause**.

Triage routes:

- **Flaky/environmental** → Quarantine / retry.
- **Broken test** → Fixer.
- **Real bug** → Bug draft.

#### Quarantine / retry

- Flaky: quarantined and confirmed by rerun.
- Environment: retry and notify.

### B16. Fixer

- Applies a deterministic repair.
- Sonnet writes a patch.
- Reruns locally up to three times.
- Compares before/after evidence.
- Agent notes: **Jev — strategy and “really fixed?”**; **Sonnet**, escalating to **Opus**.

### Bug draft

- Deduplicates against Jira.
- Attaches steps, video, logs, and device information.
- Agent note: **Jev — duplicate? and priority**.

### B17. Confirm bug

- **File in Jira**, or
- **Not a bug** → feedback to triage.
- Decision owner: **Human**.

### B18. Gate B — Approve fix

- Shows the diff, rationale, and before/after evidence.
- **Approve** → open PR.
- **Request changes** → return to Fixer.
- Decision owner: **Human**.

### B19. PR opened, Jira filed, Slack alert

- Customer CI runs again on the PR.

### B20. Reports and context saved

- Saves traceability, coverage, and dashboards.
- Produces a Haiku summary.
- Commits an App Context snapshot to `.bedrock/context`.

---

## C. Regression Run on a New Build — Everyday Flow

Bedrock does not start from scratch. It loads existing knowledge, explores only what changed, and generates only the gaps. The displayed estimate is approximately **$1 in AI usage**, around **80% cheaper than the first run**.

| Step | Stage | Details | Decision / Agent |
|---|---|---|---|
| C1 | New build | Tester drops a build, selects a version, or a schedule fires | Home |
| C2 | Load context | Repository and local index; App Model, locator memory, baseline, and decisions | — |
| C3 | Change detection | Compare build, screens, and document diff with the last snapshot | Jev: changed? |
| C4 | Per feature | Reuse as-is, update, or regenerate | Jev: reuse or regenerate? |
| C5 | Explore only changes | Delta crawl on changed screens | Explore |
| C6 | Gate A (delta) | Approve only new or changed scenarios | Human |
| C7 | Generate gaps | Claude writes only the delta | Sonnet |
| C8 | Impacted-test run | Run what the change touches, plus P0 smoke tests | Jev: test selection |
| C9 | Triage and fix | Same process as B15–B19 | Failures / Fixes |
| C10 | Learn and snapshot | Version locator stability, flakiness, and fixes that worked; commit snapshot | — |

---

## D. CI Failure Loop

The same tests run in the customer’s pipeline. Failed scenarios return automatically to the tester’s Failure Inbox. CI evidence stays in the CI system; the cloud relays metadata only.

| Step | Stage | Details |
|---|---|---|
| D1 | Push / PR / nightly | Triggers the customer CI job |
| D2 | CI runs tests | GitHub Actions, GitLab, Jenkins, or Azure DevOps |
| D3 | Bedrock Reporter | CI plug-in packages each failure as an evidence-bundle artifact |
| D4 | Signed webhook | Bedrock Cloud verifies the webhook and notifies the desktop using metadata only |
| D5 | Desktop notification | Example: “Nightly run: 4 new failures” — Jev decides notification and pull order |
| D6 | CI Collector | Downloads artifacts from CI and normalises them to the local format |
| D7 | Failure Inbox | Local and CI failures appear in one list, tagged by source; Jev asks whether each is new/known and blocks release if appropriate |
| D8 | Triage → fix → Gate B | Same loop as the local failure-handling flow; human gate |
| D9 | Fix PR | CI runs again and validates the fix |

---

## E. Failure Handling — What Happens to Each Failure

Failures are grouped by root cause—one card per cause, not one card per test. Every verdict routes to a different next step. Real bugs are never “healed.”

### Initial classification

**Failure in Inbox (local or CI)**

Signature parser → rule engine → clustering → Jev classification → confidence check → Opus for low-confidence/real-bug analysis → human if still uncertain.

### Broken test

The application changed but the test did not.

1. Fixer tries a deterministic repair, such as a unique locator swap.
2. Jev selects a strategy: locator, wait, or data.
3. Sonnet writes the patch; Opus is used after two failures.
4. Assertion Guard ensures an assertion is never weakened.
5. Rerun on the same device and compare evidence, with a maximum of three attempts.
6. **Gate B:** the tester approves the PR.

### Real bug

The application behaves incorrectly.

1. Opus writes the root-cause analysis.
2. Jev checks for a duplicate in existing Jira issues and assigns P1–P4 priority.
3. Haiku drafts the bug text and steps.
4. Attach video, logs, and device information.
5. The tester confirms the issue, which is then filed in Jira or Linear.
6. Notify the owner in Slack or Teams.

### Flaky test

The test passes and fails on retry.

1. Confirm flakiness through rerun.
2. Quarantine the test; avoid endless reruns.
3. Save the learned pattern to App Context.
4. Show the issue on Dashboards › Flaky.
5. Fixer may propose a stabilising fix, which then goes to Gate B.

### Environment

Examples include device, network, or backend outages.

1. Jev decides whether the issue is infrastructure or test-related; infrastructure gets retry only.
2. Device Manager quarantines or power-cycles the device.
3. Rerun the shard on another device.
4. Notify the team if the environment remains down.

---

## F. QA Lead and Developer Flows

### QA Lead / PM — Release Readiness

| Step | Action | Details |
|---|---|---|
| F1 | Open Dashboards | Pass rate, flaky trend, feature health, device status |
| F2 | Reports › Traceability | Requirement ↔ test ↔ result; coverage gaps highlighted |
| F3 | Approve pending scenarios | Used when project policy routes Gate A to the lead |
| F4 | Export and share | HTML/PDF report readable without Bedrock, JUnit/JSON, Slack |

### Developer — Inside an AI IDE via MCP

| Step | Action | Details |
|---|---|---|
| F5 | Connect IDE to Bedrock MCP server | Claude Code, Cursor, or Copilot; local, authenticated, same guards |
| F6 | `run_tests` → `get_failures` | Run impacted tests for the developer’s change |
| F7 | `explain_failure` · `query_app_model` | Understand what broke and where |
| F8 | `coverage_gaps` → `generate_test` | Add tests for new code; write actions still require approval |

---

## G. Step-to-Screen Map

This map identifies the unified UI screen for each action, what the user does, and the completion condition. Human gates are the explicit approval steps.

| Step | Screen | User action | System response | Decided by | Done when |
|---|---|---|---|---|---|
| A3–A5 | Sign-in · Settings | SSO, add keys, connect tools | Licence issued; keys stored in OS keychain | Rules | All integrations show “Connected” |
| A6 | Devices | Plug in or discover devices | Registry, capabilities, and health loaded | Jev | Devices are healthy and leasable |
| B1–B2 | Projects › New | Define app, surfaces, and inputs | Documents indexed and context created | Jev | Project Home shows inputs |
| B4–B6 | Explore (Live Device View) | Start, watch, pause, and steer | App Model, state graph, and coverage grow | Jev / Opus | Budget used or coverage target met |
| B8 | Plan › Approval Center | Approve, edit, or reject scenarios | Approved scenarios saved as Scenario IR | Human | No P0/P1 scenario pending |
| B9–B11 | Tests (Code & Diff) | Review code and quality score; commit | Generated and reviewed tests on a branch | Sonnet / Jev | Quality gate passes and code is committed |
| B12–B14 | Runs | Run, monitor, pause, or cancel | Shards across devices with live logs and evidence | Jev | All shards complete |
| B15 | Failures (Inbox) | Review clusters and evidence | Verdict, severity, owner, and root cause | Jev / Opus | Every cluster has a verdict |
| B17 | Failures › Bug draft | Confirm or dismiss | Jira issue with evidence | Human | Bug is filed or dismissed |
| B18 | Fixes (Gate B) | Approve or request changes | PR opened and CI reruns | Human | PR open and CI green |
| B20 | Reports · Dashboards · App Context | Read, export, and share | Reports published and snapshot committed | Haiku | Snapshot version incremented |

### Highlighted outcomes

- **3 human touchpoints in a run:** Gate A, bug confirmation, and Gate B.
- **Approximately 90%** of exploration steps are decided by Jev, with higher-tier model escalation when needed.
- **At least 70%** target for broken tests fixed automatically and proven.
- **Approximately $1** AI cost for a regression run after the first full run.

---

# Part II — Unified UI Screen Reference

## Shared application shell

The visible prototype uses a consistent left navigation and top command bar.

### Left navigation

- Project selector: **Metrolinx** — transit app / trip planner.
- All projects.
- **Build:** Home, Explore, Plan · Gate A, Tests.
- **Run:** Runs, Devices.
- **Fix:** Failures, Fixes · Gate B.
- **Insights:** Reports, Dashboards.
- **Knowledge:** App Context.
- Settings.
- Signed-in user: **Sam Rivera — QA Engineer**.

### Top and bottom status

- Global command: “Ask Bedrock or type a command…” (`Ctrl K`).
- AI budget indicator: `$1.81 / $10`.
- Prototype / Design spec switch.
- Bottom status examples:
  - Jev S1: 1,032 decisions, $0.15.
  - Claude: 30 calls, $1.66.
  - Waiting on you: 17.
  - Devices: 6/7 healthy.
  - Licence: offline-ready 14 days.
  - App Context v18: synced.
  - MCP server: on.

---

## Home — Metrolinx

**Release:** 7.3.0 cycle  
**Surfaces:** Web · Mobile · API  
**Context:** App Context v18 loaded; 9 screens changed since 7.2.4.

Primary actions:

- Explore changes.
- Open live run.

### Current cycle — build 7.3.0

Approved scenarios continue while other scenarios wait at Gate A.

| Stage | Status |
|---|---|
| Context | v18 loaded |
| Explore | Delta: 26 states |
| Plan | 31 scenarios |
| Gate A | 12 waiting |
| Generate | 22 tests |
| Review | 21 pass, 1 regeneration |
| Run | 54%, run #233 |
| Triage | 6 root causes |
| Fix · Gate B | 3 to approve |
| Report | After run |

### Cycle metrics

- Pass rate over last 7 runs: **95.6%**, up 0.9 points versus 7.2.4.
- Requirement coverage: **91%** — 64 of 70 requirements, 6 gaps.
- Flaky tests quarantined: **4**, down 1 this week.
- Open failures: **6** — 2 real bugs, including one S1.

### Needs your decision

Ordered riskiest first:

- Confirm S1 bug: **PRESTO top-up charges the card twice on gateway timeout**. Seen in CI nightly #232, no duplicate in Jira, blocks release.
- Gate A: **12 scenarios waiting** — 3 P0, 3 P1, designed by Claude Opus.
- Gate B: **3 fixes proven on device**.

### AI usage — this cycle

| Model | Usage | Cost |
|---|---:|---:|
| Jev System-1 | 1,032 decisions | $0.15 |
| Claude Opus | 5 calls | $0.88 |
| Claude Sonnet | 22 calls | $0.71 |
| Claude Haiku | 3 calls | $0.07 |

---

## Explore — Live Exploration, Build 7.3.0

Delta crawl: only screens that changed since App Context v18.

### Connected surfaces

- Pixel 8 · Android 15.
- Chrome 128.
- iPhone 15 · iOS 18.
- Staging API.

Controls: Exploring, Pause, Steer, and Stop.

### Device preview

The example shows the **Trip planner** from Union Station to Oakville GO, with upcoming Lakeshore West departures. A newly detected **Buy e-ticket** action is labelled with **Jev pick — 0.68**. A destructive action is blocked by the Destructive-Action Guard.

### Observation — state #26

| Field | Value |
|---|---|
| Screen | Trip results; type `list`; confidence 0.95 |
| Same as known? | No — new Trip results variant; fingerprint delta 0.29; “Buy e-ticket” added per departure |
| Popup / banner | Cookie banner dismissed earlier |
| Elements | 18 interactive; 4 new since v18 |
| Feature | Trip planning; linked to REQ-011 and REQ-122 |

### Next action — ranked candidates

1. Tap **Buy e-ticket** for the 08:12 departure — new element, high requirement weight: **0.68**.
2. Tap departure 08:12 details: **0.17**.
3. Tap **Swap stations**: **0.07**.
4. Go back: **0.03**.
5. Tap **Cancel Autoload & refund** — blocked by the Destructive-Action Guard.

---

## Plan · Gate A — Approval Center

Gate A approves what Bedrock should test for Metrolinx. Every scenario traces to a requirement.

- **12 waiting, 0 decided**.
- Ordering: riskiest first.
- Bulk actions: Approve all P2–P3; Approve all remaining.
- Designed by Claude Opus.

### Visible scenario list

| Priority | Scenario | ID / requirement | Technique | Risk |
|---|---|---|---|---:|
| P0 | Load $50 to PRESTO card with saved Visa | SC-201 · REQ-104 | Happy · negative | 0.93 |
| P0 | Plan trip Union → Oakville GO and show next 3 departures | SC-202 · REQ-011 | Happy · boundary | 0.90 |
| P0 | Buy GO e-ticket on mobile and show a valid QR code | SC-203 · REQ-122 | State transition | 0.88 |
| P1 | Service-alert push for Lakeshore West delay within 60 s | SC-204 · REQ-140 | Event · timing | 0.74 |

### Selected scenario: SC-202

**Plan trip Union → Oakville GO and show next 3 departures**

- Requirement: REQ-011.
- Surfaces: Web · Mobile · API.
- Technique: Happy · boundary.
- Risk: 0.90 = criticality high × changed in 7.3.0 × defect history.
- Duplicate check: no existing scenario above 0.30 similarity.

#### Scenario IR — surface-neutral steps

```gherkin
Given a rider is on the trip planner on web and mobile
When they plan a trip from Union Station to Oakville GO
Then the next 3 Lakeshore West departures are listed
And each time matches GET /v1/departures for stop UN
And delays from the real-time feed appear within 30 s
```

Test-data plan: anonymous rider with no login; departures are stubbed only for the delay case through the staging GTFS-RT replay.

---

## Tests — Code & Diff

- 22 tests generated for build 7.3.0.
- Branch: `bedrock/gen-7.3.0` in `metrolinx/transit-qe-tests`.
- Output is plain code owned by the customer.
- Actions: View diff; Commit 21 passing tests.
- Generator decision: Template or LLM? → LLM.
- Written by Sonnet.

### Visible files

```text
tests/web/
  trip-planner.spec.ts
  presto-topup.spec.ts
  autoload.spec.ts
tests/mobile/
  eticket.e2e.ts
  alerts.e2e.ts
tests/api/
  departures.api.ts
  fares.api.ts
pages/
  trip-planner.page.ts
  presto.page.ts
.bedrock/scenarios/
  SC-202.yaml
```

### Visible generated test

```ts
import { test, expect } from '@bedrock/playwright';
import { TripPlannerPage } from '../pages/trip-planner.page';

// Scenario SC-202 · REQ-011 · P0 — generated by Bedrock, owned by you
test.describe('Trip planner', () => {
  test('Union → Oakville GO shows the next 3 departures', async ({ page, api }) => {
    const planner = new TripPlannerPage(page);
    await planner.open();
    await planner.from('Union Station');
    await planner.to('Oakville GO');
    await planner.search();

    const rows = planner.departures();
    await expect(rows).toHaveCount(3);

    const live = await api.get('/v1/departures', { stop: 'UN', line: 'LW' });
    await expect(rows.first()).toContainText(live.json().departures[0].time);
  });
});
```

---

## Runs — Run #233

**Regression · build 7.3.0**

- 318 tests selected by impact: changed features plus all P0.
- 5 shards.
- Started 07:52.
- Estimated duration: 8 minutes.
- Controls: Test Selection, Device Pick, Pause, Cancel.

### Current run state

| Metric | Value |
|---|---:|
| Progress | 54% |
| Passed | 164 of 172 finished |
| Failed | 5; sent to Failure Inbox with evidence |
| Infrastructure retries | 1; Fare engine 503 retried once and passed |

### Shards shown

- Chrome 128 — shard 1 — 38 passed, 1 failed — `presto-topup.spec › saved Visa`.
- Firefox 130 — shard 2 — 36 passed, 0 failed — `autoload.spec › threshold $20`.
- Pixel 8 — shard 3 — 27 passed, 2 failed — `departures.e2e › Union board`.
- iPhone 15 — shard 4.
- Staging API — shard 5.

---

## Devices — Metrolinx

Only devices compatible with the project’s Web, Mobile, and API surfaces are shown. Leases are exclusive with a TTL; health probes run every 10 seconds.

### Summary

- Healthy: 6.
- Degraded / recovering: 1.
- Leased now: 4.
- Parallel sessions: 5 / 16 maximum.

| Device | Surface | Connection | Health | Lease | Capabilities |
|---|---|---|---|---|---|
| Pixel 8 · Android 15 | Mobile | USB | Healthy | Run #233, shard 3 | Camera · NFC · 1080×2400 |
| iPhone 15 · iOS 18.1 | Mobile | USB | Healthy | Shard 4 | Face ID · NFC · 1179×2556 |
| Galaxy S23 · Android 14 | Mobile | USB | Healthy | Idle | NFC · 1080×2340 |
| iPad Air · iPadOS 18 | Mobile | USB | Degraded | Low storage | Tablet · 1640×2360 |
| Chromium · Firefox · WebKit · Playwright 1.48 | Web | Local | Healthy | Shards 1 and 2 | Headless + headed |
| Staging API gateway · v1 · mTLS | API | HTTPS | Healthy | Shard 5 | REST · GTFS-RT replay |
| BrowserStack (farm) | Mobile | Cloud | Healthy | Used only when no local device fits | 200+ real devices |

---

## Failure Inbox

Local and CI failures appear in one list. In the example, 19 failing tests are grouped into 6 root causes.

### Visible root-cause list

| Class | Severity / source | Failure | ID / tests | Confidence |
|---|---|---|---|---:|
| Real bug | S1 · CI | PRESTO top-up charges the card twice on gateway timeout | F-51 · 1 test | 0.90 |
| Real bug | S2 · Local | Next departures show stale times after 7.3 cache change | F-52 · 3 tests | 0.64 |
| Broken test | S3 · CI | Trip-planner “From” field became a combobox | F-53 · 7 tests | 0.96 |
| Broken test | S3 · Local | E-ticket “Show QR” button moved into the ticket card | F-54 · 2 tests | 0.93 |
| Flaky | S4 · Local | Service-alert push sometimes arrives after the 60-second window | F-55 · 2 tests | 0.82 |

### Selected root cause: F-52

**Next departures show stale times after 7.3 cache change**

- Three affected tests.
- First seen in run #233.
- Suggested owner: Real-time data squad.
- Failure class confidence: 0.64.
- Escalated to Opus.

#### Trace

- 0.00 s — Open Union Station departures on Pixel 8.
- 0.42 s — `GET /v1/departures?stop=UN` → 200; cache HIT, age 312 seconds.
- 0.45 s — Board shows 08:12 Lakeshore West “On time”.
- 1.10 s — Real-time feed shows 08:12 delayed 9 minutes; board is not updated within 30 seconds.

#### Root cause — Claude Opus

Release 7.3 increased the departures cache TTL from 30 seconds to 600 seconds as part of a performance change. Real-time delays are therefore served up to 10 minutes late on mobile and through the public API, while Web—where the cache is bypassed—remains correct.

Evidence shown: cache-header age 312 seconds, configuration diff for 7.3, and a GTFS-RT feed showing the delay. Suggested owner: Real-time data squad.

The UI requires confirmation of the bug before filing.

---

## Fixes · Gate B

Broken tests are repaired by Bedrock and proven on the user’s machine. Real bugs are never “healed.” The example has **3 fixes waiting**.

### Fix list

| Strategy | Fix | Source |
|---|---|---|
| Locator | “From” field locator → combobox role | FX-41 from F-53 · `tests/web/trip-planner.spec.ts` |
| Navigation step | Open the ticket card before “Show QR” | FX-42 from F-54 · `tests/mobile/eticket.e2e.ts` |
| Wait | Listen for the push event instead of polling every 5 seconds | FX-43 from F-55 · `tests/mobile/alerts.e2e.ts` |

### Selected code change

```diff
 await planner.open();
-await page.getByPlaceholder('From').fill('Union');
+await page.getByRole('combobox', { name: 'From' }).fill('Union');
 await page.getByRole('option', { name: 'Union Station' }).click();
 await expect(planner.fromValue).toHaveText('Union Station');
```

### Why this change

Build 7.3 replaced the plain **From** input with an accessible combobox. Locator Memory ranks role plus accessible name as the most stable candidate, with stability 0.97 across 28 runs. No assertion was changed.

### Proof

- Rerun on the same device: **3 / 3 passed** on Chrome 128.
- Before/after evidence compared; failure signature is gone.
- Assertion Guard confirms that no assertion was removed or weakened.
- Attempts used: 1 / 3.
- Gate B requires the user’s decision.

---

## Reports

Requirement → test → result traceability for Metrolinx. Reports can be read without Bedrock installed and exported as HTML/PDF or JUnit/JSON, then shared.

### Summary — Claude Haiku

Build 7.3.0 is **not release-ready**: an S1 bug can charge a PRESTO top-up twice when the payment gateway is slow, and real-time departures can be served up to 10 minutes stale on Mobile and API. Nine broken tests came from UI changes, and three fixes are proven and awaiting approval. Coverage is 91%; remaining gaps are accessibility and offline e-tickets.

### Traceability matrix

Legend: ✓ pass · ✕ fail · ○ untested.

| Requirement | Web | Mobile | API |
|---|:---:|:---:|:---:|
| REQ-002 Sign in with MFA | ✓ | ✓ | ✓ |
| REQ-011 Trip planning | ✓ | ✕ | ✕ |
| REQ-104 PRESTO top-up | ✕ | — | ✕ |
| REQ-108 Autoload | ✓ | — | ✓ |
| REQ-115 Fare calculation | ✓ | — | ○ |
| REQ-122 GO e-tickets | — | ✓ | ✓ |
| REQ-125 Offline e-ticket | — | ○ | — |

### Coverage gaps

- P1 · REQ-030 Accessibility — screen-reader checks not run on Web or Mobile.
- P2 · REQ-125 Offline e-ticket — Mobile test not generated yet.
- P2 · REQ-115 Fare calculation — API contract test missing.
- P3 · Three more; action: plan scenarios.

### Bugs this cycle

- S1 · F-51 — PRESTO top-up double charge; awaiting user confirmation.
- P3 · MX-2207 — French label truncated on the Autoload page; Web.

---

## Dashboards — Metrolinx

Pass rate, flakiness, and feature health across local and CI runs. Visible range: last 14 runs / 30 days.

### Pass rate

- Web, Mobile, and API combined: **95.6%** on the latest point.

### Most flaky tests

| Test | Flakiness |
|---|---:|
| `alerts.e2e › push within 60 s` | 28% |
| `autoload.spec › 3DS iframe` | 14% |
| `departures.api › p95 latency` | 10% |
| `eticket.e2e › QR render` | 7% |
| `lang.spec › FR toggle` | 4% |

### Feature health

| Feature | Health |
|---|---:|
| Trip planning | 74% |
| PRESTO top-up | 80% |
| GO e-tickets | 92% |
| Service alerts | 88% |
| Sign-in and MFA | 99% |

### Failure sources this cycle

- Real bugs: 3.
- Broken tests: 9.
- Flaky: 2.
- Environment: 4.
- Triage agreement with human labels: **94%**; target ≥ 90%.
- Automatically fixed broken tests: **78%**; target ≥ 70%.

---

## App Context Memory

Everything Bedrock knows about Metrolinx is stored under `.bedrock/context` in `metrolinx/transit-qe-tests`, versioned in Git and shared with the team and CI. Current version: **v18**.

### Stored context

| Area | Contents |
|---|---|
| App Profile | Riders, 3 personas, 3 environments |
| App Model | 162 screens, 35 features, 70 requirements |
| Locator Memory | 2,740 elements with stability scores |
| Test Baseline | 402 tests; last green suite #230 |
| Human Decisions | 204 approvals, 27 edits, 11 labels |
| Learned Patterns | 6 flaky signatures, 38 fixes that worked |

### Change detection: 7.2.4 → 7.3.0

| Feature | What changed | Decision |
|---|---|---|
| Trip planner | “From” / “To” became comboboxes | Update locators |
| GO e-tickets | “Show QR” moved into the ticket card | Update navigation |
| Departures API | Cache TTL change, no contract change | Reuse 14 tests |
| PRESTO top-up | New confirmation step | Regenerate 4 tests |
| Service alerts | New alert categories | Explore + 3 new tests |
| Sign-in | Unchanged | Reuse 16 tests |

### Snapshots

- v18 — after run #232; learned 2 locator updates and 1 flaky pattern; commit `c41a7e9`; 3 hours ago.
- v17 — after explore #229; 5 new screens; commit `9de02b1`; yesterday; rollback available.
- v16 — release 7.2.4 baseline; commit `71b3f60`; 8 days ago; rollback available.

No secrets are stored in context—only vault references. Repeat runs are approximately 80% cheaper because only changes are explored and only gaps are generated.

---

## Settings

Project: Metrolinx. Some policies are set by the organisation administrator and shown read-only.

### Project

#### Surfaces in this project

Turning on a surface adds its driver, devices, and test kit.

| Surface | Status |
|---|---|
| Web | On |
| Mobile | On |
| DTH / Smart TV | Off |
| IoT | Off |
| API | On |

#### Project details

| Field | Value |
|---|---|
| Application | Transit app · trip planner, PRESTO, GO e-tickets |
| Test repository | `metrolinx/transit-qe-tests` |
| Issue tracker | Jira · MX |
| Team chat | Teams · `#transit-qe` |
| Current build | 7.3.0 |

### AI and models

#### Bring-your-own AI keys

- Keys are stored in the OS keychain.
- Jev System-1 key: valid.
- Claude key: valid.
- Local LLM: not installed; setup option available for private projects.

#### Routing policy

Signed bundle from the organisation, version 7.

| Work type | Route |
|---|---|
| Decisions: classify, score, rank, verify | Jev |
| Analysis, planning, root cause | Opus + thinking |
| Write tests and fixes | Sonnet; escalate to Opus after two failures |
| Summaries and bug text | Haiku |
| Unsure or rejected twice | Stronger model, then user |

### Integrations

All visible integrations are connected:

| Integration | Details |
|---|---|
| GitLab | `metrolinx/transit-qe-tests`; merge requests enabled |
| GitLab CI | Bedrock Reporter plug-in installed |
| Jira | Project MX; confirm before filing |
| Microsoft Teams | `#transit-qe`; alerts routed by Jev |
| Figma | Transit app v7 designs |
| Bedrock MCP server | On; Claude Code and Copilot allowed |

### Budgets and privacy

#### AI budgets

| Limit | Value |
|---|---:|
| Per-run hard stop | $10.00 |
| Per exploration | $2.00 |
| Monthly project cap | $150.00 |
| Pre-run estimate shown | On |

#### Privacy

| Policy | Value |
|---|---|
| Private project: local LLM only, no cloud models | Off |
| Redact secrets and personal data before any AI call | Always |
| Evidence leaves this machine | Never, by default |
| Usage telemetry | Opt-in; currently off |

### Roles

| Role | Can do | Sees |
|---|---|---|
| QA Engineer | Create projects, run, explore, approve Gate A and B, file bugs | Everything in their projects |
| QA Lead / PM | Approve Gate A when required by policy; export reports | All projects, Home, Plan, Reports, Dashboards |
| Viewer | Read-only | Reports and Dashboards |
| Org Admin | SSO, licences, AI policy, MCP allow-list through web console | Organisation settings |

### Project switcher

Visible projects:

- **Metrolinx** — Web, Mobile, API; selected.
- **FME** — Web, Mobile, IoT, API; 17 items waiting.
- **Google** — DTH / Smart TV, API; 17 items waiting.
- Actions: All projects; New project.

