import { strict as assert } from "node:assert";
import { createServer, type Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { carries, change, drift, enough, gateAction, label, link, steps, verify } from "./ask.js";

/**
 * A stand-in for TypeSafe. Each test sets `answer` to decide what Jev says
 * about each question, so the tests are about how the app uses an answer
 * rather than about what the real model would reply.
 */
let server: Server;
let endpoint = "";
let asked: Array<Record<string, unknown>> = [];
let answer: (id: string, question: Record<string, unknown>) => unknown = () => ({
  type: "noul",
  noul: 0.9,
});
let failWith: number | null = null;

before(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      if (failWith !== null) {
        response.writeHead(failWith).end("no");
        return;
      }
      const body = JSON.parse(raw || "{}") as { questions?: Record<string, Record<string, unknown>> };
      asked.push(body as Record<string, unknown>);
      const answers: Record<string, unknown> = {};
      for (const [id, question] of Object.entries(body.questions ?? {})) {
        answers[id] = answer(id, question);
      }
      response
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 10, output_tokens: 1 } }));
    });
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  endpoint = `http://127.0.0.1:${address.port}/v1`;
});

after(() => server.close());

function reset() {
  asked = [];
  failWith = null;
  answer = () => ({ type: "noul", noul: 0.9 });
}

const jev = () => ({ mode: "jev" as const, key: "k", endpoint });

describe("is this piece of the document worth reading", () => {
  const chunks = [
    { id: "c1", text: "Table of contents" },
    { id: "c2", text: "The fare is halved for a concession card." },
  ];

  it("reads everything when nothing is judging", async () => {
    reset();
    const result = await carries({ mode: "rules", chunks });
    assert.deepEqual(result.answers.map((entry) => entry.answer), [true, true]);
    assert.equal(asked.length, 0);
  });

  it("drops a piece only when Jev is sure it is not a requirement", async () => {
    reset();
    // c1 a confident no, c2 a confident yes.
    answer = (id) => ({ type: "noul", noul: id === "q1" ? 0.03 : 0.97 });
    const result = await carries({ ...jev(), chunks });
    assert.deepEqual(result.answers.map((entry) => entry.answer), [false, true]);
  });

  it("keeps a piece Jev is only half sure about", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.45 });
    const result = await carries({ ...jev(), chunks });
    assert.deepEqual(
      result.answers.map((entry) => entry.answer),
      [true, true],
      "a shrug is not a reason to lose a requirement",
    );
  });

  it("reads everything when the request fails", async () => {
    reset();
    failWith = 500;
    const result = await carries({ ...jev(), chunks });
    assert.deepEqual(result.answers.map((entry) => entry.answer), [true, true]);
    assert.equal(result.failures.length, 1);
  });
});

describe("labelling a scenario", () => {
  const scenarios = [{ id: "TS-01", title: "Reject an expired card", expected: "An error is shown" }];

  it("leaves the writing model's labels alone when Jev is off", async () => {
    reset();
    const result = await label({ mode: "rules", scenarios });
    assert.deepEqual(result.answers[0]?.answer, {});
    assert.equal(asked.length, 0);
  });

  it("asks only the labels it can answer, each with its own confidence", async () => {
    reset();
    answer = (id) => ({
      type: "choice",
      choice: id === "q1" ? "Negative" : "Automatable",
      confidence: id === "q1" ? 0.9 : 0.4,
      probabilities: {},
    });
    const result = await label({ ...jev(), scenarios });

    // Priority is deliberately not asked: two questions, not three.
    assert.equal(Object.keys((asked[0] as { questions: object }).questions).length, 2);
    assert.deepEqual(result.answers[0]?.answer, {
      class: { value: "Negative", confidence: 0.9 },
      feasibility: { value: "Automatable", confidence: 0.4 },
    });
    // The set's own number is the weakest of them, for display only; each
    // label is applied on its own.
    assert.equal(result.answers[0]?.confidence, 0.4);
  });
});

