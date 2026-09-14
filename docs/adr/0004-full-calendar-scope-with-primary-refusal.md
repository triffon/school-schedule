# Calendar access uses the full `calendar` scope, guarded by a primary-calendar refusal

The pipeline must both create a calendar during `init` and attach to a calendar the user already owns, and Google offers no per-calendar consent for Calendar the way the Picker offers per-file consent for Drive. Any scope that reaches a pre-existing calendar reaches every calendar the user owns, so we request `https://www.googleapis.com/auth/calendar` and compensate in code: the pipeline hard-refuses to operate on `primary`, or on any calendar not named in the data repository's Config.

## Considered Options

`https://www.googleapis.com/auth/calendar.app.created` would have made destructive reconciliation physically incapable of touching personal appointments, since it grants access only to calendars created by this OAuth client. It was rejected because it cannot attach to a pre-existing calendar, is not accepted on `calendarList.list` (so it can offer no calendar picker at all), and binds access to the OAuth client ID — re-registering the application would orphan the calendar it had created. Note also that Google documents what that scope allows but never states in prose what it denies, so the restriction is strongly implied rather than documented.
