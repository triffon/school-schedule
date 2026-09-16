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
import {
  intakeFiles,
  schoolDayWith,
  SCHOOL_DAY_FILE,
  TIMETABLE_FILE,
  timetable,
} from "./support/intake.js";
import { formatAt, renderedTab, renderedTabs } from "./support/rendered-sheet.js";
import { runCli } from "./support/run-cli.js";

/** The tab the fixture's Config names: `{class} - {term}` filled in. */
const TAB = "5В - Учебна 2025/26 година, I срок";

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
      // A blank row sets the heading off from the grid.
      ["", "", "", "", "", "", "", ""],
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
      // The one labelled Break of the fixture's day, read across the whole
      // width; the unlabelled ones have nothing to say that the times either
      // side of them do not.
      ["голямо междучасие", "", "", "", "", "", "", ""],
      ["09:50", "–", "10:30", "Български език", "Английски език", "История", "", ""],
      ["10:40", "–", "11:10", "Физическо възпитание", "", "", "", ""],
      ["11:20", "–", "11:50", "Музика", "", "", "", ""],
    ]);
  });

  test("the rows are as tall and the columns as wide as what they hold", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(tab.columnWidths).toEqual([43, 15, 43, 176, 176, 176, 176, 176]);
    // The two title rows are left as tall as their own text — how tall 14pt
    // Arial stands is Google's business. Then the blank row, the headers, a
    // Slot row two lines tall for each Slot, and one line for the Break.
    expect(tab.rowHeights).toEqual(["fit", "fit", 41, 21, 42, 42, 21, 42, 42, 42]);
  });
});

