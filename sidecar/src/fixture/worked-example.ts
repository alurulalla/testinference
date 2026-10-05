/**
 * The worked example from the tab output reference, carried through all
 * twelve stages. Every number the engines produce from this is checked
 * against the published output, so a change that moves a number has to be
 * deliberate.
 */

import type { Requirement, Scenario, TcerRow, TestCase } from "../engines/types.js";

export const requirements: Requirement[] = [
  { id: "REQ-01", title: "User can log in with username and password", acceptance: "Login succeeds with valid credentials and fails with invalid ones", source: "BRD_v2.docx" },
  { id: "REQ-02", title: "Session expires after 30 minutes of inactivity", acceptance: "User is logged out automatically after 30 minutes idle", source: "BRD_v2.docx" },
  { id: "REQ-03", title: "User is notified when the account is locked", acceptance: "Notification sent after 5 failed login attempts", source: "BRD_v2.docx" },
  { id: "REQ-04", title: "Password reset link expires within 1 hour", acceptance: "Reset link invalid 60 minutes after generation", source: "BRD_v2.docx" },
  { id: "REQ-05", title: "Fare is deducted based on concession-card type", acceptance: "Adult, Senior and Youth rates applied correctly at tap-on", source: "Fare_Rules.pdf" },
  { id: "REQ-06", title: "System should be fast under load", acceptance: "Response time under peak traffic is acceptable", source: "NFR.xlsx" },
  { id: "REQ-07", title: "Admin can export audit logs as CSV", acceptance: "CSV download with date-range filter", source: "BRD_v2.docx" },
  { id: "REQ-08", title: "API returns 401 for unauthenticated requests", acceptance: "Any call without a valid bearer token returns HTTP 401", source: "API_Spec.yaml" },
];

export const scenarios: Scenario[] = [
  { id: "TS-01", reqId: "REQ-01", title: "Login with valid credentials succeeds", class: "Positive", priority: "P1", autoFeasibility: "Automatable", included: true },
  { id: "TS-02", reqId: "REQ-01", title: "Login with invalid password shows error", class: "Negative", priority: "P1", autoFeasibility: "Automatable", included: true },
  { id: "TS-03", reqId: "REQ-02", title: "Session auto-expires after 30 minutes idle", class: "Positive", priority: "P1", autoFeasibility: "Partial", included: true },
  { id: "TS-04", reqId: "REQ-03", title: "Account locked after 5 failed attempts", class: "Negative", priority: "P1", autoFeasibility: "Partial", included: true },
  { id: "TS-05", reqId: "REQ-04", title: "Reset link rejected after 61 minutes", class: "Boundary", priority: "P2", autoFeasibility: "Automatable", included: true },
  { id: "TS-06", reqId: "REQ-05", title: "Adult concession fare deducted at tap-on", class: "Positive", priority: "P1", autoFeasibility: "Automatable", included: true },
  { id: "TS-07", reqId: "REQ-05", title: "Senior concession rate applied", class: "Positive", priority: "P1", autoFeasibility: "Automatable", included: true },
  { id: "TS-08", reqId: "REQ-05", title: "Insufficient balance rejects tap-on", class: "Negative", priority: "P1", autoFeasibility: "Automatable", included: true },
  { id: "TS-09", reqId: "REQ-08", title: "API rejects request with no bearer token", class: "Security", priority: "P1", autoFeasibility: "Automatable", included: true },
  { id: "TS-10", reqId: "REQ-08", title: "Expired token returns 401", class: "Negative", priority: "P2", autoFeasibility: "Automatable", included: true },
  { id: "TS-11", reqId: "REQ-07", title: "Admin exports audit-log CSV by date range", class: "Positive", priority: "P3", autoFeasibility: "Partial", included: true },
  { id: "TS-12", reqId: "REQ-05", title: "Tap-on with balance exactly equal to fare", class: "Boundary", priority: "P3", autoFeasibility: "Automatable", included: true },
];

const row = (
  id: string,
  tcId: string,
  reqId: string,
  title: string,
  expected: string,
  priority: TcerRow["priority"],
  removed = false,
): TcerRow => ({ id, tcId, reqId, title, trigger: "the documented action", expected, priority, removed });

export const tcerRows: TcerRow[] = [
  row("TS-01", "TC-001", "REQ-01", "Login with valid credentials succeeds", "Redirected to Dashboard; session cookie set", "P1"),
  row("TS-02", "TC-002", "REQ-01", "Login with invalid password shows error", "Toast reads Invalid credentials; remains on login", "P1"),
  row("TS-03", "TC-003", "REQ-02", "Session auto-expires after 30 minutes idle", "Automatic logout; session-expired banner", "P1"),
  row("TS-04", "TC-004", "REQ-03", "Account locked after 5 failed attempts", "Status becomes Locked; notification sent", "P1"),
  row("TS-05", "TC-005", "REQ-04", "Reset link rejected after 61 minutes", "Link expired; no change permitted", "P2"),
  row("TS-06", "TC-006", "REQ-05", "Adult concession fare deducted at tap-on", "Adult fare deducted; new balance shown", "P1"),
  row("TS-07", "TC-007", "REQ-05", "Senior concession rate applied", "Senior rate deducted; concession confirmed", "P1"),
  row("TS-08", "TC-008", "REQ-05", "Insufficient balance rejects tap-on", "Declined; Insufficient balance shown", "P1"),
  row("TS-09", "TC-009", "REQ-08", "API rejects request with no bearer token", "HTTP 401; error code MISSING_TOKEN", "P1"),
  row("TS-10", "TC-010", "REQ-08", "Expired token returns 401", "HTTP 401; error code TOKEN_EXPIRED", "P2"),
  row("TS-11", "TC-011", "REQ-07", "Admin exports audit-log CSV by date range", "CSV with entries in range", "P3", true),
  // The model left this one's expected result empty, which is the whole point
  // of it: it fails scoring, and is therefore never written up as a case.
  { id: "TS-12", tcId: "TC-012", reqId: "REQ-05", title: "Tap-on with balance exactly equal to fare", trigger: "", expected: "", priority: "P3", removed: false },
];

const steps = (count: number) => Array.from({ length: count }, (_, index) => `${index + 1}. step`).join("\n");

/**
 * What authoring produces from the rows above: ten cases, because the
 * rejected row is not written up, plus one case uploaded from a spreadsheet.
 */
export const testCases: TestCase[] = [
  ...tcerRows
    .filter((candidate) => !candidate.removed && candidate.expected.trim().length > 0)
    .map<TestCase>((candidate) => {
      const scenario = scenarios.find((entry) => entry.id === candidate.id);
      return {
        id: candidate.tcId,
        scenarioId: candidate.id,
        reqId: candidate.reqId,
        title: `Verify ${candidate.title.toLowerCase()}`,
        type: "Functional",
        priority: candidate.priority,
        precondition: "the documented starting state",
        steps: steps(4),
        expected: candidate.expected,
        // Carried over from the scenario — the fix the old app was missing.
        autoFeasibility: scenario?.autoFeasibility ?? null,
      };
    }),
  {
    id: "TC-012",
    scenarioId: null,
    reqId: null,
    title: "Kiosk top-up, uploaded legacy case",
    type: "Functional",
    priority: null,
    precondition: "",
    steps: "1. top up at the kiosk",
    expected: "the top-up succeeds",
    autoFeasibility: null,
  },
];
