import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { storedAuthorisation } from "../src/google/authorisation.js";
import { CALENDAR_SCOPE, SHEETS_SCOPE } from "../src/google/scopes.js";
import {
  TOKEN_FILE,
  ignoreTheToken,
  readStoredToken,
  writeStoredToken,
} from "../src/google/token.js";
import { dataRepository } from "./support/data-repository.js";
import { fakeFetch, jsonReply } from "./support/fake-fetch.js";
import { fixedClock } from "./support/fixed-clock.js";

const NOW = "2026-09-15T10:00:00.000Z";
const clock = fixedClock(NOW);

const oauthClient = {
  installed: { client_id: "client-of-the-operator", client_secret: "not-really-a-secret" },
};

/** A stored token that is still good for an hour and carries both scopes. */
const token = {
  accessToken: "access-that-works",
  refreshToken: "refresh-that-works",
  expiresAt: "2026-09-15T11:00:00.000Z",
  scopes: [SHEETS_SCOPE, CALENDAR_SCOPE],
};

/** The same token, but with its access token already past its expiry. */
const expired = { ...token, accessToken: "access-that-expired", expiresAt: NOW };

function authorised(files: Record<string, string | object> = {}) {
  return dataRepository({ "credentials.json": oauthClient, [TOKEN_FILE]: token, ...files });
}

describe("the stored token", () => {
  test("is written so that only the operator can read it, and read back whole", async () => {
    const root = await dataRepository();

    await writeStoredToken(root, token);
    const read = await readStoredToken(root);

    expect(read).toEqual({ ok: true, token });
  });

  test("re-authorising replaces what was stored rather than adding to it", async () => {
    const root = await dataRepository();
    await writeStoredToken(root, token);

    const second = { ...token, accessToken: "access-from-the-second-init", scopes: [SHEETS_SCOPE] };
    await writeStoredToken(root, second);

    expect(await readStoredToken(root)).toEqual({ ok: true, token: second });
  });

  test("is named in the data repository's ignore rules, so it cannot be committed", async () => {
    const root = await dataRepository();

    await ignoreTheToken(root);

    expect(await readFile(join(root, ".gitignore"), "utf8")).toContain(TOKEN_FILE);
  });

  test("an ignore rule that already covers it is left exactly as it was", async () => {
    const existing = "# credentials\ncredentials.json\ntoken.json\n";
    const root = await dataRepository({ ".gitignore": existing });

    await ignoreTheToken(root);

    expect(await readFile(join(root, ".gitignore"), "utf8")).toBe(existing);
  });

  test("is readable only by the operator, on the first write and on every one after", async () => {
    const root = await dataRepository();

    await writeStoredToken(root, token);
    await writeStoredToken(root, { ...token, accessToken: "refreshed" });

    expect((await stat(join(root, TOKEN_FILE))).mode & 0o777).toBe(0o600);
  });

  test("a missing token names the file and what was expected in it", async () => {
    const root = await dataRepository();

    const read = await readStoredToken(root);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems[0]?.file).toBe(TOKEN_FILE);
    expect(read.problems[0]?.message).toMatch(/not there/i);
  });

  test("a token missing a field names the field", async () => {
    const root = await dataRepository({ [TOKEN_FILE]: { accessToken: "only-this" } });

    const read = await readStoredToken(root);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems.map((problem) => problem.at)).toContain("refreshToken");
  });
});

describe("reaching Google with a stored token", () => {
  test("an unexpired token is used as it is, with nothing asked of Google", async () => {
    const fetching = fakeFetch();
    const authorisation = storedAuthorisation(await authorised(), { clock, fetch: fetching });

    expect(await authorisation.accessToken(SHEETS_SCOPE)).toBe("access-that-works");
    expect(fetching.calls).toEqual([]);
  });

  test("a missing token fails naming the file and init", async () => {
    const root = await dataRepository({ "credentials.json": oauthClient });
    const authorisation = storedAuthorisation(root, { clock, fetch: fakeFetch() });

    await expect(authorisation.accessToken(SHEETS_SCOPE)).rejects.toThrow(
      /token\.json[\s\S]*init|init[\s\S]*token\.json/,
    );
  });

  test("a scope the token does not carry is refused before anything is sent", async () => {
    const fetching = fakeFetch();
    const root = await authorised({ [TOKEN_FILE]: { ...token, scopes: [SHEETS_SCOPE] } });
    const authorisation = storedAuthorisation(root, { clock, fetch: fetching });

    await expect(authorisation.accessToken(CALENDAR_SCOPE)).rejects.toThrow(CALENDAR_SCOPE);
    await expect(authorisation.accessToken(CALENDAR_SCOPE)).rejects.toThrow(/init/);
    expect(fetching.calls).toEqual([]);
  });
});