describe("a labelled Break", () => {
  test("reads as one band across every weekday no Block is spanning it in", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    // No weekday teaches across this Break, so the band runs the whole width —
    // over the time columns too, and the label with it.
    expect(tab.merges).toContain("A7:H7");
    expect(tab.values[6]).toEqual(["голямо междучасие", "", "", "", "", "", "", ""]);
    expect(formatAt(tab, "A7")).toMatchObject({ textFormat: { italic: true } });
    // It carries no lines of its own, only the frame it sits on.
    expect(formatAt(tab, "A7")).toMatchObject({ borders: { left: expect.anything() } });
    expect(formatAt(tab, "E7")).not.toHaveProperty("borders");
  });

  test("shows its label in every stretch of weekdays it is free in, merged only where they adjoin", async () => {
    const root = await dataRepository({
      ...configFile(),
      ...intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [
            // Monday and Wednesday teach across the Break, leaving Tuesday on
            // its own and Thursday and Friday adjoining each other.
            { weekday: "monday", slot: 2, subject: "Математика" },
            { weekday: "monday", slot: 3, subject: "Математика" },
            { weekday: "wednesday", slot: 2, subject: "Химия" },
            { weekday: "wednesday", slot: 3, subject: "Химия" },
            { weekday: "tuesday", slot: 2, subject: "История" },
          ],
        },
      }),
    });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(tab.values[6]).toEqual(["", "", "", "", "голямо междучасие", "", "голямо междучасие", ""]);
    // Thursday and Friday adjoin, so they are one cell; Tuesday stands alone
    // between the two Blocks and merges with neither.
    expect(tab.merges).toContain("G7:H7");
    expect(tab.merges).not.toContain("E7:H7");
  });

  test("is swallowed where a Block spans it, and the band picks up after", async () => {
    const root = await dataRepository({
      ...configFile(),
      ...intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [
            // Monday teaches the same subject either side of the labelled
            // Break, so its merged cell covers the Break row.
            { weekday: "monday", slot: 2, subject: "Математика" },
            { weekday: "monday", slot: 3, subject: "Математика" },
            { weekday: "tuesday", slot: 2, subject: "История" },
          ],
        },
      }),
    });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    // Monday's Математика runs from the 08:50 row through the Break row to the
    // 09:50 one; the band is left to the four weekdays either side of it.
    expect(tab.merges).toContain("D6:D8");
    expect(tab.merges).toContain("E7:H7");
    expect(tab.values[6]).toEqual(["", "", "", "", "голямо междучасие", "", "", ""]);
  });

  test("shows nowhere at all when every weekday teaches across it", async () => {
    const root = await dataRepository({
      ...configFile(),
      ...intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: config.display.weekdays.flatMap(({ weekday }) => [
            { weekday, slot: 2, subject: "Химия" },
            { weekday, slot: 3, subject: "Химия" },
          ]),
        },
      }),
    });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    // The row is still there — it is what the five merged cells run through —
    // but no column is free to write the label in (ADR-0008).
    expect(tab.values[6]).toEqual(["", "", "", "", "", "", "", ""]);
    expect(tab.merges).toContain("D6:D8");
    expect(tab.merges).toContain("H6:H8");
  });

  test("an unlabelled Break gets no row of its own", async () => {
    const root = await dataRepository({
      ...configFile(),
      ...intakeFiles({
        [SCHOOL_DAY_FILE]: schoolDayWith({
          3: { kind: "break", start: "09:30", end: "09:50" },
        }),
      }),
    });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(tab.values).toHaveLength(9);
    expect(tab.values.map((row) => row[0])).toEqual([
      "5В",
      "Учебна 2025/26 година, I срок",
      "",
      "",
      "08:00",
      "08:50",
      "09:50",
      "10:40",
      "11:20",
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
      "D5:D6",
      "E5:E6",
      // Tuesday ends after three Slots; the rest of the column is one gap.
      "E9:E10",
      // Wednesday's История spans the 10:30 Break, which has no row of its own.
      "F8:F9",
      "G8:G10",
      "H8:H10",
      // The labelled Break's band, made last. No weekday teaches across it, so
      // it runs the whole width of the sheet, time columns included.
      "A7:H7",
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
    // The Break row sits between the second Математика and the third, and the
    // run is broken by История in any case.
    expect(tab.values.slice(4).map((row) => row[3])).toEqual([
      "Математика",
      "История",
      // Monday teaches nothing across the Break, and neither does any other
      // weekday, so the band runs the whole width and its label sits in the
      // first of the time columns rather than in Monday's.
      "",
      "Математика",
      "",
      "",
    ]);
    expect(tab.values[6]?.[0]).toBe("голямо междучасие");
    expect(tab.merges).toEqual([
      "A1:H1",
      "A2:H2",
      // Monday's last two Slots are one gap; the Break above them is not part
      // of it, so the band still reads across.
      "D9:D10",
      // Every other weekday is empty, and its gap stops at the Break row.
      "E5:E6",
      "E8:E10",
      "F5:F6",
      "F8:F10",
      "G5:G6",
      "G8:G10",
      "H5:H6",
      "H8:H10",
      "A7:H7",
    ]);
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
    expect(tab.values).toHaveLength(10);
    expect(tab.values[9]).toEqual(["11:20", "–", "11:50", "", "", "", "", ""]);
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
    expect(tab.merges).toEqual([
      "A1:H1",
      "A2:H2",
      // Химия runs through the labelled Break and swallows its row.
      "D5:D8",
      "D9:D10",
      "E5:E6",
      "E8:E10",
      "F5:F6",
      "F8:F10",
      "G5:G6",
      "G8:G10",
      "H5:H6",
      "H8:H10",
      // Monday is spanned, so the band starts at Tuesday.
      "E7:H7",
    ]);
    expect(tab.values[4]?.[3]).toBe("Химия");
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
    expect(tab.values[3]).toEqual(["", "", "", "ПЕТЪК", "ПОНЕДЕЛНИК"]);
    // Monday's Математика covers both of the first two Slots, so it is written
    // once, in the row the merge keeps; Friday teaches nothing until the second.
    expect(tab.values[4]).toEqual(["08:00", "–", "08:40", "", "Математика"]);
    expect(tab.values[5]).toEqual(["08:50", "–", "09:30", "Изобразително изкуство", ""]);
    expect(tab.columnWidths).toEqual([43, 15, 43, 220, 220]);
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
    // row carries the times of its own Slot rather than a computed stride. The
    // Break row carries no times of its own: the Slots either side of it
    // already say when it runs, and its band has taken the columns over.
    expect(tab.values.slice(4).map((row) => `${row[0]}${row[1]}${row[2]}`)).toEqual([
      "08:00–08:40",
      "08:50–09:30",
      "голямо междучасие",
      "09:50–10:30",
      "10:40–11:10",
      "11:20–11:50",
    ]);
    // Tuesday stops after three Slots and Thursday after two; neither shortens
    // its column, and Monday still runs the full five.
    expect(tab.values.slice(4).map((row) => row[4])).toEqual([
      "Български език",
      "",
      "",
      "Английски език",
      "",
      "",
    ]);
    expect(tab.values[9]?.[3]).toBe("Музика");
  });

  test("the formatting is part of what a republish reapplies, not just the values", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });
    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    expect(formatAt(tab, "A1")).toEqual({
      horizontalAlignment: "CENTER",
      verticalAlignment: "BOTTOM",
      textFormat: { bold: true, fontSize: 14 },
    });
    // The weekday headers stand out from the grid by their shading.
    expect(formatAt(tab, "D4")).toMatchObject({
      textFormat: { bold: true },
      backgroundColor: { red: 217 / 255, green: 217 / 255, blue: 217 / 255 },
    });
    // A subject is the one thing that can outgrow its column.
    expect(formatAt(tab, "D5")).toMatchObject({ wrapStrategy: "WRAP" });
    expect(formatAt(tab, "A5")).not.toMatchObject({ wrapStrategy: "WRAP" });
  });

  test("the grid is ruled, with the three time columns boxed as one", async () => {
    const root = await dataRepository({ ...configFile(), ...intakeFiles() });
    const sheets = spreadsheet();

    await runCli(["apply", root, "--yes"], { sheets });

    const tab = renderedTab(sheets, SPREADSHEET_ID, TAB);
    const rule = { style: "SOLID", width: 1, color: { red: 0, green: 0, blue: 0 } };

    // `08:00 – 08:40` reads as one time, so no line runs between its cells.
    expect(formatAt(tab, "A5")).toMatchObject({
      borders: { top: rule, bottom: rule, left: rule },
    });
    expect(formatAt(tab, "A5")).not.toHaveProperty("borders.right");
    expect(formatAt(tab, "B5")).not.toHaveProperty("borders.left");
    expect(formatAt(tab, "C5")).toMatchObject({ borders: { right: rule } });
    // A subject cell is boxed on all four sides.
    expect(formatAt(tab, "D5")).toMatchObject({
      borders: { top: rule, right: rule, bottom: rule, left: rule },
    });
    // The heading above the grid carries no lines at all.
    expect(formatAt(tab, "A1")).not.toHaveProperty("borders");
    expect(formatAt(tab, "A3")).not.toHaveProperty("borders");
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
