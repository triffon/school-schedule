import { join } from "node:path";
import { authoriseInBrowser } from "../google/authorise.js";
import { openInBrowser } from "../google/browser.js";
import { readOAuthClient } from "../google/credentials.js";
import { nameOfScope, REQUESTED_SCOPES } from "../google/scopes.js";
import { ignoreTheToken, TOKEN_FILE, writeStoredToken } from "../google/token.js";
import { describeProblems } from "../intake/problems.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import type { CommandContext } from "./context.js";

/**
 * Authorises against Google once, so that every later run needs no interaction.
 *
 * The operator consents in their browser, which comes back to a loopback
 * address this run is listening on; what that yields — the refresh token and
 * the scopes it was granted — is written into the data repository beside its
 * Config, and nothing below the command layer learns that it exists.
 *
 * Both scopes are asked for at once. Only Sheets is published to today, but the
 * consent screen is the one thing an operator should not have to see twice.
 *
 * Re-running replaces what was stored: a grant that has been revoked, or one
 * that is missing a scope, is repaired by authorising again rather than by
 * editing a file.
 */
export async function init(context: CommandContext): Promise<number> {
  const { io } = context.deps;

  if (context.args.length > 0) {
    io.err(`school-schedule init: unexpected ${context.args.map((each) => `"${each}"`).join(", ")}`);
    io.err("init takes the data repository and nothing else.");
    return EXIT_USAGE;
  }

  const client = await readOAuthClient(context.dataRepository);
  if (!client.ok) {
    io.err(`school-schedule init: ${context.dataRepository} has no OAuth client to authorise as`);
    io.err("");
    for (const line of describeProblems(client.problems)) io.err(line);
    io.err("");
    io.err("Nothing has been authorised; put the file named above in place and run init again.");
    return EXIT_FAILURE;
  }

  try {
    // Before the browser is opened rather than after it comes back: whatever
    // else this run does, the data repository should not be able to commit a
    // token it is about to be given.
    await ignoreTheToken(context.dataRepository);

    const token = await authoriseInBrowser({
      client: client.client,
      scopes: REQUESTED_SCOPES,
      clock: context.deps.clock,
      invite: (consentUrl) => invite(context, consentUrl),
    });

    await writeStoredToken(context.dataRepository, token);

    io.out(`Authorised. The grant is in ${join(context.dataRepository, TOKEN_FILE)}, ignored by git.`);
    for (const scope of token.scopes) io.out(`  granted   ${nameOfScope(scope)}`);
    for (const scope of REQUESTED_SCOPES.filter((each) => !token.scopes.includes(each))) {
      io.err(`  withheld  ${nameOfScope(scope)} — a run needing it will say so and publish nothing`);
    }

    return EXIT_OK;
  } catch (cause) {
    io.err(`school-schedule init: ${(cause as Error).message}`);
    io.err("Nothing has been authorised.");
    return EXIT_FAILURE;
  }
}

/**
 * Sends the operator to the consent screen. Everything said to them goes to
 * stderr with the rest of the run's talk, and the URL is printed whether or not
 * a browser opened — over SSH or in a container, nothing will.
 */
async function invite(context: CommandContext, consentUrl: string): Promise<void> {
  const { io } = context.deps;

  io.err("");
  io.err("init is asking Google for:");
  for (const scope of REQUESTED_SCOPES) io.err(`  ${nameOfScope(scope)}  ${scope}`);
  io.err("");

  const opened = await openInBrowser(consentUrl);
  io.err(
    opened
      ? "Your browser is opening the consent screen. If it did not, open this:"
      : "Open this in a browser and agree to it:",
  );
  io.err("");
  io.err(`  ${consentUrl}`);
  io.err("");
  io.err("Waiting for you to agree…");
}
