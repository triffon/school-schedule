import { describe, expect, test } from "vitest";
import { dataRepository } from "./support/data-repository.js";
import {
  intakeFiles,
  nonSchoolDays,
  schoolDay,
  term,
  timetable,
  NON_SCHOOL_DAYS_FILE,
  SCHOOL_DAY_FILE,
  TERM_FILE,
  TIMETABLE_FILE,
} from "./support/intake.js";
import { runCli } from "./support/run-cli.js";

describe("an Intake the pipeline accepts", () => {
  test("a fixture covering ragged days and Slots of differing duration validates cleanly", async () => {
    const root = await dataRepository(intakeFiles());

    const result = await runCli(["validate", root]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("is valid: 4 documents against schema version 1");
  });

  test("validating touches neither Google client", async () => {
    const root = await dataRepository(intakeFiles());

    const result = await runCli(["validate", root]);

    expect(result.calendar.requests).toEqual([]);
    expect(result.sheets.requests).toEqual([]);
  });
});

describe("a document that is not there", () => {
  test("is rejected, naming the file the pipeline looked for", async () => {
    const root = await dataRepository(intakeFiles({ [SCHOOL_DAY_FILE]: null }));

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(SCHOOL_DAY_FILE);
    expect(result.stderr).toMatch(/not there|missing|does not exist/i);
  });
});

describe("a document from a different version of the contract", () => {
  test("is rejected, naming both the version the pipeline speaks and the one found", async () => {
    const root = await dataRepository(
      intakeFiles({ [TIMETABLE_FILE]: { ...timetable, schemaVersion: "0" } }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(TIMETABLE_FILE);
    expect(result.stderr).toContain('"1"');
    expect(result.stderr).toContain('"0"');
  });

  test("with no version at all is rejected, naming the missing field", async () => {
    const { schemaVersion: _omitted, ...versionless } = timetable;
    const root = await dataRepository(intakeFiles({ [TIMETABLE_FILE]: versionless }));

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("schemaVersion");
  });
});

describe("provenance", () => {
  test("a document with no provenance block at all is rejected", async () => {
    const { provenance: _omitted, ...unprovenanced } = term;
    const root = await dataRepository(intakeFiles({ [TERM_FILE]: unprovenanced }));

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(TERM_FILE);
    expect(result.stderr).toContain("provenance");
  });

  test("an incomplete provenance block is rejected, naming the field left out", async () => {
    const { sourceHash: _omitted, ...incomplete } = term.provenance;
    const root = await dataRepository(
      intakeFiles({ [TERM_FILE]: { ...term, provenance: incomplete } }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("provenance");
    expect(result.stderr).toContain("sourceHash");
  });

  test("a provenance timestamp that is not a timestamp is rejected", async () => {
    const root = await dataRepository(
      intakeFiles({
        [TERM_FILE]: { ...term, provenance: { ...term.provenance, parsedAt: "last Tuesday" } },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("provenance.parsedAt");
    expect(result.stderr).toContain("last Tuesday");
  });
});

describe("a document the pipeline cannot make sense of", () => {
  test("malformed JSON is rejected, naming the file", async () => {
    const root = await dataRepository(
      intakeFiles({ [TERM_FILE]: '{ "schemaVersion": "1", }' }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(TERM_FILE);
    expect(result.stderr).toMatch(/could not be parsed/i);
  });

  test("a value of the wrong type is rejected, naming the value and what was expected", async () => {
    const root = await dataRepository(
      intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [{ weekday: "monday", slot: "1", subject: "Математика" }],
        },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("lessons[0].slot");
    expect(result.stderr).toContain("integer");
    expect(result.stderr).toContain('"1"');
  });

  test("a missing required field is rejected, naming the field and where it belongs", async () => {
    const root = await dataRepository(
      intakeFiles({
        [TIMETABLE_FILE]: { ...timetable, lessons: [{ weekday: "monday", slot: 1 }] },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("lessons[0]");
    expect(result.stderr).toContain("subject");
  });

  test("a weekday the contract does not know is rejected, listing the ones it does", async () => {
    const root = await dataRepository(
      intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [{ weekday: "Monday", slot: 1, subject: "Математика" }],
        },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("lessons[0].weekday");
    expect(result.stderr).toContain("monday");
    expect(result.stderr).toContain('"Monday"');
  });

  test("a field the contract has no place for is rejected, naming it", async () => {
    const root = await dataRepository(
      intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [{ weekday: "monday", slot: 1, subject: "Математика", teacher: "Иванова" }],
        },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("teacher");
  });

  test("a Slot time that is not a time of day is rejected, naming the offending value", async () => {
    const root = await dataRepository(
      intakeFiles({
        [SCHOOL_DAY_FILE]: {
          ...schoolDay,
          sequence: [{ kind: "slot", start: "8:00", end: "08:40" }],
        },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("sequence[0].start");
    expect(result.stderr).toContain("HH:MM");
    expect(result.stderr).toContain('"8:00"');
  });

  test("a Term bound that is not a real date is rejected", async () => {
    const root = await dataRepository(intakeFiles({ [TERM_FILE]: { ...term, end: "2026-02-30" } }));

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("end");
    expect(result.stderr).toContain("2026-02-30");
  });

  test("a Non-school day range given as a bare date rather than a range is rejected", async () => {
    const root = await dataRepository(
      intakeFiles({ [NON_SCHOOL_DAYS_FILE]: { ...nonSchoolDays, ranges: ["2025-12-24"] } }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(NON_SCHOOL_DAYS_FILE);
    expect(result.stderr).toContain("ranges[0]");
    expect(result.stderr).toContain("2025-12-24");
  });

  test("a Non-school day range with no label is rejected", async () => {
    const root = await dataRepository(
      intakeFiles({
        [NON_SCHOOL_DAYS_FILE]: {
          ...nonSchoolDays,
          ranges: [{ start: "2025-12-24", end: "2026-01-04" }],
        },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ranges[0]");
    expect(result.stderr).toContain("label");
  });
});

describe("a weekday and Slot identifying more than one Lesson", () => {
  test("is rejected, naming the weekday, the Slot and where it was first declared", async () => {
    const root = await dataRepository(
      intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [
            { weekday: "monday", slot: 1, subject: "Математика" },
            { weekday: "tuesday", slot: 1, subject: "Български език" },
            { weekday: "monday", slot: 1, subject: "История" },
          ],
        },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(TIMETABLE_FILE);
    expect(result.stderr).toContain("lessons[2]");
    expect(result.stderr).toContain("monday");
    expect(result.stderr).toContain("lessons[0]");
  });

  test("but the same subject in two Slots on the same weekday is normal", async () => {
    const root = await dataRepository(
      intakeFiles({
        [TIMETABLE_FILE]: {
          ...timetable,
          lessons: [
            { weekday: "monday", slot: 1, subject: "Математика" },
            { weekday: "monday", slot: 2, subject: "Математика" },
          ],
        },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.exitCode).toBe(0);
  });
});

describe("the report", () => {
  test("every document is checked, so one pass shows everything to correct", async () => {
    const root = await dataRepository(
      intakeFiles({
        [TERM_FILE]: { ...term, end: 20260130 },
        [TIMETABLE_FILE]: { ...timetable, lessons: [{ weekday: "monday", slot: 1 }] },
      }),
    );

    const result = await runCli(["validate", root]);

    expect(result.stderr).toContain(TERM_FILE);
    expect(result.stderr).toContain(TIMETABLE_FILE);
  });
});
