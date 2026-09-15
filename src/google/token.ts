import { appendFile, chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { show, type Problem } from "../intake/problems.js";
import { readJsonFile, type JsonFile } from "../json-file.js";

/**
 * What one authorisation leaves behind: enough to reach Google for as long as
 * the operator lets the pipeline, without ever asking them again.
 *
 * It is stored in the data repository beside the Config, because that is where
 * everything about one school's run lives — but unlike the Config it is never
 * committed, and writing it says so in the repository's ignore rules.
 */
export interface StoredToken {
  /** The short-lived token every request carries. */
  accessToken: string;
  /** The long-lived one that mints the next access token, unattended. */
  refreshToken: string;
  /** When the access token stops being accepted, as an ISO instant. */
  expiresAt: string;
  /**
   * The scopes Google actually granted, which may be fewer than were asked for.
   * Recorded so that a run needing one the operator withheld is refused here,
   * naming the scope, rather than against Google as an opaque 403.
   */
  scopes: string[];
}

export const TOKEN_FILE = "token.json";

const TOKEN_DOCUMENT: JsonFile = {
  file: TOKEN_FILE,
  noun: "the stored authorisation",
  missing:
    "expected the authorisation this pipeline was granted, but the file is not there. " +
    "It holds the refresh token and the scopes it was granted, and `init` writes it.",
};

export type StoredTokenReading =
  | { ok: true; token: StoredToken }
  | { ok: false; problems: Problem[] };

/**
 * Reads the stored token. A fault reads the way a Config fault does — the file,
 * where in it, and what was expected — because it is the same kind of trouble:
 * the operator has a file to put right, or a command to run.
 */
export async function readStoredToken(dataRepository: string): Promise<StoredTokenReading> {
  const read = await readJsonFile(dataRepository, TOKEN_DOCUMENT);
  if (!read.ok) return read;

  const content = read.content;
  if (content === null || typeof content !== "object" || Array.isArray(content)) {
    return fault(`expected the stored authorisation as an object, found ${show(content)}`);
  }

  const held = content as Record<string, unknown>;
  const problems: Problem[] = [];
  const token: StoredToken = {
    accessToken: required(held["accessToken"], "accessToken", problems),
    refreshToken: required(held["refreshToken"], "refreshToken", problems),
    expiresAt: required(held["expiresAt"], "expiresAt", problems),
    scopes: scopes(held["scopes"], problems),
  };

  return problems.length > 0 ? { ok: false, problems } : { ok: true, token };
}

/**
 * Writes the token, replacing whatever was there: re-authorising supersedes the
 * previous grant rather than adding to it, and so does a silent refresh.
 *
 * The mode is set after the write as well as with it, because a mode given to
 * `writeFile` applies only when it creates the file — and every write after the
 * first one does not.
 */
export async function writeStoredToken(
  dataRepository: string,
  token: StoredToken,
): Promise<void> {
  const path = join(dataRepository, TOKEN_FILE);
  await writeFile(path, `${JSON.stringify(token, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

/** How the rule reads when the pipeline is the one adding it. */
const IGNORE_RULE = ["", "# Written by `school-schedule init` — never commit", TOKEN_FILE, ""];

/**
 * Makes sure the data repository's `.gitignore` names the token file, adding
 * the rule when it does not. An operator who has already ignored it — as the
 * data repository template does — is left alone.
 *
 * `init` does this before it writes, rather than every write doing it: a token
 * committed by accident is a token that has to be revoked, but a run that only
 * refreshes one has no business editing the operator's `.gitignore`.
 */
export async function ignoreTheToken(dataRepository: string): Promise<void> {
  const path = join(dataRepository, ".gitignore");

  let existing: string;
  try {
    existing = await readFile(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    await writeFile(path, `${IGNORE_RULE.slice(1).join("\n")}`, "utf8");
    return;
  }

  if (ignores(existing)) return;
  await appendFile(path, `${IGNORE_RULE.join("\n")}`, "utf8");
}

/**
 * Whether these ignore rules already cover the token. Only the plain spellings
 * are recognised: a rule the pipeline cannot read is better added twice than
 * missed, and a duplicate line in a `.gitignore` costs nothing.
 */
function ignores(gitignore: string): boolean {
  return gitignore
    .split("\n")
    .map((line) => line.trim())
    .some((line) => line === TOKEN_FILE || line === `/${TOKEN_FILE}` || line === "*.json");
}

function fault(message: string): StoredTokenReading {
  return { ok: false, problems: [{ file: TOKEN_FILE, message }] };
}

function required(value: unknown, at: string, problems: Problem[]): string {
  if (typeof value === "string" && value !== "") return value;
  problems.push({
    file: TOKEN_FILE,
    at,
    message: `expected a non-empty string, found ${show(value)}. Run \`init\` to authorise again.`,
  });
  return "";
}

function scopes(value: unknown, problems: Problem[]): string[] {
  if (Array.isArray(value) && value.length > 0 && value.every((each) => typeof each === "string")) {
    return value as string[];
  }
  problems.push({
    file: TOKEN_FILE,
    at: "scopes",
    message:
      `expected the scopes this authorisation was granted, found ${show(value)}. ` +
      "Run `init` to authorise again.",
  });
  return [];
}
