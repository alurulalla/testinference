# TestInference — Build Plan
### Test Design and Test Cases, slice by slice

3 October 2026 · companion to `testinference-design.md`

---

## How this is organised

Twelve slices in four phases. Every slice ends with something you can try yourself — not "the store is done" but "make a project, quit, reopen, it is still there". If a slice can't be checked that way, it is too big and gets split.

Sizes are relative: **S** is a sitting, **M** is a few, **L** is the heavy ones. Two slices are marked L and they are where the risk lives.

**Already working:** the desktop app, the worker process it supervises, the live event stream, and keys in the macOS keychain.

---

## Phase A · Foundations

No AI in this phase. It ends with the arithmetic proven, which is the thing everything later leans on.

### A1 · Projects and the file store — M
**You can:** create a project, close the app, reopen it, and find it exactly as you left it. Open the `.testinference/` folder in Finder and read your own data as plain files.

Builds: the folder layout, one file per record, atomic writes so a crash never leaves half a file, the small journal that replays an interrupted multi-file change, loading a project into memory on open, the project list and switcher, and the Home screen shell.

### A2 · The five rule engines — M
**You can:** run one command and watch the worked example reproduce exactly — 93% average TCER score, 75% coverage, risk bands 2/8/2, feasibility 8/2/0, validation 10 pass / 0 rework / 1 reject.

Builds: TCER scoring, coverage and the traceability matrix, risk ranking, validation, automation feasibility — all as plain functions with no AI, plus the fixture that holds both expected sets: the numbers that must match the old app, and the five that must deliberately differ.

### A3 · Reading documents — M
**You can:** drop a PDF or a Word file in and see it broken into pieces, each one showing which page and paragraph it came from. Drop the same file again and the app says nothing changed.

Builds: PDF, Word, Markdown, plain text and paste; chunking; the page-and-paragraph anchors the CSV export needs; fingerprints per file and per chunk; the Documents screen.

### A4 · The model socket — M
**You can:** add a key for Anthropic, OpenAI, Gemini or a local model, see the live list of models that key can actually reach, run the self-test, and choose which model does which job.

Builds: the three connection shapes, live model listing, the self-test that records what a model can do, the per-job assignment table, the spend guard, and the estimate shown before a run.

> **Decide before phase B:** the visual style. The first real screens are built in B1, and restyling them afterwards is wasted work.

---

## Phase B · Test Design

The first AI. Each slice adds one agent and its checker.

### B1 · Requirements, end to end — L
**You can:** drop in a real PRD and get requirements on screen, with the vague ones flagged and clarification questions raised. Export the CSV. Open the files on disk and see one per requirement.

Builds: the manager that runs a node and records what happened, the first agent, answer-shape enforcement with one repair, IDs assigned by the app, artifacts written with their lineage, the Requirements screen with its side panel, and the CSV export.

This is the heaviest slice because the machinery arrives with it. Everything after it reuses this.

**I need from you:** a real PRD, even a redacted one.

### B2 · Scenarios and Gate A — M
**You can:** approve, edit or reject scenarios, riskiest first, and see that a rejection sends the designer back with your reason.

Builds: the designer agent, the coverage check that asks whether a requirement has enough scenarios, the Scenarios screen, and Gate A as a recorded decision — who, when, what changed.

### B3 · TCER, coverage and risk — M
**You can:** run a whole document through to a ranked risk list and a traceability matrix, and see rows that failed scoring held back.

Builds: the enricher with batching and per-row repair, and the three screens wired to the engines from A2.

> **End of phase B is the first thing worth demonstrating to a customer:** documents in, approved scenarios and coverage out.

---

## Phase C · Test Cases

### C1 · Test cases and validation — M
**You can:** generate test cases with numbered steps, see validation issues on each, and watch empty fields show as missing rather than being papered over.

### C2 · BDD and the step library — M
**You can:** get real `.feature` files with Scenario Outlines, and watch the step library grow without filling up with four spellings of the same step.

Builds: the author agent, Gherkin parsing as the checker, the step library on disk, and the on-device similarity match that decides reuse against new.

### C3 · Gate B, suites, publishing and the push — L
**You can:** approve cases, assign them to suites, publish to your ALM, and push to the repo — with the app asking whether to send the project context along.

Builds: review states, suite assignment, publishing, the feasibility view, git commits with readable messages, and the push prompt.

