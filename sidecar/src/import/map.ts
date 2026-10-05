import { fanOut, field as safeName } from "../decisions/fanout.js";
import { FIELDS, type Field, type Sheet } from "./csv.js";

/**
 * Working out which column is which.
 *
 * Every team names these differently — "Summary", "Test Case Name" and
 * "Title" are the same column, and "Steps", "Test Steps" and "Actions" are
 * another. Known names are matched outright; anything left over goes to the
 * judge, which is a classification question of exactly the kind it is for.
 *
 * Nothing is guessed silently: the mapping is shown before anything is
 * imported, and a person can change any of it.
 */

export type Mapping = Partial<Record<Field, number>>;

/** Known headings, lowercased and stripped of punctuation. */
const KNOWN: Record<string, Field> = {
  title: "title",
  name: "title",
  summary: "title",
  testcase: "title",
  testcasename: "title",
  testcasetitle: "title",
  scenario: "title",

  id: "id",
  key: "id",
  testcaseid: "id",
  tcid: "id",
  caseid: "id",
  identifier: "id",

  description: "description",
  objective: "description",
  purpose: "description",

  precondition: "precondition",
  preconditions: "precondition",
  prerequisite: "precondition",
  prerequisites: "precondition",
  setup: "precondition",
  given: "precondition",

  testdata: "testData",
  data: "testData",
  inputdata: "testData",

  steps: "steps",
  teststeps: "steps",
  stepstoreproduce: "steps",
  actions: "steps",
  action: "steps",
  procedure: "steps",
  when: "steps",

  expected: "expected",
  expectedresult: "expected",
  expectedresults: "expected",
  expectedoutcome: "expected",
  expectedbehaviour: "expected",
  expectedbehavior: "expected",
  then: "expected",
  result: "expected",

  priority: "priority",
  severity: "priority",
  importance: "priority",

  type: "caseType",
  testtype: "caseType",
  casetype: "caseType",
  category: "caseType",

  platform: "platform",
  environment: "platform",
  application: "platform",

  automatable: "autoFeasibility",
  automation: "autoFeasibility",
  automationstatus: "autoFeasibility",
  autofeasibility: "autoFeasibility",

  requirement: "reqId",
  requirementid: "reqId",
  reqid: "reqId",
  story: "reqId",
  userstory: "reqId",
  epic: "reqId",

  scenarioid: "scenarioId",
  tsid: "scenarioId",
};

function flatten(heading: string): string {
  return heading.toLowerCase().replace(/[^a-z]/g, "");
}

export interface Suggestion {
  mapping: Mapping;
  /** Column index to how the mapping was arrived at. */
  why: Record<number, string>;
  unmapped: string[];
  by: "rules" | "jev";
  inputTokens: number;
  outputTokens: number;
}

/** Matches what it recognises. The judge is not involved. */
export function byName(sheet: Sheet): Suggestion {
  const mapping: Mapping = {};
  const why: Record<number, string> = {};
  const unmapped: string[] = [];

  sheet.columns.forEach((heading, index) => {
    const known = KNOWN[flatten(heading)];
    // First column to claim a field keeps it; a spreadsheet with two
    // "Comments" columns should not have the second quietly win.
    if (known && mapping[known] === undefined) {
      mapping[known] = index;
      why[index] = `"${heading}" is a known name for this`;
      return;
    }
    unmapped.push(heading);
  });

  return { mapping, why, unmapped, by: "rules", inputTokens: 0, outputTokens: 0 };
}

const SKIP = "none of these";

/**
 * Asks the judge about the columns the names did not settle, showing it a
 * few real values — a column called "Notes" is only identifiable by what is
 * in it.
 */
export async function suggest(
  params: Record<string, unknown> & { sheet?: Sheet },
): Promise<Suggestion> {
  const sheet = params["sheet"] as Sheet | undefined;
  if (!sheet) throw new Error("no spreadsheet to map");

  const base = byName(sheet);
  const key = typeof params["key"] === "string" ? params["key"] : "";
  if (params["mode"] !== "jev" || !key || base.unmapped.length === 0) return base;

  // Only the fields still going spare are worth offering.
  const taken = new Set(Object.keys(base.mapping));
  const options: Record<string, string> = { [SKIP]: "This column is not any of the above." };
  for (const [name, description] of Object.entries(FIELDS)) {
    if (!taken.has(name)) options[name] = description;
  }
  if (Object.keys(options).length === 1) return base;

  const asking = sheet.columns
    .map((heading, index) => ({ heading, index }))
    .filter((entry) => base.unmapped.includes(entry.heading));

  const units = asking.map((entry) => {
    const name = `column_${safeName(entry.heading)}_${entry.index}`;
    return {
      state: {
        [name]: {
          heading: entry.heading,
          // Enough rows to tell a priority column from a platform one.
          values: sheet.rows.slice(0, 5).map((row) => (row[entry.index] ?? "").slice(0, 160)),
        },
      },
      question: {
        type: "choice" as const,
        instructions: `A spreadsheet of test cases has a column \`${name}\`. Which part of a test case does it hold?`,
        criteria: options,
      },
    };
  });

  const out = await fanOut(
    {
      key,
      endpoint: typeof params["endpoint"] === "string" ? params["endpoint"] : null,
      model: typeof params["model"] === "string" ? params["model"] : null,
    },
    units,
    Number(params["atOnce"]) || 4,
  );

  const mapping: Mapping = { ...base.mapping };
  const why = { ...base.why };
  const unmapped: string[] = [];

  asking.forEach((entry, at) => {
    const answer = out.answers.get(at);
    const option = answer?.option;
    // A guess below half is worse than leaving it for a person: an
    // unmapped column is visibly empty, a wrongly mapped one is not.
    if (!option || option === SKIP || !(option in FIELDS) || (answer?.confidence ?? 0) < 0.5) {
      unmapped.push(entry.heading);
      return;
    }
    const as = option as Field;
    if (mapping[as] !== undefined) {
      unmapped.push(entry.heading);
      return;
    }
    mapping[as] = entry.index;
    why[entry.index] = `the judge read the values as ${as} (${Math.round((answer?.confidence ?? 0) * 100)}%)`;
  });

  return {
    mapping,
    why,
    unmapped,
    by: "jev",
    inputTokens: out.inputTokens,
    outputTokens: out.outputTokens,
  };
}
