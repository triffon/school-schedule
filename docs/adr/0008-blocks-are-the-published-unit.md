# Blocks, not Lessons, are the unit that gets published

Consecutive Slots on the same weekday carrying the same subject form a Block, and both Destinations publish Blocks rather than individual Lessons: the Calendar emits one recurring event spanning the whole run, and the sheet renders it as one vertically merged cell. The Intake still records one Lesson per cell — forming Blocks is the pipeline's job, not the transcribing agent's — so a Block is derived, never stated.

A Block may span a Break, and when it does the Break is swallowed: the merged cell covers the Break row, and the Calendar event covers the Break's time. A labelled Break therefore appears in a weekday column only where no Block spans it, which is why a Break row is rendered per-column rather than as one full-width row.

## Considered Options

Publishing one event per Slot was rejected: four adjacent identical events for a single morning of the same subject is calendar noise, and it would have the two Destinations disagree about what a lesson is, since the sheet already presents the run as one cell.

## Consequences

- A Calendar event may cover a Break, so a Block running 08:00–11:20 includes the 20-minute break inside it. This is accepted as an honest rendering of continuous instruction in one subject rather than treated as a defect.
- A Block spans any Break regardless of its length, with no threshold, so the same subject either side of a 75-minute lunch produces one long event. A duration cut-off was rejected as a magic number that would be wrong for some school; the resulting over-long cell is conspicuous in the sheet and is corrected in the Intake.
- Where a Block spans a labelled Break on every weekday, that Break's label does not appear in the sheet at all. This follows from the per-column rendering rule and is intended.
- The correlation key in ADR-0006 identifies a Block by its weekday and its first Slot, so a Block's key changes when the run's start moves.
- Runs of equal values merge whether or not they hold a subject, so consecutive empty cells merge too. Every Slot is rendered as a row even when no weekday has a Lesson in it.
