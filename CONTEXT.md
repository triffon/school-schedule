# School Schedule

A generic pipeline that ingests a school's weekly timetable from external artifacts and publishes it to multiple destinations (Google Sheets, Google Calendar). The pipeline is school-agnostic; a school's own data lives in a separate repository.

## Language

### The time grid

**School day**:
The ordered sequence of Slots and Breaks that every day of the week follows. A property of the school rather than of any one Timetable.
_Avoid_: Daily routine, bell schedule, day template

**Slot**:
A time window in the School day during which a Lesson may be taught, such as 09:30–10:10. Identified by its position among the Slots.
_Avoid_: Period, hour, lesson slot

**Break**:
A time window in the School day between two Slots, during which no Lesson is taught. May carry a label, such as "lunch / supervised rest".
_Avoid_: Gap, interval, recess

**Term**:
The date range over which the Timetable is in force.
_Avoid_: Semester, school year

**Non-school day**:
A date inside the Term on which no Lesson is taught. Declared as a labelled date range rather than as individual dates.
_Avoid_: Holiday, vacation, day off

### The pattern and its instances

**Timetable**:
The recurring weekly pattern: for each weekday and Slot, which Lesson happens.
_Avoid_: Weekly schedule, schedule, rota

**Lesson**:
One cell of the Timetable — a weekday and Slot paired with the subject taught. Recurring and undated; a weekday and Slot identify at most one Lesson, and not every weekday and Slot pair has one.
_Avoid_: Class, session, subject

**Block**:
A maximal run of consecutive Slots on one weekday whose Lessons all name the same subject. Blocks, not individual Lessons, are what Destinations publish, and a Block may span a Break.
_Avoid_: Run, group, double period, merged lesson

**Class**:
A group of students who share a Timetable, such as 5B. Never used to mean a Lesson or an Occurrence.
_Avoid_: Form, grade, group

### The pipeline

**Source**:
An external artifact that is ingested to yield part of the input: Slots, the Timetable, Non-school days, or Term bounds.
_Avoid_: Input file, feed

**Intake**:
The validated, structured data extracted from the Sources — Slots, Timetable, Non-school days and Term bounds — and the sole input to Materialisation. The boundary between untrusted artifacts and the deterministic pipeline.
_Avoid_: Intermediate representation, IR, parsed data, extract

**Provenance**:
The record every Intake document carries of where it came from: the Source's name, a hash of that Source, when it was parsed and by which agent. What tells an operator their Intake is stale once the school republishes.
_Avoid_: Metadata, origin, audit trail

**Parsing Skill**:
Instructions for turning one publisher's artifact into part of an Intake, written for an agent rather than for code.
_Avoid_: Parser, adapter, extractor

**Config**:
A school's settings, held alongside its Intake in the data repository: which calendar and spreadsheet to publish to, the timezone Slot times are interpreted in, and the display choices used when publishing — the Class name, the Term label, the weekday headers and the order they read in, the templates naming the tab to publish into and the two lines the sheet is titled under, and how wide a weekday column is.
_Avoid_: Settings, options, profile

**Destination**:
A place the Timetable is published to. Currently Google Sheets and Google Calendar.
_Avoid_: Output, target, sink

**Reconciliation**:
What makes a re-run converge the calendar on the Intake rather than publish the week a second time: reading the events the pipeline published there before, then inserting what is new, updating what has changed, and deleting what the Timetable no longer has or a previous Term left behind. An unchanged Intake reconciles to no writes at all.
_Avoid_: Sync, diff, upsert, merge
