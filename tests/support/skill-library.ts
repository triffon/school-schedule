import { SCHEMA_VERSION } from "../../src/intake/schema.js";
import { temporaryTree } from "./data-repository.js";

/**
 * A Parsing Skill as it sits on disk: frontmatter the pipeline reads followed
 * by the Markdown an agent reads. `overrides` replaces a frontmatter field, so
 * a test can break exactly one of them.
 */
export function skillText(
  name: string,
  overrides: Record<string, string> = {},
  body = "## The Source\n\nThe one-page timetable the school pins to its noticeboard.\n",
): string {
  const frontmatter: Record<string, string> = {
    name,
    publisher: "Example School",
    artifact: "The weekly timetable PDF published each August",
    document: "timetable",
    schemaVersion: `"${SCHEMA_VERSION}"`,
    ...overrides,
  };

  const lines = Object.entries(frontmatter).map(([field, value]) => `${field}: ${value}`);
  return ["---", ...lines, "---", "", body].join("\n");
}

/**
 * A throwaway Parsing Skill library laid out the way the shared one is: the
 * library's root with its Skills under `skills/<name>.md`.
 */
export async function skillLibrary(skills: Record<string, string>): Promise<string> {
  return temporaryTree(
    Object.fromEntries(Object.entries(skills).map(([name, text]) => [`skills/${name}.md`, text])),
  );
}

/**
 * A library root that exists but holds nothing — what an operator who cloned
 * the pipeline without `git submodule update --init` is pointing at.
 */
export async function uninitialisedSkillLibrary(): Promise<string> {
  return temporaryTree();
}
