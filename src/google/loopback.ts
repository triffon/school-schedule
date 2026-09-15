import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Where the browser comes back to once the operator has answered the consent
 * screen.
 *
 * Google's installed-application flow redirects to a loopback address on this
 * machine rather than to a server the pipeline would have to run, which is what
 * lets a command-line tool complete an OAuth flow at all. The port is whatever
 * the operating system hands out, so two runs never collide.
 */
export interface LoopbackRedirect {
  /** The address Google is asked to redirect to, and is listening on. */
  redirectUri: string;
  /**
   * The authorisation code, once the browser has brought it back. Rejects when
   * the operator declined, or when the redirect does not carry the state this
   * run sent — which means it was not this run's redirect.
   */
  code(): Promise<string>;
  /** Stops listening. Called however the flow ends. */
  close(): void;
}

/** What the operator is shown once the browser has done its part. */
function page(heading: string, said: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>school-schedule</title></head>
<body style="font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 30rem">
<h1>${heading}</h1>
<p>${said}</p>
</body></html>
`;
}

const AUTHORISED = page(
  "school-schedule is authorised",
  "You can close this tab and go back to the terminal.",
);

/**
 * The browser is told the same thing the terminal is. Showing the operator a
 * success page for a consent they declined would leave the two disagreeing,
 * and the terminal is the one they have to go back to either way.
 */
const NOT_AUTHORISED = page(
  "school-schedule is not authorised",
  "Nothing was granted. Close this tab and see the terminal for what happened.",
);

/**
 * Listens for the redirect, and answers it with whatever it turns out to say.
 * The state this run sent is given up front so that the page the operator sees
 * can be decided as the redirect arrives, rather than after it.
 */
export async function loopbackRedirect(expectedState: string): Promise<LoopbackRedirect> {
  let settle: (code: string) => void;
  let refuse: (cause: Error) => void;
  // Held from the moment it is listening, because the browser may come back
  // before anything is waiting on it.
  const arrived = new Promise<string>((resolve, reject) => {
    settle = resolve;
    refuse = reject;
  });
  // Nobody may be awaiting it yet, and an unhandled rejection would take the
  // process down before the flow gets to report what went wrong.
  arrived.catch(() => {});

  const server = createServer((request, response) => {
    const asked = new URL(request.url ?? "/", "http://127.0.0.1");
    const code = asked.searchParams.get("code");
    const error = asked.searchParams.get("error");

    // A browser asks for more than the redirect — a favicon, most often — and
    // none of it is what this is waiting for.
    if (code === null && error === null) {
      response.writeHead(404).end();
      return;
    }

    const answer = (body: string) =>
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(body);

    if (error !== null) {
      answer(NOT_AUTHORISED);
      refuse(new Error(`Google did not grant access (${error})`));
      return;
    }

    if (asked.searchParams.get("state") !== expectedState) {
      answer(NOT_AUTHORISED);
      refuse(
        new Error(
          "the browser came back with a state this run did not send, so the redirect was not " +
            "this run's. Nothing has been authorised; run `init` again.",
        ),
      );
      return;
    }

    answer(AUTHORISED);
    settle(code as string);
  });

  await listen(server);
  const { port } = server.address() as AddressInfo;

  return {
    redirectUri: `http://127.0.0.1:${port}`,
    code: () => arrived,
    close: () => {
      server.close();
    },
  };
}

/** Listening on a port the operating system picks, on the loopback address. */
function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}
