# BEDROCK AI Prompt Reference

Comprehensive documentation of every AI prompt used across Test Design & Test Cases modules.

**Legend**

- AI-powered (LLM prompt)
- Deterministic (no LLM)
- Human workflow

---

# Test Design

Five-stage pipeline that transforms raw requirements into traceable test scenarios with TCER scoring, coverage mapping, and risk ranking.

## 1. Requirement Intelligence

**Type:** AI-Powered

Parses free-form text (pasted docs, user stories, emails) and extracts structured software requirements as reviewable JSON.

### What it does

Takes any unstructured requirement text the user pastes in and sends it to Claude. The model extracts individual requirements—each with an ID, title, acceptance criteria, confidence score, domain, and a flag for ambiguity. A fallback (retry) call is made automatically if the primary response fails to parse. A separate BA/SME chat lets the user ask follow-up questions about the extracted requirements without re-running the full extraction.

### Primary extraction prompt

**Prompt type:** System prompt

```text
Extract software requirements from the user text and return ONLY valid JSON.
Example output:
{"requirements":[{"id":"REQ-01","title":"User can log in with username and password","acceptance":"Login succeeds with valid credentials and fails with invalid ones","ambiguous":false,"confidence":.90,"domain":"Authentication","impacted":"login page","source":"doc"}],"summary":"Authentication requirements","clarifications":[],"inferred":[]}

Rules: fill every field with real content from the text. Each sentence that describes a feature, rule, or constraint is one requirement. Do not copy the example values — use the actual text provided. Return only JSON.
```

**User message:** The raw requirement text pasted by the user is sent as the user turn.

### Simplified retry prompt

**Prompt type:** Fallback (used only when primary fails to parse)

```text
Extract requirements from this text. Return JSON only: {"requirements":[{"id":"REQ-01","title":"requirement description","acceptance":"how to test it","ambiguous":false}]}
```

### BA/SME clarification chat

**Prompt type:** Chat / system prompt

```text
You are a QA business-analyst assistant helping clarify software requirements. Answer the user's question concisely (2-4 sentences), staying grounded in the provided requirements. Plain text only, no markdown.
```

**User message structure:**

```text
Context:
"""{full normalised requirements list}"""

User: {the user's question}
```

---

## 2. Scenario Design

**Type:** AI-Powered

Generates multi-class test scenarios (positive, negative, boundary, edge) from the extracted requirements—the output awaits Gate A human approval.

### What it does

Sends all extracted requirements to Claude and asks it to produce a complete set of test scenarios—one or more per requirement, spanning positive paths, negative paths, boundary conditions, and edge cases. Each scenario carries an ID, class, priority, automation feasibility, domain, and a link back to its source requirement. Humans then review and approve scenarios at Gate A before TCER creation begins.

### Primary scenario generation prompt

**Prompt type:** System prompt

```text
Generate test scenarios from the provided requirements or feature description. Return ONLY valid JSON.
Example output:
{"scenarios":[{"id":"TS-01","title":"Login with valid credentials succeeds","precondition":"User is on the login page","trigger":"User enters correct username and password and clicks Login","expected":"User is redirected to the dashboard","class":"Positive","priority":"P1","autoFeasibility":"Automatable","domain":"Authentication","reqId":"REQ-01"},{"id":"TS-02","title":"Login with invalid password shows error","precondition":"User is on the login page","trigger":"User enters wrong password","expected":"Error message displayed, user not logged in","class":"Negative","priority":"P1","autoFeasibility":"Automatable","domain":"Authentication","reqId":"REQ-01"}],"summary":"Login scenarios"}

Rules: generate multiple scenarios per requirement (positive, negative, edge cases). Fill every field with real content. Do not copy the example — use the actual requirements provided. Return only JSON.
```

**User message:** The full JSON array of extracted requirements from Stage 1.

### Simplified retry prompt

**Prompt type:** Fallback

```text
Generate test scenarios from this text. Return JSON only: {"scenarios":[{"title":"scenario name","trigger":"action","expected":"result","class":"Positive","priority":"P2"}]}
```

---

## 3. TCER Creation

**Type:** AI-Powered

Enriches approved scenarios with detailed preconditions, triggers, and expected results to make each scenario a fully testable case—then scores it for quality.

### What it does

