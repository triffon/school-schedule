import type {
  BatchUpdateRequest,
  GetSpreadsheetRequest,
  SheetsClient,
  Spreadsheet,
} from "../ports/sheets.js";
import { googleApi, type GoogleApiOptions } from "./api.js";
import type { Authorisation } from "./authorisation.js";
import { systemFetch } from "./http.js";
import { SHEETS_SCOPE } from "./scopes.js";

const SHEETS = "https://sheets.googleapis.com/v4/spreadsheets";

/**
 * A spreadsheet can be megabytes of cells, and the pipeline wants only the list
 * of tabs: asking for exactly that keeps a run from downloading the whole thing
 * to read two fields off it.
 */
const TAB_FIELDS = "spreadsheetId,sheets.properties.sheetId,sheets.properties.title";

/** What Google answers a spreadsheet read with, on the way it is understood. */
interface SpreadsheetResource {
  spreadsheetId: string;
  sheets?: { properties?: { sheetId?: number; title?: string } }[];
}

/** The real Google Sheets client, behind the port the pipeline publishes through. */
export function googleSheetsClient(
  authorisation: Authorisation,
  options: GoogleApiOptions = {},
): SheetsClient {
  const api = googleApi("Google Sheets", SHEETS_SCOPE, authorisation, options.fetch ?? systemFetch);

  return {
    async getSpreadsheet(request: GetSpreadsheetRequest): Promise<Spreadsheet> {
      const spreadsheet = await api.get<SpreadsheetResource>(
        `${SHEETS}/${encodeURIComponent(request.spreadsheetId)}?fields=${encodeURIComponent(TAB_FIELDS)}`,
      );

      return {
        spreadsheetId: spreadsheet.spreadsheetId,
        sheets: (spreadsheet.sheets ?? []).map((sheet) => ({
          sheetId: sheet.properties?.sheetId ?? 0,
          title: sheet.properties?.title ?? "",
        })),
      };
    },

    async batchUpdate(request: BatchUpdateRequest): Promise<void> {
      await api.post(
        `${SHEETS}/${encodeURIComponent(request.spreadsheetId)}:batchUpdate`,
        { requests: request.requests },
      );
    },
  };
}
