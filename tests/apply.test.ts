import { describe, expect, test } from "vitest";
import {
  config,
  configFile,
  configWithDisplay,
  CONFIG_FILE,
  SPREADSHEET_ID,
} from "./support/config.js";
import { dataRepository } from "./support/data-repository.js";
import { fakeSheetsClient, type FakeSheetsClient } from "./support/fake-sheets.js";
import { intakeFiles, TIMETABLE_FILE, timetable } from "./support/intake.js";
import { formatAt, renderedTab, renderedTabs } from "./support/rendered-sheet.js";
import { runCli } from "./support/run-cli.js";

/** The tab the fixture's Config names: `{class} — {term}` filled in. */
const TAB = "5В — Учебна 2025/26 година, I срок";

/** A spreadsheet the operator already keeps other things in. */
function spreadsheet(tabs = [{ sheetId: 0, title: "Бележки" }]) {
  return fakeSheetsClient({ spreadsheets: { [SPREADSHEET_ID]: tabs } });
}

describe("an Intake apply will not publish", () => {
  test("a Lesson in an undeclared Slot fails the run, naming the file", async () => {
    const root = await dataRepository({
      ...configFile(),
      ...intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [...timetable.lessons, { weekday: "friday", slot: 9, subject: "Химия" }],
        },
      }),
    });

    const result = await runCli(["apply", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(TIMETABLE_FILE);
    expect(result.stderr).toContain("Slot 9");
  });

  test("nothing reaches the spreadsheet when the Intake does not validate", async () => {
    const root = await dataRepository({
      ...configFile(),
      ...intakeFiles({ [TIMETABLE_FILE]: null }),
    });

    const result = await runCli(["apply", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.sheets.requests).toEqual([]);
  });
});

describe("a Config apply cannot publish against", () => {
  test("a Config that is not there fails the run, naming the file", async () => {
    const root = await dataRepository(intakeFiles());

    const result = await runCli(["apply", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(CONFIG_FILE);
    expect(result.sheets.requests).toEqual([]);
  });

  test("a Config naming no spreadsheet fails, saying what was expected", async () => {
    const root = await dataRepository({
      ...configFile({ ...config, spreadsheetId: "" }),
      ...intakeFiles(),
    });

    const result = await runCli(["apply", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("spreadsheetId");
    expect(result.sheets.requests).toEqual([]);
  });

  test("a Config with no weekday to render fails, saying what was expected", async () => {
    const root = await dataRepository({
      ...configFile(configWithDisplay({ weekdays: [] })),
      ...intakeFiles(),
    });

    const result = await runCli(["apply", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("display.weekdays");
  });

  test("a weekday the Intake never names fails, listing the weekdays there are", async () => {
    const root = await dataRepository({
      ...configFile(
        configWithDisplay({ weekdays: [{ weekday: "funday", header: "Веселник" }] }),
      ),
      ...intakeFiles(),
    });

    const result = await runCli(["apply", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("funday");
    expect(result.stderr).toContain("monday");
  });

  test("a Config fault is reported together with an Intake fault, so one pass shows both", async () => {
    const root = await dataRepository({
      ...configFile({ ...config, spreadsheetId: "" }),
      ...intakeFiles({ [TIMETABLE_FILE]: null }),
    });

    const result = await runCli(["apply", root]);

    expect(result.stderr).toContain(CONFIG_FILE);
    expect(result.stderr).toContain(TIMETABLE_FILE);
  });
});

describe("the weekly grid", () => {
  test("reads times down the left and weekdays across the top, one row per Slot", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    const result = await runCli(["apply", root, "--yes"], { sheets });

    expect(result.exitCode).toBe(0);
    expect(renderedTab(sheets, SPREADSHEET_ID, TAB).values).toEqual([
      ["5В", "", "", "", "", "", "", ""],
      ["Учебна 2025/26 година, I срок", "", "", "", "", "", "", ""],
      ["", "", "", "Понеделник", "Вторник", "Сряда", "Четвъртък", "Петък"],
      [
        "08:00",
        "–",
        "08:40",
        "Математика",
        "Български език",
        "Математика",
        "Английски език",
        "",
      ],
      ["08:50", "–", "09:30", "", "", "", "Технологии", "Изобразително изкуство"],
      ["09:50", "–", "10:30", "Български език", "Английски език", "История", "", ""],
      ["10:40", "–", "11:10", "Физическо възпитание", "", "", "", ""],
      ["11:20", "–", "11:50", "Музика", "", "", "", ""],
    ]);
  });
});

describe("Blocks in the grid", () => {
  test("every merge the fixture week needs, and no other", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    expect(renderedTab(sheets, SPREADSHEET_ID, TAB).merges).toEqual([
      // The two title rows, each across the whole width.
      "A1:H1",
      "A2:H2",
      // Monday's double Математика, and Tuesday's double Български език.
      "D4:D5",
      "E4:E5",
      // Tuesday ends after three Slots; the rest of the column is one gap.
      "E7:E8",
      // Wednesday's История spans the 09:30 Break and the 10:30 one.
      "F6:F7",
      "G6:G8",
      "H6:H8",
    ]);
  });

  test("a subject repeating non-consecutively on the same weekday does not merge", async () => {
    const root = await dataRepository({
      ...configFile(),
      ...intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [
            { weekday: "monday", slot: 1, subject: "Математика" },
            { weekday: "monday", slot: 2, subject: "История" },
            { weekday: "monday", slot: 3, subject: "Математика" },
          ],
        },
      }),
    });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(tab.values.slice(3).map((row) => row[3])).toEqual([
      "Математика",
      "История",
      "Математика",
      "",
      "",
    ]);
    expect(tab.merges).toEqual(["A1:H1", "A2:H2", "D7:D8", "E4:E8", "F4:F8", "G4:G8", "H4:H8"]);
  });

  test("a Slot no weekday teaches in still gets a row of its own", async () => {
    const root = await dataRepository({
      ...configFile(),
      ...intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: timetable.lessons.filter((lesson) => lesson.slot < 5),
        },
      }),
    });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(tab.values).toHaveLength(8);
    expect(tab.values[7]).toEqual(["11:20", "–", "11:50", "", "", "", "", ""]);
  });
});

