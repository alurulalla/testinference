import { useEffect, useState } from "react";
import { call, describeError } from "../lib/ipc";
import { Pill, Table } from "../ui/Table";
import { useDetail } from "../ui/detail";
import type { AppPage, Explored, OpenProject } from "../types/api";

/**
 * What the application actually looks like.
 *
 * Every other screen reads documents. This one reads the product, which is
 * the only way a generated test can point at a control that exists rather
 * than one a model imagined.
 */
export default function ExplorePanel({ project }: { project: OpenProject }) {
  const [pages, setPages] = useState<AppPage[]>([]);
  const [result, setResult] = useState<Explored | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [budget, setBudget] = useState(20);
  const [depth, setDepth] = useState(3);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The login form, filled from whatever the explorer found.
  const [showSignIn, setShowSignIn] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submit, setSubmit] = useState("");
  const [user, setUser] = useState("");
  const [secret, setSecret] = useState("");

  useEffect(() => {
    void load();
  }, [project.path]);

  async function load() {
    try {
      setPages(await call("explore_map", { projectPath: project.path }));
    } catch (cause: unknown) {
      setError(describeError(cause));
    }
  }

  async function explore(freshStart: boolean) {
    setRunning(true);
    setError(null);
    try {
      const walked = await call("explore_run", {
        projectPath: project.path,
        pages: budget,
        depth,
        freshStart,
      });
      setResult(walked);
      await load();
      if (walked.needsSignIn) offerSignIn(walked);
    } catch (cause: unknown) {
      setError(describeError(cause));
    } finally {
      setRunning(false);
    }
  }

  /** Pre-fills the sign-in with the fields that were actually found. */
  function offerSignIn(walked: Explored) {
    void call("explore_map", { projectPath: project.path }).then((map) => {
      const door = map[0];
      if (!door) return;
      const inputs = door.elements.filter((element) => element.kind === "input");
      const buttons = door.elements.filter((element) => element.kind === "control");
      setUsername(inputs[0]?.selector ?? "");
      setPassword(inputs[1]?.selector ?? "");
      setSubmit(buttons[0]?.selector ?? "");
      setShowSignIn(true);
    });
    void walked;
  }

  const chosen = pages.find((page) => page.url === selected) ?? null;
  const weak = chosen?.elements.filter((element) => element.sturdiness < 0.5).length ?? 0;
  const ambiguous = chosen?.elements.filter((element) => element.checked && element.matches > 1).length ?? 0;
  const untried =
    chosen?.elements.filter((element) => element.kind !== "text" && !element.checked).length ?? 0;

  useDetail(
    chosen ? (
      <>
        <header className="panel-head">
          <h2>{chosen.title || "untitled"}</h2>
          <Pill kind="plain">{chosen.elements.length}</Pill>
        </header>
        <code className="path">{chosen.url}</code>

        {chosen.examples.length > 0 && (
          <p className="hint">
            One screen, seen {chosen.examples.length + 1} times — {chosen.pattern.split("/").pop()}{" "}
            and {chosen.examples.length} more like it. A test written here covers all of them.
          </p>
        )}

        {weak > 0 && (
          <p className="warn">
            {weak} of these can only be found by their markup. A test built on those breaks the
            next time someone changes a class name — a data-test attribute on each would fix it
            for good.
          </p>
        )}

        {untried > 0 && (
          <p className="hint">
            {untried} were not tried in the browser. This page has more controls than one visit
            checks, and the form fields and buttons go first — what is left is mostly links.
          </p>
        )}

        {ambiguous > 0 && (
          <p className="warn">
            {ambiguous} answer to the same description as something else on the page. A test
            pointed at one of those acts on whichever the browser reaches first, so it has to say
            which one it means.
          </p>
        )}

        <span className="aside-label">What a test can touch</span>
        <div className="rows">
          {chosen.elements
            .filter((element) => element.kind !== "text")
            .slice(0, 40)
            .map((element, at) => (
              <div className="row" key={at}>
                <span className="row-main">{element.name || element.role || element.tag}</span>
                <span className="row-sub mono">{element.selector}</span>
                <Pill
                  kind={
                    !element.checked
                      ? "plain"
                      : element.matches === 1
                        ? element.sturdiness >= 0.85
                          ? "ok"
                          : "warn"
                        : "bad"
                  }
                >
                  {!element.checked
                    ? element.how
                    : element.matches === 1
                      ? element.how
                      : `${element.matches} of these`}
                </Pill>
              </div>
            ))}
        </div>
      </>
    ) : null,
    [selected, pages.length],
    () => setSelected(null),
  );

  return (
    <div className="stack">
      <section className="card">
        <header className="panel-head">
          <h2>Explore</h2>
          {pages.length > 0 && <Pill kind="plain">{pages.length} pages</Pill>}
        </header>

        <p className="hint">
          This walks {project.appUrl || "the application"} and writes down the pages and controls
          it finds, so test code can point at things that exist. It follows links and reads pages.
          It clicks nothing and submits nothing — apart from the sign-in, if you set one up below.
        </p>

        <div className="budgets">
          <div className="field">
            <label htmlFor="pages">Pages at most</label>
            <input
              id="pages"
              type="number"
              min="1"
              max="200"
              value={budget}
              onChange={(change) => setBudget(Number(change.target.value))}
            />
          </div>
          <div className="field">
            <label htmlFor="depth">How many links deep</label>
            <input
              id="depth"
              type="number"
              min="0"
              max="10"
              value={depth}
              onChange={(change) => setDepth(Number(change.target.value))}
            />
          </div>
        </div>

        <div className="actions">
          <button type="button" disabled={running || !project.appUrl} onClick={() => void explore(false)}>
            {running ? "Walking the application…" : pages.length > 0 ? "Explore again" : "Explore"}
          </button>
          {pages.length > 0 && (
            <button
              type="button"
              className="ghost danger"
              disabled={running}
              onClick={() => void explore(true)}
            >
              Start the map again
            </button>
          )}
          <button type="button" className="ghost" onClick={() => setShowSignIn(!showSignIn)}>
            {showSignIn ? "Hide the sign-in" : "Sign-in"}
          </button>
        </div>

        {!project.appUrl && (
          <p className="warn">
            This project has no application URL. Settings → Project, and it will have something to
            walk.
          </p>
        )}
        {error && <p className="warn">{error}</p>}

        {result && (
          <div className="estimate">
            <p className={result.needsSignIn ? "warn" : "hint"}>{result.note}</p>
            <p className="hint">
              {result.pages} pages · {result.fresh} new · {result.changed} changed since last time
              {result.repeats > 0 ? ` · ${result.repeats} were a screen already mapped` : ""}
            </p>
            {result.skipped.length > 0 && (
              <p className="warn">{result.skipped.length} could not be read: {result.skipped[0]}</p>
            )}
          </div>
        )}

        {showSignIn && (
          <div className="estimate">
            <p className="hint">
              The one thing the explorer is allowed to do besides read. Point the three fields at
              the login form — they are filled in from what was found on the page — and give it a
              test account. The password goes to the keychain, never into the project.
            </p>
            <div className="field">
              <label htmlFor="su">Username field</label>
              <input id="su" type="text" value={username} onChange={(c) => setUsername(c.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sp">Password field</label>
              <input id="sp" type="text" value={password} onChange={(c) => setPassword(c.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="sb">The button</label>
              <input id="sb" type="text" value={submit} onChange={(c) => setSubmit(c.target.value)} />
            </div>
            <div className="budgets">
              <div className="field">
                <label htmlFor="suser">Test account</label>
                <input id="suser" type="text" value={user} onChange={(c) => setUser(c.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="ssecret">Its password</label>
                <input
                  id="ssecret"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  onChange={(c) => setSecret(c.target.value)}
                />
              </div>
            </div>
            <div className="actions">
              <button
                type="button"
                disabled={running}
                onClick={() =>
                  void call("sign_in_set", {
                    projectPath: project.path,
                    username,
                    password,
                    submit,
                    user,
                    secret,
                  })
                    .then(() => {
                      setSecret("");
                      setShowSignIn(false);
                    })
                    .catch((cause: unknown) => setError(describeError(cause)))
                }
              >
                Save the sign-in
              </button>
              <button
                type="button"
                className="ghost danger"
                onClick={() =>
                  void call("sign_in_clear", { projectPath: project.path })
                    .then(() => setShowSignIn(false))
                    .catch((cause: unknown) => setError(describeError(cause)))
                }
              >
                Forget it
              </button>
            </div>
          </div>
        )}
      </section>

      <Table
        columns={[
          { label: "Page" },
          { label: "Address" },
          { label: "Controls", width: 90, align: "right" },
          { label: "Findable", width: 110 },
        ]}
        empty="Nothing explored yet."
        rows={pages.map((page) => {
          const touchable = page.elements.filter((element) => element.kind !== "text");
          const tried = touchable.filter((element) => element.checked);
          const sturdy = tried.filter(
            (element) => element.matches === 1 && element.sturdiness >= 0.85,
          ).length;
          return {
            id: page.url,
            selected: page.url === selected,
            onSelect: () => setSelected(page.url),
            cells: [
              page.title || <span className="sub">untitled</span>,
              <span className="mono sub">{page.url}</span>,
              touchable.length,
              <Pill kind={sturdy === tried.length ? "ok" : sturdy > tried.length / 2 ? "warn" : "bad"}>
                {sturdy} of {tried.length} solidly
              </Pill>,
            ],
          };
        })}
      />
    </div>
  );
}
