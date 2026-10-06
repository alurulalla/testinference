import { readBatch, PROMPT_VERSION } from "../agents/requirements.js";
import { carries } from "../decisions/ask.js";
import { emit } from "../protocol.js";
import * as store from "../store/index.js";
import { read as readChunks } from "../store/chunks.js";
import { readContext } from "../store/project.js";
import { endpointFor, load as loadSettings } from "../store/settings.js";
import { judgeSettings } from "./judge.js";
import { keyFor, providerOf } from "./keys.js";
import { estimate as measure, runBatches, type Estimate } from "./manage.js";

/**
 * Reading the documents and pulling out the requirements.
 *
 * The expensive part of this stage is not the reading, it is re-reading.
 * Every piece carries a fingerprint, and a run records the ones it saw,
 * so the next run can tell what actually changed. A requirement whose
 * piece is untouched keeps whatever a person has since edited or
 * approved — re-reading a document must not cost a week of review.
 */

const BATCH = 4;

export interface Piece {
  document: string;
  page: number | null;
  block: number;
  hash: string;
  text: string;
}

/** Every piece of every document in the project, in reading order. */
export function gather(projectPath: string): Piece[] {
  const context = readContext(projectPath);
  const pieces: Piece[] = [];

  for (const document of store.documents.list(projectPath)) {
    for (const chunk of readChunks(context.id, document.id)) {
      pieces.push({
        document: document.name,
        page: chunk.page,
        block: chunk.block,
        hash: chunk.hash,
        text: chunk.text,
      });
    }
  }
  return pieces;
}

/** The pieces the last read saw, so this one can tell what moved. */
function lastSeen(projectPath: string): string[] | null {
  const runs = store.runs
    .list(projectPath)
    .filter((run) => run.kind === "extract" && run.pieces.length > 0);
  return runs.length > 0 ? (runs[runs.length - 1]?.pieces ?? null) : null;
}

export interface Delta {
  firstRun: boolean;
  unchangedPieces: number;
  newPieces: number;
  gonePieces: number;
  keep: number;
  orphaned: number;
  estimate: Estimate;
  note: string;
}

/** Roughly four characters to the token, which is close enough to budget on. */
function tokensFor(pieces: Piece[]): { inPerUnit: number; outPerUnit: number } {
  const characters = pieces.reduce((total, piece) => total + piece.text.length, 0);
  const perPiece = pieces.length > 0 ? characters / pieces.length : 0;
  return { inPerUnit: Math.ceil(perPiece / 4) + 120, outPerUnit: 180 };
}

/**
 * What a read would do, before it does any of it.
 *
 * Nothing is regenerated until a person has seen this: on a project with
 * a week of approvals behind it, "read the documents again" is a
 * frightening button without a sentence saying what it will keep.
 */
export function plan(projectPath: string): Delta {
  const pieces = gather(projectPath);
  const current = new Set(pieces.map((piece) => piece.hash));
  const previous = lastSeen(projectPath);

  if (previous === null) {
    return {
      firstRun: true,
      unchangedPieces: 0,
      newPieces: pieces.length,
      gonePieces: 0,
      keep: 0,
      orphaned: 0,
      estimate: measure({
        units: pieces.length,
        perBatch: BATCH,
        ...tokensFor(pieces),
        job: "read-documents",
        nothing: "there are no documents to read — add one first",
      }),
      note: `nothing has been read yet — all ${pieces.length} pieces are new`,
    };
  }

  const seen = new Set(previous);
  const fresh = pieces.filter((piece) => !seen.has(piece.hash));
  const gone = previous.filter((hash) => !current.has(hash)).length;

  const requirements = store.requirements.list(projectPath);
  const orphaned = requirements.filter((item) => !current.has(item.source.piece)).length;
  const keep = requirements.length - orphaned;

  const estimate = measure({
    units: fresh.length,
    perBatch: BATCH,
    ...tokensFor(fresh),
    job: "read-documents",
    nothing: "nothing has changed",
  });

  const note =
    fresh.length === 0 && gone === 0
      ? `nothing has changed — all ${keep} requirements stay as they are, and this costs nothing`
      : `${fresh.length} new pieces to read · ${keep} requirements kept with their edits and approvals · ${orphaned} no longer have a source`;

  return {
    firstRun: false,
    unchangedPieces: pieces.length - fresh.length,
    newPieces: fresh.length,
    gonePieces: gone,
    keep,
    orphaned,
    estimate,
    note,
  };
}

