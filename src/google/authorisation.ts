import { describeProblems, type Problem } from "../intake/problems.js";
import { systemClock, type Clock } from "../ports/clock.js";
import { readOAuthClient, type OAuthClient } from "./credentials.js";
import { systemFetch, type HttpFetch } from "./http.js";
import { refreshAccessToken } from "./oauth.js";
import { nameOfScope } from "./scopes.js";
import { readStoredToken, writeStoredToken, TOKEN_FILE, type StoredToken } from "./token.js";

/**
 * What the real Google clients get their authority from, and the only thing
 * they know about how the pipeline came by it. Every request asks for the scope
 * it needs, so a run the stored grant does not cover is refused here rather
 * than by Google.
 */
export interface Authorisation {
  accessToken(scope: string): Promise<string>;
}

export interface StoredAuthorisationOptions {
  clock?: Clock;
  fetch?: HttpFetch;
}

/**
 * An access token is treated as spent this long before Google says it is, so
 * that a request sent on the strength of it does not expire in flight.
 */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * The authorisation `init` left in the data repository: loaded once per run,
 * refreshed silently when the access token has run out, and written back so the
 * next run finds it fresh.
 */
export function storedAuthorisation(
  dataRepository: string,
  options: StoredAuthorisationOptions = {},
): Authorisation {
  const clock = options.clock ?? systemClock;
  const fetching = options.fetch ?? systemFetch;

  // Loaded lazily and held for the run: a `validate` or a `prompt` never
  // touches Google, and should not be made to have a token.
  let loading: Promise<StoredToken> | undefined;

  const load = async (): Promise<StoredToken> => {
    const read = await readStoredToken(dataRepository);
    if (!read.ok) {
      throw cannotAuthorise(
        `school-schedule: ${dataRepository} has not been authorised against Google`,
        read.problems,
        `Run \`school-schedule init ${dataRepository}\` once, and no later run will ask again.`,
      );
    }
    return read.token;
  };

  const refresh = async (token: StoredToken): Promise<StoredToken> => {
    const client = await oauthClient(dataRepository);
    let refreshed: StoredToken;
    try {
      refreshed = await refreshAccessToken({ client, token, clock, fetch: fetching });
    } catch (cause) {
      throw new Error(
        `school-schedule: the stored authorisation could not be refreshed. ` +
          `${(cause as Error).message}\n` +
          `Run \`school-schedule init ${dataRepository}\` to authorise again.`,
      );
    }
    await writeStoredToken(dataRepository, refreshed);
    return refreshed;
  };

  return {
    async accessToken(scope) {
      loading ??= load();
      let token = await loading;

      if (!token.scopes.includes(scope)) {
        throw new Error(
          `school-schedule: this run needs ${nameOfScope(scope)} (${scope}), which the ` +
            `authorisation stored in ${TOKEN_FILE} was not granted.\n` +
            `Run \`school-schedule init ${dataRepository}\` and agree to it. Nothing has been sent.`,
        );
      }

      if (hasExpired(token, clock)) {
        token = await refresh(token);
        loading = Promise.resolve(token);
      }

      return token.accessToken;
    },
  };
}

function hasExpired(token: StoredToken, clock: Clock): boolean {
  const expiresAt = Date.parse(token.expiresAt);
  // An expiry that cannot be read is treated as spent: refreshing costs one
  // request, where trusting it costs a failure against Google.
  if (Number.isNaN(expiresAt)) return true;
  return expiresAt - clock.now().getTime() <= EXPIRY_MARGIN_MS;
}

async function oauthClient(dataRepository: string): Promise<OAuthClient> {
  const read = await readOAuthClient(dataRepository);
  if (!read.ok) {
    throw cannotAuthorise(
      "school-schedule: the stored authorisation has expired and cannot be refreshed without " +
        "the OAuth client it was granted to",
      read.problems,
      `Put the file named above in place, or run \`school-schedule init ${dataRepository}\` again.`,
    );
  }
  return read.client;
}

/** A file fault, reported the way `validate` reports one, as one message. */
function cannotAuthorise(headline: string, problems: Problem[], advice: string): Error {
  return new Error([headline, "", ...describeProblems(problems), "", advice].join("\n"));
}
