# Google is reached over REST with the platform's `fetch`, not the `googleapis` SDK

The pipeline uses eight operations across two Google APIs, and they are already named as two narrow ports (`CalendarClient`, `SheetsClient`) that the command layer injects. The real implementations of those ports are written against Google's REST endpoints with Node's own `fetch`, and the installed-application OAuth flow — loopback redirect, PKCE, code exchange, refresh — is written the same way. The only dependency this adds is none.

That keeps the pipeline's dependency surface at Ajv, keeps the last hop to the network a one-function seam a test can stand in for, and keeps the shape of a request visible at the call site rather than assembled inside a generated client. The cost is ours to carry: paging, error shapes and the OAuth grant types are hand-written, and a change at Google's end is ours to follow.

## Considered Options

`googleapis` is the obvious alternative and would have supplied typed clients, paging and token refresh outright. It was rejected on size and opacity: the package carries generated clients for every Google API in existence, and what it sends is decided inside a generic request layer rather than at the call site, which is exactly what the two ports exist to make legible. Its authentication half, `google-auth-library`, was the closer call — it implements this very flow — but taking it alone would leave the REST calls hand-written anyway, for one dependency's worth of the work already done here.

This is reversible. The ports are the seam: swapping either implementation for an SDK-backed one is a change to one file and no test.
