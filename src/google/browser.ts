import { spawn } from "node:child_process";

/** How each platform is asked to open a URL in whatever browser is preferred. */
function opener(url: string): { command: string; args: string[] } {
  switch (process.platform) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      // `start` is a shell builtin, and the empty string is the window title
      // the first quoted argument would otherwise be taken for.
      return { command: "cmd", args: ["/c", "start", "", url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}

/**
 * Opens the consent screen in the operator's browser, and says whether it could.
 *
 * Best-effort on purpose: a machine with no browser — over SSH, in a container —
 * is a normal way to run this, and the URL is printed either way so that the
 * operator can open it wherever they are.
 */
export async function openInBrowser(url: string): Promise<boolean> {
  const { command, args } = opener(url);

  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, { stdio: "ignore", detached: true });
      child.once("error", () => resolve(false));
      child.once("spawn", () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}
