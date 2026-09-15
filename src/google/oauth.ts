import { createHash, randomBytes } from "node:crypto";
import type { Clock } from "../ports/clock.js";
import type { OAuthClient } from "./credentials.js";
import { whatGoogleSaid, type HttpFetch } from "./http.js";
import type { StoredToken } from "./token.js";

const AUTHORISATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

/**
 * The secret half of PKCE and the digest of it that goes to Google. It proves
 * that whoever redeems the authorisation code is whoever asked for it, which is
 * what makes an installed client — whose secret is on the operator's disk —
 * safe to run this flow with.
 */
export interface Pkce {
  verifier: string;
  challenge: string;
}

export function pkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

/**
 * The `state` parameter Google echoes back on the redirect. Unguessable, so
 * that a redirect the pipeline did not ask for can be told apart from its own.
 */
export function unguessableState(): string {
  return randomBytes(16).toString("base64url");
}

export interface AuthorisationRequest {
  client: OAuthClient;
  /** Where Google sends the operator back to: the loopback this run listens on. */
  redirectUri: string;
  scopes: string[];
  state: string;
  codeChallenge: string;
}

/**
 * The page the operator consents on.
 *
 * `access_type=offline` with `prompt=consent` is what makes a refresh token
 * come back — and come back again on a re-run, which Google otherwise issues
 * only on the very first consent. Re-running `init` has to yield a token that
 * stands on its own, because it replaces the one stored.
 */
export function authorisationUrl(request: AuthorisationRequest): string {
  const url = new URL(AUTHORISATION_ENDPOINT);
  url.search = new URLSearchParams({
    client_id: request.client.clientId,
    redirect_uri: request.redirectUri,
    response_type: "code",
    scope: request.scopes.join(" "),
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: "S256",
    access_type: "offline",
    prompt: "consent",
  }).toString();
  return url.toString();
}

export interface Exchange {
  client: OAuthClient;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  clock: Clock;
  fetch: HttpFetch;
}

/** Turns the code the browser came back with into a token worth storing. */
export async function exchangeCode(exchange: Exchange): Promise<StoredToken> {
  const granted = await post(exchange.fetch, {
    grant_type: "authorization_code",
    code: exchange.code,
    redirect_uri: exchange.redirectUri,
    code_verifier: exchange.codeVerifier,
    client_id: exchange.client.clientId,
    client_secret: exchange.client.clientSecret,
  });

  if (granted.refresh_token === undefined) {
    throw new Error(
      "school-schedule: Google granted access but no refresh token, so a later run would " +
        "have to ask again. Remove this pipeline from the account's third-party access at " +
        "https://myaccount.google.com/connections and run `init` again.",
    );
  }

  return {
    accessToken: granted.access_token,
    refreshToken: granted.refresh_token,
    expiresAt: expiryOf(granted, exchange.clock),
    scopes: grantedScopes(granted),
  };
}

export interface Refresh {
  client: OAuthClient;
  token: StoredToken;
  clock: Clock;
  fetch: HttpFetch;
}

/**
 * Mints a new access token from the stored refresh token. Google does not
 * repeat the refresh token in its reply, so the stored one carries over.
 */
export async function refreshAccessToken(refresh: Refresh): Promise<StoredToken> {
  const granted = await post(refresh.fetch, {
    grant_type: "refresh_token",
    refresh_token: refresh.token.refreshToken,
    client_id: refresh.client.clientId,
    client_secret: refresh.client.clientSecret,
  });

  return {
    accessToken: granted.access_token,
    refreshToken: granted.refresh_token ?? refresh.token.refreshToken,
    expiresAt: expiryOf(granted, refresh.clock),
    scopes: granted.scope === undefined ? refresh.token.scopes : grantedScopes(granted),
  };
}

/** What Google's token endpoint answers with, on the way it is understood. */
interface GrantedToken {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

/**
 * How long a token is treated as good for when Google does not say. An hour is
 * what Google issues; a short guess only costs an extra refresh.
 */
const ASSUMED_LIFETIME_SECONDS = 3600;

function expiryOf(granted: GrantedToken, clock: Clock): string {
  const seconds = granted.expires_in ?? ASSUMED_LIFETIME_SECONDS;
  return new Date(clock.now().getTime() + seconds * 1000).toISOString();
}

function grantedScopes(granted: GrantedToken): string[] {
  return (granted.scope ?? "").split(" ").filter((scope) => scope !== "");
}

/**
 * Posts to the token endpoint, which speaks form encoding rather than JSON, and
 * turns a refusal into the sentence Google put in it.
 */
async function post(
  fetching: HttpFetch,
  form: Record<string, string>,
): Promise<GrantedToken> {
  let response: Response;
  try {
    response = await fetching(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(form).toString(),
    });
  } catch (cause) {
    throw new Error(`Google could not be reached: ${(cause as Error).message}`);
  }

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Google refused the request — ${whatGoogleSaid(response.status, body)}`);
  }

  try {
    return JSON.parse(body) as GrantedToken;
  } catch {
    throw new Error(`Google answered with something that is not JSON: ${body.slice(0, 200)}`);
  }
}
