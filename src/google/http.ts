/**
 * The slice of the platform's `fetch` the pipeline uses. Narrow on purpose: it
 * is the last thing between the pipeline and the network, so a test hands the
 * real clients a stand-in and asserts on what would have gone out.
 */
export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<Response>;

/** The platform's own, which is what a run that is not a test uses. */
export const systemFetch: HttpFetch = (url, init) => fetch(url, init);

/**
 * What Google said when it refused, rather than a status code on its own. Its
 * REST APIs and its OAuth endpoints word a refusal differently — a message
 * under `error`, against an error code and a description beside it — and both
 * are usually the whole answer to what went wrong.
 */
export function whatGoogleSaid(status: number, body: string): string {
  try {
    const said = JSON.parse(body) as {
      error?: string | { status?: string; message?: string };
      error_description?: string;
    };

    if (typeof said.error === "string") {
      return said.error_description === undefined
        ? said.error
        : `${said.error}: ${said.error_description}`;
    }
    if (said.error?.message !== undefined) {
      return `${status} ${said.error.status ?? ""}: ${said.error.message}`.replace("  ", " ");
    }
  } catch {
    // Not JSON; the status and what came back are all there is to go on.
  }

  return `HTTP ${status}: ${body.slice(0, 200)}`;
}
