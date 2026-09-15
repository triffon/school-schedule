import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The shared Parsing Skill library's root: the submodule this repository
 * mounts at `skills/`, whose Skills sit under `skills/skills/<name>.md`
 * (ADR-0002).
 *
 * Found relative to this module rather than to the working directory, so that
 * the pipeline resolves Skills the same way wherever it is invoked from. Both
 * layouts this file is loaded in — `src/prompt/` under tsx and `dist/prompt/`
 * after a build — sit two directories below the repository root.
 */
export const SHARED_SKILL_LIBRARY: string = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills",
);

/** Where a library keeps its Skills: `<library>/skills/<name>.md`. */
function skillFileIn(library: string, name: string): string {
  return join(library, "skills", `${name}.md`);
}

/**
 * A Skill is named `<publisher>/<artifact>` after its path under `skills/`.
 * Held to that here rather than left to the filesystem, because a name is
 * turned straight into a path: without this, a name carrying `..` reads a file
 * from outside either library and embeds it in the prompt.
 */
const SKILL_NAME = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9.-]*$/;

export function isSkillName(candidate: string): boolean {
  return SKILL_NAME.test(candidate);
}

export interface FoundSkill {
  /** The file the Skill was read from, so an operator can go and open it. */
  file: string;
  text: string;
}

export interface UnfoundSkill {
  /** What was asked for. */
  name: string;
  /** Every file that was looked for, in the order they were looked for. */
  searched: string[];
  /**
   * Whether the shared library is there at all. False when the operator has
   * cloned the pipeline but not initialised the submodule, which looks exactly
   * like a Skill that does not exist and is not the same problem at all.
   */
  sharedLibraryPresent: boolean;
}

export type SkillResolution = ({ ok: true } & FoundSkill) | ({ ok: false } & UnfoundSkill);

/**
 * Finds a named Skill, preferring the school's own to the shared library's
 * (ADR-0002). A school whose publisher changed its layout mid-year drops a
 * corrected Skill into its data repository and is unblocked at once, upstream
 * being a separate and slower matter.
 */
export async function resolveSkill(
  name: string,
  dataRepository: string,
  sharedLibrary: string,
): Promise<SkillResolution> {
  const searched: string[] = [];

  for (const library of [dataRepository, sharedLibrary]) {
    const file = skillFileIn(library, name);
    searched.push(file);
    const text = await readIfPresent(file);
    if (text !== undefined) return { ok: true, file, text };
  }

  return {
    ok: false,
    name,
    searched,
    sharedLibraryPresent: await isDirectory(join(sharedLibrary, "skills")),
  };
}

async function readIfPresent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    // A missing Skill and a missing directory on the way to it are the same
    // answer: it is not here. Anything else is a real fault worth raising.
    if (code === "ENOENT" || code === "ENOTDIR") return undefined;
    throw cause;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
