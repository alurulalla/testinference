import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import type { Chunk, DocumentRecord, DriftReport, OpenProject } from "../types/api";

const KINDS = ["pdf", "docx", "md", "markdown", "txt"];

export default function DocumentsPanel({ project }: { project: OpenProject }) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [gaps, setGaps] = useState<DriftReport | null>(null);
  const [checking, setChecking] = useState(false);
  const [written, setWritten] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [project.path]);

  async function refresh() {
    try {
      setDocuments(await call("document_list", { projectPath: project.path }));
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  async function addDocument() {
    setError(null);
    setNote(null);

    const chosen = await open({
      multiple: false,
      filters: [{ name: "Documents", extensions: KINDS }],
    });
    if (typeof chosen !== "string") return;

    setBusy(true);
    try {
      const added = await call("document_add", { projectPath: project.path, sourcePath: chosen });
      setNote(
        added.outcome === "unchanged"
          ? `${added.record.name} has not changed since it was last read — nothing to do.`
          : `${added.record.name} · ${added.record.chunks} pieces${
              added.record.pages ? ` from ${added.record.pages} pages` : ""
            }`,
      );
      await refresh();
      await show(added.record.id);
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function show(documentId: string) {
    setSelected(documentId);
    try {
      setChunks(
        await call("document_chunks", { projectPath: project.path, documentId, limit: 40 }),
      );
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>Documents</h2>
          <Pill kind="plain">{documents.length}</Pill>
        </header>

        <div className="actions">
          <button type="button" disabled={busy} onClick={() => void addDocument()}>
            {busy ? "Reading…" : "Add a document"}
          </button>
          <span className="hint">PDF, Word, Markdown or plain text</span>

          {documents.length > 0 && (
            <button
              type="button"
              className="ghost"
              disabled={busy || checking}
              onClick={() => {
                setChecking(true);
                setError(null);
                setWritten(null);
                void call("document_drift", { projectPath: project.path })
                  .then(setGaps)
                  .catch((cause: unknown) => setError(describeError(cause)))
                  .finally(() => setChecking(false));
              }}
            >
              {checking ? "Reading…" : "Check against the requirements"}
            </button>
          )}
        </div>

        {note && <p className="hint">{note}</p>}
        {error && <p className="warn">{error}</p>}

        {gaps && (
          <div className="estimate">
            <header className="panel-head">
              <h3>Where the documents and the requirements disagree</h3>
              <Pill kind={gaps.gaps.length > 0 ? "warn" : "ok"}>
                {gaps.gaps.length} of {gaps.checked}
              </Pill>
            </header>
            <p className={gaps.by === "rules" ? "warn" : "hint"}>{gaps.note}</p>
            <p className="hint">
              This app cannot edit your document. What it can do is tell you where the team's
              understanding has moved on and the written document has not — which is the list
              whoever owns that document never gets.
            </p>

            {gaps.orphanedAndEdited > 0 && (
              <p className="warn">
                {gaps.orphanedAndEdited} requirements that someone had edited no longer have a
                paragraph at all. Their source text changed or was removed. They are kept, not
                deleted — read them on the Requirements screen before letting them go.
              </p>
            )}

            {gaps.gaps.length > 0 && (
              <Table
                columns={[
                  { label: "Requirement", width: 100 },
                  { label: "The document says" },
                  { label: "The tests follow" },
                  { label: "Sure", width: 64, align: "right" },
                ]}
                empty="Nothing to report."
                rows={gaps.gaps.map((gap) => ({
                  id: gap.reqId,
                  cells: [
                    <>
                      <span className="mono">{gap.reqId}</span>
                      <span className="sub">
                        {gap.document}
                        {gap.page !== null ? ` p${gap.page}` : ""}
                        {gap.edited ? " · edited" : ""}
                      </span>
                    </>,
                    <span className="sub">{gap.paragraph.slice(0, 180)}</span>,
                    <>
                      {gap.title}
                      <span className="sub">{gap.acceptance.slice(0, 140)}</span>
                    </>,
                    `${Math.round(gap.confidence * 100)}%`,
                  ],
                }))}
              />
            )}

            <div className="actions">
              <button
                type="button"
                className="ghost"
                disabled={checking}
                onClick={() => {
                  setChecking(true);
                  void call("document_drift_export", { projectPath: project.path })
                    .then(setWritten)
                    .catch((cause: unknown) => setError(describeError(cause)))
                    .finally(() => setChecking(false));
                }}
              >
                Write it up for whoever owns the document
              </button>
              {written && <span className="hint">Written to {written}</span>}
            </div>
          </div>
        )}

        <Table
          columns={[
            { label: "Document" },
            { label: "Kind", width: 80 },
            { label: "Pages", width: 70, align: "right" },
            { label: "Pieces", width: 70, align: "right" },
            { label: "Size", width: 80, align: "right" },
            { label: "Fingerprint", width: 140 },
            { label: "", width: 110 },
          ]}
          empty="Nothing read yet."
          rows={documents.map((document) => ({
            id: document.id,
            selected: document.id === selected,
            onSelect: () => void show(document.id),
            cells: [
              <>
                {document.name}
                {document.warning ? <span className="sub">{document.warning}</span> : null}
              </>,
              document.kind,
              document.pages ?? "—",
              document.chunks,
              `${Math.round(document.bytes / 1024)} KB`,
              <span className="mono">{document.fingerprint}</span>,
              <span className="inline-actions">
                <button type="button" className="ghost" onClick={() => void show(document.id)}>
                  {selected === document.id ? "Showing" : "Pieces"}
                </button>
              </span>,
            ],
          }))}
        />
      </section>

      {selected && chunks.length > 0 && (
        <section className="card">
          <header className="panel-head">
            <h2>Pieces</h2>
            <Pill kind="plain">first {chunks.length}</Pill>
          </header>
          <p className="hint">
            Each piece remembers where it came from, so a requirement can point back at the sentence
            that produced it.
          </p>
          <div className="chunks">
            {chunks.map((chunk) => (
              <article className="chunk" key={chunk.hash}>
                <header>
                  <span className="chunk-where">
                    {chunk.page !== null ? `page ${chunk.page}` : `block ${chunk.block}`}
                    {chunk.heading ? ` · ${chunk.heading}` : ""}
                  </span>
                  <span className="chunk-hash">{chunk.hash}</span>
                </header>
                <p>{chunk.text.length > 320 ? `${chunk.text.slice(0, 320)}…` : chunk.text}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
