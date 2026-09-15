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
  /** The tabs a spreadsheet already had, before anything the run sent it. */
  tabsOf(spreadsheetId: string): SheetTab[];
}

export interface FakeSheetsState {
  /** Spreadsheets the account already owns, keyed by identifier. */
  spreadsheets?: Record<string, SheetTab[]>;
}

/** The tabs an `addSheet` in this batch asks for, as the spreadsheet will hold them. */
function tabsAddedBy(request: BatchUpdateRequest): SheetTab[] {
  return request.requests.flatMap((each) => {
    const properties = (each["addSheet"] as { properties?: SheetTab } | undefined)?.properties;
    return properties === undefined ? [] : [{ sheetId: properties.sheetId, title: properties.title }];
  });
}

export function fakeSheetsClient(state: FakeSheetsState = {}): FakeSheetsClient {
  const requests: SheetsRequestRecord[] = [];
  const seeded = new Map<string, SheetTab[]>(
    Object.entries(state.spreadsheets ?? {}).map(([id, tabs]) => [id, [...tabs]]),
  );
  // What the spreadsheet holds now: the tabs it was seeded with plus any the run
  // has created, so that a second run reads the tab the first one added.
  const spreadsheets = new Map<string, SheetTab[]>(
    [...seeded].map(([id, tabs]) => [id, [...tabs]]),
  );

  return {
    requests,

    get batches() {
      return requests
        .filter((record) => record.kind === "batchUpdate")
        .map((record) => record.request);
    },

    tabsOf(spreadsheetId) {
      return [...(seeded.get(spreadsheetId) ?? [])];
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
      const tabs = spreadsheets.get(request.spreadsheetId);
      if (tabs === undefined) throw new Error(`no spreadsheet ${request.spreadsheetId}`);
      tabs.push(...tabsAddedBy(request));
    },
  };
}
