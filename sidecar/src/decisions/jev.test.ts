import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { ask, confidenceOf, isYes, models } from "./jev.js";
import { review } from "./index.js";

/** What the stub was asked, so the test can check the request, not just the reply. */
interface Seen {
  path: string;
  authorization: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let endpoint = "";
let seen: Seen[] = [];
/** Set by a test to make the next replies fail in a particular way. */
let failures: Array<{ status: number; retryAfter?: string }> = [];

before(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      seen.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
        body,
      });

      const failure = failures.shift();
      if (failure) {
        if (failure.retryAfter) response.setHeader("retry-after", failure.retryAfter);
        response.writeHead(failure.status).end("busy");
        return;
      }

      if (request.url === "/v1/models") {
        response
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ models: [{ id: "jev-latest" }, { id: "jev-preview" }] }));
        return;
      }

      // Answer every question yes, with the certainty rising by position, so
      // a test can tell the answers apart.
      const questions = (body["questions"] ?? {}) as Record<string, unknown>;
      const answers: Record<string, unknown> = {};
      Object.keys(questions).forEach((id, index) => {
        answers[id] = { type: "noul", noul: index === 0 ? 0.95 : 0.52 };
      });

      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          model: "jev-1.13.0",
          answers,
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
      );
    });
  });

  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no test server port");
  endpoint = `http://127.0.0.1:${address.port}/v1`;
});

after(() => server.close());

describe("talking to Jev", () => {
  it("sends the state, the model and the questions, with the key as a bearer token", async () => {
    seen = [];
    const answered = await ask(
      { key: "test-key", endpoint, model: "jev-latest" },
      { REQ_01: { title: "User can log in", acceptance: "Valid credentials reach the dashboard" } },
      { q1: { type: "noul", instructions: "Is `REQ_01` too vague?" } },
    );

    assert.equal(seen.length, 1);
    assert.equal(seen[0]!.path, "/v1/systemone");
    assert.equal(seen[0]!.authorization, "Bearer test-key");
    assert.equal(seen[0]!.body["model"], "jev-latest");
    assert.ok(seen[0]!.body["state"], "the state must be sent");

    assert.equal(answered.model, "jev-1.13.0");
    assert.equal(answered.nouls.get("q1"), 0.95);
    assert.deepEqual(answered.usage, { inputTokens: 100, outputTokens: 10 });
  });

  it("waits and tries again when Jev says it is busy", async () => {
    seen = [];
    failures = [{ status: 429, retryAfter: "0" }, { status: 529 }];

    const answered = await ask({ key: "k", endpoint }, "anything", {
      q1: { type: "noul", instructions: "Is this a question?" },
    });

    assert.equal(seen.length, 3, "two refusals then the answer");
    assert.equal(answered.nouls.get("q1"), 0.95);
  });

  it("does not retry a rejected key, and says so plainly", async () => {
    seen = [];
    failures = [{ status: 401 }];

    await assert.rejects(
      ask({ key: "wrong", endpoint }, "anything", {
        q1: { type: "noul", instructions: "Is this a question?" },
      }),
      /rejected the key/,
    );
    assert.equal(seen.length, 1, "a bad key is not worth a second attempt");
  });

  it("lists the models the account may use", async () => {
    failures = [];
    assert.deepEqual(await models({ key: "k", endpoint }), ["jev-latest", "jev-preview"]);
  });
});

describe("reading a noul", () => {
  it("treats the distance from 'I don't know' as the certainty", () => {
    // Jev returns no confidence for a noul; this is the documented formula.
    assert.equal(confidenceOf(1), 1);
    assert.equal(confidenceOf(0), 1);
    assert.equal(confidenceOf(0.5), 0);
    assert.ok(Math.abs(confidenceOf(0.75) - 0.5) < 1e-9);
  });

  it("calls anything above a half a yes", () => {
    assert.equal(isYes(0.51), true);
    assert.equal(isYes(0.49), false);
  });
});

describe("a review answered by Jev", () => {
  const items = [
    { id: "REQ-01", title: "User can log in with username and password", acceptance: "Valid credentials reach the dashboard" },
    { id: "REQ-02", title: "The user logs in using a username and a password", acceptance: "Valid credentials reach the dashboard" },
    { id: "REQ-03", title: "Search should be fast", acceptance: "Results come back quickly" },
  ];

  it("asks Jev about every requirement and reports what it charged", async () => {
    seen = [];
    failures = [];
    const result = (await review({
      requirements: items,
      mode: "jev",
      key: "k",
      endpoint,
      model: "jev-latest",
    })) as {
      mode: string;
      asked: number;
      inputTokens: number;
      findings: Array<{ kind: string; id: string; by: string; action: string }>;
      unsure: Array<{ action: string }>;
    };

    assert.equal(result.mode, "jev");
    // Three "is it vague" questions plus the one shortlisted pair.
    assert.equal(result.asked, 4);
    assert.equal(result.inputTokens, 100);
    assert.equal(result.findings.every((finding) => finding.by === "jev"), true);

    // The stub is certain about the first question in the request and barely
    // sure about the rest. Only the certain one is a finding; a yes at 52%
    // is the model shrugging, and goes in the pile of things it could not
    // decide rather than the list of things that are wrong.
    assert.deepEqual(result.findings.map((finding) => finding.action), ["act"]);
    assert.equal(result.unsure.length, 3);
    assert.equal(result.unsure.every((finding) => finding.action === "ask"), true);
  });

  it("keeps the answers it got when one request fails", async () => {
    seen = [];
    // One requirement per request would be four requests; with twenty to a
    // request this is one, so fail it and expect an empty but honest result.
    failures = [{ status: 500 }];

    const result = (await review({
      requirements: items,
      mode: "jev",
      key: "k",
      endpoint,
    })) as { findings: unknown[]; unsure: unknown[]; failed?: number; failure?: string };

    assert.equal(result.findings.length, 0);
    assert.equal(result.failed, 1);
    assert.match(result.failure ?? "", /500/);
  });
});
