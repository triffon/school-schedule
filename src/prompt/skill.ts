import type { Intake } from "../intake/documents.js";
import { INTAKE_DOCUMENTS } from "../intake/documents.js";

/**
 * A Parsing Skill as the pipeline reads it: the frontmatter fields, which say
 * what the Skill is for, and the Markdown body, which is what an agent is
 * handed. `skills/docs/skill-format.md` in the shared library is the contract.
 */
export interface Skill {
  name: string;
  publisher: string;
  artifact: string;
  /** Which of the four Intake documents this Skill produces. */
  document: keyof Intake;
  schemaVersion: string;
  /** Everything after the frontmatter, verbatim. */
  body: string;
}

/**
 * A reading of a Skill file, or everything wrong with it worded for the
 * operator who must fix it.
 */
export type SkillReading = { ok: true; skill: Skill } | { ok: false; faults: string[] };

const REQUIRED_FIELDS = ["name", "publisher", "artifact", "document", "schemaVersion"] as const;

const DOCUMENT_KEYS = INTAKE_DOCUMENTS.map((document) => document.key);

/**
 * Reads one Skill file. `expectedName` is what the operator asked for and
 * `schemaVersion` the contract this pipeline speaks; both are checked here
 * because a Skill that disagrees with either would otherwise produce a prompt
 * for a document nobody asked for or against a contract that has moved on.
 *
 * Every fault is collected rather than the first thrown, so an operator fixing
 * a Skill sees the whole list.
 */
export function readSkill(text: string, expectedName: string, schemaVersion: string): SkillReading {
  const split = splitFrontmatter(text);
  if (split === undefined) {
    return {
      ok: false,
      faults: [
        "expected YAML frontmatter delimited by --- lines, and the file does not start with one. " +
          "See skills/docs/skill-format.md for the contract every Skill obeys.",
      ],
    };
  }

  const { fields, body, malformed } = split;
  if (malformed.length > 0) return { ok: false, faults: malformed };

  const faults: string[] = [];

  for (const field of REQUIRED_FIELDS) {
    if (fields.get(field) === undefined) {
      faults.push(`expected a "${field}" field in the frontmatter, and there is none`);
    }
  }
  if (faults.length > 0) return { ok: false, faults };

  const name = fields.get("name") as string;
  const document = fields.get("document") as string;
  const declaredVersion = fields.get("schemaVersion") as string;

  // A Skill's name must equal its path under `skills/`, so a mismatch means
  // the library is inconsistent and the operator is not being handed what they
  // named.
  if (name !== expectedName) {
    faults.push(
      `expected the Skill found at ${expectedName}.md to name itself "${expectedName}", ` +
        `found "${name}". A Skill's name must equal its path under skills/.`,
    );
  }

  if (!isDocumentKey(document)) {
    faults.push(
      `expected "document" to be one of ${DOCUMENT_KEYS.join(", ")}, found "${document}". ` +
        "A Skill produces exactly one Intake document.",
    );
  }

  if (declaredVersion !== schemaVersion) {
    faults.push(
      `expected a Skill written against schema version "${schemaVersion}", which is what this ` +
        `pipeline speaks, found "${declaredVersion}". Update the Skill before parsing against it.`,
    );
  }

  if (faults.length > 0) return { ok: false, faults };

  return {
    ok: true,
    skill: {
      name,
      publisher: fields.get("publisher") as string,
      artifact: fields.get("artifact") as string,
      document: document as keyof Intake,
      schemaVersion: declaredVersion,
      body,
    },
  };
}

function isDocumentKey(candidate: string): candidate is keyof Intake {
  return (DOCUMENT_KEYS as string[]).includes(candidate);
}

interface Frontmatter {
  fields: Map<string, string>;
  body: string;
  /** Lines inside the frontmatter that are not a `key: value` pair. */
  malformed: string[];
}

const DELIMITER = /^---[ \t]*$/;

/** YAML's block scalar indicators, which carry a value onto the lines below. */
const BLOCK_SCALAR = /^[|>][+-]?[0-9]*$/;

/**
 * Splits a Skill into its frontmatter fields and its body.
 *
 * The fields are read a line at a time rather than by a YAML parser, because
 * the contract only ever asks for flat `key: value` pairs and because real
 * Skills write values a YAML parser would reject — an `artifact` beginning
 * with a quoted Bulgarian title and continuing in prose after the closing
 * quote. Everything after the colon is the value; surrounding quotes come off
 * only when they enclose the whole of it, which is how `schemaVersion: "1"`
 * stays the string `1`.
 *
 * Reading a line at a time means the YAML a Skill may not use has to be turned
 * away rather than misread: a line with no colon, and a value continued onto
 * the lines below it, would otherwise drop silently and leave the agent being
 * told the artifact is called `>`.
 */
function splitFrontmatter(text: string): Frontmatter | undefined {
  const lines = text.split("\n");
  if (lines[0] === undefined || !DELIMITER.test(lines[0])) return undefined;

  const closing = lines.findIndex((line, index) => index > 0 && DELIMITER.test(line));
  if (closing === -1) return undefined;

  const fields = new Map<string, string>();
  const malformed: string[] = [];

  for (const line of lines.slice(1, closing)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    const separator = line.indexOf(":");
    const field = separator === -1 ? "" : line.slice(0, separator).trim();
    if (field === "") {
      malformed.push(
        `expected every frontmatter line to be a "field: value" pair, found ${JSON.stringify(trimmed)}`,
      );
      continue;
    }

    const value = unquote(line.slice(separator + 1).trim());
    if (BLOCK_SCALAR.test(value)) {
      malformed.push(
        `expected the value of "${field}" on the same line as the field, found the YAML block ` +
          `scalar ${JSON.stringify(value)}. A Skill's frontmatter is flat "field: value" pairs.`,
      );
      continue;
    }

    fields.set(field, value);
  }

  return { fields, body: lines.slice(closing + 1).join("\n").trim(), malformed };
}

function unquote(value: string): string {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.length > 1 && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value;
}