Takes Gate-A-approved scenarios (which may only have a title and class) and calls Claude to flesh out the three critical TCER fields—precondition, trigger (action/input), and expected result—keeping each to 1–2 sentences. Scenarios are processed in batches. After AI enrichment, TCER quality scoring is entirely deterministic: each row is scored on atomicity, testability, verifiable result, and requirement trace—no further LLM call is made.

### TCER enrichment prompt

**Prompt type:** System prompt

```text
You are a QA test-case writer. For each scenario given, fill in the precondition, trigger (action/input), and expected result fields to make a complete, testable test case.
Return ONLY minified JSON (no prose, no fences):
{"scenarios":[{"id":"TS-01","precondition":"system is in state X","trigger":"user does Y","expected":"system responds with Z"}]}
Keep each field to 1-2 sentences. Valid JSON only.
```

**User message (per batch):**

```text
Scenarios:\n[{"id":"TS-01","title":"...","existing_trigger":"...","existing_expected":"..."},...]
```

### Post-enrichment TCER scoring

**Type:** Deterministic — no LLM

Each TCER row is scored on four quality dimensions after AI enrichment:

- **Atomicity** — tests exactly one behaviour
- **Testability** — has a clear trigger and verifiable expected result
- **Traceability** — is linked to a requirement ID
- **Completeness** — precondition, trigger, and expected result are all populated

Scoring is rule-based (field checks + heuristic length analysis). No LLM is called for this step.

---

## 4. Coverage Analysis & RTM

**Type:** Deterministic

Builds a Requirements Traceability Matrix mapping every requirement to its scenarios and TCER rows with Covered / Partial / Gap status.

### What it does

Entirely algorithmic—no LLM is called. The engine cross-references the three prior stages: for each requirement from Stage 1 it finds the scenarios from Stage 2 and the TCER rows from Stage 3 that carry its ID. A requirement is marked **Covered** when it has at least one TCER-enriched scenario with a Pass verdict, **Partial** when it has scenarios but none have been validated yet, and **Gap** when no scenario references it. The RTM table is exported as a downloadable artefact.

### AI prompts

None. Coverage status and RTM generation are computed deterministically by joining requirement IDs across the pipeline data.

---

## 5. Risk Based Analysis

**Type:** Deterministic

Ranks all scenarios by risk exposure using weighted scoring across priority, automation feasibility, and scenario class.

### What it does

No LLM is involved. Each scenario is scored by multiplying three hard-coded weights, and the resulting risk score determines the execution band:

- **Priority weight:** P1 = 3, P2 = 2, P3 = 1
- **Automation feasibility weight:** Manual = 3, Partial = 2, Automatable = 1
- **Class weight:** Security = 3, Error / Recovery / Negative / Boundary = 2, Edge / Positive = 1

Scenarios are then sorted and banded into Risk P1 / P2 / P3 execution queues for prioritised test execution.

### AI prompts

None. Risk scoring is fully deterministic:

```text
Risk Score = Priority weight × Automation weight × Class weight
```

---

## AI Assistant — Test Design (shared across all stages)

**Type:** AI-Powered

Floating chat panel available on every Test Design stage. Users can query pipeline data or instruct the AI to modify or delete requirements, scenarios, and TCER rows.

### What it does

A persistent chat panel that injects a full JSON snapshot of the current pipeline into the system prompt (up to 12,000 characters covering requirements, scenarios, TCER rows, and risk rankings). The model can answer analysis questions in plain text or respond with a structured JSON action block that the app parses and applies to mutate the pipeline state—updates or deletions on requirements, scenarios, and TCER rows—without re-running any extraction pipeline.

### System prompt

**Prompt type:** Dynamic — stage name and data injected at runtime

```text
You are an AI assistant for the BEDROCK QA Automation Platform — ${stage} stage.
You have full access to the pipeline data and can query it, modify items, or delete items.

Current pipeline data:
${buildContext()}

When the user asks you to modify data, respond with a JSON action block in a code fence:
- To update requirements: {"updateRequirements": [{"id": "REQ-001", "title": "...", ...}]}
- To delete requirements: {"deleteRequirements": ["REQ-001", "REQ-002"]}
- To update scenarios:    {"updateScenarios": [{"id": "SCN-001", "text": "...", ...}]}
- To delete scenarios:    {"deleteScenarios": ["SCN-001"]}
- To update TCER rows:    {"updateTCERRows": [{"id": "TCER-001", "verdict": "Pass", ...}]}
- To mark TCER rows removed: {"deleteTCERRows": ["TCER-001"]}

For analysis/query questions, respond with plain text. Be concise.
```