describe("are these scenarios enough", () => {
  const requirements = [
    { id: "REQ-01", title: "User can pay", acceptance: "A valid card is charged" },
    { id: "REQ-02", title: "User can refund", acceptance: "A refund returns the money" },
  ];
  const scenarios = [{ reqId: "REQ-01", title: "Pay with a valid card", class: "Positive" }];

  it("uses the rule when Jev is off: a requirement that can fail needs a failing case", async () => {
    reset();
    const result = await enough({ mode: "rules", requirements, scenarios });
    assert.deepEqual(result.answers.map((entry) => entry.answer), [false, false]);
    assert.equal(result.answers[0]?.why, "nothing tests this failing");
    assert.equal(result.answers[1]?.why, "no scenarios");
  });

  it("never asks about a requirement with no scenarios at all", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.99 });
    const result = await enough({ ...jev(), requirements, scenarios });

    assert.equal(result.answers[1]?.answer, false, "nothing covers REQ-02, whatever Jev would say");
    assert.equal(result.answers[1]?.why, "no scenarios");
    // Two questions — does anything test it working, does anything test it
    // failing — for the one requirement that has scenarios.
    assert.equal(Object.keys((asked[0] as { questions: object }).questions).length, 2);
  });

  it("takes Jev's word over the rule when it has scenarios", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.95 });
    const result = await enough({ ...jev(), requirements, scenarios });
    assert.equal(result.answers[0]?.answer, true, "the rule said no; Jev read the scenarios");
    assert.equal(result.answers[0]?.why, "it is tested working and failing");
  });

  it("says which half is missing, not just that something is", async () => {
    reset();
    // Yes it is tested working, no it is not tested failing.
    answer = (id) => ({ type: "noul", noul: id === "q1" ? 0.97 : 0.04 });
    const result = await enough({ ...jev(), requirements, scenarios });

    assert.equal(result.answers[0]?.answer, false);
    assert.equal(result.answers[0]?.why, "nothing tests this failing");
    assert.ok((result.answers[0]?.confidence ?? 0) > 0.9, "it was sure about the half that failed");
  });
});

describe("is this step already in the library", () => {
  const library = ["Click the Pay button", "Enter a valid card number"];

  it("matches on wording when Jev is off", async () => {
    reset();
    const result = await steps({ mode: "rules", proposed: ["Click the Pay button"], library });
    assert.equal(result.answers[0]?.answer, "Click the Pay button");
  });

  it("keeps two steps apart when Jev says they differ, however alike they read", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.05 });
    const result = await steps({ ...jev(), proposed: ["Enter an expired card number"], library });
    assert.equal(result.answers[0]?.answer, null);
    assert.match(result.answers[0]?.why ?? "", /different steps/);
  });

  it("reuses a step Jev recognises through different wording", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.95 });
    const result = await steps({ ...jev(), proposed: ["Tap Pay"], library });
    assert.equal(result.answers[0]?.answer, "Click the Pay button");
  });
});

describe("does the case test its scenario", () => {
  const cases = [
    {
      id: "TC-01",
      title: "Pay with an expired card",
      steps: "1. Enter an expired card\n2. Submit",
      expected: "The payment is refused",
      scenario: { title: "Reject an expired card", expected: "An error is shown" },
    },
  ];

  it("asks nothing when Jev is off, because nothing else can answer it", async () => {
    reset();
    const result = await verify({ mode: "rules", cases });
    assert.deepEqual(result.answers, []);
    assert.equal(asked.length, 0);
  });

  it("reports a case that tests something else", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.08 });
    const result = await verify({ ...jev(), cases });
    assert.equal(result.answers[0]?.answer, false);
    assert.ok((result.answers[0]?.confidence ?? 0) > 0.8);
  });
});

describe("is the chat asking to destroy something", () => {
  it("confirms a listed action without asking anyone", async () => {
    reset();
    const result = await gateAction({ ...jev(), action: "delete_requirements", known: true });
    assert.equal(result.answer, true);
    assert.equal(asked.length, 0, "a known destructive action needs no second opinion");
  });

  it("can add to the list, catching a harmless-looking action", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.93 });
    const result = await gateAction({
      ...jev(),
      action: "replace_all",
      message: "start the requirements again from scratch",
      known: false,
    });
    assert.equal(result.answer, true);
  });

  it("lets a reversible action through", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.04 });
    const result = await gateAction({ ...jev(), action: "set_priority", message: "make these P2", known: false });
    assert.equal(result.answer, false);
  });

  it("confirms anyway when Jev cannot be reached", async () => {
    reset();
    failWith = 503;
    const result = await gateAction({ ...jev(), action: "replace_all", message: "wipe it", known: false });
    assert.equal(result.answer, true, "silence is not permission");
  });
});

