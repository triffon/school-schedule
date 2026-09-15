import { tabName, type Config } from "../config.js";
import type { Intake } from "../intake/documents.js";
import type { SheetsClient, SheetsRequest } from "../ports/sheets.js";
import { gridOf } from "./grid.js";
import { freeSheetId, layoutRequests, type TargetTab } from "./requests.js";

/**
 * Everything one run would do to the spreadsheet, worked out before anything is
 * sent, so that the operator is shown what is about to change and can still say
 * no.
 */
export interface SheetPlan {
  spreadsheetId: string;
  /** The one tab the pipeline owns; every other tab is left alone. */
  tab: string;
  /** True when that tab is not there yet and this run will create it. */
  creating: boolean;
  requests: SheetsRequest[];
}

/**
 * Reads the spreadsheet, finds the tab Config names — or picks an identifier
 * for one to be created — and builds the batch that regenerates it.
 *
 * Renaming the Config template orphans the tab published under the old name
 * rather than deleting a tab the pipeline no longer recognises.
 */
export async function planSheet(
  client: SheetsClient,
  config: Config,
  intake: Intake,
): Promise<SheetPlan> {
  const spreadsheet = await client.getSpreadsheet({ spreadsheetId: config.spreadsheetId });
  const title = tabName(config.display);
  const existing = spreadsheet.sheets.find((sheet) => sheet.title === title);

  const tab: TargetTab = {
    sheetId: existing?.sheetId ?? freeSheetId(spreadsheet.sheets.map((sheet) => sheet.sheetId)),
    title,
    creating: existing === undefined,
  };

  return {
    spreadsheetId: config.spreadsheetId,
    tab: tab.title,
    creating: tab.creating,
    requests: layoutRequests(gridOf(config, intake), tab),
  };
}

/**
 * Sends the plan as one batch: Sheets counts a whole batch as a single request
 * against the quota, where sending a request per cell would exhaust it.
 */
export async function publishSheet(client: SheetsClient, plan: SheetPlan): Promise<void> {
  await client.batchUpdate({ spreadsheetId: plan.spreadsheetId, requests: plan.requests });
}