**Runtime substitutions:** `${stage}` = active stage label (e.g. “Requirement Intelligence”). `${buildContext()}` = live JSON snapshot of all pipeline data, truncated to 12,000 chars.

---

# Test Cases

Seven-stage workflow that authors detailed test cases and BDD scenarios from TCER data, validates and reviews them, organises them into suites, and publishes them to ALM tools.

## 1. Test Case Authoring

**Type:** AI-Powered

Generates fully detailed test cases from TCER rows—or enriches test cases the user uploads—with numbered steps, expected results, test data, and metadata.

### What it does

Two entry points—generate from TCER or upload existing test cases:

- **Generate from TCER:** Claude receives all approved TCER rows and produces one complete test case per row: numbered steps, matching numbered expected results, precondition, test data, platform, and test type.
- **Upload and enrich:** The user uploads existing test cases (CSV/Excel); Claude preserves the original titles and requirement IDs but enriches empty fields, improves step clarity, and aligns with TCER context if available.

### Generate from TCER — system prompt

```text
You are a QA expert. Given TCER scenario rows, generate detailed test cases.
Return a JSON object: {"testCases": [ { "scenarioId", "title", "description", "precondition", "testData", "steps", "expectedResults", "priority", "reqId", "testType", "platform" } ]}.
- steps: numbered list e.g. "1. Open screen\n2. Tap button"
- expectedResults: numbered list matching steps
- testType: one of Functional, Regression, Smoke, Traditional, BDD
```

**User message:** JSON array of TCER rows—fields: id, title, reqId, priority, precondition, expected, domain, class, autoFeasibility.

### Upload & enrich — system prompt

```text
You are a QA expert. The user has uploaded existing test cases. Enrich and complete each one — keep the original intent and format, fill missing fields, improve steps clarity, and align with the TCER context if provided.
Return a JSON object: {"testCases": [ { "scenarioId", "title", "description", "precondition", "testData", "steps", "expectedResults", "priority", "reqId", "testType", "platform" } ]}.
- steps: numbered list e.g. "1. Navigate to screen\n2. Enter value"
- expectedResults: numbered list matching steps
- testType: one of Functional, Regression, Smoke, Traditional, BDD
- Preserve original title and req IDs exactly; enrich empty fields only.
${tcerContext}
```

**`tcerContext` (appended when available):**

```text
TCER context (use for domain accuracy):
{JSON of first 10 TCER rows}
```

---

## 2. BDD Authoring

**Type:** AI-Powered

Generates Gherkin Scenario Outlines with Examples tables from TCER rows—or enriches uploaded BDD files—while reusing the project’s existing step definition library.

### What it does

The most detailed prompt in the platform. Claude writes feature files using **Scenario Outline + Examples** wherever parameterisation is possible, uses `<angle_bracket>` parameter notation, reuses existing step definitions verbatim, and only proposes new steps that are genuinely domain-specific. Tracks a living step library that grows with each generation run. Two entry points—generate from TCER or upload and enrich existing `.feature` files.

### Generate BDD from TCER — system prompt

```text
You are a senior BDD/Gherkin expert writing feature files for a QA automation framework.

RULES:
1. Use "Scenario Outline" (not plain Scenario) whenever the scenario can be parameterised across multiple values (concession types, user roles, amounts, platforms, etc.).
   Always prefer Scenario Outline + Examples over a plain Scenario.
2. Given / When / Then lines MUST be on separate lines. Use "And" for continuation lines.
3. Examples table: use Markdown pipe format with a header row and one data row per variant.
   Parameters in steps use <angle_bracket> notation.
4. Reuse step definitions from the existing step library (listed below) wherever they apply — do NOT create new versions of existing steps.
5. newSteps: list ONLY step definitions that do not exist in the library and are domain-specific (skip generic ones like "Given I am on the home page").

EXISTING STEP LIBRARY (reuse these verbatim):
${existingStepList}

Return a JSON object with this exact shape:
{
  "bddCases": [
    {
      "scenarioId": "TS-1",
      "reqId": "REQ-01",
      "feature": "FarePayment",
      "title": "Fare payment using PCC",
      "description": "Validate fare deduction for different concession types",
      "given": "Given a <concession> PCC with sufficient balance\nAnd the MFTP device is online",
      "when": "When the card is tapped on the MFTP device",
      "then": "Then the fare is accepted and the <concession> screen is shown\nAnd the balance is reduced by the fare amount",
      "examples": "| concession |\n| Adult |\n| Senior |\n| Youth |",
      "testData": "Adult PCC, e-purse $10.00",
      "platform": "MFTP",
      "priority": "P1",
      "newSteps": [
        "Given a <concession> PCC with sufficient balance",
        "Then the fare is accepted and the <concession> screen is shown"
      ]
    }
  ]
}
```

