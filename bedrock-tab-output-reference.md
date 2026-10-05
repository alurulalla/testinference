# BEDROCK Tab Output Reference

What every Test Design and Test Cases tab produces. One worked example—a login, transit-fare, and API feature—is carried through all 12 tabs. Every score, verdict, band, and count is calculated using the application’s actual rules from `TestDesign.jsx` and `TestCases.jsx`. Only the AI-written text, such as titles, steps, and Gherkin, is illustrative.

---

## Data Flow

Each tab’s output becomes the next tab’s input. TCER rows cross from Test Design into Test Cases through `window.__bedrockTCER`.

```text
8 Requirements
  → 12 Scenarios
  → 12 TCER rows (1 removed)
  → RTM: 6 covered / 1 partial / 1 gap
  → Risk: 2 P1 / 8 P2 / 2 P3
  → 11 generated test cases + 1 uploaded case
  → 3 BDD outlines
  → Validation: 10 pass / 1 rework / 1 reject
  → 10 approved
  → 3 suites
  → 10 published
  → Automation feasibility
```

---

# Test Design

Requirements → scenarios → TCER → coverage → risk ranking.

## 1. Requirement Intelligence

**Processing:** AI output

Turns raw requirement text into structured requirement records, plus a summary, open clarification questions, and inferred or implicit requirements.

### Input

Uploaded or pasted requirement documents, including BRDs, user stories, and emails.

### Output stored

```text
pipe.req.out → {
  requirements[],
  summary,
  clarifications[] (max 10),
  inferred[] (max 8)
}
```

### Totals

| Measure | Count |
|---|---:|
| Requirements | 8 |
| Clear | 6 |
| Ambiguous | 2 |
| Clarifications | 3 |
| Inferred | 1 |

### Requirement table — CSV export columns

| ID | Title | Source | Acceptance criteria | Impacted areas | Ambiguity | Confidence |
|---|---|---|---|---|---|---:|
| REQ-01 | User can log in with username and password | `BRD_v2.docx` | Login succeeds with valid credentials and fails with invalid ones | Login page | Clear | 90 |
| REQ-02 | Session expires after 30 minutes of inactivity | `BRD_v2.docx` | User is logged out automatically after 30 minutes idle | Authentication middleware | Clear | 95 |
| REQ-03 | User is notified when the account is locked | `BRD_v2.docx` | Notification sent after 5 failed login attempts | Notification service | Ambiguous | 72 |
| REQ-04 | Password reset link expires within 1 hour | `BRD_v2.docx` | Reset link invalid 60 minutes after generation | Password-reset flow | Clear | 88 |
| REQ-05 | Fare is deducted based on concession-card type | `Fare_Rules.pdf` | Adult, Senior, and Youth rates applied correctly at tap-on | MFTP device, e-purse | Clear | 91 |
| REQ-06 | System should be fast under load | `NFR.xlsx` | Response time under peak traffic is acceptable | API gateway | Ambiguous | 58 |
| REQ-07 | Admin can export audit logs as CSV | `BRD_v2.docx` | CSV download with date-range filter | Reporting module | Clear | 85 |
| REQ-08 | API returns 401 for unauthenticated requests | `API_Spec.yaml` | Any call without a valid bearer token returns HTTP 401 | API layer | Clear | 97 |

The on-screen table shows only ID, Requirement Title, Acceptance Criteria, and Flag. The export additionally includes Source, Anchor, Impacted Areas, and Confidence.

### Summary and clarification output

**Summary:** Authentication, session, security, fare engine, admin reporting, and API requirements extracted. Two items are ambiguous.

**Clarifications:**

1. Which channel carries the lock notification: email, SMS, or both?
2. What is the numeric response-time SLA under peak load?
3. Is the fare deducted at tap-on or tap-off?

**Inferred:** The system must allow concurrent sessions per user, implied by REQ-02.

**BA/SME chat sample:**

> Q: Is REQ-03 testable as written?  
> A: Partly. The five-attempt threshold is testable, but the notification channel is undefined, so expected results cannot be asserted until the BA confirms email versus SMS.

---

## 2. Scenario Design

**Processing:** AI output

Generates positive, negative, boundary, security, and edge scenarios for each requirement. The user selects which scenarios to include and approves the set at Gate A.

### Input

Requirements from Tab 1.

