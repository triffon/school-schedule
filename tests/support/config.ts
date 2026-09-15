/**
 * A complete, valid Config for the same school the Intake fixture describes.
 * Every `apply` test starts from this and breaks or bends exactly one thing.
 */

export const CONFIG_FILE = "config.json";

export const SPREADSHEET_ID = "spreadsheet-of-the-school";

export const config = {
  timezone: "Europe/Sofia",
  calendarId: "school@group.calendar.google.com",
  spreadsheetId: SPREADSHEET_ID,
  display: {
    class: "5В",
    term: "Учебна 2025/26 година, I срок",
    weekdays: [
      { weekday: "monday", header: "Понеделник" },
      { weekday: "tuesday", header: "Вторник" },
      { weekday: "wednesday", header: "Сряда" },
      { weekday: "thursday", header: "Четвъртък" },
      { weekday: "friday", header: "Петък" },
    ],
  },
};

/** The fixture with `display` fields replaced, which is what most tests bend. */
export function configWithDisplay(display: Record<string, unknown>): object {
  return { ...config, display: { ...config.display, ...display } };
}

/** The fixture as the one file a data repository holds it in. */
export function configFile(overrides?: unknown): Record<string, string | object> {
  return { [CONFIG_FILE]: (overrides ?? config) as object };
}