**Runtime substitution:** `${existingStepList}` = current step library rendered as bullet lines, or “(none yet)” if the library is empty.

### Upload & enrich BDD — system prompt

```text
You are a senior BDD/Gherkin expert. The user has uploaded existing BDD scenarios. Enrich and complete each one — preserve the original intent, use Scenario Outline + Examples where possible, fill missing Given/When/Then, improve clarity, and reuse steps from the existing library.

RULES:
1. Use Scenario Outline with Examples table (pipe format, <angle_bracket> params) wherever applicable.
2. Given / When / Then on separate lines; use "And" for continuations.
3. Reuse existing steps verbatim. Only add to newSteps if genuinely new and domain-specific.

EXISTING STEP LIBRARY (reuse verbatim):
${existingStepList}${tcerContext}

Return JSON: {"bddCases":[{"scenarioId","reqId","feature","title","description","given","when","then","examples","testData","platform","priority","newSteps":[]}]}
```

---

## 3. Test Case Validation

**Type:** Deterministic

Runs automated quality checks on all authored test cases before they reach the human review gate—flagging gaps, duplicates, and structural issues.

### What it does

Rule-based checks only—no LLM is called. The validation engine inspects every test case and raises issues for:

- **Missing expected result** — no expected result field populated
- **Missing precondition** — precondition field empty
- **Non-atomic / too few steps** — fewer than 2 step lines
- **Broken requirement link** — no scenarioId or reqId present
- **Duplicate title** — same title as another test case in the set

Issues are displayed inline on each test case card; the reviewer must either fix or accept-with-waiver each issue before the case can advance.

### AI prompts

None. All validation is rule-based (field-presence checks, length heuristics, duplicate detection). No LLM is called at this stage.

---

## 4. AI Review & Human Approval

**Type:** Human Workflow

Human reviewers read each validated test case and mark it Approved, Rework, or Rejected with optional inline comments—Gate B before test suites are assembled.

### What it does

Purely human-driven—no LLM is invoked. Each test case is presented to a named reviewer who selects a verdict (Approved / Rework / Rejected) and can attach a comment explaining their decision. Rework cases are routed back to the author. Only Approved cases advance to Suite Structuring. This Gate B exists to ensure human accountability before test assets enter a release cycle.

### AI prompts

None. This stage is intentionally human-only. Verdicts and comments are entered by the reviewer via UI controls. No LLM is called.

---

## 5. Suite Structuring

**Type:** Human Workflow

Manually assigns approved test cases into Feature Suite, Regression Suite, or Release Suite via checkboxes—giving the team control over execution batches.

### What it does

Entirely UI-driven—no LLM is called. The reviewer selects checkboxes next to each approved test case to assign it to one or more of three pre-built suites. Suites map to execution cadences: Feature Suite (new-feature sanity), Regression Suite (full regression pack), Release Suite (go/no-go gates). The structured assignment is persisted and drives the publishing payload in the next stage.

### AI prompts

None. Suite assignments are made manually by the reviewer via checkboxes. No LLM is called.

---

## 6. Test Asset Publishing

**Type:** Deterministic

Exports the structured test suites to an ALM target—Azure DevOps, Jira-Xray, or a Git repository—generating a timestamped repository ID as the publish receipt.

### What it does

No LLM is involved. The user selects a publish target (ADO / Jira-Xray / Git), clicks Publish, and the app records a timestamp-based repository ID as the publish receipt. In the production build this will call the respective ALM API; in the current version it is a mock action. The record is stored in the session for traceability.

### AI prompts

None. Publishing is a mock export action. Target ALM selection and publish invocation are UI-driven. No LLM is called.

---

## 7. Automation Feasibility

**Type:** Deterministic

Classifies every test case as Automatable, Partial, or Manual—and recommends a tool—based on fields already present in the test case record.

### What it does

Fully deterministic field-inspection logic—no LLM is called. Classification rules (evaluated in order):

