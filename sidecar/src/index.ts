/**
 * The TestInference worker.
 *
 * Everything slow or dangerous belongs here rather than in the Rust core or
 * the renderer: provider calls now, agents, MCP clients and surface runners
 * later. It speaks one JSON object per line over stdin and stdout, and is
 * restarted by the core if it dies.
 */

import { createInterface } from "node:readline";
import { emit, log, send, type Handler, type Request } from "./protocol.js";
import * as demo from "./methods/demo.js";
import * as providers from "./methods/providers.js";
import { extract } from "./documents/extract.js";
import { complete, listModels, selfTest } from "./models/index.js";
import { readBatch } from "./agents/requirements.js";
import { designBatch } from "./agents/scenarios.js";
import { enrichBatch } from "./agents/tcer.js";
import { writeBatch } from "./agents/cases.js";
import { writeBatch as writeBdd, toFeatureFile, stepsOf } from "./agents/bdd.js";
import { foldIn } from "./engines/steps.js";
import { ask } from "./agents/assistant.js";
import { discuss } from "./agents/discuss.js";
import { judgeByModel, judgeSameByRule, judgeVagueByRule, review } from "./decisions/index.js";
import * as decide from "./decisions/ask.js";
import { parse as parseSheet } from "./import/csv.js";
import { suggest as suggestMapping } from "./import/map.js";
import { crawl } from "./explore/crawl.js";
import { generate } from "./code/index.js";
import { play } from "./run/play.js";
import { validateCases } from "./engines/validation.js";
import { classifyCases } from "./engines/feasibility.js";
import { checkBalance } from "./engines/balance.js";
import { rankScenarios, requirementNeeds } from "./engines/risk.js";
import { scoreRows } from "./engines/tcer.js";
import { buildCoverage } from "./engines/coverage.js";

const handlers: Record<string, Handler> = {
  "worker.ping": () => ({ message: "pong from the worker", pid: process.pid, ts: Date.now() }),
  "worker.crash": () => {
    // Used by the UI to prove the supervisor restarts us.
    log("crashing on purpose");
    setTimeout(() => process.exit(1), 10);
    return { crashing: true };
  },
  "job.start": (params) => demo.start(params),
  "job.cancel": (params) => demo.cancel(params),
  "providers.validate": (params) => providers.validate(params),
  "documents.extract": (params) => extract(params),
  "models.list": (params) => listModels(params),
  "models.selfTest": (params) => selfTest(params),
  "models.complete": (params) => complete(params),
  "requirements.readBatch": (params) => readBatch(params),
  "scenarios.designBatch": (params) => designBatch(params),
  "engines.balance": (params) =>
    checkBalance(params["requirementIds"] as string[], params["scenarios"] as never[]),
  "engines.rank": (params) => rankScenarios(params["scenarios"] as never[]),
  "tcer.enrichBatch": (params) => enrichBatch(params),
  "cases.writeBatch": (params) => writeBatch(params),
  "bdd.writeBatch": (params) => writeBdd(params),
  "bdd.render": (params) =>
    toFeatureFile(params["feature"] as string, params["cases"] as never[]),
  "bdd.steps": (params) => stepsOf(params["case"] as never),
  "assistant.ask": (params) => ask(params),
  "requirement.discuss": (params) => discuss(params),
  "decisions.judge": (params) => judgeByModel(params),
  "decisions.review": (params) => review(params),
  "decisions.carries": (params) => decide.carries(params),
  "decisions.label": (params) => decide.label(params),
  "decisions.enough": (params) => decide.enough(params),
  "decisions.steps": (params) => decide.steps(params),
  "decisions.foldSteps": (params) => decide.foldSteps(params),
  "decisions.verify": (params) => decide.verify(params),
  "decisions.gateAction": (params) => decide.gateAction(params),
  "decisions.link": (params) => decide.link(params),
  "decisions.drift": (params) => decide.drift(params),
  "decisions.change": (params) => decide.change(params),
  "import.read": (params) => parseSheet(params["text"] as string),
  "import.map": (params) => suggestMapping(params),
  "explore.crawl": (params) => crawl(params),
  "code.generate": (params) => generate(params),
  "run.play": (params) => play(params),
  "decisions.vague": (params) =>
    judgeVagueByRule(params["title"] as string, params["acceptance"] as string),
  "decisions.same": (params) =>
    judgeSameByRule(params["left"] as string, params["right"] as string),
  "engines.foldSteps": (params) =>
    foldIn(params["proposed"] as string[], params["library"] as string[]),
  "engines.validate": (params) => validateCases(params["cases"] as never[]),
  "engines.classify": (params) => classifyCases(params["cases"] as never[]),
  "engines.score": (params) => scoreRows(params["rows"] as never[]),
  "engines.coverage": (params) =>
    buildCoverage(
      params["requirements"] as never[],
      params["scenarios"] as never[],
      params["rows"] as never[],
    ),
  "engines.needs": (params) =>
    requirementNeeds(rankScenarios(params["scenarios"] as never[]), params["rows"] as never[]),
};

async function dispatch(request: Request): Promise<void> {
  const handler = handlers[request.method];

  if (!handler) {
    send({ id: request.id, ok: false, error: { message: `unknown method ${request.method}` } });
    return;
  }

  try {
    const params = (request.params ?? {}) as Record<string, unknown>;
    send({ id: request.id, ok: true, result: await handler(params) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    log(`${request.method} failed: ${message}`);
    send({ id: request.id, ok: false, error: { message } });
  }
}

const lines = createInterface({ input: process.stdin });

lines.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let request: Request;
  try {
    request = JSON.parse(trimmed) as Request;
  } catch {
    log(`ignored a line that was not JSON: ${trimmed.slice(0, 120)}`);
    return;
  }

  void dispatch(request);
});

lines.on("close", () => {
  log("the core closed the pipe; shutting down");
  process.exit(0);
});

process.on("uncaughtException", (error: Error) => {
  log(`uncaught: ${error.stack ?? error.message}`);
  process.exit(1);
});

log(`worker up on node ${process.version} (pid ${process.pid})`);
emit("worker:hello", { pid: process.pid, node: process.version });
