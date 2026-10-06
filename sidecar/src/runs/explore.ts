import { crawl } from "../explore/crawl.js";
import * as store from "../store/index.js";
import { readContext } from "../store/project.js";
import { load as loadSettings } from "../store/settings.js";
import { judgeSettings } from "./judge.js";
import { keyFor } from "./keys.js";

/**
 * Walking the application to see what is really there.
 *
 * Everything before this reads documents. This reads the product, and
 * the difference matters: a test written from a document guesses at the
 * markup, while a test written from the map points at controls that were
 * observed to exist.
 */

export interface Explored {
  pages: number;
  repeats: number;
  changed: number;
  fresh: number;
  skipped: string[];
  /** True when the only thing found was a login page. */
  needsSignIn: boolean;
  note: string;
  run: store.Run;
}

/** Does this page look like the way in rather than the application? */
function looksLikeADoor(page: store.AppPage): boolean {
  const touch = page.elements.filter((element) => element.kind !== "text");
  return (
    touch.filter((element) => element.kind === "input").length >= 2 &&
    touch.some((element) => element.kind === "control") &&
    page.links.length <= 2
  );
}

export async function run(
  projectPath: string,
  pages: number,
  depth: number,
  freshStart: boolean,
): Promise<Explored> {
  const context = readContext(projectPath);
  if (!context.appUrl.trim()) throw new Error("set the application URL on the project first");

  const secret = keyFor(`signin:${context.id}`);
  const signIn =
    context.signIn && secret ? { ...context.signIn, secret } : undefined;

  const before = store.appPages.list(projectPath);
  if (freshStart) store.appPages.clear(projectPath);

  const walk = (await crawl({
    url: context.appUrl,
    pages,
    depth,
    signIn,
    // Used only to confirm that two addresses are one screen.
    judge: judgeSettings(projectPath),
  })) as {
    pages: Array<Omit<store.AppPage, "id" | "seenAt">>;
    skipped: string[];
    repeats: number;
    folded: number;
    note: string;
  };

  let changed = 0;
  const saved: store.AppPage[] = [];
  for (const found of walk.pages) {
    const page: store.AppPage = { ...found, id: store.pageId(found.url), seenAt: store.now() };
    const known = before.find((earlier) => earlier.url === page.url);
    // A page whose controls are the same as last time is not news.
    if (!known || known.fingerprint !== page.fingerprint) changed += 1;
    store.appPages.save(projectPath, page);
    saved.push(page);
  }

  const fresh = saved.filter((page) => !before.some((old) => old.url === page.url)).length;
  const needsSignIn =
    signIn === undefined && saved.length === 1 && saved[0] !== undefined && looksLikeADoor(saved[0]);

  const note = needsSignIn
    ? "This application is a login page and nothing else until you are through it. Point the three fields below at the form and give it a test account, and the next run will go further."
    : walk.note;

  const record: store.Run = {
    id: store.nextRunId(projectPath),
    kind: "explore",
    startedAt: store.now(),
    finishedAt: store.now(),
    status: "finished",
    model: "browser",
    prompt: "explore/1",
    batches: 1,
    batchesDone: 1,
    attempts: 1,
    inputTokens: 0,
    outputTokens: 0,
    cost: null,
    produced: saved.length,
    note: `${saved.length} pages · ${fresh} new · ${changed} changed`,
    judge: store.readJudgeMode(projectPath),
    pieces: saved.map((page) => page.fingerprint),
  };
  store.runs.save(projectPath, record);

  void loadSettings();
  return {
    pages: saved.length,
    repeats: walk.repeats + walk.folded,
    changed,
    fresh,
    skipped: walk.skipped,
    needsSignIn,
    note,
    run: record,
  };
}