### Output stored

```text
pipe.scn.acceptance[] → {
  id,
  reqId,
  text,
  class,
  priority,
  precondition,
  trigger,
  expected,
  autoFeasibility,
  domain,
  included
}
```

### Totals

| Measure | Count |
|---|---:|
| Scenarios | 12 |
| Positive | 5 |
| Negative | 4 |
| Boundary | 2 |
| Security | 1 |

### Approved scenario set

| ID | Scenario title | Class | Priority | Trigger | Expected outcome | Automation feasibility | Requirement |
|---|---|---|---|---|---|---|---|
| TS-01 | Login with valid credentials succeeds | Positive | P1 | Enter correct username and password; click Login | Redirected to dashboard | Automatable | REQ-01 |
| TS-02 | Login with invalid password shows error | Negative | P1 | Enter wrong password | Error shown; user not logged in | Automatable | REQ-01 |
| TS-03 | Session auto-expires after 30 minutes idle | Positive | P1 | User remains idle for 30 minutes | Logged out; session-expired message shown | Partial | REQ-02 |
| TS-04 | Account locked after 5 failed attempts | Negative | P1 | Five consecutive wrong logins | Account locked; notification sent | Partial | REQ-03 |
| TS-05 | Reset link rejected after 61 minutes | Boundary | P2 | Open reset link 61 minutes after issue | “Link expired”; no password change | Automatable | REQ-04 |
| TS-06 | Adult PCC fare deducted at tap-on | Positive | P1 | Tap Adult PCC on MFTP | Adult fare deducted; balance updated | Automatable | REQ-05 |
| TS-07 | Senior concession rate applied | Positive | P1 | Tap Senior PCC on MFTP | Senior rate deducted | Automatable | REQ-05 |
| TS-08 | Insufficient balance rejects tap-on | Negative | P1 | Tap a card whose balance is below the minimum fare | Declined; low-balance message | Automatable | REQ-05 |
| TS-09 | API rejects request with no bearer token | Security | P1 | `GET /api/data` without an Authorization header | HTTP 401 Unauthorized | Automatable | REQ-08 |
| TS-10 | Expired token returns 401 | Negative | P2 | Call API with an expired JWT | HTTP 401 with token-expired code | Automatable | REQ-08 |
| TS-11 | Admin exports audit-log CSV by date range | Positive | P3 | Set date range and click Export | CSV containing entries in range | Partial | REQ-07 |
| TS-12 | Tap-on with balance exactly equal to fare | Boundary | P3 | Tap a card whose balance equals the minimum fare | Accepted; balance becomes $0.00 | Automatable | REQ-05 |

**Coverage note:** REQ-06 is a vague performance requirement and receives no scenario. It appears as a Gap in Tab 4.

---

## 3. TCER Creation

**Processing:** AI plus rule scoring

AI fills the precondition, trigger, and expected result for each scenario. Each row is then scored using four checks worth 25% each.

- Score ≥ 75 → Pass.
- Score ≥ 50 → Rework.
- Otherwise → Reject.
- An SME can remove rows and add comments.

### Input

Included scenarios from Tab 2.

### Output stored

```text
pipe.tcer → {
  rows[{
    id,
    title,
    tcId,
    trigger,
    expected,
    priority,
    reqId,
    verdict,
    score,
    reasons,
    comment,
    removed
  }],
  avg,
  pass,
  rework,
  reject
}
```

### Totals

| Measure | Value |
|---|---:|
| Pass | 10 |
| Rework | 0 |
| Reject | 1 |
| Average score | 93% |
| Active / total | 11 / 12 |

### TCER rows

The score-check columns are **A T V R**.

