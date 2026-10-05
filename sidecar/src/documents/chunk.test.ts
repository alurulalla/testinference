import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { hashOf, normalise, toChunks, type Block } from "./chunk.js";

const block = (text: string, page: number | null = null, isHeading = false): Block => ({
  text,
  page,
  heading: null,
  isHeading,
});

describe("cutting a document into pieces", () => {
  it("keeps the page a piece came from", () => {
    const chunks = toChunks([block("First paragraph.", 1), block("Second paragraph.", 2)]);
    assert.equal(chunks[0]?.page, 1);
    assert.ok(chunks.every((chunk) => chunk.page !== null));
  });

  it("starts a new piece at a heading, so a rule is never cut from its section", () => {
    const chunks = toChunks([
      block("Fares", 1, true),
      block("The fare is deducted at tap-on.", 1),
      block("Refunds", 1, true),
      block("A refund is issued within 24 hours.", 1),
    ]);
    assert.equal(chunks.length, 2);
    assert.ok(chunks[0]?.text.startsWith("Fares"));
    assert.ok(chunks[1]?.text.startsWith("Refunds"));
  });

  it("records where in the document each piece started", () => {
    const chunks = toChunks([
      block("Intro", 1, true),
      block("First paragraph.", 1),
      block("Fares", 2, true),
      block("The fare is deducted at tap-on.", 2),
    ]);
    assert.deepEqual(chunks.map((chunk) => chunk.block), [0, 2]);
    assert.ok(chunks.every((chunk) => chunk.block >= 0), "a position of -1 means we lost it");
  });

  it("splits a wall of text rather than producing one enormous piece", () => {
    const sentence = "The system shall respond within two seconds. ";
    const chunks = toChunks([block(sentence.repeat(120))]);
    assert.ok(chunks.length > 1, "expected several pieces");
    assert.ok(chunks.every((chunk) => chunk.text.length < 2100));
  });

  it("drops empty blocks instead of making empty pieces", () => {
    const chunks = toChunks([block("   "), block("Real content here."), block("")]);
    assert.equal(chunks.length, 1);
  });

  it("gives identical text the same fingerprint, ignoring spacing", () => {
    assert.equal(hashOf("one   two\nthree"), hashOf("one two three"));
    assert.notEqual(hashOf("one two"), hashOf("one three"));
    assert.equal(normalise("  a \n b  "), "a b");
  });
});