describe("linking an imported case to a requirement", () => {
  const requirements = [
    { id: "REQ-01", title: "User can sign in", acceptance: "Valid credentials reach the dashboard" },
    { id: "REQ-02", title: "Cart shows how many items it holds", acceptance: "A badge on the cart icon shows the count" },
    { id: "REQ-03", title: "User can empty the cart", acceptance: "Removing every item leaves the cart empty" },
  ];
  const cases = [
    {
      id: "QA-1",
      title: "Cart badge counts items",
      steps: "1. Add a product to the cart\n2. Look at the cart icon",
      expected: "The badge shows 1",
    },
  ];
  /** Says the same as REQ-02 while sharing none of its words. */
  const reworded = [
    {
      id: "QA-2",
      title: "Basket indicator updates after adding a product",
      steps: "1. Put something in the basket\n2. Observe the indicator",
      expected: "It reads 1",
    },
  ];

  it("asks about the nearest requirements, not every one", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.93 });
    await link({ ...jev(), cases, requirements });

    const questions = Object.keys((asked[0] as { questions: object }).questions).length;
    assert.ok(questions <= 3, `one case should cost at most three questions, not ${questions}`);
  });

  it("takes the strongest yes when more than one fits", async () => {
    reset();
    // Two of the three candidates say yes; the second one is the sure one.
    answer = (id) => ({ type: "noul", noul: id === "q1" ? 0.6 : id === "q2" ? 0.97 : 0.01 });
    const result = await link({ ...jev(), cases, requirements });
    assert.ok(result.answers[0]?.answer, "it should link to something");
    assert.ok(
      (result.answers[0]?.confidence ?? 0) > 0.9,
      "the confident match wins over the hesitant one",
    );
  });

  it("shows the judge a candidate however little wording it shares", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.95 });
    const result = await link({ ...jev(), cases: reworded, requirements });

    assert.ok(
      asked.length > 0,
      "word overlap must not decide what the meaning-reader is allowed to see",
    );
    assert.ok(result.answers[0]?.answer, "a case worded differently still links");
  });

  it("links nothing when the judge says none of them fit", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.02 });
    const result = await link({ ...jev(), cases, requirements });
    assert.equal(result.answers[0]?.answer, null);
    assert.match(result.answers[0]?.why ?? "", /testing something else/);
  });

  it("misses on wording alone what the judge catches", async () => {
    reset();
    const result = await link({ mode: "rules", cases: reworded, requirements });

    assert.equal(asked.length, 0, "no model is called");
    // This is the case for having a judge at all: the same requirement,
    // said in a team's own words, is invisible to word matching.
    assert.equal(result.answers[0]?.answer, null);
    assert.match(result.answers[0]?.why ?? "", /wording/);
  });
});