| Scenario | Title | TC ID | Priority | Expected result | Requirement | A T V R | Status | SME comment |
|---|---|---|---|---|---|---|---|---|
| TS-01 | Login with valid credentials succeeds | TC-001 | P1 | Redirected to Dashboard; session cookie set | REQ-01 | ✓ ✓ ✓ ✓ | Pass 100% | — |
| TS-02 | Login with invalid password shows error | TC-002 | P1 | Toast “Invalid credentials”; remains on login | REQ-01 | ✓ ✓ ✓ ✓ | Pass 100% | — |
| TS-03 | Session auto-expires after 30 minutes idle | TC-003 | P1 | Automatic logout; session-expired banner | REQ-02 | ✓ ✓ ✓ ✓ | Pass 100% | — |
| TS-04 | Account locked after 5 failed attempts | TC-004 | P1 | Status = Locked; notification sent | REQ-03 | ✓ ✓ ✓ ✓ | Pass 100% | Confirm channel with BA |
| TS-05 | Reset link rejected after 61 minutes | TC-005 | P2 | “Link expired”; no change permitted | REQ-04 | ✓ ✓ ✓ ✓ | Pass 100% | — |
| TS-06 | Adult PCC fare deducted at tap-on | TC-006 | P1 | Adult fare deducted; new balance shown | REQ-05 | ✓ ✓ ✓ ✓ | Pass 100% | — |
| TS-07 | Senior concession rate applied | TC-007 | P1 | Senior rate deducted; concession confirmed | REQ-05 | ✓ ✓ ✓ ✓ | Pass 100% | — |
| TS-08 | Insufficient balance rejects tap-on | TC-008 | P1 | Declined; “Insufficient balance” shown | REQ-05 | ✓ ✓ ✓ ✓ | Pass 100% | — |
| TS-09 | API rejects request with no bearer token | TC-009 | P1 | HTTP 401; error code `MISSING_TOKEN` | REQ-08 | ✓ ✓ ✓ ✓ | Pass 100% | — |
| TS-10 | Expired token returns 401 | TC-010 | P2 | HTTP 401; error code `TOKEN_EXPIRED` | REQ-08 | ✓ ✓ ✓ ✓ | Pass 100% | — |
| TS-11 | Admin exports audit-log CSV by date range | TC-011 | P3 | CSV with entries in range | REQ-07 | ✓ ✓ ✓ ✓ | Removed | Out of scope for this release |
| TS-12 | Tap-on with balance exactly equal to fare | TC-012 | P3 | Blank—AI left it empty | REQ-05 | ✕ ✕ ✕ ✓ | Reject 25% | Needs expected result |

### Scoring rules

- **A:** title and expected result are both present.
- **T:** expected result and trigger are both present.
- **V:** expected result contains real text.
- **R:** linked to a Requirement ID.
- Score = checks passed ÷ 4.
- Duplicate titles are capped at 60%, producing Rework.
- Average is calculated across active, non-removed rows:

```text
(10 × 100 + 25) ÷ 11 = 93%
```

---

## 4. Coverage Analysis and RTM

**Processing:** Rule-based

The Requirements Traceability Matrix is built live from Tabs 1–3.

- **Gap:** no scenarios and no TCER rows.
- **Partial:** scenarios exist but no active TCER row.
- **Covered:** at least one active TCER row.

### Input

Requirements from Tab 1, scenarios from Tab 2, and non-removed TCER rows from Tab 3, joined on Requirement ID.

### Output

Computed every time the tab renders; nothing extra is stored.

```text
{
  reqId,
  reqScns,
  reqTcs,
  tcCount,
  coverageLabel,
  gapReason
}
```

### Totals

| Measure | Value |
|---|---:|
| Covered | 6 |
| Partial | 1 |
| Gap | 1 |
| Coverage | 75% |
| Scenarios | 12 |
| Active test cases | 11 |

### Traceability matrix

| Requirement | Title | Source | Scenario IDs | Active TC IDs | #TC | Coverage | Gap reason |
|---|---|---|---|---|---:|---|---|
| REQ-01 | User can log in with username and password | `BRD_v2.docx` | TS-01, TS-02 | TC-001, TC-002 | 2 | Covered | — |
| REQ-02 | Session expires after 30 minutes of inactivity | `BRD_v2.docx` | TS-03 | TC-003 | 1 | Covered | — |
| REQ-03 | User is notified when the account is locked | `BRD_v2.docx` | TS-04 | TC-004 | 1 | Covered | — |
| REQ-04 | Password-reset link expires within 1 hour | `BRD_v2.docx` | TS-05 | TC-005 | 1 | Covered | — |
| REQ-05 | Fare deducted based on concession-card type | `Fare_Rules.pdf` | TS-06, TS-07, TS-08, TS-12 | TC-006, TC-007, TC-008, TC-012 | 4 | Covered | — |
| REQ-06 | System should be fast under load | `NFR.xlsx` | — | — | 0 | Gap | No scenario generated |
| REQ-07 | Admin can export audit logs as CSV | `BRD_v2.docx` | TS-11 | — | 0 | Partial | Scenario exists; no active TCER row |
| REQ-08 | API returns 401 for unauthenticated requests | `API_Spec.yaml` | TS-09, TS-10 | TC-009, TC-010 | 2 | Covered | — |

