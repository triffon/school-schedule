import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import {
  INTAKE_DOCUMENTS,
  type Intake,
  type IntakeDocument,
  type Timetable,
} from "./documents.js";
import { show, typeName, withArticle, type Problem } from "./problems.js";
import { INTAKE_SCHEMA, SCHEMA_VERSION } from "./schema.js";

// ajv and ajv-formats are CommonJS, so under Node's ESM interop the module
// namespace is what arrives and the export sits on `.default`.
const addFormats = addFormatsModule.default;

export type IntakeValidation =
  | { ok: true; intake: Intake }
  | { ok: false; problems: Problem[] };

/**
 * Reads the four Intake documents out of a data repository and holds each to
 * the JSON Schema. Structural only: this says the documents are shaped the way
 * the contract says, not that what they describe makes sense.
 *
 * Every document is checked even once one has failed, so that an operator who
 * has just pasted in agent output sees everything to correct in one pass.
 */
export async function validateIntake(dataRepository: string): Promise<IntakeValidation> {
  const problems: Problem[] = [];
  const documents: Partial<Record<keyof Intake, unknown>> = {};

  for (const document of INTAKE_DOCUMENTS) {
    const read = await readDocument(dataRepository, document);
    if (!read.ok) {
      problems.push(...read.problems);
      continue;
    }

    const found = checkDocument(document, read.content);
    if (found.length > 0) {
      problems.push(...found);
      continue;
    }

    documents[document.key] = read.content;
  }

  if (problems.length > 0) return { ok: false, problems };

  // Every document is present and schema-valid, which is exactly what the types
  // in `documents.ts` claim.
  return { ok: true, intake: documents as unknown as Intake };
}

type ReadDocument = { ok: true; content: unknown } | { ok: false; problems: Problem[] };

async function readDocument(
  dataRepository: string,
  document: IntakeDocument,
): Promise<ReadDocument> {
  let text: string;
  try {
    text = await readFile(join(dataRepository, document.file), "utf8");
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    const message =
      code === "ENOENT"
        ? `expected ${document.title}, but the file is not there`
        : `${document.title} could not be read: ${(cause as Error).message}`;
    return { ok: false, problems: [{ file: document.file, message }] };
  }

  try {
    return { ok: true, content: JSON.parse(text) };
  } catch (cause) {
    return {
      ok: false,
      problems: [
        {
          file: document.file,
          message: `expected ${document.title} as JSON, but it could not be parsed: ${(cause as Error).message}`,
        },
      ],
    };
  }
}

/**
 * The version is checked before the shape: a document produced against another
 * version of the contract is governed by another schema, so holding it to this
 * one would bury the one problem worth reporting under the fallout.
 */
function checkDocument(document: IntakeDocument, content: unknown): Problem[] {
  const declared = declaredVersion(content);
  if (declared !== undefined && declared !== SCHEMA_VERSION) {
    return [
      {
        file: document.file,
        at: "schemaVersion",
        message:
          `expected schema version ${JSON.stringify(SCHEMA_VERSION)}, which is what this ` +
          `pipeline speaks, found ${show(declared)}. Re-emit the prompt and re-parse the Source.`,
      },
    ];
  }

  const validate = validatorFor(document.key);
  if (!validate(content)) return problemsFrom(document, content, validate.errors ?? []);

  return document.key === "timetable" ? repeatedLessons(document, content as Timetable) : [];
}

/**
 * A weekday and a Slot identify at most one Lesson. JSON Schema has no way to
 * say so — uniqueness across a projection of a list is beyond it — so the one
 * cardinality rule of the contract is checked here, next to the shape it
 * belongs to.
 */
function repeatedLessons(document: IntakeDocument, timetable: Timetable): Problem[] {
  const firstSeenAt = new Map<string, number>();
  const problems: Problem[] = [];

  timetable.lessons.forEach((lesson, index) => {
    const cell = `${lesson.weekday} Slot ${lesson.slot}`;
    const first = firstSeenAt.get(cell);
    if (first === undefined) {
      firstSeenAt.set(cell, index);
      return;
    }
    problems.push({
      file: document.file,
      at: `lessons[${index}]`,
      message:
        `expected at most one Lesson for ${cell}, but lessons[${first}] already declares one. ` +
        `A weekday and Slot identify at most one Lesson.`,
    });
  });

  return problems;
}

function declaredVersion(content: unknown): unknown {
  if (content === null || typeof content !== "object" || Array.isArray(content)) return undefined;
  return (content as Record<string, unknown>)["schemaVersion"];
}

let validators: Map<string, ValidateFunction> | undefined;

/**
 * The four compiled schemas, built the first time an Intake is validated
 * rather than when this module loads. Compiling costs about a tenth of a
 * second, which `--help` and a usage mistake have no reason to pay.
 */
