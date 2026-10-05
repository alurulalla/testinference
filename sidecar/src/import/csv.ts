/**
 * Reading a spreadsheet of test cases.
 *
 * Test steps and expected results are the two fields most likely to contain
 * commas, quotes and line breaks, which is exactly what a split on commas
 * gets wrong. This follows RFC 4180: a field may be quoted, a quoted field
 * may contain anything including newlines, and a doubled quote inside a
 * quoted field is one literal quote.
 */

export interface Sheet {
  columns: string[];
  rows: string[][];
}

/** Comma for .csv, tab for .tsv — whichever the header line has more of. */
function separatorOf(text: string): string {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semicolons = (firstLine.match(/;/g) ?? []).length;
  if (tabs > commas && tabs >= semicolons) return "\t";
  if (semicolons > commas) return ";";
  return ",";
}

export function parse(text: string, separator?: string): Sheet {
  // A byte order mark would otherwise become part of the first column's name
  // and quietly break every mapping against it.
  const body = text.replace(/^﻿/, "");
  const sep = separator ?? separatorOf(body);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let had = false;

  const endField = () => {
    row.push(field);
    field = "";
    had = true;
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
    had = false;
  };

  for (let at = 0; at < body.length; at += 1) {
    const char = body[at]!;

    if (quoted) {
      if (char !== '"') {
        field += char;
      } else if (body[at + 1] === '"') {
        field += '"';
        at += 1;
      } else {
        quoted = false;
      }
      continue;
    }

    if (char === '"' && field.length === 0) {
      quoted = true;
    } else if (char === sep) {
      endField();
    } else if (char === "\r") {
      // Swallowed; the \n that follows ends the row.
    } else if (char === "\n") {
      endRow();
    } else {
      field += char;
    }
  }
  // A file that does not end in a newline still has a last row.
  if (field.length > 0 || had || row.length > 0) endRow();

  const header = rows.shift() ?? [];
  const columns = header.map((name, index) => name.trim() || `Column ${index + 1}`);

  return {
    columns,
    // A trailing blank line is not a test case.
    rows: rows.filter((entry) => entry.some((value) => value.trim().length > 0)),
  };
}

/** The fields a test case has, and what each one is for. */
export const FIELDS = {
  title: "What the test is called",
  id: "The case's own identifier in the file it came from",
  description: "A longer description, if the file has one",
  precondition: "What must be true before the steps start",
  testData: "The data the test uses",
  steps: "The steps to carry out",
  expected: "What should happen",
  priority: "P1, P2, P3, or High/Medium/Low",
  caseType: "Functional, Integration, BDD, and so on",
  platform: "Web, mobile, API",
  autoFeasibility: "Whether it can be automated",
  reqId: "The requirement it traces to, if the file says",
  scenarioId: "The scenario it traces to, if the file says",
} as const;

export type Field = keyof typeof FIELDS;

/** Nothing can be made of a case without these two. */
export const REQUIRED: Field[] = ["title", "steps"];