### Important behaviour

REQ-05 is shown as Covered even though TC-012 was rejected during TCER scoring. Coverage checks only whether a TCER row exists and has not been removed; it ignores the verdict.

```text
Coverage % = covered requirements ÷ total requirements = 6 ÷ 8 = 75%
```

---

## 5. Risk Based Analysis

**Processing:** Rule-based

Ranks every included scenario.

```text
Risk score = Priority × 3 + Feasibility + Class
```

Bands:

- Score ≥ 13 → P1.
- Score ≥ 9 → P2.
- Otherwise → P3.

The tab recommends how many test cases each requirement needs and which test cycle runs it.

### Weights

| Dimension | Values |
|---|---|
| Priority | P1 = 3, P2 = 2, P3 = 1 |
| Feasibility | Manual = 3, Partial = 2, Automatable = 1 |
| Class | Security = 3; Negative, Boundary, Error, Recovery = 2; Positive, Edge = 1 |

### Output stored

```text
pipe.risk.out.ranked[] → scenario + {
  riskScore,
  band,
  factors
}
```

Rows are sorted by score, highest first.

### Band totals

| Band | Count |
|---|---:|
| P1 · High | 2 |
| P2 · Medium | 8 |
| P3 · Low | 2 |

### On-screen requirement view

| Requirement / feature | Change type | Impact | TCs now → required | Cycle | Contributing factors |
|---|---|---|---|---|---|
| REQ-03 Account-lock notification | Enhancement | High | 1 → 5 | C1 | Priority P1 · Partial · Negative |
| REQ-08 API returns 401 unauthenticated | Enhancement | High | 2 → 5 | C1 | Priority P1 · Automatable · Security |
| REQ-01 Login with username and password | Enhancement | Medium | 2 → 3 | C2 | Priority P1 · Automatable · Negative |
| REQ-02 Session expiry after 30 minutes | Enhancement | Medium | 1 → 3 | C2 | Priority P1 · Partial · Positive |
| REQ-05 Fare deduction by concession card | Enhancement | Medium | 4 | C2 | Priority P1 · Automatable · Negative |
| REQ-07 Audit-log CSV export | Enhancement | Low | 6 | C2 | Priority P3 · Partial · Positive |
| REQ-05 Fare deduction by concession card | Enhancement | Low | 4 | C2 | Priority P3 · Automatable · Boundary |

### CSV export — ranked scenarios

| Rank | Scenario | Title | Risk band | Score | Arithmetic |
|---:|---|---|---|---:|---|
| 1 | TS-04 | Account locked after 5 failed attempts | P1 | 13 | 9 + 2 + 2 |
| 2 | TS-09 | API rejects request with no bearer token | P1 | 13 | 9 + 1 + 3 |
| 3 | TS-02 | Login with invalid password shows error | P2 | 12 | 9 + 1 + 2 |
| 4 | TS-03 | Session auto-expires after 30 minutes idle | P2 | 12 | 9 + 2 + 1 |
| 5 | TS-08 | Insufficient balance rejects tap-on | P2 | 12 | 9 + 1 + 2 |
| 6 | TS-01 | Login with valid credentials succeeds | P2 | 11 | 9 + 1 + 1 |
| 7 | TS-06 | Adult PCC fare deducted at tap-on | P2 | 11 | 9 + 1 + 1 |
| 8 | TS-07 | Senior concession rate applied | P2 | 11 | 9 + 1 + 1 |
| 9 | TS-05 | Reset link rejected after 61 minutes | P2 | 9 | 6 + 1 + 2 |
| 10 | TS-10 | Expired token returns 401 | P2 | 9 | 6 + 1 + 2 |
| 11 | TS-11 | Admin exports audit-log CSV by date range | P3 | 6 | 3 + 2 + 1 |
| 12 | TS-12 | Tap-on with balance exactly equal to fare | P3 | 6 | 3 + 1 + 2 |

The CSV’s Contributing Factors column contains descriptive text such as `priority P1 · Partial · Negative`. The arithmetic above is shown only to explain each score.

