import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { parse } from "./csv.js";

describe("reading a spreadsheet", () => {
  it("keeps a multi-line field whole", () => {
    const sheet = parse(
      'Title,Steps,Expected\n' +
        '"Log in","1. Open the page\n2. Enter the password","Logged in"\n',
    );
    assert.deepEqual(sheet.columns, ["Title", "Steps", "Expected"]);
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0]![1], "1. Open the page\n2. Enter the password");
  });

  it("keeps commas inside a quoted field", () => {
    const sheet = parse('Title,Steps\n"Pay, then refund","Do it"\n');
    assert.equal(sheet.rows[0]![0], "Pay, then refund");
  });

  it("reads a doubled quote as one quote", () => {
    const sheet = parse('Title\n"He said ""no"""\n');
    assert.equal(sheet.rows[0]![0], 'He said "no"');
  });

  it("reads a last row with no newline after it", () => {
    const sheet = parse("Title,Steps\nLog in,Open the page");
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.rows[0]![1], "Open the page");
  });

  it("handles Windows line endings", () => {
    const sheet = parse("Title,Steps\r\nLog in,Open it\r\n");
    assert.deepEqual(sheet.rows[0], ["Log in", "Open it"]);
  });

  it("takes tabs as the separator when the header uses them", () => {
    const sheet = parse("Title\tSteps\tExpected\nLog in\tOpen it\tDone\n");
    assert.deepEqual(sheet.columns, ["Title", "Steps", "Expected"]);
    assert.deepEqual(sheet.rows[0], ["Log in", "Open it", "Done"]);
  });

  it("drops a byte order mark rather than gluing it to the first column", () => {
    const sheet = parse('﻿Title,Steps\nLog in,Open it\n');
    assert.equal(sheet.columns[0], "Title");
  });

  it("ignores blank lines between rows", () => {
    const sheet = parse("Title\nOne\n\nTwo\n\n");
    assert.deepEqual(sheet.rows.map((row) => row[0]), ["One", "Two"]);
  });

  it("names a column the file left unnamed, instead of losing it", () => {
    const sheet = parse("Title,,Expected\nOne,Two,Three\n");
    assert.deepEqual(sheet.columns, ["Title", "Column 2", "Expected"]);
  });
});
