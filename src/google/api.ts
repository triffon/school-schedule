import type { Authorisation } from "./authorisation.js";
import { whatGoogleSaid, type HttpFetch } from "./http.js";

/**
 * One of Google's REST APIs, authorised and with its faults made readable.
 *
 * Every call asks the authorisation for the scope this API needs first, so a
 * run the stored grant does not cover never reaches the network at all.
 */
export interface GoogleApi {
  get<T>(url: string): Promise<T>;
  post<T>(url: string, body: unknown): Promise<T>;
  put<T>(url: string, body: unknown): Promise<T>;
  delete(url: string): Promise<void>;
}

export interface GoogleApiOptions {
  fetch?: HttpFetch;
}

export function googleApi(
  name: string,
  scope: string,
  authorisation: Authorisation,
  fetching: HttpFetch,
): GoogleApi {
  const call = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
    const accessToken = await authorisation.accessToken(scope);

    const headers: Record<string, string> = { authorization: `Bearer ${accessToken}` };
    if (body !== undefined) headers["content-type"] = "application/json";

    let response: Response;
    try {
      response = await fetching(url, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch (cause) {
      throw new Error(`school-schedule: ${name} could not be reached: ${(cause as Error).message}`);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `school-schedule: ${name} refused the request — ${whatGoogleSaid(response.status, text)}`,
      );
    }

    // A `delete` answers with nothing at all, and so does an update now and then.
    return (text === "" ? undefined : JSON.parse(text)) as T;
  };

  return {
    get: (url) => call("GET", url),
    post: (url, body) => call("POST", url, body),
    put: (url, body) => call("PUT", url, body),
    delete: async (url) => {
      await call("DELETE", url);
    },
  };
}