### Important behaviour

- “TCs Now → Required” targets 5 test cases for each P1 requirement and 3 for each P2 requirement.
- When a requirement has zero active TCER rows, the application falls back to the risk score as the **TCs Now** number. This is why REQ-07 shows 6.
- Cycle is C1 for the top-ranked row and every P1 row; all other rows use C2.

---

# Test Cases

Authoring → BDD → validation → human review → suites → publishing → automation feasibility.

## 1. Test Case Authoring

**Processing:** AI output

Writes one full test case for each TCER row, including numbered steps, matching expected results, test data, type, and platform. Users can also upload existing test cases for AI enrichment.

### Input

11 active TCER rows from `window.__bedrockTCER`, plus one uploaded legacy case.

### Output stored

```text
sharedRef.cases[] → {
  id,
  scenarioId,
  reqId,
  title,
  description,
  type,
  priority,
  precondition,
  testData,
  steps,
  expected,
  platform,
  status,
  approved,
  published,
  publishId,
  comment,
  reviewStatus,
  reviewer
}
```

### Totals

| Measure | Count |
|---|---:|
| Test cases | 12 |
| Generated from TCER | 11 |
| Uploaded | 1 |

### Sample rows — 4 of 12

#### TC-001 — Verify login with valid credentials

- Scenario: TS-01.
- Description: Validate successful authentication.
- Precondition: User registered; browser on `/login`.
- Test data: `testuser@qa.com / Test@1234`.
- Priority: P1.
- Requirement: REQ-01.
- Type: Functional.
- Platform: Web.
- Review status: Pending.

Steps and expected results:

| # | Step | Expected result |
|---:|---|---|
| 1 | Navigate to `/login` | Login page loads |
| 2 | Enter valid username | Username populated |
| 3 | Enter valid password | Password masked |
| 4 | Click Sign In | Redirected to `/dashboard` |

#### TC-006 — Verify Adult PCC fare deduction on MFTP tap

- Scenario: TS-06.
- Precondition: Adult PCC balance ≥ $3.50; MFTP online.
- Test data: Adult PCC, balance $10.00, fare $3.50.
- Priority: P1.
- Requirement: REQ-05.
- Type: Functional.
- Platform: MFTP.
- Review status: Pending.

| # | Step | Expected result |
|---:|---|---|
| 1 | Confirm MFTP status = Online | Device shows Ready |
| 2 | Tap Adult PCC on reader | “Processing” shown |
| 3 | Wait for confirmation | “Tap Accepted” shown |
| 4 | Read balance on display | Balance = $6.50 |

#### TC-009 — Verify API returns 401 without bearer token

- Scenario: TS-09.
- Description: Validate authentication enforcement.
- Precondition: API running; no token prepared.
- Test data: `GET /api/data`, no headers.
- Priority: P1.
- Requirement: REQ-08.
- Type: Functional.
- Platform: API.

| # | Step | Expected result |
|---:|---|---|
| 1 | Open API client | Client ready |
| 2 | Set `GET /api/data` | Request configured |
| 3 | Remove Authorization header | No auth header |
| 4 | Send request | 401 + `MISSING_TOKEN` |

#### TC-011 — Tap-on with balance exactly equal to fare

- Scenario: TS-12.
- Description: Validate tap-on with balance exactly equal to fare.
- Precondition: `System is in a stable state`.
- Steps: Tap card at exact minimum balance.
- Expected: `The system responds correctly`.
- Priority: P3.
- Requirement: REQ-05.
- Type: Functional.

**Fallback-value note:** `System is in a stable state` and `The system responds correctly` are application fallback values inserted when AI leaves fields empty. They hide the gap here, but Validation later flags the case because it has only one step.

---

## 2. BDD Authoring

**Processing:** AI output

Writes Gherkin Scenario Outlines with Examples tables while reusing the Step Definition Library. New domain-specific steps are added to the library.

### Input

TCER rows, automatically imported as drafts on first load, plus the existing step library.

### Output stored

```text
sharedRef.bddCases[] → {
  id,
  scenarioId,
  reqId,
  feature,
  title,
  description,
  given,
  when,
  then,
  examples,
  testData,
  platform,
  priority,
  newSteps[]
}

stepLib[] → {
  id,
  step
}
```

### BDD cases

