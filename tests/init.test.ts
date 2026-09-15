import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { authoriseInBrowser } from "../src/google/authorise.js";
import { CALENDAR_SCOPE, REQUESTED_SCOPES, SHEETS_SCOPE } from "../src/google/scopes.js";
import { dataRepository } from "./support/data-repository.js";
import { fakeFetch, jsonReply } from "./support/fake-fetch.js";
import { fixedClock } from "./support/fixed-clock.js";
import { runCli } from "./support/run-cli.js";

/**
 * `init` is the one command that reaches Google without a stored token, so the
 * browser leg of it cannot be driven from here. What the command seam does pin
 * is everything that must fail before a browser is ever opened.
 */
describe("init without an OAuth client", () => {
  test("fails naming the file and saying what belongs in it", async () => {
    const root = await dataRepository();

    const result = await runCli(["init", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("credentials.json");
    expect(result.stderr).toMatch(/desktop/i);
  });

  test("the leftover service account key is refused as the wrong kind of credential", async () => {
    const root = await dataRepository({
      "credentials.json": { type: "service_account", private_key: "-----BEGIN PRIVATE KEY-----" },
    });

    const result = await runCli(["init", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/service account/i);
    expect(result.stderr).toMatch(/desktop/i);
  });

  test("a web client is refused, saying a loopback redirect is what this needs", async () => {
    const root = await dataRepository({
      "credentials.json": { web: { client_id: "a", client_secret: "b" } },
    });

    const result = await runCli(["init", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/installed/);
  });

  test("an OAuth client that is not JSON at all fails saying so", async () => {
    const root = await dataRepository({ "credentials.json": "{ not json" });

    const result = await runCli(["init", root]);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/could not be parsed/i);
  });

  test("nothing is written to the data repository when the client is unusable", async () => {
    const root = await dataRepository();

    await runCli(["init", root]);

    expect(await readdir(root)).toEqual([]);
  });
});

/**
 * The browser leg, driven against a stand-in Google: a browser that consents is
 * a browser that fetches the loopback address the consent URL named, so the
 * whole flow runs here but for Google's own two endpoints.
 */
describe("the browser flow", () => {
  const client = { clientId: "client-of-the-operator", clientSecret: "not-really-a-secret" };
  const clock = fixedClock("2026-09-15T10:00:00.000Z");

  /** A browser whose operator agrees to everything on the consent screen. */
  const consenting = async (consentUrl: string): Promise<void> => {
    const asked = new URL(consentUrl);
    const back = new URL(asked.searchParams.get("redirect_uri")!);
    back.searchParams.set("code", "the-code-google-issued");
    back.searchParams.set("state", asked.searchParams.get("state")!);
    await fetch(back);
  };

  const granting = () =>
    fakeFetch(() =>
      jsonReply({
        access_token: "access-that-works",
        refresh_token: "refresh-that-works",
        expires_in: 3599,
        scope: `${SHEETS_SCOPE} ${CALENDAR_SCOPE}`,
        token_type: "Bearer",
      }),
    );

  test("yields a token carrying the refresh token, its expiry and the granted scopes", async () => {
    const token = await authoriseInBrowser({
      client,
      scopes: REQUESTED_SCOPES,
      clock,
      invite: consenting,
      fetch: granting(),
    });

    expect(token).toEqual({
      accessToken: "access-that-works",
      refreshToken: "refresh-that-works",
      expiresAt: "2026-09-15T10:59:59.000Z",
      scopes: [SHEETS_SCOPE, CALENDAR_SCOPE],
    });
  });

  test("asks for both scopes on the one consent screen, over a loopback redirect", async () => {
    let consentUrl = "";

    await authoriseInBrowser({
      client,
      scopes: REQUESTED_SCOPES,
      clock,
      invite: async (url) => {
        consentUrl = url;
        await consenting(url);
      },
      fetch: granting(),
    });

    const asked = new URL(consentUrl);
    expect(asked.origin + asked.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(asked.searchParams.get("scope")).toBe(REQUESTED_SCOPES.join(" "));
    expect(asked.searchParams.get("redirect_uri")).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    expect(asked.searchParams.get("code_challenge_method")).toBe("S256");
    // Without both of these Google issues no refresh token on a re-run, and
    // `init` has to replace the stored one every time it is asked to.
    expect(asked.searchParams.get("access_type")).toBe("offline");
    expect(asked.searchParams.get("prompt")).toBe("consent");
  });

  test("redeems the code with the verifier the challenge was made from", async () => {
    const fetching = granting();
    let consentUrl = "";

    await authoriseInBrowser({
      client,
      scopes: REQUESTED_SCOPES,
      clock,
      invite: async (url) => {
        consentUrl = url;
        await consenting(url);
      },
      fetch: fetching,
    });

    const form = fetching.formOf(fetching.calls[0]!);
    const challenge = createHash("sha256").update(form["code_verifier"]!).digest("base64url");
    expect(form["grant_type"]).toBe("authorization_code");
    expect(form["code"]).toBe("the-code-google-issued");
    expect(challenge).toBe(new URL(consentUrl).searchParams.get("code_challenge"));
  });

  test("an operator who declines on the consent screen is reported, not left waiting", async () => {
    const declining = async (consentUrl: string): Promise<void> => {
      const asked = new URL(consentUrl);
      const back = new URL(asked.searchParams.get("redirect_uri")!);
      back.searchParams.set("error", "access_denied");
      back.searchParams.set("state", asked.searchParams.get("state")!);
      await fetch(back);
    };

    await expect(
      authoriseInBrowser({
        client,
        scopes: REQUESTED_SCOPES,
        clock,
        invite: declining,
        fetch: fakeFetch(),
      }),
    ).rejects.toThrow(/access_denied/);
  });

  test("a grant with no refresh token is refused, since a later run would have to ask again", async () => {
    const fetching = fakeFetch(() =>
      jsonReply({ access_token: "access-that-works", expires_in: 3599, scope: SHEETS_SCOPE }),
    );

    await expect(
      authoriseInBrowser({ client, scopes: REQUESTED_SCOPES, clock, invite: consenting, fetch: fetching }),
    ).rejects.toThrow(/refresh token/i);
  });
});