describe("the one tab the pipeline owns", () => {
  test("is created when it is not there, and nothing else in the spreadsheet is written to", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet([
      { sheetId: 0, title: "Бележки" },
      { sheetId: 3, title: "Миналият срок" },
    ]);

    await runCli(["apply", root, "--yes"], { sheets });

    const tabs = renderedTabs(sheets, SPREADSHEET_ID);
    expect(tabs.get(TAB)?.created).toBe(true);
    expect(tabs.get("Бележки")?.written).toBe(false);
    expect(tabs.get("Миналият срок")?.written).toBe(false);
  });

  test("is rewritten in place when it is already there, rather than added again", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet([
      { sheetId: 0, title: "Бележки" },
      { sheetId: 7, title: TAB },
    ]);

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(tab.created).toBe(false);
    expect(tab.sheetId).toBe(7);
    expect(tab.values[0]?.[0]).toBe("5В");
  });

  test("republishing a changed week reapplies the merges rather than stacking them", async () => {
    const sheets = spreadsheet();
    const first = await dataRepository({ ...configFile(), ...intakeFiles() });

    await runCli(["apply", first, "--yes"], { sheets });

    const second = await dataRepository({
      ...configFile(),
      ...intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [
            { weekday: "monday", slot: 1, subject: "Химия" },
            { weekday: "monday", slot: 2, subject: "Химия" },
            { weekday: "monday", slot: 3, subject: "Химия" },
          ],
        },
      }),
    });

    await runCli(["apply", second, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(tab.merges).toEqual(["A1:H1", "A2:H2", "D4:D6", "D7:D8", "E4:E8", "F4:F8", "G4:G8", "H4:H8"]);
    expect(tab.values[3]?.[3]).toBe("Химия");
  });

  test("a tab published under a previous name is left alone rather than deleted", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet([{ sheetId: 4, title: "5В — миналата година" }]);

    await runCli(["apply", root, "--yes"], { sheets });

    expect(renderedTabs(sheets, SPREADSHEET_ID).get("5В — миналата година")?.written).toBe(false);
  });
});

describe("what the school decides", () => {
  test("the weekday columns are the ones Config lists, in its order and under its headers", async () => {
    const root = await dataRepository({
      ...configFile(
        configWithDisplay({
          weekdays: [
            { weekday: "friday", header: "ПЕТЪК" },
            { weekday: "monday", header: "ПОНЕДЕЛНИК" },
          ],
          weekdayColumnWidth: 220,
        }),
      ),
      ...intakeFiles(),
    });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(tab.values[2]).toEqual(["", "", "", "ПЕТЪК", "ПОНЕДЕЛНИК"]);
    // Monday's Математика covers both of the first two Slots, so it is written
    // once, in the row the merge keeps; Friday teaches nothing until the second.
    expect(tab.values[3]).toEqual(["08:00", "–", "08:40", "", "Математика"]);
    expect(tab.values[4]).toEqual(["08:50", "–", "09:30", "Изобразително изкуство", ""]);
    expect(tab.columnWidths).toEqual([64, 24, 64, 220, 220]);
  });

  test("the tab is named by the Config template, with the Class and the Term filled in", async () => {
    const root = await dataRepository({
      ...configFile(configWithDisplay({ tab: "{class} ({term})" })),
      ...intakeFiles(),
    });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    expect([...renderedTabs(sheets, SPREADSHEET_ID).keys()]).toContain(
      "5В (Учебна 2025/26 година, I срок)",
    );
  });
});