| BDD ID | Scenario | Feature | Title | Test data | Platform | Priority | Requirement | New steps |
|---|---|---|---|---|---|---|---|---:|
| BDD-001 | TS-06 | FarePayment | Fare payment using PCC by concession type | Adult/Senior/Youth PCC; e-purse $10.00 | MFTP | P1 | REQ-05 | 2 |
| BDD-002 | TS-01 | Authentication | Login outcome by credential validity | Valid and invalid credential pairs | Web | P1 | REQ-01 | 2 |
| BDD-003 | TS-09 | APISecurity | API response for unauthenticated access | 3 protected endpoints | API | P1 | REQ-08 | 2 |

### BDD-001 — FarePayment

```gherkin
Feature: FarePayment

  Scenario Outline: Fare payment using PCC by concession type
    Given a <concession> PCC with sufficient balance
    And the MFTP device is online
    When the card is tapped on the MFTP device
    Then the fare is accepted and the <concession> screen is shown
    And the balance is reduced by the fare amount

    Examples:
      | concession |
      | Adult      |
      | Senior     |
      | Youth      |
```

### BDD-002 — Authentication

```gherkin
Feature: Authentication

  Scenario Outline: Login outcome by credential validity
    Given the user is on the login page
    When the user enters <username> and <password>
    Then the login <outcome> is displayed

    Examples:
      | username        | password | outcome                    |
      | testuser@qa.com | Test@1234 | succeeds to dashboard     |
      | testuser@qa.com | WrongPass | fails: Invalid credentials |
```

### BDD-003 — APISecurity

```gherkin
Feature: APISecurity

  Scenario Outline: API response for unauthenticated access
    Given the API endpoint <endpoint> is available
    When a request is sent without an Authorization header
    Then the response status code is <status_code>

    Examples:
      | endpoint         | status_code |
      | GET /api/data    | 401         |
      | GET /api/users   | 401         |
      | POST /api/update | 401         |
```

### Step Definition Library after this run

| ID | Step |
|---|---|
| STEP-001 | Given the user is on the login page |
| STEP-002 | And the MFTP device is online |
| STEP-003 | When the card is tapped on the MFTP device |
| STEP-004 | And the balance is reduced by the fare amount |
| STEP-005 | Given a `<concession>` PCC with sufficient balance |
| STEP-006 | Then the fare is accepted and the `<concession>` screen is shown |
| STEP-007 | When the user enters `<username>` and `<password>` |
| STEP-008 | Then the login `<outcome>` is displayed |
| STEP-009 | Given the API endpoint `<endpoint>` is available |
| STEP-010 | When a request is sent without an Authorization header |
| STEP-011 | Then the response status code is `<status_code>` |

---

## 3. Test Case Validation

**Processing:** Rule-based

Checks every test case against five rules.

```text
Score = (1 − issues ÷ 4) × 100
```

Verdicts:

- 0 issues → Pass.
- 1 issue → Rework.
- 2 or more issues → Reject.

### Validation rules

- Missing expected result.
- Missing precondition.
- Fewer than 2 step lines.
- No scenario ID.
- Duplicate title.

### Output stored

```text
sharedRef.validated → {
  results[{
    case,
    issues[],
    verdict,
    score
  }],
  runAt
}
```

### Totals

| Verdict | Count |
|---|---:|
| Pass | 10 |
| Rework | 1 |
| Reject | 1 |
| Total | 12 |

### Validation results

| ID | Title | Issues | Score | Verdict |
|---|---|---|---:|---|
| TC-001 | Verify login with valid credentials | None | 100 | Pass |
| TC-002 | Verify error on invalid password | None | 100 | Pass |
| TC-003 | Verify session auto-expiry after 30 min | None | 100 | Pass |
| TC-004 | Verify account lock after 5 failures | None | 100 | Pass |
| TC-005 | Verify reset link rejected after 61 min | None | 100 | Pass |
| TC-006 | Verify Adult PCC fare deduction on MFTP tap | None | 100 | Pass |
| TC-007 | Verify Senior concession rate | None | 100 | Pass |
| TC-008 | Verify tap-on declined on low balance | None | 100 | Pass |
| TC-009 | Verify API returns 401 without bearer token | None | 100 | Pass |
| TC-010 | Verify expired token returns 401 | None | 100 | Pass |
| TC-011 | Tap-on with balance exactly equal to fare | Non-atomic or too few steps | 75 | Rework |
| TC-012 | Kiosk top-up, uploaded legacy case | Missing precondition; non-atomic or too few steps; broken requirement link because no scenario ID | 25 | Reject |

