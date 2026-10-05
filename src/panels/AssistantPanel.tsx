import { useEffect, useRef, useState } from "react";
import { call, describeError } from "../lib/ipc";
import type { AssistantAnswer, OpenProject, Proposal } from "../types/api";

interface Turn {
  question: string;
  answer: string;
  note: string;
  proposal: Proposal | null;
  destructive: boolean;
  applied: string | null;
}

export default function AssistantPanel({ project, asked }: { project: OpenProject; asked: string }) {
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handled = useRef("");

  // A question typed into the command bar arrives here already asked.
  useEffect(() => {
    if (asked && asked !== handled.current) {
      handled.current = asked;
      setQuestion(asked);
    }
  }, [asked]);

  async function ask() {
    const asked = question.trim();
    if (!asked) return;

    setAsking(true);
    setError(null);
    try {
      const reply: AssistantAnswer = await call("assistant_ask", {
        projectPath: project.path,
        question: asked,
        history: turns.slice(-3).map((turn) => ({ question: turn.question, answer: turn.answer })),
      });
      setTurns((previous) => [
        ...previous,
        {
          question: asked,
          answer: reply.answer,
          note: reply.contextNote,
          proposal: reply.proposal,
          destructive: reply.destructive,
          applied: null,
        },
      ]);
      setQuestion("");
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setAsking(false);
    }
  }

  async function apply(at: number, proposal: Proposal) {
    setError(null);
    try {
      const result = await call("assistant_apply", { projectPath: project.path, proposal });
      setTurns((previous) =>
        previous.map((turn, index) => (index === at ? { ...turn, applied: result } : turn)),
      );
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  return (
    <div className="stack">
      <section className="card">
        <h2>Assistant</h2>
        <p className="hint">
          It reads this project's data and can propose a change. It cannot make one — every
          proposal is applied by you, and the last change can be undone.
        </p>
        <div className="field">
          <label htmlFor="question">Ask about your requirements, scenarios or cases</label>
          <input
            id="question"
            type="text"
            value={question}
            placeholder="which requirements have no negative scenario?"
            onChange={(change) => setQuestion(change.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void ask();
            }}
          />
        </div>
        <div className="actions">
          <button type="button" disabled={asking || question.trim().length === 0} onClick={() => void ask()}>
            {asking ? "Thinking…" : "Ask"}
          </button>
          <button
            type="button"
            className="ghost"
            onClick={() =>
              void call("assistant_undo", { projectPath: project.path })
                .then(setNote)
                .catch((cause: unknown) => setError(describeError(cause)))
            }
          >
            Undo the last change
          </button>
        </div>
        {note && <p className="hint">{note}</p>}
        {error && <p className="warn">{error}</p>}
      </section>

      {[...turns].reverse().map((turn, reversed) => {
        const at = turns.length - 1 - reversed;
        return (
          <section className="card" key={`${turn.question}-${at}`}>
            <p className="lede">{turn.question}</p>
            <p>{turn.answer}</p>
            <p className="hint">{turn.note}</p>

            {turn.proposal && (
              <div className="estimate">
                <span className="steps-head">It proposes a change</span>
                <p>
                  <strong>{turn.proposal.action.replace(/_/g, " ")}</strong> ·{" "}
                  {turn.proposal.ids.join(", ")}
                  {turn.proposal.verdict ? ` · ${turn.proposal.verdict}` : ""}
                </p>
                <p className="hint">{turn.proposal.why}</p>
                {turn.destructive && (
                  <p className="warn">
                    This one destroys something. Nothing is removed until you press apply, and undo
                    puts it back.
                  </p>
                )}
                {turn.applied ? (
                  <p className="hint">{turn.applied}</p>
                ) : (
                  <div className="actions">
                    <button
                      type="button"
                      className={turn.destructive ? "danger" : ""}
                      onClick={() => void apply(at, turn.proposal as Proposal)}
                    >
                      Apply it
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        setTurns((previous) =>
                          previous.map((entry, index) =>
                            index === at ? { ...entry, proposal: null } : entry,
                          ),
                        )
                      }
                    >
                      Discard
                    </button>
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
