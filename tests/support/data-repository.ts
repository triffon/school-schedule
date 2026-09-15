import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

/**
 * Creates a throwaway directory holding `files` and returns its path. Removed
 * after the test that made it.
 *
 * `files` maps a path relative to the directory to its contents; an object is
 * written as JSON.
 */
export async function temporaryTree(
  files: Record<string, string | object> = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "school-schedule-"));
  created.push(root);

  for (const [relativePath, contents] of Object.entries(files)) {
    const target = join(root, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(
      target,
      typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`,
      "utf8",
    );
  }

  return root;
}

/** A throwaway data repository — one school's Config and Intake. */
export async function dataRepository(
  files: Record<string, string | object> = {},
): Promise<string> {
  return temporaryTree(files);
}

/** A path under a real temporary directory that deliberately does not exist. */
export async function missingPath(): Promise<string> {
  return join(await dataRepository(), "not-here");
}