---

## 4. AI Review and Human Approval

**Processing:** Human workflow

The reviewer marks every case Approved, Rework, or Rejected and can add a comment at Gate B. Despite the tab name, this stage makes no AI call. Approved rows turn green.

### Input

All test cases, usually reviewed alongside their Validation verdicts.

### Fields updated on each case

```text
status: Approved | Rework | Rejected | Pending
approved: true | false
comment
```

### Totals

| Status | Count |
|---|---:|
| Approved | 10 |
| Rework | 1 |
| Rejected | 1 |
| Pending | 0 |

### Review examples

| ID | Title | Type | Priority | Status | Reviewer comment |
|---|---|---|---|---|---|
| TC-001 | Verify login with valid credentials | Functional | P1 | Approved | — |
| TC-002 | Verify error on invalid password | Functional | P1 | Approved | — |
| TC-003–TC-009 | Seven additional cases | Functional | P1/P2 | Approved | — |
| TC-010 | Verify expired token returns 401 | Functional | P2 | Approved | Add response-body assertion in automation |
| TC-011 | Tap-on with balance exactly equal to fare | Functional | P3 | Rework | Split into tap, confirm, and balance-check steps; define expected $0.00 |
| TC-012 | Kiosk top-up, uploaded legacy case | Functional | — | Rejected | Validation issues require replacement or major rewrite |

Available actions on each row: Approve, Rework, Reject.

---

## 5. Suite Structuring

**Processing:** Human workflow

The user assigns approved cases to Feature, Regression, and Release suites through checkboxes. A case may belong to more than one suite.

### Input

10 approved test cases.

### Output stored

```text
sharedRef.suites[] → {
  id: SUITE-00x,
  name,
  view,
  cases[TC IDs]
}
```

### Suites

#### SUITE-001 — Feature Suite

- 10 of 10 approved cases.
- Contains TC-001 through TC-010.

#### SUITE-002 — Regression Suite

- 5 of 10 cases:
  - TC-001 — Valid login.
  - TC-002 — Invalid password.
  - TC-006 — Adult PCC fare.
  - TC-008 — Low-balance decline.
  - TC-009 — API 401 with no token.

#### SUITE-003 — Release Suite

- 3 of 10 cases:
  - TC-001 — Valid login.
  - TC-006 — Adult PCC fare.
  - TC-009 — API 401 with no token.

### Case-to-suite assignments

| ID | Title | Type | Priority | Suites |
|---|---|---|---|---|
| TC-001 | Verify login with valid credentials | Functional | P1 | Feature, Regression, Release |
| TC-002 | Verify error on invalid password | Functional | P1 | Feature, Regression |
| TC-003 | Verify session auto-expiry after 30 min | Functional | P1 | Feature |
| TC-004 | Verify account lock after 5 failures | Functional | P1 | Feature |
| TC-005 | Verify reset link rejected after 61 min | Functional | P2 | Feature |
| TC-006 | Verify Adult PCC fare deduction on MFTP tap | Functional | P1 | Feature, Regression, Release |
| TC-007 | Verify Senior concession rate | Functional | P1 | Feature |
| TC-008 | Verify tap-on declined on low balance | Functional | P1 | Feature, Regression |
| TC-009 | Verify API returns 401 without bearer token | Functional | P1 | Feature, Regression, Release |
| TC-010 | Verify expired token returns 401 | Functional | P2 | Feature |

---

## 6. Test Asset Publishing

**Processing:** Rule-based mock

Stamps each approved case with a repository ID, selected target—ADO, Jira-Xray, or Git—and timestamp. The current behaviour is simulated with a 1.2-second delay; no real ALM API is called.

### Input

Approved cases plus selected target.

### Output stored

```text
sharedRef.published[] → case + {
  published: true,
  publishId: TARGET-xxxxx-NNN,
  publishTarget,
  publishedAt
}
```

### Result

| Measure | Value |
|---|---|
| Published | 10 |
| Target | ADO |
| Published at | 10/3/2026, 10:23:45 AM |

### Published cases

