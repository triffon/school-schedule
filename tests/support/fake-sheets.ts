import type {
  BatchUpdateRequest,
  GetSpreadsheetRequest,
  SheetTab,
  SheetsClient,
  Spreadsheet,
} from "../../src/ports/sheets.js";

export type SheetsRequestRecord =
  | { kind: "getSpreadsheet"; request: GetSpreadsheetRequest }
  | { kind: "batchUpdate"; request: BatchUpdateRequest };

export interface FakeSheetsClient extends SheetsClient {
  /** Every call the command made, in order. */
  readonly requests: SheetsRequestRecord[];
  /** Only the batches, in order — one entry per batch, as the quota counts them. */
  readonly batches: BatchUpdateRequest[];
}

export interface FakeSheetsState {
  /** Spreadsheets the account already owns, keyed by identifier. */
  spreadsheets?: Record<string, SheetTab[]>;
}

export function fakeSheetsClient(state: FakeSheetsState = {}): FakeSheetsClient {
  const requests: SheetsRequestRecord[] = [];
  const spreadsheets = new Map<string, SheetTab[]>(
    Object.entries(state.spreadsheets ?? {}).map(([id, tabs]) => [id, [...tabs]]),
  );

  return {
    requests,

    get batches() {
      return requests
        .filter((record) => record.kind === "batchUpdate")
        .map((record) => record.request);
    },

    async getSpreadsheet(request): Promise<Spreadsheet> {
      requests.push({ kind: "getSpreadsheet", request });
      const tabs = spreadsheets.get(request.spreadsheetId);
      if (tabs === undefined) {
        throw new Error(`no spreadsheet ${request.spreadsheetId}`);
      }
      return { spreadsheetId: request.spreadsheetId, sheets: [...tabs] };
    },

    async batchUpdate(request) {
      requests.push({ kind: "batchUpdate", request });
    },
  };
}
