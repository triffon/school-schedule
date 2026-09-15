/**
 * Something wrong with an Intake. Every problem names the file it is in, where
 * in that file it is, and what was expected against what was found, so that an
 * operator can correct the Intake without reverse-engineering the validator.
 */
export interface Problem {
  /** The document, as a path relative to the data repository. */
  file: string;
  /** Where in the document, in the reader's notation — `lessons[3].subject`. */
  at?: string;
  /** What was expected, and what was found instead. */
  message: string;
}

/** One problem as a line under its file's heading. */
function describeProblem(problem: Problem): string {
  return problem.at === undefined ? problem.message : `${problem.at}: ${problem.message}`;
}

/**
 * The whole report, file by file, in the order the documents were read.
 * Returns the lines to write; the caller decides where they go.
 */
export function describeProblems(problems: Problem[]): string[] {
  const lines: string[] = [];
  let heading: string | undefined;

  for (const problem of problems) {
    if (problem.file !== heading) {
      if (heading !== undefined) lines.push("");
      lines.push(problem.file);
      heading = problem.file;
    }
    lines.push(`  ${describeProblem(problem)}`);
  }

  return lines;
}

/** How a value is shown once it has been found wanting. */
export function show(value: unknown): string {
  if (value === undefined) return "nothing";
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (value !== null && typeof value === "object") return "an object";

  const rendered = JSON.stringify(value) ?? String(value);
  return rendered.length > 60 ? `${rendered.slice(0, 59)}…` : rendered;
}

/** What kind of thing a value is, for when the rendering alone is ambiguous. */
export function typeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  switch (typeof value) {
    case "string":
      return "a string";
    case "number":
      return Number.isInteger(value) ? "a whole number" : "a number";
    case "boolean":
      return "a boolean";
    case "object":
      return "an object";
    default:
      return typeof value;
  }
}

/** `a string`, `an integer` — the indefinite article a JSON type takes. */
export function withArticle(noun: string): string {
  return /^[aeiou]/i.test(noun) ? `an ${noun}` : `a ${noun}`;
}
