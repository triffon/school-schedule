# The Calendar is written as recurring events, not dated instances

Each Block becomes one recurring Google Calendar event — a few dozen per Timetable — with an `RRULE` bounded by the Term and `EXDATE`s puncturing it for Non-school days. The alternative, one event per dated instance, would mean roughly 900 writes per full rebuild against a quota of 600 requests per minute per user, and Calendar batching does not reduce quota consumption (a batch of *n* counts as *n*). Recurring events cost roughly 35.

The consequence for the domain model is larger than the API saving: there is no concept of a dated lesson instance anywhere in the system. Term bounds and Non-school days exist to bound and puncture the recurrence — a Non-school day is additionally published as a full-day event of its own, so that a free day says why it is free (ADR-0010), but that event names a labelled range rather than a lesson. The Google Sheets destination publishes the weekly grid alone, with no record of either.

## Consequences

- The Calendar is a *projection* of the Intake, not a workspace. Editing an instance in the Google UI forks it into an exception, and the pipeline overwrites the recurring master without detecting or preserving that.
- Re-runs must correlate each existing event with a Lesson in the current Intake or they duplicate on every `apply`. See ADR-0006 for how that correlation is established.
- The `RRULE` is expanded by Google in the event's declared timezone, which is what carries lessons correctly across the daylight-saving shifts that fall inside a school term.