describe("what leaves the process", () => {
  test("the whole layout goes out as one batch, not a request per cell", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    expect(sheets.batches).toHaveLength(1);
    expect(sheets.batches[0]?.requests.length).toBeGreaterThan(8);
  });
});

describe("the confirmation", () => {
  test("a summary of what is about to change is printed before anything is asked", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    const result = await runCli(["apply", root], { sheets, confirm: true });

    expect(result.stdout).toContain(SPREADSHEET_ID);
    expect(result.stdout).toContain(TAB);
    expect(result.stdout).toContain("5 Slots");
    expect(result.stdout).toContain("14 Lessons");
    expect(result.questions).toHaveLength(1);
  });

  test("nothing is written when the operator declines", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    const result = await runCli(["apply", root], { sheets, confirm: false });

    expect(result.exitCode).not.toBe(0);
    expect(sheets.batches).toEqual([]);
    expect(`${result.stdout}${result.stderr}`).toMatch(/nothing has been published/i);
  });

  test("the skip flag publishes without asking anything", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    const result = await runCli(["apply", root, "--yes"], { sheets });

    expect(result.exitCode).toBe(0);
    expect(result.questions).toEqual([]);
    expect(sheets.batches).toHaveLength(1);
  });

  test("an argument apply does not know is a usage mistake, not a silent publish", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    const result = await runCli(["apply", root, "--force"], { sheets });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--force");
    expect(sheets.requests).toEqual([]);
  });
});

describe("a grid that prints", () => {
  test("ragged days and Slots of differing duration render as themselves", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    // The first three Slots are 40 minutes long and the last two 30, and each
    // row carries the times of its own Slot rather than a computed stride.
    expect(tab.values.slice(3).map((row) => `${row[0]}${row[1]}${row[2]}`)).toEqual([
      "08:00–08:40",
      "08:50–09:30",
      "09:50–10:30",
      "10:40–11:10",
      "11:20–11:50",
    ]);
    // Tuesday stops after three Slots and Thursday after two; neither shortens
    // its column, and Monday still runs the full five.
    expect(tab.values.slice(3).map((row) => row[4])).toEqual([
      "Български език",
      "",
      "Английски език",
      "",
      "",
    ]);
    expect(tab.values[7]?.[3]).toBe("Музика");
  });

  test("the formatting is part of what a republish reapplies, not just the values", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });
    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(formatAt(tab, "A1")).toEqual({
      horizontalAlignment: "CENTER",
      verticalAlignment: "MIDDLE",
      textFormat: { bold: true, fontSize: 14 },
    });
    expect(formatAt(tab, "D3")).toMatchObject({ textFormat: { bold: true } });
    // A subject is the one thing that can outgrow its column.
    expect(formatAt(tab, "D4")).toMatchObject({ wrapStrategy: "WRAP" });
    expect(formatAt(tab, "A4")).not.toMatchObject({ wrapStrategy: "WRAP" });
  });
});

/**
 * A Destination that will not have the run is the operator's problem in the
 * same way a bad Config is: nothing published, one thing to put right.
 */
describe("a Destination apply cannot reach", () => {
  /** A Sheets client that refuses everything, as an unauthorised one does. */
  function refusing(why: string): FakeSheetsClient {
    const refuse = async (): Promise<never> => {
      throw new Error(why);
    };
    return {
      requests: [],
      batches: [],
      tabsOf: () => [],
      getSpreadsheet: refuse,
      batchUpdate: refuse,
    };
  }

  test("fails with what Google said, and says that nothing has been published", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = refusing(
      "school-schedule: Google Sheets refused the request — 403 PERMISSION_DENIED: no permission",
    );

    const result = await runCli(["apply", root, "--yes"], { sheets });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("PERMISSION_DENIED");
    expect(result.stderr).toMatch(/Nothing has been published/);
  });

  test("a data repository that was never authorised is told to run init", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = refusing(
      "school-schedule: this data repository has not been authorised against Google\n" +
        "Run `school-schedule init` once, and no later run will ask again.",
    );

    const result = await runCli(["apply", root, "--yes"], { sheets });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("init");
    expect(result.stdout).not.toContain("Published");
  });
});
