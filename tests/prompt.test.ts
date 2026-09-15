import { describe, expect, test } from "vitest";
import { INTAKE_SCHEMA, SCHEMA_VERSION } from "../src/intake/schema.js";
import { dataRepository } from "./support/data-repository.js";
import { fixedClock } from "./support/fixed-clock.js";
import { runCli } from "./support/run-cli.js";
import { skillLibrary, skillText, uninitialisedSkillLibrary } from "./support/skill-library.js";

/**
 * The JSON the prompt embeds, read back out of it the way an agent reads it:
 * the one fenced block in the section that introduces the schema.
 */
function schemaEmbeddedIn(prompt: string): unknown {
  const fenced = /## The Intake schema\n[\s\S]*?```json\n([\s\S]*?)\n```/.exec(prompt);
  if (fenced?.[1] === undefined) throw new Error("the prompt embeds no JSON schema");
  return JSON.parse(fenced[1]);
}

describe("the emitted prompt", () => {
  test("embeds the Intake JSON Schema verbatim", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable"),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], { skillLibrary: shared });

    expect(result.exitCode).toBe(0);
    // Read back out of the prompt the way an agent reads it, so this says the
    // whole contract arrived and not merely that some rendering of it did.
    expect(schemaEmbeddedIn(result.stdout)).toEqual(INTAKE_SCHEMA);
  });

  test("includes the text of the resolved Parsing Skill", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText(
        "example-school/timetable",
        {},
        "## Quirks\n\nA blank cell means no Lesson, never the subject above it.\n",
      ),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("A blank cell means no Lesson, never the subject above it.");
  });

  test("names the publisher and artifact the Skill's frontmatter declares", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable", {
        publisher: "Първа частна математическа гимназия",
        artifact: "The weekly timetable pinned to the noticeboard each August",
      }),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    expect(result.stdout).toContain("Първа частна математическа гимназия");
    expect(result.stdout).toContain("The weekly timetable pinned to the noticeboard each August");
  });

  test("says which Intake document to produce and where it goes", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "ministry/term": skillText("ministry/term", { document: "term" }),
    });

    const result = await runCli(["prompt", root, "ministry/term"], { skillLibrary: shared });

    expect(result.stdout).toContain("The Term: one JSON document");
    expect(result.stdout).toContain("to be saved as `intake/term.json`");
  });

  test("asks for every field of the provenance block", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable"),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
      clock: fixedClock("2026-09-15T17:21:23.000Z"),
    });

    // Named one by one rather than looped over the schema, so that a field
    // added to the contract fails here until the prompt asks for it too.
    expect(result.stdout).toContain("`source`");
    expect(result.stdout).toContain("`sourceHash`");
    expect(result.stdout).toContain("`parsedAt`");
    expect(result.stdout).toContain("`agent`");
    expect(INTAKE_SCHEMA.$defs.provenance.required).toEqual([
      "source",
      "sourceHash",
      "parsedAt",
      "agent",
    ]);
  });

  test("offers its own emission time for the parse timestamp, from the run's clock", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable"),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
      clock: fixedClock("2026-09-15T17:21:23.000Z"),
    });

    expect(result.stdout).toContain("2026-09-15T17:21:23.000Z");
  });

  test("carries through what the operator added after the Skill's name", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/term": skillText("example-school/term", { document: "term" }),
    });

    const result = await runCli(["prompt", root, "example-school/term", "публикувам І-ви срок"], {
      skillLibrary: shared,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("публикувам І-ви срок");
  });

  test("goes to stdout alone, so that a run can be redirected into a file", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable"),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    expect(result.stdout).toContain("# Parse one artifact into one Intake document");
    expect(result.stderr).not.toContain("# Parse one artifact into one Intake document");
  });

  test("reaches neither Google client — nothing is published by emitting a prompt", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable"),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    expect(result.calendar.requests).toEqual([]);
    expect(result.sheets.requests).toEqual([]);
  });
});

describe("resolving the Parsing Skill", () => {
  test("a Skill in the data repository is preferred to one of the same name in the library", async () => {
    const root = await dataRepository({
      "skills/example-school/timetable.md": skillText(
        "example-school/timetable",
        {},
        "## Quirks\n\nThe school moved the times column to the right in January.\n",
      ),
    });
    const shared = await skillLibrary({
      "example-school/timetable": skillText(
        "example-school/timetable",
        {},
        "## Quirks\n\nThe times column is on the left.\n",
      ),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("The school moved the times column to the right in January.");
    expect(result.stdout).not.toContain("The times column is on the left.");
  });

  test("a Skill in neither place fails, naming it and both places searched", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable"),
    });

    const result = await runCli(["prompt", root, "example-school/school-day"], {
      skillLibrary: shared,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("example-school/school-day");
    expect(result.stderr).toContain(`${root}/skills/example-school/school-day.md`);
    expect(result.stderr).toContain(`${shared}/skills/example-school/school-day.md`);
  });

  test("an uninitialised shared library says how to initialise it", async () => {
    const root = await dataRepository();
    const uninitialised = await uninitialisedSkillLibrary();

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: uninitialised,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("git submodule update --init");
  });

  test("an initialised library that simply lacks the Skill does not blame the submodule", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable"),
    });

    const result = await runCli(["prompt", root, "example-school/school-day"], {
      skillLibrary: shared,
    });

    expect(result.stderr).not.toContain("git submodule");
  });

  test("naming no Skill at all fails, saying what the argument is", async () => {
    const root = await dataRepository();

    const result = await runCli(["prompt", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/<publisher>\/<artifact>/);
  });

  test("a name that would climb out of the skills directory is refused, not followed", async () => {
    // `skills/../secrets.md` in the data repository: a file the pipeline has no
    // business reading, let alone pasting into a prompt bound for an AI chat.
    const root = await dataRepository({ "secrets.md": "the refresh token is hunter2" });
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable"),
    });

    const result = await runCli(["prompt", root, "../secrets"], { skillLibrary: shared });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).not.toContain("hunter2");
    expect(result.stderr).toContain("<publisher>/<artifact>");
  });
});

describe("a Parsing Skill the pipeline cannot use", () => {
  test("one written against another version of the contract is refused", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable", {
        schemaVersion: '"an-older-contract"',
      }),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(SCHEMA_VERSION);
    expect(result.stderr).toContain('found "an-older-contract"');
  });

  test("one whose frontmatter is not flat field-and-value pairs is refused", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": [
        "---",
        "name: example-school/timetable",
        "publisher: Example School",
        "artifact: >",
        "  The weekly timetable PDF published each August",
        `document: timetable`,
        `schemaVersion: "${SCHEMA_VERSION}"`,
        "---",
        "",
        "## The Source",
        "",
        "The noticeboard.",
      ].join("\n"),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    // The artifact would otherwise be announced to the agent as ">", with the
    // sentence describing it silently dropped.
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("artifact");
  });

  test("one naming an Intake document that does not exist is refused", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/timetable", { document: "lessons" }),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("lessons");
    expect(result.stderr).toContain("timetable");
  });

  test("one whose name disagrees with where it sits is refused", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": skillText("example-school/school-day"),
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("example-school/school-day");
  });

  test("one with no frontmatter at all is refused, pointing at the format", async () => {
    const root = await dataRepository();
    const shared = await skillLibrary({
      "example-school/timetable": "# Just prose\n\nNo frontmatter here.\n",
    });

    const result = await runCli(["prompt", root, "example-school/timetable"], {
      skillLibrary: shared,
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("frontmatter");
    expect(result.stderr).toContain("skill-format.md");
  });
});
