import { INTAKE_DOCUMENTS, type IntakeDocument } from "../intake/documents.js";
import { INTAKE_SCHEMA } from "../intake/schema.js";
import type { Skill } from "./skill.js";

export interface PromptRequest {
  skill: Skill;
  /** Whatever the operator added after the Skill's name, verbatim. */
  notes: string[];
  /** When the prompt was emitted, from the run's clock. */
  emittedAt: Date;
}

/**
 * Renders the prompt an operator pastes into an AI chat along with the
 * artifact. It is self-contained on purpose (ADR-0001): the pipeline parses
 * nothing itself, so everything the agent needs to produce an Intake document
 * this pipeline will accept has to be in here — the Skill for this publisher's
 * artifact, the schema the output is held to, and what to record about where
 * the artifact came from.
 */
export function emitPrompt(request: PromptRequest): string {
  const { skill, notes, emittedAt } = request;
  const document = documentFor(skill.document);

  return [
    "# Parse one artifact into one Intake document",
    "",
    "You are reading a single published artifact and turning it into a single JSON document",
    "for the school-schedule pipeline. Everything you need is in this prompt; the artifact",
    "itself is attached alongside it.",
    "",
    "## What to produce",
    "",
    `${capitalise(document.title)}: one JSON document, valid against the \`${skill.document}\``,
    `definition of the schema below, to be saved as \`${document.file}\` in the school's data`,
    "repository.",
    "",
    `- Source: ${skill.artifact}`,
    `- Published by: ${skill.publisher}`,
    `- Parsing Skill: ${skill.name} (schema version ${skill.schemaVersion})`,
    ...operatorNotes(notes),
    "",
    "## The Parsing Skill",
    "",
    "Read this before the artifact. It is what this publisher does that an otherwise careful",
    "reading would get wrong.",
    "",
    skill.body,
    "",
    "## The Intake schema",
    "",
    `Your output must validate against the \`${skill.document}\` definition. The schema describes`,
    "all four Intake documents; produce only that one, and only its own fields — the contract",
    "allows no others.",
    "",
    "```json",
    JSON.stringify(INTAKE_SCHEMA, null, 2),
    "```",
    "",
    "## Provenance",
    "",
    "The document carries a `provenance` block recording where it came from, so that an operator",
    "can tell it has gone stale once the publisher republishes. Fill in all four fields:",
    "",
    "- `source` — the name of the artifact you read, such as its filename.",
    "- `sourceHash` — a hash of the artifact's bytes, written `sha256:<hex>`; compute it over the",
    "  file itself, for instance with `sha256sum`. If you cannot read the bytes, say so rather",
    "  than inventing a hash.",
    "- `parsedAt` — the instant you parsed it, as an RFC 3339 timestamp in UTC. This prompt was",
    `  emitted at ${emittedAt.toISOString()}; use that if you have no clock of your own.`,
    "- `agent` — what did the parsing, such as the model name.",
    "",
    "## What to send back",
    "",
    "The JSON document and nothing else, in a single ```json fenced block: no commentary around",
    "it, no fields the schema does not declare, and no data carried over from any other school.",
    "The operator saves what is inside the fence, so anything outside it is theirs to delete by",
    "hand.",
    "",
    "Say so rather than guessing if the artifact contradicts the Skill, or if it does not carry",
    "something the document needs. A misread cell is still a well-formed cell, so the pipeline's",
    "validation will not catch it and only a human reading the diff will.",
    "",
  ].join("\n");
}

function operatorNotes(notes: string[]): string[] {
  if (notes.length === 0) return [];
  // A Skill may need something only the operator knows — which of the school
  // year's two Terms is being published, which Class the Timetable is for — so
  // whatever followed the Skill's name on the command line is carried through
  // untouched.
  return ["", "The operator adds:", "", ...notes.map((note) => `> ${note}`)];
}

function documentFor(key: IntakeDocument["key"]): IntakeDocument {
  const document = INTAKE_DOCUMENTS.find((candidate) => candidate.key === key);
  if (document === undefined) {
    throw new Error(`the Intake has no document named "${key}"`);
  }
  return document;
}

function capitalise(title: string): string {
  return `${title.slice(0, 1).toUpperCase()}${title.slice(1)}`;
}
