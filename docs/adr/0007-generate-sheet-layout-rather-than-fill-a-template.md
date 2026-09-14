# The sheet layout is generated, not filled into a pre-formatted tab

Publishing to Google Sheets writes the whole layout — merged title rows, merged Break rows, column widths, weekday headers and cell values — via `spreadsheets.batchUpdate`, rather than writing values into a tab whose formatting a human maintains. The row layout is a direct function of the School day: a Break that gains a label gains a row, a Term with a different number of Slots shifts every row beneath it, and each merged Break row spans the full width. A pre-formatted tab cannot absorb any of that.

The layout itself is school-agnostic. Everything that was specific to the originating school — the parameter columns from which lesson and break times were once computed — is gone, because times now come from the Intake. What remains is driven by the School day sequence plus display strings in Config: the Class name, the Term label, and the weekday headers, which are listed explicitly rather than derived from a locale so that their capitalisation and the start of the week are the school's choice.

## Consequences

- Publishing costs substantially more Sheets API surface than writing a values rectangle, and a republish must reapply formatting as well as values.
- `apply` owns exactly one tab, named by a Config template of the Class and Term, creating it when absent and never touching other tabs in the spreadsheet. Renaming that template orphans the previous tab rather than updating it — a visible leftover, in preference to the pipeline deleting a tab it does not recognise.