export async function run(projectPath: string, delta = true): Promise<store.Run> {
  const planned = plan(projectPath);
  const estimate = planned.estimate;
  if (estimate.overBudget) throw new Error(estimate.note);
  if (!estimate.model) throw new Error("assign a model to reading documents first");

  const settings = loadSettings();
  const provider = providerOf(estimate.model);
  const key = keyFor(provider);
  const endpoint = endpointFor(provider, settings);

  const all = gather(projectPath);
  const allHashes = all.map((piece) => piece.hash);
  const current = new Set(allHashes);
  const seen = new Set(delta ? (lastSeen(projectPath) ?? []) : []);

  let toRead = delta ? all.filter((piece) => !seen.has(piece.hash)) : all;

  let position = 0;
  let orphaned = 0;
  if (delta) {
    // A requirement whose paragraph has gone is flagged, never deleted.
    // A disappeared requirement is a decision for a person.
    for (const requirement of store.requirements.list(projectPath)) {
      const missing = !current.has(requirement.source.piece);
      if (missing !== requirement.orphaned) {
        store.requirements.save(projectPath, { ...requirement, orphaned: missing });
      }
      if (missing) orphaned += 1;
    }
    position = store.nextNumber(
      store.requirements.list(projectPath).map((item) => item.id),
      "REQ-",
    );
  } else {
    store.requirements.clear(projectPath);
  }

  // Which of these pieces actually carry a requirement. With nothing
  // judging, every piece is read: a piece wrongly skipped is a
  // requirement nobody knows is missing.
  let skipped = 0;
  const judge = judgeSettings(projectPath);
  if (judge["mode"] === "jev" && toRead.length > 0) {
    try {
      const answered = await carries({
        ...judge,
        chunks: toRead.map((piece) => ({ id: piece.hash, text: piece.text })),
      });
      const drop = new Set(
        answered.answers.filter((entry) => entry.answer === false).map((entry) => entry.id),
      );
      skipped = drop.size;
      toRead = toRead.filter((piece) => !drop.has(piece.hash));
    } catch {
      // Judging is an optimisation. If it fails, read everything.
    }
  }

  const batches: Piece[][] = [];
  for (let at = 0; at < toRead.length; at += BATCH) batches.push(toRead.slice(at, at + BATCH));

  const record = await runBatches({
    projectPath,
    kind: "extract",
    model: estimate.model,
    prompt: PROMPT_VERSION,
    batches,
    // Every piece in the project, not only the ones read, so the next
    // delta knows an untouched piece was seen rather than missed.
    pieces: allHashes,
    work: async (batch, index) => {
      const answer = await readBatch({
        model: estimate.model,
        key,
        endpoint,
        pieces: batch.map((piece, within) => ({ piece: within, text: piece.text })),
      });

      for (const draft of answer.requirements) {
        const source = batch[draft.piece];
        if (!source) continue;

        const requirement: store.Requirement = {
          id: store.requirementId(position),
          title: draft.title,
          acceptance: draft.acceptance,
          // Optional on the way out of the model, always present on a
          // stored record: an absent field and an empty one should not
          // be two different things to everything downstream.
          domain: draft.domain ?? "",
          impacted: draft.impacted ?? "",
          flag: draft.vague ? "vague" : "clear",
          version: 1,
          // Kept from the start, so a change years later can still be
          // shown against what the document said.
          asExtracted: { title: draft.title, acceptance: draft.acceptance },
          clarification: draft.clarification || null,
          source: {
            document: source.document,
            page: source.page,
            block: source.block,
            piece: source.hash,
          },
          madeBy: {
            run: "pending",
            model: estimate.model!,
            prompt: PROMPT_VERSION,
            attempt: answer.attempts,
          },
          editedBy: [],
          orphaned: false,
        };
        position += 1;
        store.requirements.save(projectPath, requirement);
        emit("run:requirement", requirement);
      }

      void index;
      return {
        produced: answer.requirements.length,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        attempts: answer.attempts,
      };
    },
  });

  const notes: string[] = [];
  if (record.note) notes.push(record.note);
  if (skipped > 0) notes.push(`${skipped} pieces were judged not to carry a requirement`);
  if (orphaned > 0) notes.push(`${orphaned} requirements no longer have a source`);
  record.note = notes.length > 0 ? notes.join(" · ") : null;
  store.runs.save(projectPath, record);

  return record;
}
