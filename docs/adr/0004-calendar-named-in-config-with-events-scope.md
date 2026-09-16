# The calendar is named in Config, and access is the `calendar.events` scope

The pipeline publishes to exactly one calendar, and the operator names it: `calendarId` is a required Config setting, filled in with an ID copied out of Google Calendar's own settings. Nothing in the pipeline lists, offers or creates calendars, so it never manages a calendar at all and asks only for `https://www.googleapis.com/auth/calendar.events` — reading and writing events on calendars the operator already owns, with no power to create, delete or re-configure one.

## Considered Options

**The full `https://www.googleapis.com/auth/calendar` scope, with `init` creating a calendar or listing the operator's calendars to choose from.** Rejected: a picker costs a listing, a prompt, and a stored choice in order to spare the operator one paste, and it buys that convenience by widening the grant from events to calendar management for the life of the grant. Google offers no per-calendar consent for Calendar the way the Picker offers per-file consent for Drive, so the broader scope reaches every calendar the operator owns however narrowly the pipeline behaves — the narrowing has to come from the scope, because consent will not supply it.

**`https://www.googleapis.com/auth/calendar.app.created`**, which grants access only to calendars created by this OAuth client, would have made destructive reconciliation physically incapable of touching personal appointments. It cannot attach to a calendar that already exists, which is now the only way a calendar is chosen, and it binds access to the OAuth client ID — re-registering the application would orphan the calendar it had created. Note also that Google documents what that scope allows but never states in prose what it denies, so the restriction is strongly implied rather than documented.

## Consequences

- `calendar.events` still reaches every calendar the operator owns, and reconciliation is destructive (ADR-0006): a `calendarId` naming the wrong calendar will sweep that calendar's events. The pipeline makes no check of its own — no refusal of `primary`, no test that the calendar looks like a school's — because the operator naming a calendar explicitly is taken as the decision itself. What the scope buys is that the blast radius stops at events; the grant cannot destroy a calendar.
- A grant stored by an earlier `init` carries the old scope string, and a scope is matched literally rather than by implication, so the full `calendar` grant does not satisfy `calendar.events`. Such a run is refused by name before anything is sent, and re-running `init` repairs it.
