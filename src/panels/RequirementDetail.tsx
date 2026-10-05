import { useEffect, useRef, useState } from "react";
import { call, describeError } from "../lib/ipc";
import { Pill } from "../ui/Table";
import type { Applied, OpenProject, Requirement, Rewording, Turn } from "../types/api";

/**
 * The requirement, and the conversation about it, in the detail column.
 *
 * It owns its own state so the shell does not have to re-publish the whole
 * column on every keystroke. The column is where someone is already looking
 * when they notice the wording is wrong, which is why the discussion lives
 * here rather than on a screen of its own.
 */
export default function RequirementDetail({
  project,
  requirement,
  built,
  onChanged,
}: {
  project: OpenProject;
  requirement: Requirement;
  /** What has been built on this requirement, and how much is stale. */
  built: { scenarios: number; cases: number; stale: number };
  onChanged: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [proposal, setProposal] = useState<Rewording | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [talking, setTalking] = useState(false);
  const foot = useRef<HTMLDivElement>(null);

  // A new requirement is a new conversation.
  useEffect(() => {
    setTurns([]);
    setDraft("");
    setProposal(null);
    setApplied(null);
    setError(null);
    setTalking(false);
  }, [requirement.id]);

  useEffect(() => {
    foot.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, proposal]);

  async function say(text: string) {
    const said = text.trim();
    if (!said) return;

    const mine: Turn = { from: "person", text: said, at: new Date().toISOString() };
    const sofar = [...turns, mine];
    setTurns(sofar);
    setDraft("");
    setBusy(true);
    setError(null);

    try {
      const answer = await call("requirement_discuss", {
        projectPath: project.path,
        reqId: requirement.id,
        said,
        history: turns,
      });
      const reply = [answer.reply, answer.question].filter(Boolean).join("\n\n");
      setTurns([...sofar, { from: "app", text: reply, at: new Date().toISOString() }]);
      setProposal(answer.proposal);
    } catch (cause: unknown) {
      setError(describeError(cause));
      setTurns(sofar);
    } finally {
      setBusy(false);
    }
  }

  async function applyWording() {
    if (!proposal) return;
    setBusy(true);
    setError(null);
    try {
      const result = await call("requirement_apply_wording", {
        projectPath: project.path,
        reqId: requirement.id,
        title: proposal.title,
        acceptance: proposal.acceptance,
        turns,
      });
      setApplied(result);
      setProposal(null);
      onChanged();
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  async function keepAsIs() {
    setBusy(true);
    try {
      await call("requirement_keep_discussion", {
        projectPath: project.path,
        reqId: requirement.id,
        turns,
      });
      setTalking(false);
      setTurns([]);
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="panel-head">
        <h2>{requirement.id}</h2>
        {requirement.version > 1 && <Pill kind="plain">v{requirement.version}</Pill>}
        <Pill kind={requirement.orphaned ? "bad" : requirement.flag === "vague" ? "warn" : "ok"}>
          {requirement.orphaned ? "no source" : requirement.flag}
        </Pill>
      </header>
      <p className="lede">{requirement.title}</p>

      <span className="aside-label">Acceptance</span>
      <span className="aside-value">{requirement.acceptance || "— not given"}</span>

      <span className="aside-label">From</span>
      <span className="aside-value">
        {requirement.source.document}
        {requirement.source.page !== null ? ` · page ${requirement.source.page}` : ""} · block{" "}
        {requirement.source.block}
      </span>

      {requirement.version > 1 && requirement.asExtracted && (
        <>
          <span className="aside-label">The document said</span>
          <span className="aside-value sub">
            {requirement.asExtracted.title}
            {requirement.asExtracted.acceptance ? ` — ${requirement.asExtracted.acceptance}` : ""}
          </span>
        </>
      )}

      {built.stale > 0 && (
        <p className="warn">
          {built.stale} of the {built.cases} test cases here were written from older wording. They
          are not wrong by themselves — they were just written against a sentence this requirement
          no longer has.
        </p>
      )}

      <span className="aside-label">Built on this</span>
      {built.scenarios === 0 && built.cases === 0 ? (
        <span className="aside-value">
          Nothing yet — no scenarios have been designed from this requirement.
          {requirement.flag === "clear"
            ? " Test Design → Scenarios picks up every requirement that has none."
            : " Settle the wording first; a vague requirement is skipped as untestable."}
        </span>
      ) : (
        <span className="aside-value">
          {built.scenarios} scenarios · {built.cases} cases
        </span>
      )}

      {applied && (
        <div className="estimate">
          <p className={applied.keeps ? "hint" : "warn"}>{applied.note}</p>
          <p className="hint">
            Now version {applied.version}. Saved as {applied.discussion}.
          </p>
        </div>
      )}

      {!talking && (
        <div className="actions">
          <button type="button" onClick={() => setTalking(true)}>
            Discuss this requirement
          </button>
        </div>
      )}

      {talking && (
        <div className="talk">
          {requirement.clarification && turns.length === 0 && (
            <p className="hint">
              This was flagged when it was read: <em>{requirement.clarification}</em>
            </p>
          )}

          {turns.map((turn, at) => (
            <p className={turn.from === "person" ? "said-me" : "said-app"} key={at}>
              {turn.text}
            </p>
          ))}
          {busy && <p className="hint">Thinking…</p>}
          {error && <p className="warn">{error}</p>}

          {proposal && (
            <div className="estimate">
              <span className="aside-label">It suggests</span>
              <p className="lede">{proposal.title}</p>
              <p className="aside-value">{proposal.acceptance}</p>
              <p className="hint">{proposal.why}</p>
              <div className="actions">
                <button type="button" disabled={busy} onClick={() => void applyWording()}>
                  Use this wording
                </button>
                <button type="button" className="ghost" onClick={() => setProposal(null)}>
                  Not that
                </button>
              </div>
            </div>
          )}

          <div className="field">
            <textarea
              rows={3}
              value={draft}
              placeholder={
                requirement.flag === "vague"
                  ? "Answer the question above, or say what it should mean"
                  : "Ask about this requirement, or say what should change"
              }
              disabled={busy}
              onChange={(change) => setDraft(change.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  void say(draft);
                }
              }}
            />
          </div>
          <div className="actions">
            <button type="button" disabled={busy || !draft.trim()} onClick={() => void say(draft)}>
              Send
            </button>
            {turns.length > 0 && (
              <button type="button" className="ghost" disabled={busy} onClick={() => void keepAsIs()}>
                Leave it as it is
              </button>
            )}
            {turns.length === 0 && (
              <button type="button" className="ghost" onClick={() => setTalking(false)}>
                Close
              </button>
            )}
          </div>
          <span className="hint">
            Nothing changes until you say so. The conversation is saved with the project either
            way — including when you decide the requirement is fine.
          </span>
          <div ref={foot} />
        </div>
      )}
    </>
  );
}