**Decide before this slice:** is publishing to Azure DevOps, Jira Xray and Git real in v1, or a receipt?

---

## Phase D · Memory and help

### D1 · Change detection and reuse — M
**You can:** re-import a changed document and be shown what changed before anything is regenerated. Approvals on untouched requirements survive.

Builds: fingerprint comparison, matching a re-extracted requirement to the one it replaces, the delta screen, and asking you when a match is genuinely unclear rather than renumbering quietly.

### D2 · The assistant — M
**You can:** ask questions about your own pipeline and make changes by asking, with every destructive change confirmed and undoable.

Builds: the tool loop, retrieval over your documents, mutations through the same commands the buttons use, and the audit record.

### D3 · Jev — S — built

**You can:** switch judgement between Rules, the assigned model and Jev, per project, in
Settings → Judgement. The switch lives in the project's `context.yaml`, so it travels to git
with everything else. Every run records the mode it ran under, and the runs table shows it.
"Check the set" on Requirements runs the judgement pass: which requirements are too vague to
test, and which two say the same thing. A review that asks a judge anything is recorded as a
run of its own, with its tokens and — once you set the price — its cost.

**Jev as it actually is:** `POST https://api.typesafe.ai/v1/systemone`, bearer key, one
`state` plus a map of typed questions answered in parallel. The app uses **noul**, the graded
yes/no: 0.95 a confident yes, 0.5 "I don't know". No prose, no schema to repair. The key is
checked against `GET /v1/models`, so "Check the key" now tells the truth instead of saying
Jev cannot be validated. 429 and 529 are retried with backoff honouring `retry-after`; 401
and 422 are not, because repeating a bad request only repeats the mistake.