describe("does the document still say what the requirement says", () => {
  const requirements = [
    {
      id: "REQ-01",
      title: "Searches finish in under 400ms",
      acceptance: "95% of searches return in under 400ms at 1000 concurrent users",
      paragraph: "Search should be fast.",
      edited: true,
    },
    {
      id: "REQ-02",
      title: "User can log in",
      acceptance: "Valid credentials reach the dashboard",
      paragraph: "A user logs in with a username and password and lands on the dashboard.",
      edited: false,
    },
  ];

  it("reports only what the paragraph no longer supports", async () => {
    reset();
    // The first is no longer in the document, the second still is.
    answer = (id) => ({ type: "noul", noul: id === "q1" ? 0.04 : 0.96 });
    const result = await drift({ ...jev(), requirements });

    assert.deepEqual(result.answers.map((entry) => entry.id), ["REQ-01"]);
    assert.match(result.answers[0]?.why ?? "", /changed by hand/);
    assert.equal(result.answers[0]?.answer.paragraph, "Search should be fast.");
  });

  it("stays quiet when the judge is only half sure", async () => {
    reset();
    // A no, but a hesitant one: 0.45 is a shrug, not a finding.
    answer = () => ({ type: "noul", noul: 0.45 });
    const result = await drift({ ...jev(), requirements });
    assert.deepEqual(result.answers, []);
  });

  it("says nothing when the document still backs every requirement", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.97 });
    const result = await drift({ ...jev(), requirements });
    assert.deepEqual(result.answers, []);
  });

  it("falls back to the ones a person touched, and only those", async () => {
    reset();
    const result = await drift({ mode: "rules", requirements });

    assert.equal(asked.length, 0);
    assert.deepEqual(result.answers.map((entry) => entry.id), ["REQ-01"]);
  });

  it("skips a requirement whose paragraph is gone, rather than guessing", async () => {
    reset();
    answer = () => ({ type: "noul", noul: 0.01 });
    const result = await drift({
      ...jev(),
      requirements: [{ ...requirements[0]!, paragraph: "" }],
    });
    // A missing paragraph is the orphan flag's job, not this one's.
    assert.deepEqual(result.answers, []);
    assert.equal(asked.length, 0);
  });
});

describe("how far has an edit moved the requirement", () => {
  const before = { title: "Search should be fast", acceptance: "Results come back quickly" };
  const after = {
    title: "Search returns results within 400ms",
    acceptance: "95% of searches return in under 400ms at 1000 concurrent users",
  };

  it("asks both questions: how big, and did anything fall out", async () => {
    reset();
    answer = (_id, question) =>
      question["type"] === "choice"
        ? { type: "choice", choice: "sharper", confidence: 0.9, probabilities: {} }
        : { type: "noul", noul: 0.95 };

    const result = await change({ ...jev(), before, after });
    assert.equal(result.answer.kind, "sharper");
    assert.equal(result.answer.keeps, true);
  });

  it("reports wording that quietly drops something", async () => {
    reset();
    answer = (_id, question) =>
      question["type"] === "choice"
        ? { type: "choice", choice: "sharper", confidence: 0.9, probabilities: {} }
        : { type: "noul", noul: 0.05 };

    const result = await change({ ...jev(), before, after });
    assert.equal(result.answer.keeps, false);
    assert.ok(result.answer.lost);
  });

  it("treats an edit it is unsure about as a real change", async () => {
    reset();
    answer = (_id, question) =>
      question["type"] === "choice"
        ? { type: "choice", choice: "wording", confidence: 0.2, probabilities: {} }
        : { type: "noul", noul: 0.9 };

    const result = await change({ ...jev(), before, after });
    // Calling a shrug "just wording" is how a changed requirement slips
    // past the tests that no longer match it.
    assert.equal(result.answer.kind, "different");
  });

  it("assumes the worst when nothing is judging", async () => {
    reset();
    const result = await change({ mode: "rules", before, after });
    assert.equal(result.answer.kind, "different");
    assert.equal(asked.length, 0);
  });
});

describe("packing several questions into one request", () => {
  it("refuses two questions whose state means different things under one name", async () => {
    reset();
    const { fanOut } = await import("./fanout.js");
    await assert.rejects(
      fanOut({ key: "k", endpoint }, [
        {
          state: { step: "Enter the username" },
          question: { type: "noul", instructions: "Is `step` a login step?" },
        },
        {
          state: { step: "Click Pay" },
          question: { type: "noul", instructions: "Is `step` a login step?" },
        },
      ]),
      /mean different things/,
    );
    // The two questions would both have been answered about "Click Pay",
    // and both answers would have looked perfectly reasonable.
    assert.equal(asked.length, 0, "nothing is sent when the request is wrong");
  });

  it("allows several questions about one shared thing", async () => {
    reset();
    const { fanOut } = await import("./fanout.js");
    const shared = { scenario: { title: "Reject an expired card" } };
    const out = await fanOut({ key: "k", endpoint }, [
      { state: shared, question: { type: "noul", instructions: "Is `scenario` negative?" } },
      { state: shared, question: { type: "noul", instructions: "Is `scenario` automatable?" } },
    ]);
    assert.equal(out.answers.size, 2);
  });
});
