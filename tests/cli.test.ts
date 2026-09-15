import { describe, expect, test } from "vitest";
import { dataRepository, missingPath } from "./support/data-repository.js";
import { fixedClock } from "./support/fixed-clock.js";
import { runCli } from "./support/run-cli.js";

describe("help", () => {
  test("--help lists the four subcommands and the data repository argument", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<data-repository>");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("prompt");
    expect(result.stdout).toContain("validate");
    expect(result.stdout).toContain("apply");
  });

  test("--help is understood after the subcommand, where the usage advertises it", async () => {
    const result = await runCli(["validate", "--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<data-repository>");
    expect(result.stderr).toBe("");
  });
});

describe("dispatch", () => {
  test("an unknown subcommand fails, naming what was given", async () => {
    const result = await runCli(["aply", "/tmp/some-repo"]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("aply");
    expect(result.stdout).toBe("");
  });

  test("no arguments at all fails and shows the usage", async () => {
    const result = await runCli([]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("<data-repository>");
    expect(result.stderr).toContain("validate");
  });
});

describe("the data repository argument", () => {
  test.each(["init", "prompt", "validate", "apply"])(
    "%s fails when no data repository is given",
    async (command) => {
      const result = await runCli([command]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("<data-repository>");
    },
  );

  test.each(["init", "prompt", "validate", "apply"])(
    "%s fails when the data repository path is not there, naming the path",
    async (command) => {
      const absent = await missingPath();

      const result = await runCli([command, absent]);

      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(absent);
      expect(result.stderr).toMatch(/does not exist/i);
    },
  );

  test("a path that is a file rather than a directory fails, naming the path", async () => {
    const root = await dataRepository({ "config.json": {} });

    const result = await runCli(["validate", `${root}/config.json`]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("config.json");
    expect(result.stderr).toMatch(/not a directory/i);
  });
});

describe("subcommands", () => {
  test.each(["init", "prompt", "validate", "apply"])(
    "%s is recognised and dispatched",
    async (command) => {
      const root = await dataRepository();

      const result = await runCli([command, root]);

      expect(result.stderr).not.toMatch(/unknown command/i);
    },
  );

  // Every subcommand has landed, so nothing says it does nothing yet. `init`
  // authorises on its own rather than through the injected clients, which is
  // why it reaches neither.
  test("init reaches neither injected Google client", async () => {
    const root = await dataRepository();

    const result = await runCli(["init", root]);

    expect(result.calendar.requests).toEqual([]);
    expect(result.sheets.requests).toEqual([]);
  });

  test("no subcommand is a placeholder any more", async () => {
    const root = await dataRepository();

    for (const command of ["init", "prompt", "validate", "apply"]) {
      const result = await runCli([command, root]);

      expect(`${result.stdout}${result.stderr}`).not.toContain("not implemented yet");
    }
  });
});

describe("the injected clock", () => {
  test("a run is stamped with the injected clock, not the machine's", async () => {
    const root = await dataRepository();

    const result = await runCli(["validate", root], {
      clock: fixedClock("2019-03-04T06:07:08.000Z"),
    });

    expect(result.stderr).toContain("2019-03-04T06:07:08.000Z");
  });
});