**Checked against the live API on 2026-10-05**, with the real 120-requirement project:
Jev answered 780 questions in 3.6 seconds for 129k input tokens (about half a cent at
TypeSafe's listed price). It found 31 duplicate pairs it was confident about, against the
rules' 19 — and it kept apart the pairs the rules merge, such as "sort by price lowest to
highest" and "sort by price highest to lowest", which share 94% of their wording and do the
opposite thing. Of the 4 requirements the rules called too vague, Jev rated every one
testable, and reading them it is right: "the sort control does not sort items correctly" is
checkable, it just contains the word "correctly".

**Seven of the nine are on Jev.** Beyond the review's two: which document pieces carry a
requirement, class and feasibility labels, whether a requirement's scenarios are enough,
whether a step is already in the library, whether a case tests the scenario it claims, and
whether a chat request would destroy work. Two are deliberately not sent — priority and
model routing — for reasons recorded in the design doc, both of them measured rather than
assumed.

The case check sits beside the validation score rather than inside it: that score is
published arithmetic, (1 − issues/5)×100, which we reproduce on purpose, so a sixth check
cannot be folded in without changing a number that is meant to match.

## Phase E · Starting from somewhere else

### E1 · Starting from test cases you already have — M — built

**You can:** import a spreadsheet of test cases instead of designing them. Test cases →
"Import from a spreadsheet" takes a CSV or TSV, works out which column is which, shows the
mapping and the first rows, and imports on your say-so.

**Reading the file:** RFC 4180, so a steps column with commas, quotes and line breaks
arrives whole — that field is the one a naive split always ruins. Tabs and semicolons are
detected, as is a byte order mark.

**Which column is which:** about sixty known headings are matched outright ("Summary",
"Pre-requisites", "Expected Result", "Severity"). With Jev on, the leftovers go to it as a
choice question with five real values from the column, because a column called "Notes" is
only identifiable by what is in it. Measured on a Jira-style export: names alone got 6 of
10 and missed the steps column entirely; with the judge, 8 of 10 including steps. Every
mapping is shown with how it was arrived at, and any of it can be changed before importing.

**What it keeps:** the identifier a case already has, because those are in bug reports and
CI output and renumbering them breaks every reference. One is only replaced when it would
collide with a case already here or could not be a filename, and the screen says which.
High/Medium/Low becomes P1/P2/P3, because that is the vocabulary everything downstream
counts in. Each case records the file it came from, so an imported case is never mistaken
for one this app designed.

**What it cannot conjure** is the spine — the requirement and scenario each case came from.
Where the file carries those references they are kept. Where it does not, the cases still
go through validation, Gate B, suites, BDD, automation feasibility and publishing, but
coverage, risk and the TCER stay empty, and every case picks up the "no link to a scenario"
issue at validation. The import screen says this before you import, not after. The
alternative — inventing a requirement per case so the matrices look full — would be worse
than an honest gap.

**Linking is E2, below.**

### E2 · Linking imported cases to requirements — S — built

**You can:** with untraced cases and requirements both present, Test cases → "Link N to
requirements" proposes which requirement each case is a test of. Nothing is written until
you apply it: the confident matches are ticked, the rest are not, and you can untick any of
them.

**How:** word overlap ranks each case's three nearest requirements, and the judge reads
those three properly. There is no minimum overlap to clear — overlap decides the order,
never whether a candidate is seen. A case called "Basket indicator updates after adding a
product" shares no words with "Cart shows how many items it holds", and that pair is the
whole reason for asking something that reads meaning. Three questions per case is a few
hundred on a real project, which is pennies.

**Measured** on 40 cases whose requirement the pipeline had already established, against
144 requirements:

| | wording alone | with the judge |
|---|---|---|
| exactly right | 12 | 14 |
| a near-duplicate of the right one | — | 7 |
| genuinely wrong | 24 | 7 |
| left unlinked | 4 | 12 |
| **right or a twin, of those ticked by default** | **5 of 12** | **18 of 20** |

Two things that measurement taught. The project has many duplicate requirement pairs, so
"wrong" often means "linked to the twin of the right one" — a judgement about the
requirements, not the linking. And the 12 left unlinked are the judge declining rather than
guessing, which is what should happen: a wrong link makes a requirement look tested when it
is not, which is worse than no link. The 0.7 bar for ticking by default is what keeps the
applied set at 90%; the rest are shown with their confidence for a person to decide.

**What linking does not do** is fill the matrices. Coverage, risk and the TCER are built
from requirements → scenarios → TCER rows, and a case never enters that chain. That is E3.

### E3 · Deriving the scenarios and rows a case implies — S — built

**You can:** with cases linked to requirements but nothing behind them, Test cases →
"Derive N scenarios and rows" builds the scenario and TCER row each case implies. Coverage,
risk and the TCER then work for imported cases.

**This is a projection, not an invention.** A test case already carries a precondition, an
action and an expected result — those are a scenario's own fields, copied across. The steps
become the trigger verbatim rather than being summarised, because writing a summary would
be composing content, which is not what this is for. The TCER row is the same projection,
and its score is computed by the same four checks as any other row, never asserted.

**One field is genuinely inferred: the class.** The judge answers it at 88% (measured), and
a first-match-wins word rule stands in when it is unsure or switched off. The derived
records say where they came from — `derived from TC-104` — so a reverse-engineered scenario
is never mistaken for a designed one.

**Measured** on 430 cases and 144 requirements:

| | before | after |
|---|---|---|
| coverage | 0% — 144 gaps | **51%** — 73 covered, 71 gaps |
| TCER | nothing | 430 rows, 99% average, 424 pass / 6 rework |
| risk bands | nothing | 22 P1 · 325 P2 · 83 P3 |

The 71 remaining gaps are requirements that genuinely have no case pointing at them, which
is the honest answer rather than a failure. **The 99% TCER average means less than it
looks**: those four checks test whether fields are present, and a derived row inherits its
fields from a case that already had them, so passing is close to guaranteed. Read it as "the
projection worked", not "the tests are good".

**The scenarios arrive at Gate A pending**, like any other. Marking them approved would
record a decision nobody made — the decision these represent was made by whoever wrote the
cases, not by this app. Bulk approve by band is there for exactly this.

## Phase F · Changing what is already there

Decided 2026-10-05: requirements first, flag the documents, save the discussions.

### F1 · Talking a requirement into shape — L — built

**You can:** click a requirement, and the discussion is right there in the detail column —
where you were already looking when you noticed the wording was wrong. It asks what it
needs to know, you answer in your own words, it proposes new wording as a before and after,
and nothing changes until you say so.

**Checked against the live model**, five behaviours that matter:

| | |
|---|---|
| "this is too vague, fix it" | asked for the number instead of inventing one |
| "under 400ms, a thousand users" | proposed, and warned the 11 cases would go behind |
| the judge on that edit | *sharper*, 99% sure, keeps everything the old one did |
| "what tests exist for this?" | answered, proposed nothing — a question is not a request |
| a requirement that was already fine | "I wouldn't change a word" |

The last two are the ones that make it usable. A discussion tool that proposes a change
every time you open it teaches you to ignore it.

**Versions, so the audit survives.** Each requirement carries a version; every scenario,
TCER row and case records which version it was built from. "Out of date" is a comparison of
two numbers, not a guess. The requirement list shows "v2 · 7 behind", the detail column says
which cases are affected, and Gate B marks a case as *written against REQ-07 v1, which is
now v2*.

**Nothing downstream is deleted and no approval is withdrawn.** A test approved against
"search should be fast" was approved against a sentence that no longer exists, and the
record says exactly that rather than pretending otherwise or quietly tearing up someone's
decision.

**How far an edit reaches** is the judge's call, with two questions: how far has this moved
(wording · sharper · different), and does the new wording still require everything the old
one did. A typo bumps nothing. An unanswered or unsure verdict is treated as a real change,
because calling a shrug "just wording" is how a changed requirement slips past the eleven
tests that no longer match it.

### F2 · Telling the document it is out of step — M — built

**You can:** Documents → "Check against the requirements" reads every requirement beside
the paragraph it came from and reports where the two no longer agree. "Write it up for
whoever owns the document" produces a Markdown file, grouped by document, saying what the
document says and what the tests are actually written against. Markdown rather than CSV,
because the reader is whoever maintains the PRD, not a spreadsheet.

**The phrasing was chosen by measurement, and it was not the obvious one.** Three ways of
asking, against 40 untouched requirements and 4 planted edits of the kind a discussion
produces:

| the question | planted edits found | false alarms |
|---|---|---|
| "does the paragraph support this requirement?" | 1 of 4 | 0 of 40 |
| "does the requirement say anything the paragraph does not?" | 4 of 4 | **25 of 40** |
| **"could this requirement have been written from the paragraph alone?"** | **4 of 4** | **0 of 40** |

The first is useless: a requirement about a topic sits comfortably beside a paragraph about
that topic, so nearly everything reads as supported. The second is noise that would train
anyone to ignore the screen. The third works — but only with the confidence floor: every
wrong flag came back under 42% sure, and the quietest real edit at 58%, so the floor sits at
a half.

**Run-to-run variation is real near that line.** A subtle addition sitting around 55% is
found on one run and missed on the next. Wholesale changes are found every time. The screen
should be read as "here is what has clearly drifted", not "here is everything".

**Without Jev** this falls back to listing the requirements someone edited by hand, and says
so rather than implying it is the whole picture.

**Protecting hand edits.** When a paragraph changes, today's delta re-read marks the old
requirement orphaned and extracts a fresh one — which would quietly discard someone's
edit. Orphans that were edited by hand are now called out separately, the bulk tidy-up
drops only the ones nobody touched, and removing the edited ones takes a second, explicit
confirmation.

### F3 · Keeping the discussions — S — built

One file per discussion in `.testinference/discussions`, so it travels to git with
everything else: what was asked, what was answered, the wording before and after, and how
far the judge said it moved. "Leave it as it is" saves one too — someone looking at a
requirement and being satisfied is evidence, and you asked for those to be kept.

Each discussion records the version it produced, so the *why* sits next to the *what*.

**Worth saying out loud:** these conversations end up in a repository the whole team can
read. People write informally in chat. That is not a reason to avoid saving them, but it is
worth the team knowing.


## Phase G · Reading the product, not just the documents

### G1 · Explore — M — built

**You can:** Build → Explore walks the project's application and writes down the pages it
finds, every control on them, and a way of finding each one again. The map lives in
`.testinference/app/` and travels to git like everything else; a second run says which pages
are new and which have changed.

**Read-only by construction.** It follows links and reads pages. It clicks nothing and
submits nothing. The one exception is a sign-in a person configures, because most
applications are a login page and nothing else until you are through it. That restraint is
the design, not a gap to close later: a crawler that presses whatever it finds will one day
press "Delete account" on someone's staging environment, and no list of dangerous words is
good enough — "Remove" is dangerous, "Remove filter" is not.

**Selectors are the whole point.** Each element gets the sturdiest way of finding it that
actually works — test id, then role and name, then label, placeholder, text, and markup
last — and the rung is recorded, so a test built on a class path never looks as trustworthy
as one built on a role.

**Two things only running it could have taught:**

*The selector that reads beautifully and matches nothing.* saucedemo marks its controls with
`data-test`; Playwright's `getByTestId` resolves `data-testid` and nothing else. Every
selector the explorer produced for it matched **zero** elements. Sites using a different
attribute now get `locator('[data-test="username"]')` — uglier, correct, and still trusted
as a test id. All four now resolve to exactly one element.

*Guessing at uniqueness does not work.* Counting matches in the page says a selector is
unique when Playwright, which matches a role by its accessible name, finds six. Every
selector is now tried in the browser and falls through to the next rung until one resolves
to a single element. On a documentation site with no test ids that took uniquely-resolving
selectors from 89 of 145 to 96, and unfindable ones from 6 to 1, in 1.8 seconds. The 48 that
remain genuinely answer to the same description as something else, and are marked as such
rather than handed over as if they were fine.

**Where it works, measured on four kinds of site:**

| | pages | controls | tried | resolve uniquely | time |
|---|---|---|---|---|---|
| a plain page | 1 | 1 | 1 | 1 | 0.6s |
| a single-page app | 1 | 4 | 4 | 3 | 0.7s |
| a Wikipedia article | 4 | 2877 | 600 | 454 | 10.4s |
| a documentation site | 4 | 254 | 254 | 183 | 2.1s |

Three things that survey fixed. Verifying every selector on a Wikipedia article took **60
seconds for four pages**; form fields and buttons are now checked first and the rest is
capped, which brought it to 10. Two addresses that redirect to the same page were being
mapped as two different pages, because where a request asks to go and where it lands are
not the same. And "never checked" and "matched nothing" were both stored as zero, so a page
of uninspected links read as a page of broken selectors — they are now told apart.

**One screen, seen forty times.** A shop has `/product/1` through `/product/40`. They are
one screen showing different data, and treating them as forty pages does real damage: a
twenty page budget is spent entirely on products, and the basket and checkout are never
reached. Measured on a shop-shaped site with forty products and a budget of twenty:

| | pages written down | basket reached | checkout reached |
|---|---|---|---|
| without the cap | 2 | **no** | **no** |
| with the cap | 4 | yes | yes |

Two mechanisms, because they catch different things. The address with its identifiers
removed — `/product/{}` — is known *before* a page is visited, which is what saves the
budget; three addresses per pattern are visited and the rest are recorded as examples. The
shape of a page, which is what it is made of with the words left out, catches screens whose
addresses look nothing alike, and is only known after looking. Jev confirms each group the
rules formed, and when it is off the rules stand, because being wrong here costs a page in
the map rather than a test.

The first row is the part worth noticing: folding pages together afterwards still produced
a tidy-looking map of 2 pages. Tidy and wrong. Only the cap during the walk puts the budget
where it belongs.

**What it does not reach, and will say so rather than pretend:**

- **Applications that navigate with script.** The explorer follows links. A single-page app
  that moves between screens on a button press gives up its first screen and no more, and
  the note says exactly that instead of reporting a thin application.
- **Anything behind a click.** Modals, drawers, menus and wizards are reachable only by
  pressing something, and pressing things is what this deliberately does not do.
- **Shadow DOM and iframes.** Neither is traversed, so web components and embedded widgets
  are invisible to it.
- **Sign-in beyond a form.** Single sign-on, two factors and magic links are not a username,
  a password and a button.

**The sign-in is verified**, against a local application built for it: a login page with
nothing behind it until you are through. Without the sign-in, one page. With it, three —
the dashboard, the orders and the settings behind the door. It is not verified against a
live site, because that would mean typing a password into one, and that is a person's
action rather than this one's.

That run also found the explorer blaming the wrong thing: a login page and an application
that navigates by script both come back as one page, and it guessed "script" at the login
page. It now tells a door from a dead end and says which it found.

### G2 · Tests · code — M — built

**You can:** Build → Tests · code turns approved cases into a Playwright file at
`<project>/tests/generated.spec.ts`. It runs.

**Three steps, deliberately kept apart.** A writing model reads each step and says what it
does — fill, click, check — and what it is aimed at, *in words*: "the username field". It is
never asked for a selector, because a model inventing `.btn-primary` from prose is guessing
at markup it has not seen. The map says which controls exist. The judge picks which one the
step means. No link in that chain can invent a selector.

**One rule above all others: a test that checks nothing must not pass.** A generated file
full of green ticks that assert nothing is worse than no file, because it buys confidence
nobody earned and nobody looks again. Anything unfinished is written out as `test.fixme`
with the step's own words and a TODO saying what was missing.

**Proved end to end**, against a small application served locally: explored, cases written,
code generated, executed. Two tests passed, the third — a confirmation email — was correctly
marked unfinished, with every step identified as outside a browser. Then the page was
changed so the expected text was gone, and **the test failed**, which is the part that makes
a passing test mean anything.

**Two bugs that only running it could find:**

*Every question was about the wrong step.* The fan-out packs many questions into one
request, and the matcher named its state `step` for every one of them — so each question's
data silently overwrote the last, and all twenty were judged against the final step. The
answers looked perfectly reasonable and were about something else entirely. The same mistake
was in the page-template grouping. Both are fixed, and the fan-out now refuses a request
where two questions name different things alike, before anything is sent. Questions that
share one thing — what class is this scenario, and how automatable — are still allowed.

*Assertions pointed at buttons.* "The page heading reads 'Sign in'" was checking that the
login button contained "Sign in". Checks now only consider headings, text and alerts, and
fall back to checking the whole page when the judge is not sure — a weaker assertion that is
right beats a precise one that is wrong.

### G3 · Runs — M — built

**You can:** Run → Runs plays the tests and says what happened — per case, per step, with
the message and a picture of the page at the moment it failed. "Watch it happen" opens a
real browser window, which is worth doing once: a test nobody has seen run is not yet
evidence of anything.

**The app and CI cannot disagree.** Writing the code and running it both come from one
saved plan in `.testinference/plans/`. Generating them separately would let the two drift,
and a test that behaves differently in the app than in CI is worse than either alone. The
`.spec.ts` file remains the artifact you commit; this is the one that tells you which line
went wrong.

**An unfinished test is never run and never passes.** It stays in the list as unfinished,
which is the truth about it.

**Proved both ways.** Against a working application: two passed, one correctly reported
unfinished. The same tests against an application where one line of text had changed: one
passed, one failed at the exact step, with an 8 KB screenshot of the page. A suite that
cannot fail is not a suite.

**Two things the run taught.** The first failure message was `locator.waitFor: Timeout
15000ms exceeded` — true and useless; it now reads `"Call us." is not on the page`. And a
check waiting fifteen seconds for text that is not there costs fifteen seconds per failing
test, which is how a suite becomes one nobody runs; checks now get five seconds, actions
keep fifteen.

**The whole path, on an application behind a login.** Explored through the sign-in, three
cases written, three run, three passed — and in the middle of it, exactly the drift that
keeping one plan was meant to prevent. A step that said "go" with no address: the written
file fell back to the start, and the runner did not, so the file would have passed and the
run failed. The address is now resolved once, in the plan, which is the only place where
one answer is guaranteed to reach both.

**What is kept, and where.** The result is small text and lives with the project, so a
history exists and travels to git — the same test passing on Monday and failing on Tuesday
is the most useful thing a suite can tell you, and one run cannot show it. The screenshot
is large and binary and goes beside the application's own data, because nobody wants a
megabyte of PNG in a commit.

---

## Running through everything

These are not slices; they are conditions on every slice.

- The fixture tests grow as the engines do, and stay green.
- Every artifact records its model, prompt version and attempt count.
- The spend guard works before the first model call, not after.
- Empty states say what is missing in plain words.
- Nothing leaves the machine except the model call you configured.

---

## The order, and why

A before B, without exception. It is tempting to start with requirement extraction because it demonstrates well, but then the arithmetic is built underneath moving parts and a wrong number can be a bad model or a bad rule, with no way to tell.

B before C. Test Design stands on its own; Test Cases does not.

D last, because change detection needs two runs to compare and the assistant needs data worth asking about.

---

## What I need from you, in order of when

1. The visual style — before B1.
2. A real PRD — for B1.
3. Publishing real or mock — before C3.
4. Jev's API — whenever it exists.

---

*Phases A to D and E1 are built. The lines above about what is still needed are kept
because they are still true of the slices that have not been written.*