function validatorFor(key: string): ValidateFunction {
  if (validators === undefined) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv, ["date", "date-time"]);
    ajv.addSchema(INTAKE_SCHEMA);
    validators = new Map(
      INTAKE_DOCUMENTS.map((document) => [
        document.key,
        ajv.compile({ $ref: `${INTAKE_SCHEMA.$id}#/$defs/${document.key}` }),
      ]),
    );
  }

  const validate = validators.get(key);
  if (validate === undefined) {
    throw new Error(`the Intake schema has no definition named "${key}"`);
  }
  return validate;
}

/** Keywords that only say a branch was taken; the branch reports the real fault. */
const STRUCTURAL_KEYWORDS = new Set(["if", "allOf", "anyOf", "oneOf", "not"]);

function problemsFrom(
  document: IntakeDocument,
  content: unknown,
  errors: ErrorObject[],
): Problem[] {
  const problems: Problem[] = [];
  const seen = new Set<string>();

  for (const error of errors) {
    if (STRUCTURAL_KEYWORDS.has(error.keyword)) continue;

    const params = error.params as Record<string, unknown>;
    // One message per offending value, so a value that trips two keywords —
    // a time that is neither the right type nor the right shape — reads once.
    const fingerprint = `${error.instancePath}|${params["missingProperty"] ?? params["additionalProperty"] ?? ""}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const at = readablePath(error.instancePath);
    const problem: Problem = {
      file: document.file,
      message: explain(error, valueAt(content, error.instancePath)),
    };
    problems.push(at === undefined ? problem : { ...problem, at });
  }

  return problems;
}

/** Turns one ajv error into what was expected and what was found. */
function explain(error: ErrorObject, found: unknown): string {
  const params = error.params as Record<string, unknown>;

  switch (error.keyword) {
    case "required":
      return `missing required property "${String(params["missingProperty"])}"`;
    case "additionalProperties":
      return `unexpected property "${String(params["additionalProperty"])}" — the Intake contract has no such field`;
    case "type":
      return `expected ${phraseFromSchema(error.schemaPath) ?? withArticle(String(params["type"]))}, found ${show(found)} (${typeName(found)})`;
    case "enum":
      return `expected one of ${(params["allowedValues"] as unknown[]).map((value) => show(value)).join(", ")}, found ${show(found)}`;
    case "const":
      return `expected ${show(params["allowedValue"])}, found ${show(found)}`;
    case "minLength":
      return params["limit"] === 1
        ? `expected a non-empty string, found ${show(found)}`
        : `expected at least ${String(params["limit"])} characters, found ${show(found)}`;
    case "minimum":
      return `expected a number of at least ${String(params["limit"])}, found ${show(found)}`;
    case "format":
      return `expected ${phraseFromSchema(error.schemaPath) ?? `a valid ${String(params["format"])}`}, found ${show(found)}`;
    case "pattern":
      return `expected ${phraseFromSchema(error.schemaPath) ?? `a value matching ${String(params["pattern"])}`}, found ${show(found)}`;
    default:
      return `${error.message ?? "is not what the Intake contract allows"}, found ${show(found)}`;
  }
}

/**
 * The schema's own wording for the shape a value failed to take. Only the
 * scalar shapes under `$defs` are quoted: theirs are worded as phrases exactly
 * so that they can be read back to an operator, whereas every other
 * description is a sentence about a field and would not sit after "expected".
 */
function phraseFromSchema(schemaPath: string): string | undefined {
  const failed = /^#\/\$defs\/([^/]+)\/[^/]+$/.exec(schemaPath);
  const definition = failed?.[1];
  if (definition === undefined || !PHRASED_DEFINITIONS.has(definition)) return undefined;

  const description = (INTAKE_SCHEMA.$defs as Record<string, { description?: string }>)[definition]
    ?.description;
  return description;
}

const PHRASED_DEFINITIONS = new Set(["timeOfDay", "date", "timestamp"]);

/** A JSON pointer's segments, with RFC 6901's two escapes undone. */
function segmentsOf(pointer: string): string[] {
  if (pointer === "") return [];
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** Follows a JSON pointer into a parsed document, or into the schema itself. */
function valueAt(root: unknown, pointer: string): unknown {
  let here: unknown = root;
  for (const segment of segmentsOf(pointer)) {
    if (here === null || typeof here !== "object") return undefined;
    here = (here as Record<string, unknown>)[segment];
  }
  return here;
}

/** `/lessons/3/subject` as `lessons[3].subject`, which is how it is read. */
function readablePath(instancePath: string): string | undefined {
  if (instancePath === "") return undefined;

  return segmentsOf(instancePath).reduce((path, segment) => {
    if (/^\d+$/.test(segment)) return `${path}[${segment}]`;
    return path === "" ? segment : `${path}.${segment}`;
  }, "");
}
