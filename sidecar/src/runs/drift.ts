import { join } from "node:path";

import { drift as judgeDrift } from "../decisions/ask.js";
import { read as readChunks } from "../store/chunks.js";
import * as store from "../store/index.js";
import { atomicWrite } from "../store/paths.js";
import { readContext } from "../store/project.js";
import { judgeSettings } from "./judge.js";

/**
 * Where the document and the requirements have come apart.
 *
 * A requirement gets talked into shape; the document still says what it
 * always said. Over a release the two drift until neither can be trusted
 * as the record. This app cannot edit someone's PRD, so what it produces
 * is the list — and that list is the thing worth having, because these
 * gaps are found every week and almost never make it back.
 */

export interface Gap {
  reqId: string;
  document: string;
  page: number | null;
  /** What the document says. */
  paragraph: string;
  /** What the requirement says now. */
  title: string;
  acceptance: string;
  why: string;
  confidence: number;
  edited: boolean;
}

export interface Report {
  gaps: Gap[];
  checked: number;
  orphaned: number;
  /** Of those, the ones a person had edited — worth rescuing. */
  orphanedAndEdited: number;
  by: string;
  note: string;
}

/** Every paragraph of every document, by fingerprint. */
function paragraphs(projectPath: string): Map<string, string> {
  const context = readContext(projectPath);
  const found = new Map<string, string>();
  for (const document of store.documents.list(projectPath)) {
    for (const chunk of readChunks(context.id, document.id)) {
      found.set(chunk.hash, chunk.text);
    }
  }
  return found;
}

export async function check(projectPath: string): Promise<Report> {
  const requirements = store.requirements.list(projectPath);
  if (requirements.length === 0) {
    throw new Error("there are no requirements to check against the documents yet");
  }

  const text = paragraphs(projectPath);
  const orphaned = requirements.filter((item) => item.orphaned);
  const orphanedAndEdited = orphaned.filter((item) => item.editedBy.length > 0).length;

  const asked = requirements
    .filter((item) => !item.orphaned)
    .map((item) => ({
      id: item.id,
      title: item.title,
      acceptance: item.acceptance,
      paragraph: text.get(item.source.piece) ?? "",
      edited: item.editedBy.length > 0,
    }));

  const answered = await judgeDrift({ ...judgeSettings(projectPath), requirements: asked });
  const by = answered.answers[0]?.by ?? "rules";

  const gaps: Gap[] = [];
  for (const entry of answered.answers) {
    const requirement = requirements.find((item) => item.id === entry.id);
    if (!requirement) continue;
    gaps.push({
      reqId: requirement.id,
      document: requirement.source.document,
      page: requirement.source.page,
      paragraph: entry.answer.paragraph,
      title: requirement.title,
      acceptance: requirement.acceptance,
      why: entry.why,
      confidence: entry.confidence,
      edited: requirement.editedBy.length > 0,
    });
  }

  const note =
    by === "rules"
      ? "Nothing is judging, so this is only the requirements someone changed by hand. Turn on Jev in Settings to have every requirement read against its paragraph."
      : gaps.length === 0
        ? "Every requirement is still supported by the paragraph it came from."
        : `${gaps.length} places where the document and the requirements disagree.`;

  return { gaps, checked: asked.length, orphaned: orphaned.length, orphanedAndEdited, by, note };
}

/**
 * Writes the list as something the document's owner can read.
 *
 * Markdown rather than CSV: the reader is whoever maintains the PRD, not
 * a spreadsheet.
 */
export function writeReport(projectPath: string, report: Report): string {
  const out: string[] = ["# Where the documents and the tests disagree", ""];
  out.push(`Checked ${report.checked} requirements on ${store.now()}.`, "");

  if (report.gaps.length === 0) {
    out.push("Nothing to report: every requirement is still supported by its source.");
  } else {
    out.push(
      "Each entry below is a place where the test team's understanding has moved away from the written document. The tests follow the second version. The document still says the first.",
      "",
    );
  }

  const byDocument = new Map<string, Gap[]>();
  for (const gap of report.gaps) {
    const list = byDocument.get(gap.document) ?? [];
    list.push(gap);
    byDocument.set(gap.document, list);
  }

  for (const [document, gaps] of [...byDocument].sort()) {
    out.push(`## ${document}`, "");
    for (const gap of gaps) {
      out.push(`### ${gap.reqId}${gap.page !== null ? ` · page ${gap.page}` : ""}`, "");
      out.push("**The document says**", "", `> ${gap.paragraph.replace(/\n/g, "\n> ")}`, "");
      out.push("**The tests are written against**", "", `> ${gap.title}`, ">", `> ${gap.acceptance}`, "");
      out.push(`_${gap.why}_`, "");
    }
  }

  if (report.orphanedAndEdited > 0) {
    out.push(
      "---",
      "",
      `${report.orphanedAndEdited} requirements that someone had edited no longer have a paragraph in any document at all. Their source text changed or was removed. They are kept in the project, not deleted.`,
    );
  }

  const target = join(projectPath, ".testinference", "exports", "document-gaps.md");
  atomicWrite(target, out.join("\n"));
  return target;
}
