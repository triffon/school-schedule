/**
 * The slice of Google Sheets the pipeline uses. Layout and values both go out
 * through `batchUpdate`, because Sheets counts a whole batch as one request
 * against the quota.
 */
export interface SheetsClient {
  getSpreadsheet(request: GetSpreadsheetRequest): Promise<Spreadsheet>;
  batchUpdate(request: BatchUpdateRequest): Promise<void>;
}

export interface GetSpreadsheetRequest {
  spreadsheetId: string;
}

export interface Spreadsheet {
  spreadsheetId: string;
  sheets: SheetTab[];
}

/** One tab. The pipeline owns exactly one and leaves every other alone. */
export interface SheetTab {
  sheetId: number;
  title: string;
}

export interface BatchUpdateRequest {
  spreadsheetId: string;
  requests: SheetsRequest[];
}

/**
 * A single Sheets API request within a batch. Left open here: the layout
 * requests the Sheets Destination needs are that ticket's business, not the
 * skeleton's.
 */
export type SheetsRequest = Record<string, unknown>;
