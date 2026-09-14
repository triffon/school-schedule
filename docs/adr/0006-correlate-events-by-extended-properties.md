# Events are correlated by extended properties, not by client-specified IDs

Every `apply` must decide, for each recurring event already on the calendar, which Block in the current Intake it corresponds to — otherwise re-runs duplicate rather than update. We let Google assign event IDs and stamp each event with private extended properties instead: a key identifying the weekday and the Block's first Slot, and the Term. Reconciliation lists the calendar's events filtered by `privateExtendedProperty`, matches on that key within the current Term, and sweeps events carrying a stale Term.

## Considered Options

Client-specified event IDs derived deterministically from Term, weekday and Slot were the obvious alternative and were rejected:

- **A deleted ID may not be re-insertable.** Google's documentation does not address whether an event ID can be reused after deletion. A Lesson that disappears from the Timetable and later returns is ordinary, and under deterministic IDs that ordinary case may be unrecoverable — a hazard baked into a permanent identifier.
- **Client IDs must be base32hex** — lowercase `a`–`v` and digits `0`–`9` — so weekday names cannot appear in them (`wed` is illegal) and every identifier becomes an encoding to decode when debugging. Extended properties take arbitrary text and are readable in the Google UI.
- **The supposed saving does not exist.** Deterministic IDs would allow reconciliation without reading the calendar, but orphaned events — those whose Lesson has been removed from the Timetable — can only be found by listing anyway. Both approaches cost one `events.list` plus N writes.

A state file in the data repository mapping Lessons to server-assigned IDs was rejected as a second source of truth that drifts silently as soon as anyone deletes an event in the Google UI. Matching on event content was rejected because renaming a subject turns an update into a duplicate.

## Consequences

Correlation depends on the `events.list` query and on the extended properties surviving. If someone strips a property in the Google UI, that event becomes an orphan: it is deleted and recreated rather than updated.
