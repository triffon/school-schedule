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
| `init` | Works. Authorises against Google in the browser, once, and stores the grant. |
| `apply` | Works. Publishes the weekly grid to a real Google spreadsheet. |
| Calendar Destination | Designed (ADR-0003, ADR-0004, ADR-0006), not built. Its scope is granted, and nothing uses it yet. |

Nothing is published to npm yet. Choosing the calendar to publish to — and the refusals that
bound what the granted scope may reach — is the next piece of work.

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
config.json                     # which calendar and spreadsheet, the timezone, display choices
intake/school-day.json          # the ordered Slots and Breaks every day follows
intake/timetable.json           # the recurring weekly pattern of Lessons
intake/non-school-days.json     # labelled date ranges inside the Term
intake/term.json                # the dates the Timetable is in force over
skills/                         # local Parsing Skills, if this school needs any
credentials.json                # the OAuth client to authorise as — never committed
token.json                      # what init was granted — never committed
```

**Config** is the school's half of a run — everything the pipeline cannot derive from the Intake:

```json
{
  "timezone": "Europe/Sofia",
  "calendarId": "school@group.calendar.google.com",
  "spreadsheetId": "1AbC…",
  "display": {
    "class": "5В",
    "term": "Учебна 2025/26 година, I срок",
    "weekdays": [
      { "weekday": "monday", "header": "Понеделник" },
      { "weekday": "tuesday", "header": "Вторник" }
    ],
    "tab": "{class} - {term}",
    "title": "{class}",
    "subtitle": "{term}",
    "weekdayColumnWidth": 176
  }
}
```

Each weekday names itself as the Intake does and carries the header it is rendered under, so
which weekdays get a column, in what order and with what capitalisation is the school's choice
rather than a locale's.

`tab`, `title` and `subtitle` are templates over `{class}` and `{term}`: the first names the one
tab `apply` owns, the other two the two lines the sheet is printed under. They are templates
rather than the strings themselves because a sheet meant to be handed to a child is titled the
way a person would say it — `"Седмична програма на {class}"` — while `class` stays the short
name every Calendar event title carries.

All three, `weekdayColumnWidth` and `timezone` may be left out and default to what is shown
above. A setting the Config has no field for is reported rather than ignored, because a
misspelled one is otherwise indistinguishable from an unset one.

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

**`init <data-repository>`** — authorises against Google. It opens a consent screen in your
browser, which comes back to a loopback address the run is listening on, and writes what Google
granted — the refresh token and the scopes — to `token.json` in the data repository. Every run
after it reaches Google without asking you anything, refreshing the access token silently when
it has expired. Re-running re-authorises and replaces what was stored, which is how a revoked
grant or a withheld scope is repaired.

```sh
school-schedule init data
```

Both scopes are asked for at once — `spreadsheets` and the full `calendar` (**ADR-0004**) — so
that adopting the Calendar Destination later costs no second consent screen. A run needing a
scope the stored grant does not carry is refused before anything is sent, naming the scope.

It authorises as an **OAuth client of your own**: an OAuth 2.0 Client ID of type *Desktop app*,
registered in a Google Cloud project with the Sheets and Calendar APIs enabled, downloaded from
the console as JSON and saved as `credentials.json` in the data repository. A service account
key is the other JSON Google hands out under that name and will not do — a service account
cannot consent on your behalf, and `init` says so rather than failing obscurely.

Neither file is ever committed: `init` makes sure the data repository's `.gitignore` names the
token before it writes it, and writes it readable only by you.

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

**`apply <data-repository> [--yes]`** — validates the Config and the Intake together, prints
what it is about to change, and publishes only once you have agreed to it. Both halves are
reported together: someone setting a school up for the first time has both to fill in.

It writes the weekly grid — times down the left, weekdays across the top, one row per Slot, and
each Block one vertically merged cell — into exactly one tab, the one `display.tab` names,
created when it is not there. Every other tab in the spreadsheet is left alone, including one
orphaned by renaming that template. The layout is regenerated whole on every run — merges,
ruling, shading, column widths and row heights as well as values — and goes out as a single
batch, which is what the Sheets quota counts.

A labelled Break gets a row of its own, shaded and captioned, across every weekday no Block is
spanning it in; an unlabelled one gets none, having nothing to say that the Slot times either
side of it do not.

```sh
school-schedule apply data           # summarises, then asks
school-schedule apply data --yes     # for a run with nobody at the terminal
```

Exit status distinguishes a usage mistake from a run that started and failed: `0` success,
`1` failure, `2` usage. Declining `apply`'s question publishes nothing and exits `1`, so a run
that was never agreed to cannot be mistaken for one that published.

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
| [0009](docs/adr/0009-google-over-rest-with-the-platforms-fetch.md) | Google is reached over REST with the platform's `fetch`, not the `googleapis` SDK |

## Development

```sh
npm test           # vitest
npm run test:watch
npm run typecheck
npm run build
```

Tests drive the CLI the way an operator does. Everything the pipeline touches outside itself —
the Google clients, the clock, the Skill library, stdout and stderr, and the question `apply`
stops to ask — arrives through one injected `Dependencies` object, so a test asserts on what
left the process: the exit status, the lines written, and the requests the fake clients
recorded. The command layer in [src/command.ts](src/command.ts) is that seam.

`init` is the exception, and says so: it is the one command that has to reach outside before
there is anything to inject — it listens on a loopback socket and opens a browser at Google's
consent screen. Its own seam is one layer down, at `authoriseInBrowser`
([src/google/authorise.ts](src/google/authorise.ts)), whose `invite` stands for "put this in
front of the operator". A test consents by fetching the loopback address the consent URL named,
so the whole flow runs locally but for Google's two endpoints.

Sheets requests are asserted through a renderer that applies them the way Sheets would
([tests/support/rendered-sheet.ts](tests/support/rendered-sheet.ts)), so a case reads as the
grid a person would see — values, merges in A1 notation, formats, column widths — rather than
as a heap of wire JSON.

The last hop to the network is one narrow function, `HttpFetch`, so the real Google clients are
tested by handing them a stand-in and asserting on what would have gone out
([tests/google-clients.test.ts](tests/google-clients.test.ts)). Google is reached over REST
rather than through the `googleapis` SDK (**ADR-0009**).

Credentials never belong in a checkout: `credentials.json`, `token.json` and `*-key.json` are
gitignored, here and in a data repository.

Contributor and agent conventions — the issue tracker, triage labels, and how to edit CONTEXT.md
and the ADRs — are in [CLAUDE.md](CLAUDE.md) and [`docs/agents/`](docs/agents/).

## Licence

GPL-3.0-or-later. See [LICENSE](LICENSE).