1. `autoFeasibility` contains `auto` → **Automatable** (tool: Selenium / Playwright)
2. `autoFeasibility` contains `partial` → **Partial** (tool: Manual + API tests)
3. `type = BDD` → **Automatable**
4. `priority = High` or `P1` → **Partial**
5. Otherwise → **Manual**

The results feed back into the Risk Based Analysis stage to weight manual-only cases with higher risk exposure.

### AI prompts

None. Classification is deterministic field inspection. Rules are applied in order; the first matching rule wins. No LLM is called.

---

## AI Assistant — Test Cases (Test Case Authoring & BDD Authoring)

**Type:** AI-Powered

Embedded chat panel in the TC Authoring and BDD Authoring tabs. Users can query, modify, or delete test cases and BDD scenarios through natural language.

### What it does

Similar to the Test Design AI Assistant but scoped to test case and BDD data. The system prompt injects the full live snapshot of test cases, BDD scenarios, and the step library. The model can answer analysis questions in plain text or return structured JSON action blocks that update or delete test cases / BDD scenarios without re-running the full generation pipeline.

### System prompt

**Prompt type:** Dynamic — full data context injected at runtime

```text
You are an AI assistant embedded in the BEDROCK QA platform. You have full access to all test cases and BDD scenarios listed in the context.

You can perform these actions by returning a JSON block:

1. MODIFY test cases:
{"action":"updateTestCases","cases":[{"id":"TC-001","title":"...","steps":"...","expected":"...","priority":"...","description":"...","precondition":"...","testData":"...","platform":"...","type":"..."}]}
Only include fields that change.

2. DELETE test cases:
{"action":"deleteTestCases","ids":["TC-002","TC-005"]}

3. MODIFY BDD scenarios:
{"action":"updateBDDCases","cases":[{"id":"BDD-001","title":"...","given":"...","when":"...","then":"...","examples":"...","feature":"...","priority":"...","description":"...","testData":"...","platform":"..."}]}
Only include fields that change.

4. DELETE BDD scenarios:
{"action":"deleteBDDCases","ids":["BDD-002"]}

5. For queries/analysis, respond in plain conversational text — no JSON needed.

Rules:
- Always confirm what you did after an action.
- For deletions, list the IDs removed.
- For modifications, briefly summarise what changed.
- Keep responses concise.
```

**User message structure:**

```text
Context (all current data):
{JSON of testCases, bddCases, stepLib}

User request: {user's question}
```

---

# Full Summary Table

Quick-reference: every tab, its AI involvement, and the prompt type used.

| Module | # | Tab | AI prompt? | Type / Notes |
|---|---:|---|---|---|
| Test Design | 1 | Requirement Intelligence | AI | Extraction system prompt + simplified retry + BA/SME clarification chat |
| Test Design | 2 | Scenario Design | AI | Scenario generation system prompt + simplified retry |
| Test Design | 3 | TCER Creation | AI | Test case enrichment system prompt (scoring is deterministic post-AI) |
| Test Design | 4 | Coverage Analysis & RTM | None | Deterministic RTM join across REQ / Scenario / TCER IDs |
| Test Design | 5 | Risk Based Analysis | None | Weighted scoring algorithm (Priority × Feasibility × Class) |
| Test Design | ✦ | AI Assistant (all stages) | AI | Dynamic chat with full pipeline context; supports data mutation via JSON blocks |
| Test Cases | 1 | Test Case Authoring | AI | Generate-from-TCER prompt + upload/enrich prompt |
| Test Cases | 2 | BDD Authoring | AI | Gherkin Scenario Outline prompt (with step library) + upload/enrich prompt |
| Test Cases | 3 | Test Case Validation | None | Rule-based: missing fields, duplicate titles, non-atomic steps |
| Test Cases | 4 | AI Review & Human Approval | Human | Gate B—human verdict only (Approved / Rework / Rejected) |
| Test Cases | 5 | Suite Structuring | Human | Manual checkbox assignment to Feature / Regression / Release suites |
| Test Cases | 6 | Test Asset Publishing | None | Mock publish to ADO / Jira-Xray / Git with timestamp receipt |
| Test Cases | 7 | Automation Feasibility | None | Field-inspection classification (`autoFeasibility` → `type` → `priority`) |
| Test Cases | ✦ | AI Assistant (TC stages) | AI | Dynamic chat with TC + BDD + step-library context; supports mutation via JSON |

---

*Bedrock AI Prompt Reference · Generated 2026-10-03 · Internal use only*