| TC ID | Title | Type | Repository ID | Target |
|---|---|---|---|---|
| TC-001 | Verify login with valid credentials | Functional | ADO-82345-001 | ADO |
| TC-002 | Verify error on invalid password | Functional | ADO-82345-002 | ADO |
| TC-003 | Verify session auto-expiry after 30 min | Functional | ADO-82345-003 | ADO |
| TC-004 | Verify account lock after 5 failures | Functional | ADO-82345-004 | ADO |
| TC-005 | Verify reset link rejected after 61 min | Functional | ADO-82345-005 | ADO |
| TC-006 | Verify Adult PCC fare deduction on MFTP tap | Functional | ADO-82345-006 | ADO |
| TC-007 | Verify Senior concession rate | Functional | ADO-82345-007 | ADO |
| TC-008 | Verify tap-on declined on low balance | Functional | ADO-82345-008 | ADO |
| TC-009 | Verify API returns 401 without bearer token | Functional | ADO-82345-009 | ADO |
| TC-010 | Verify expired token returns 401 | Functional | ADO-82345-010 | ADO |

---

## 7. Automation Feasibility

**Processing:** Rule-based

Classifies every published case as Automatable, Partial, or Manual, and assigns a recommended tool and ROI. Rules are evaluated in order; the first match wins.

### Rules

1. `autoFeasibility` contains `auto` → Automatable.
2. `autoFeasibility` contains `partial` → Partial.
3. `type = BDD` → Automatable.
4. `priority = High` or `P1` → Partial.
5. Otherwise → Manual.

### Input

Published cases. If nothing has been published, the tab falls back to all cases.

### Output

Computed each time the tab renders; nothing is stored.

```text
case + {
  feasibility,
  tool,
  roi
}
```

Tool and ROI mapping:

- Automatable → Selenium / Playwright, High ROI.
- Partial → Manual + API tests, Medium ROI.
- Manual → Manual, Low ROI.

### Totals

| Classification | Count |
|---|---:|
| Automatable | 0 |
| Partial | 8 |
| Manual only | 2 |
| Total | 10 |

### Feasibility results

| TC ID | Title | Type | Priority | Feasibility | Recommended tool | ROI | Published ID |
|---|---|---|---|---|---|---|---|
| TC-001 | Verify login with valid credentials | Functional | P1 | Partial | Manual + API tests | Medium | ADO-82345-001 |
| TC-002 | Verify error on invalid password | Functional | P1 | Partial | Manual + API tests | Medium | ADO-82345-002 |
| TC-003 | Verify session auto-expiry after 30 min | Functional | P1 | Partial | Manual + API tests | Medium | ADO-82345-003 |
| TC-004 | Verify account lock after 5 failures | Functional | P1 | Partial | Manual + API tests | Medium | ADO-82345-004 |
| TC-005 | Verify reset link rejected after 61 min | Functional | P2 | Manual | Manual | Low | ADO-82345-005 |
| TC-006 | Verify Adult PCC fare deduction on MFTP tap | Functional | P1 | Partial | Manual + API tests | Medium | ADO-82345-006 |
| TC-007 | Verify Senior concession rate | Functional | P1 | Partial | Manual + API tests | Medium | ADO-82345-007 |
| TC-008 | Verify tap-on declined on low balance | Functional | P1 | Partial | Manual + API tests | Medium | ADO-82345-008 |
| TC-009 | Verify API returns 401 without bearer token | Functional | P1 | Partial | Manual + API tests | Medium | ADO-82345-009 |
| TC-010 | Verify expired token returns 401 | Functional | P2 | Manual | Manual | Low | ADO-82345-010 |

### Important implementation caveat

All 10 published cases originated from scenarios rated Automatable or Partial during Scenario Design, yet none is classified Automatable here. When test cases are created in `TestCases.jsx` around lines 674–691, the scenario’s `autoFeasibility` value is not copied onto the generated case.

Classification therefore skips the first two rules and proceeds to priority:

- P1 → Partial.
- Everything else → Manual.
- Only cases typed BDD can currently reach Automatable without `autoFeasibility` being copied.

Copying `src.autoFeasibility` onto every generated case would preserve the intended classification.

---

*Bedrock Tab Output Reference · Source: `Bedrock_Framework/src/components/TestDesign` and `TestCases` · 2026-10-03*
