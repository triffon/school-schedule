# school-schedule

Publish a school's weekly **Timetable** to Google Calendar and Google Sheets.

A school publishes its timetable as a PDF, a spreadsheet or a web page. Parents and students
want it in their calendars, and the school office wants a printable grid. This pipeline turns
the one into the other — and it does so without parsing anything itself.

## How it works

```
       Sources                      Intake                     Destinations
 ┌─────────────────┐      ┌───────────────────────┐      ┌────────────────────┐
 │ the timetable   │      │ school-day.json       │      │ Google Sheets      │
 │ the school day  │ ───▶ │ timetable.json        │ ───▶ │   the weekly grid  │
 │ the term order  │      │ non-school-days.json  │      │                    │
 │ the holidays    │      │ term.json             │      │ Google Calendar    │
 └─────────────────┘      └───────────────────────┘      │   one recurring    │
                                                         │   event per Block  │
                                                         └────────────────────┘
  an agent reads them        committed JSON, validated      written by the
  against a Parsing Skill    on every run                   deterministic pipeline
```

The layouts of published school artifacts are idiosyncratic and change from year to year, so
the pipeline delegates reading them to an agent (**ADR-0001**). It publishes a JSON Schema and
a library of **Parsing Skills** — prose written for an agent, keyed by publisher and artifact —
and emits a self-contained prompt you paste into an AI chat along with the artifact. The JSON
that comes back is committed to the school's own repository, and everything downstream of it is
ordinary deterministic code.

That makes the **Intake** a trust boundary. It is validated structurally (JSON Schema) and
semantically (Slots contiguous and non-overlapping, every Lesson in a declared Slot, Non-school
days inside the Term); it carries a `schemaVersion` so output from a stale prompt is rejected
rather than misread; and each document records its **Provenance** — the Source, a hash of it,
when it was parsed and by which agent. It is committed rather than cached because reading its
`git diff` is the only defence against a misread cell.

The vocabulary above is not incidental. [CONTEXT.md](CONTEXT.md) defines the domain language —
Slot, Break, Timetable, Lesson, Block, Intake, Source, Config, Destination — and the code, the
docs and the operator-facing messages all use those words and no synonyms.

## Status

Early, and honest about it:

| | |
| --- | --- |
| `prompt` | Works. Emits the parsing prompt for one Source. |
| `validate` | Works. Checks a data repository's Intake, structurally and semantically. |
| `apply` | Renders the Sheets layout, but the real Google clients are not wired up yet, so it cannot reach Google. |
| `init` | Not implemented. |
| Calendar Destination | Designed (ADR-0003, ADR-0004, ADR-0006), not built. |

Nothing is published to npm yet. Google authorisation is the next piece of work.

## Getting started

Node 22 or newer.

```sh
git clone git@github.com:triffon/school-schedule.git
cd school-schedule
git submodule update --init    # the shared Parsing Skill library, mounted at skills/
npm install
```

Run it against a school's data repository — the positional argument every command takes:

```sh
npm run cli -- validate /path/to/some-school
```

Or build and link it, to get the `school-schedule` command itself:

```sh
npm run build && npm link
school-schedule validate /path/to/some-school
```

## The data repository

A school's **Config** and **Intake** live in their own repository (**ADR-0002**), located by
that positional argument. Nothing school-specific is committed here, so one installation serves
several schools and this repository stays publishable.

```
config.json                     # which calendar and spreadsheet, the timezone, display strings
intake/school-day.json          # the ordered Slots and Breaks every day follows
intake/timetable.json           # the recurring weekly pattern of Lessons
intake/non-school-days.json     # labelled date ranges inside the Term
intake/term.json                # the dates the Timetable is in force over
skills/                         # local Parsing Skills, if this school needs any
```

The four Intake documents are separate files because they are re-parsed on different cadences:
the Term and the Non-school days when the ministry publishes its order, the School day and the
Timetable when the school publishes its own. Re-parsing one should not churn the others.

While working on a single school, symlink its repository as `data`, which is gitignored:

```sh
ln -s ../some-school data
npm run school -- validate               # → school-schedule validate data
npm run school -- prompt some-publisher/timetable
```

`npm run school` inserts `data` as the positional argument; `npm run cli` takes the path itself.

## Commands

```
school-schedule <command> <data-repository> [options]
```

**`prompt <data-repository> <publisher>/<artifact> [notes…]`** — emits, on stdout, a
self-contained prompt for turning one Source into one Intake document: the Parsing Skill, the
Intake schema, and what to record about where the artifact came from. Everything said to you
goes to stderr, so the run can be redirected into a file that is nothing but the prompt.
Anything after the Skill's name reaches the agent as a note from you — which of the year's two
Terms is being published, or which Class the Timetable is for.

```sh
school-schedule prompt data ministry-of-education-and-science/term > /tmp/prompt.md
```

**`validate <data-repository>`** — checks the Intake without touching a calendar or a
spreadsheet, which is what to run immediately after pasting agent output into place. Failure is
total and every fault is reported at once, named by file and by JSON path.

**`apply <data-repository>`** — validates the Config and the Intake together, then publishes
the Timetable to the configured Destinations. Both halves are reported together: someone setting
a school up for the first time has both to fill in.

**`init <data-repository>`** — will authorise against Google, let you pick or create a
calendar, and write its identifier into Config. Not implemented yet.

Exit status distinguishes a usage mistake from a run that started and failed: `0` success,
`1` failure, `2` usage.

## Parsing Skills

[`skills/`](skills/) is a git submodule holding the shared
[Parsing Skill library](https://github.com/triffon/school-schedule-parsing-skills). A Skill is
named after its path in it, so `skills/skills/example-school/timetable.md` is the Skill
`example-school/timetable`. Resolution prefers the school's own:

1. `<data-repository>/skills/<name>.md`
2. `<pipeline>/skills/skills/<name>.md` — the shared library

A school whose publisher changed its layout mid-year can fix it locally at once and upstream the
fix afterwards. The Skill format is documented in
[`skills/docs/skill-format.md`](skills/docs/skill-format.md); write Skills in that repository,
not this one.

## Design decisions

The choices that would otherwise be re-litigated, each with its alternatives and their reasons
for rejection, are in [`docs/adr/`](docs/adr/):

| ADR | Decision |
| --- | --- |
| [0001](docs/adr/0001-agent-parses-sources-not-code.md) | Parsing Sources is delegated to an agent, not to code |
| [0002](docs/adr/0002-three-repository-split.md) | Pipeline, Parsing Skills and school data live in three repositories |
| [0003](docs/adr/0003-recurring-events-not-dated-instances.md) | The Calendar is written as recurring events, not dated instances |
| [0004](docs/adr/0004-full-calendar-scope-with-primary-refusal.md) | Full `calendar` scope, guarded by a primary-calendar refusal |
| [0005](docs/adr/0005-typescript-on-node.md) | TypeScript on Node |
| [0006](docs/adr/0006-correlate-events-by-extended-properties.md) | Events are correlated by extended properties, not by client-specified IDs |
| [0007](docs/adr/0007-generate-sheet-layout-rather-than-fill-a-template.md) | The sheet layout is generated, not filled into a pre-formatted tab |
| [0008](docs/adr/0008-blocks-are-the-published-unit.md) | Blocks, not Lessons, are the unit that gets published |

## Development

```sh
npm test           # vitest
npm run test:watch
npm run typecheck
npm run build
```

Tests drive the CLI the way an operator does. Everything the pipeline touches outside itself —
the Google clients, the clock, the Skill library, stdout and stderr — arrives through one
injected `Dependencies` object, so a test asserts on what left the process: the exit status, the
lines written, and the requests the fake clients recorded. The command layer in
[src/command.ts](src/command.ts) is that single seam.

Credentials never belong in a checkout: `credentials.json`, `token.json` and `*-key.json` are
gitignored.

Contributor and agent conventions — the issue tracker, triage labels, and how to edit CONTEXT.md
and the ADRs — are in [CLAUDE.md](CLAUDE.md) and [`docs/agents/`](docs/agents/).

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