describe("refreshing an expired access token", () => {
  test("is done silently, and the operator is not asked for anything", async () => {
    const fetching = fakeFetch(() =>
      jsonReply({
        access_token: "access-that-was-refreshed",
        expires_in: 3599,
        scope: `${SHEETS_SCOPE} ${CALENDAR_SCOPE}`,
        token_type: "Bearer",
      }),
    );
    const root = await authorised({ [TOKEN_FILE]: expired });
    const authorisation = storedAuthorisation(root, { clock, fetch: fetching });

    expect(await authorisation.accessToken(SHEETS_SCOPE)).toBe("access-that-was-refreshed");

    const call = fetching.calls[0];
    expect(call?.url).toBe("https://oauth2.googleapis.com/token");
    expect(fetching.formOf(call!)).toMatchObject({
      grant_type: "refresh_token",
      refresh_token: "refresh-that-works",
      client_id: "client-of-the-operator",
    });
  });

  test("keeps the refresh token, which the refresh reply does not repeat", async () => {
    const fetching = fakeFetch(() =>
      jsonReply({ access_token: "fresh", expires_in: 3599, scope: SHEETS_SCOPE }),
    );
    const root = await authorised({ [TOKEN_FILE]: expired });

    await storedAuthorisation(root, { clock, fetch: fetching }).accessToken(SHEETS_SCOPE);

    const stored = await readStoredToken(root);
    expect(stored.ok && stored.token.refreshToken).toBe("refresh-that-works");
  });

  test("is persisted, so the next run does not refresh again", async () => {
    const fetching = fakeFetch(() =>
      jsonReply({ access_token: "fresh", expires_in: 3599, scope: SHEETS_SCOPE }),
    );
    const root = await authorised({ [TOKEN_FILE]: expired });

    await storedAuthorisation(root, { clock, fetch: fetching }).accessToken(SHEETS_SCOPE);
    await storedAuthorisation(root, { clock, fetch: fakeFetch() }).accessToken(SHEETS_SCOPE);

    expect(fetching.calls).toHaveLength(1);
  });

  test("records the scopes Google granted, which may be fewer than were asked for", async () => {
    const fetching = fakeFetch(() =>
      jsonReply({ access_token: "fresh", expires_in: 3599, scope: SHEETS_SCOPE }),
    );
    const root = await authorised({ [TOKEN_FILE]: expired });

    await storedAuthorisation(root, { clock, fetch: fetching }).accessToken(SHEETS_SCOPE);

    const stored = await readStoredToken(root);
    expect(stored.ok && stored.token.scopes).toEqual([SHEETS_SCOPE]);
  });

  test("a token that cannot be refreshed fails with a message naming init", async () => {
    const fetching = fakeFetch(() =>
      jsonReply({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, 400),
    );
    const root = await authorised({ [TOKEN_FILE]: expired });
    const authorisation = storedAuthorisation(root, { clock, fetch: fetching });

    await expect(authorisation.accessToken(SHEETS_SCOPE)).rejects.toThrow(/invalid_grant/);
    await expect(authorisation.accessToken(SHEETS_SCOPE)).rejects.toThrow(/init/);
  });

  test("refreshing without the OAuth client fails saying what that file is", async () => {
    const root = await dataRepository({ [TOKEN_FILE]: expired });
    const authorisation = storedAuthorisation(root, { clock, fetch: fakeFetch() });

    await expect(authorisation.accessToken(SHEETS_SCOPE)).rejects.toThrow(/credentials\.json/);
  });
});

describe("a token the operator has edited by hand", () => {
  test("that is not JSON fails the way a Config that is not JSON does", async () => {
    const root = await dataRepository({ [TOKEN_FILE]: "{ not json" });
    await writeFile(join(root, "credentials.json"), JSON.stringify(oauthClient), "utf8");

    const read = await readStoredToken(root);

    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.problems[0]?.message).toMatch(/could not be parsed/i);
  });
});
