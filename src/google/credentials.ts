import { show, type Problem } from "../intake/problems.js";
import { readJsonFile, type JsonFile } from "../json-file.js";

/**
 * The OAuth client the pipeline authorises as: an installed-application client,
 * registered once in a Google Cloud project and downloaded from the console as
 * JSON. It is a credential, so it lives in the data repository beside the token
 * `init` writes rather than in the pipeline's own checkout, and neither is
 * committed.
 *
 * An installed client's secret is not a secret in the sense a server's is —
 * Google says so, and the loopback flow uses PKCE for exactly that reason — but
 * it identifies the operator's Cloud project, and the quota that goes with it.
 */
export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export const OAUTH_CLIENT_FILE = "credentials.json";

export type OAuthClientReading =
  | { ok: true; client: OAuthClient }
  | { ok: false; problems: Problem[] };

/** What the file is, said the same way wherever it is found wanting. */
const WHAT_IT_IS =
  "the JSON Google Cloud downloads for an OAuth 2.0 Client ID of type Desktop app, " +
  "and it belongs beside the Config in the data repository, uncommitted";

const OAUTH_CLIENT_DOCUMENT: JsonFile = {
  file: OAUTH_CLIENT_FILE,
  noun: "the OAuth client",
  missing: `expected the OAuth client to authorise as, but the file is not there. It is ${WHAT_IT_IS}.`,
};

/**
 * Reads the data repository's OAuth client. Every fault says what the file is
 * and where it belongs, because an operator meeting this message has not got
 * one yet and has to go and make it.
 */
export async function readOAuthClient(dataRepository: string): Promise<OAuthClientReading> {
  const read = await readJsonFile(dataRepository, OAUTH_CLIENT_DOCUMENT);
  if (!read.ok) return read;

  const content = read.content;
  if (!isObject(content)) {
    return fault(`expected ${WHAT_IT_IS}, found ${show(content)}`);
  }

  // A service account key is the other JSON Google hands out under this name,
  // and the pipeline cannot use one: a service account is nobody, so it has no
  // calendar of its own and no way to be granted access to the operator's.
  if (content["type"] === "service_account") {
    return fault(
      "expected a Desktop OAuth client, found a service account key. A service account " +
        `cannot consent on the operator's behalf; what is wanted here is ${WHAT_IT_IS}.`,
      "type",
    );
  }

  const installed = content["installed"];
  if (!isObject(installed)) {
    return fault(
      `expected "installed", which is where ${WHAT_IT_IS} keeps its client id and secret, ` +
        `found ${show(installed)}. A "web" client will not do: this is a command-line ` +
        "application, and it redirects to a loopback address.",
      "installed",
    );
  }

  const problems: Problem[] = [];
  const clientId = required(installed["client_id"], "installed.client_id", problems);
  const clientSecret = required(installed["client_secret"], "installed.client_secret", problems);

  return problems.length > 0 ? { ok: false, problems } : { ok: true, client: { clientId, clientSecret } };
}

function fault(message: string, at?: string): OAuthClientReading {
  const problem: Problem =
    at === undefined
      ? { file: OAUTH_CLIENT_FILE, message }
      : { file: OAUTH_CLIENT_FILE, at, message };
  return { ok: false, problems: [problem] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function required(value: unknown, at: string, problems: Problem[]): string {
  if (typeof value === "string" && value !== "") return value;
  problems.push({
    file: OAUTH_CLIENT_FILE,
    at,
    message: `expected a non-empty string, found ${show(value)}`,
  });
  return "";
}
