import type { Clock } from "../ports/clock.js";
import type { OAuthClient } from "./credentials.js";
import { systemFetch, type HttpFetch } from "./http.js";
import { loopbackRedirect } from "./loopback.js";
import { authorisationUrl, exchangeCode, pkce, unguessableState } from "./oauth.js";
import type { StoredToken } from "./token.js";

export interface BrowserFlow {
  client: OAuthClient;
  /** What to ask for. Every scope the pipeline will ever need, on one screen. */
  scopes: string[];
  clock: Clock;
  /**
   * Puts the consent screen in front of the operator — opens their browser at
   * it, and tells them what is happening. The only part of the flow that is not
   * the pipeline's to do, and the seam a test drives it through.
   *
   * It returns once the operator has been invited, not once they have agreed.
   */
  invite: (consentUrl: string) => Promise<void>;
  fetch?: HttpFetch;
}

/**
 * The installed-application OAuth flow, start to finish: listen on a loopback
 * address, send the operator to Google's consent screen, take the code the
 * browser comes back with, and redeem it for a token worth storing.
 *
 * PKCE binds the code to this run, which is what makes an installed client —
 * whose secret sits on the operator's disk — safe to redeem with.
 */
export async function authoriseInBrowser(flow: BrowserFlow): Promise<StoredToken> {
  const verification = pkce();
  const expectedState = unguessableState();
  const redirect = await loopbackRedirect(expectedState);

  try {
    await flow.invite(
      authorisationUrl({
        client: flow.client,
        redirectUri: redirect.redirectUri,
        scopes: flow.scopes,
        state: expectedState,
        codeChallenge: verification.challenge,
      }),
    );

    return await exchangeCode({
      client: flow.client,
      code: await redirect.code(),
      redirectUri: redirect.redirectUri,
      codeVerifier: verification.verifier,
      clock: flow.clock,
      fetch: flow.fetch ?? systemFetch,
    });
  } finally {
    redirect.close();
  }
}
