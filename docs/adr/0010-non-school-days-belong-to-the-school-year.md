# Non-school days belong to the school year, not to a Term

A Term owns the Blocks published under it: each recurring event is stamped with the Term's dates and correlated within them (ADR-0006). Non-school days are not like that. A school declares its holidays for the year once, in one artifact; the same Christmas break straddles the boundary between two Terms; and every Term's Intake carries the same Non-school days document. Stamping a Non-school day event with the Term that happened to publish it would make one holiday several events, one per Term, each swept by the other's run.

So a Non-school day event carries no Term. It is stamped `publishedBy=school-schedule`, as every event of the pipeline's is, plus `nonSchoolDay` holding the range's label and `year` holding the calendar year its start date falls in. Those two are its identity, and they are the whole of it: any `apply`, whichever Term it publishes, inserts the events of the ranges it does not find on the calendar and amends the ones it does.

## Considered Options

**The Term stamp Blocks carry** is rejected above: it makes one holiday several events and hands each Term's run the power to sweep another's.

**The range's dates as the identity** — `2026-12-24/2027-01-03` — is rejected because the dates are the thing that moves. A school shifting its Christmas break by a day would leave the old event behind and insert a second, which is the duplication Reconciliation exists to prevent. Under label-and-year, moving or extending a range amends the event in place.

**The label alone** is rejected because a break repeats: the `Коледна ваканция` of 2027 is not the one of 2026, and under a label-only identity publishing next year's Intake would drag this year's event forward onto next year's dates rather than leave the year behind it alone. The year of the *start* date, rather than of the end date, keeps a break that crosses New Year in the year the school's own calendar puts it in.

## Consequences

- **Nothing sweeps a Non-school day event.** A run inserts and updates; it never deletes. No run holds the whole truth about every year on the calendar, and a document that has stopped naming a range is as likely to be another year's Intake as a correction, so staleness cannot be shown. A range taken out of the Intake, and the event orphaned when a range is re-labelled, stay on the calendar until an operator removes them in the Google UI. This is the reverse of how a Block's event is reconciled and is the price of an event no run owns.
- **A label is a name here, not a display choice.** ADR-0006 deliberately keeps Config's Term label out of the stamp, so that rewording it does not rebuild an event. A range's label is the opposite: it comes out of the Intake, it is all there is to identify a holiday by, and rewording it does rebuild.
- **Two ranges sharing a label and a start year are one identity**, so an Intake naming both cannot be published: validation refuses it, naming the label and the year. Distinct ranges want distinct labels, which is what a viewer reading the calendar wants of them anyway.
- **A range need no longer fall inside the Term.** The semantic check that required it goes: the year's holidays are published with whichever Term's Intake is to hand, and most of them fall outside it. A Block's `EXDATE`s are confined to the dates its own recurrence reaches, so a year-wide document does not litter a Term's events with exclusions beyond the Term's end.
