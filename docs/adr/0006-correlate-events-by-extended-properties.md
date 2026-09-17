# Events are correlated by extended properties, not by client-specified IDs

Every `apply` must decide, for each event already on the calendar, which Block in the current Intake it corresponds to — otherwise re-runs duplicate rather than update. We let Google assign event IDs and stamp each event with private extended properties instead: `publishedBy=school-schedule`, which says the event is the pipeline's own whatever else it holds; a key identifying the weekday and the Block's first Slot; and the Term. Reconciliation lists the calendar's events filtered on `publishedBy` — one listing, and one that does not return an operator's own events — then matches each on weekday and Slot within the current Term, and sweeps events carrying a stale Term. The filter needs a property every event of ours shares and nobody else's carries: a Block key differs per event, and a Term key cannot find the Terms being swept, so neither can stand in for it.

Not every event of the pipeline's is a Block's. A Non-school day is published as a full-day event stamped `nonSchoolDay` and `year` in place of `block` and `term`, because it belongs to the school year rather than to a Term (ADR-0010). What holds for both is `publishedBy`: one listing still returns everything of ours, and each kind then correlates on the stamp it carries, so a Block event and a Non-school day event never correlate with one another.

## Considered Options

Client-specified event IDs derived deterministically from Term, weekday and Slot were the obvious alternative and were rejected:

- **A deleted ID may not be re-insertable.** Google's documentation does not address whether an event ID can be reused after deletion. A Lesson that disappears from the Timetable and later returns is ordinary, and under deterministic IDs that ordinary case may be unrecoverable — a hazard baked into a permanent identifier.
- **Client IDs must be base32hex** — lowercase `a`–`v` and digits `0`–`9` — so weekday names cannot appear in them (`wed` is illegal) and every identifier becomes an encoding to decode when debugging. Extended properties take arbitrary text and are readable in the Google UI.
- **The supposed saving does not exist.** Deterministic IDs would allow reconciliation without reading the calendar, but orphaned events — those whose Lesson has been removed from the Timetable — can only be found by listing anyway. Both approaches cost one `events.list` plus N writes.

A state file in the data repository mapping Lessons to server-assigned IDs was rejected as a second source of truth that drifts silently as soon as anyone deletes an event in the Google UI. Matching on event content was rejected because renaming a subject turns an update into a duplicate.

## Consequences

Correlation depends on the `events.list` query and on the extended properties surviving. If someone strips a property in the Google UI, that Block's event becomes an orphan: it is deleted and recreated rather than updated. A Non-school day event that loses part of its stamp is not deleted, because nothing sweeps one (ADR-0010); it is left where it is and its range published alongside it. An event that has lost `publishedBy` itself is worse than an orphan — no listing returns it, so it is left where it is and its Block published alongside it.

Whether an event still says what the Intake says is decided by comparing what the pipeline itself writes, and Google does not hand back everything as it was sent: a wall-clock time comes back with the zone's offset appended. Comparison is on the wall clock, and on the exclusion dates rather than on how the `EXDATE` lines group them, so that a re-run of an unchanged Intake writes nothing.
