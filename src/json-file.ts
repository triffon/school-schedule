import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Problem } from "./intake/problems.js";

/**
 * One of the JSON documents a data repository holds and the pipeline reads
 * whole: the Config, the OAuth client, the stored authorisation.
 *
 * Each is read the same way and fails the same way — the file is not there, or
 * cannot be read, or is not JSON — and each says its own name while doing it,
 * because the operator meeting the message has to know which file to go to.
 */
export interface JsonFile {
  /** The file, as a path relative to the data repository. */
  file: string;
  /** How the document is named when it is read back — `the Config`. */
  noun: string;
  /** What to say when it is not there: what was expected, and what it holds. */
  missing: string;
}

export type JsonFileReading =
  | { ok: true; content: unknown }
  | { ok: false; problems: Problem[] };

/** Reads and parses one of them, leaving what is *in* it to the caller. */
export async function readJsonFile(
  dataRepository: string,
  document: JsonFile,
): Promise<JsonFileReading> {
  let text: string;
  try {
    text = await readFile(join(dataRepository, document.file), "utf8");
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    return fault(
      document,
      code === "ENOENT"
        ? document.missing
        : `${document.noun} could not be read: ${(cause as Error).message}`,
    );
  }

  try {
    return { ok: true, content: JSON.parse(text) };
  } catch (cause) {
    return fault(
      document,
      `expected ${document.noun} as JSON, but it could not be parsed: ${(cause as Error).message}`,
    );
  }
}

function fault(document: JsonFile, message: string): JsonFileReading {
  return { ok: false, problems: [{ file: document.file, message }] };
}
