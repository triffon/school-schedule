# Parsing Sources is delegated to an agent, not to code

School timetables, holiday calendars and term declarations arrive as PDFs, spreadsheets and web pages whose layouts are idiosyncratic and change from year to year, so the pipeline does not parse them at all. Instead it publishes a JSON Schema and a library of Parsing Skills; an agent turns a Source into an Intake conforming to that schema; and the deterministic pipeline consumes only the Intake. Initially the pipeline emits a self-contained prompt that a human pastes into any AI chat along with the artifact, and the resulting Intake is saved into the data repository by hand.

The Intake is therefore a trust boundary. It is validated both structurally (JSON Schema) and semantically (Slots contiguous and non-overlapping, every Lesson referencing a declared Slot, Non-school days inside the Term), both as hard failures. It carries a `schemaVersion` so that an Intake produced by an outdated prompt is rejected rather than misread, and a provenance block recording the source artifact, a hash of it, the parse date and the agent used.

## Consequences

- The pipeline cannot guarantee an Intake is a faithful reading of its Source. Reviewing the Intake's `git diff` in the data repository is the only defence against a misread cell, which is why the Intake is committed rather than treated as a cache.
- Moving the agent inside the pipeline (an interactive ingest mode) is a later addition that does not change this boundary.
