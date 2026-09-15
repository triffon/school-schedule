import { afterEach, describe, expect, test } from "vitest";
import { loopbackRedirect, type LoopbackRedirect } from "../src/google/loopback.js";

const open: LoopbackRedirect[] = [];

afterEach(() => {
  for (const redirect of open.splice(0)) redirect.close();
});

const STATE = "the-state-this-run-sent";

async function listening(): Promise<LoopbackRedirect> {
  const redirect = await loopbackRedirect(STATE);
  open.push(redirect);
  return redirect;
}

/**
 * The half of the browser flow that runs on this machine: Google sends the
 * operator back to a loopback address this run is listening on, and the
 * authorisation code arrives as a query parameter.
 */
describe("the loopback redirect", () => {
  test("listens on a loopback address, which is what Google will redirect to", async () => {
    const redirect = await listening();

    expect(redirect.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  test("yields the code Google came back with", async () => {
    const redirect = await listening();

    const answered = await fetch(`${redirect.redirectUri}/?code=the-code&state=${STATE}`);

    expect(await redirect.code()).toBe("the-code");
    expect(answered.ok).toBe(true);
  });

  test("tells the operator in the browser that they can go back to the terminal", async () => {
    const redirect = await listening();

    const answered = await fetch(`${redirect.redirectUri}/?code=the-code&state=${STATE}`);

    expect(await answered.text()).toMatch(/is authorised[\s\S]*terminal/i);
  });

  test("refuses a redirect carrying somebody else's state", async () => {
    const redirect = await listening();

    await fetch(`${redirect.redirectUri}/?code=the-code&state=not-the-state`);

    await expect(redirect.code()).rejects.toThrow(/state/i);
  });

  test("reports an operator who declined on the consent screen", async () => {
    const redirect = await listening();

    await fetch(`${redirect.redirectUri}/?error=access_denied&state=${STATE}`);

    await expect(redirect.code()).rejects.toThrow(/access_denied/);
  });

  // The browser and the terminal have to agree: an operator who cancelled and
  // was then told in the browser that they had authorised would have no way to
  // tell which of the two was lying.
  test.each([
    ["declining", `?error=access_denied&state=${STATE}`],
    ["a redirect that is not this run's", "?code=the-code&state=somebody-elses"],
  ])("shows no success page after %s", async (_what, query) => {
    const redirect = await listening();

    const answered = await fetch(`${redirect.redirectUri}/${query}`);

    expect(await answered.text()).toMatch(/is not authorised/i);
    await expect(redirect.code()).rejects.toThrow();
  });

  test("ignores a request that is not the redirect, such as the browser's favicon", async () => {
    const redirect = await listening();

    const ignored = await fetch(`${redirect.redirectUri}/favicon.ico`);
    await fetch(`${redirect.redirectUri}/?code=the-code&state=${STATE}`);

    expect(ignored.status).toBe(404);
    expect(await redirect.code()).toBe("the-code");
  });
});
