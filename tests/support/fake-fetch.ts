import type { HttpFetch } from "../../src/google/http.js";

/** One call the pipeline made, in the shape a failure message can be read in. */
export interface HttpCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** The request body as it went out, form-encoded or JSON. */
  body: string | undefined;
}

export interface FakeFetch extends HttpFetch {
  /** Every call made through it, in order. */
  readonly calls: HttpCall[];
  /** The form fields of the last call, for the form-encoded OAuth endpoints. */
  formOf(call: HttpCall): Record<string, string>;
}

export type Responder = (call: HttpCall) => Response | Promise<Response>;

/** A JSON reply, the way Google's APIs answer. */
export function jsonReply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stands in for the platform's `fetch`, recording what went out and replying
 * with whatever the test says. A responder that is never meant to be reached
 * fails the test loudly rather than silently answering.
 */
export function fakeFetch(responder?: Responder): FakeFetch {
  const calls: HttpCall[] = [];

  const fetching: HttpFetch = async (url, init) => {
    const call: HttpCall = {
      method: init.method,
      url,
      headers: init.headers,
      body: init.body,
    };
    calls.push(call);
    if (responder === undefined) {
      throw new Error(`this run should not have reached the network, and called: ${url}`);
    }
    return responder(call);
  };

  return Object.assign(fetching, {
    calls,
    formOf(call: HttpCall): Record<string, string> {
      return Object.fromEntries(new URLSearchParams(call.body ?? ""));
    },
  });
}
