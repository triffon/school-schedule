import { SCHEMA_VERSION } from "../intake/schema.js";
import { emitPrompt } from "../prompt/emit.js";
import { isSkillName, resolveSkill, type UnfoundSkill } from "../prompt/library.js";
import { readSkill } from "../prompt/skill.js";
import { EXIT_FAILURE, EXIT_OK, EXIT_USAGE } from "../exit-codes.js";
import type { CommandContext } from "./context.js";

/**
 * Emits a self-contained prompt for turning one Source into part of an Intake,
 * embedding the Intake JSON Schema and the resolved Parsing Skill.
 *
 * The prompt goes to stdout and everything said to the operator goes to
 * stderr, so that a run can be piped or redirected into a file and the file be
 * nothing but the prompt.
 */
export async function prompt(context: CommandContext): Promise<number> {
  const { io } = context.deps;
  const [name, ...notes] = context.args;

  if (name === undefined) {
    io.err("school-schedule prompt: no Parsing Skill named");
    io.err(
      "Name the Skill for the artifact you are parsing, as <publisher>/<artifact> — " +
        "for instance: school-schedule prompt . example-school/timetable",
    );
    return EXIT_USAGE;
  }

  if (!isSkillName(name)) {
    io.err(`school-schedule prompt: "${name}" is not the name of a Parsing Skill`);
    io.err(
      "A Skill is named <publisher>/<artifact> after its path under skills/, in lower case — " +
        "for instance: example-school/timetable",
    );
    return EXIT_USAGE;
  }

  const found = await resolveSkill(name, context.dataRepository, context.deps.skillLibrary);
  if (!found.ok) {
    for (const line of describeUnfound(found)) io.err(line);
    return EXIT_FAILURE;
  }

  const reading = readSkill(found.text, name, SCHEMA_VERSION);
  if (!reading.ok) {
    io.err(`school-schedule prompt: the Parsing Skill in ${found.file} cannot be used`);
    for (const fault of reading.faults) io.err(`  ${fault}`);
    return EXIT_FAILURE;
  }

  io.err(`Parsing Skill ${name}, read from ${found.file}`);
  // The prompt is one string with its own line breaks; `io.out` adds the last.
  io.out(emitPrompt({ skill: reading.skill, notes, emittedAt: context.startedAt }).trimEnd());
  return EXIT_OK;
}

/**
 * A Skill that is in neither place. Both places are named, because which one
 * the operator meant to put it in is the whole question — and an uninitialised
 * submodule looks identical from here, so it is ruled out explicitly.
 */
function describeUnfound(unfound: UnfoundSkill): string[] {
  const lines = [
    `school-schedule prompt: no Parsing Skill named "${unfound.name}"`,
    "",
    "Looked for:",
    ...unfound.searched.map((file) => `  ${file}`),
  ];

  if (!unfound.sharedLibraryPresent) {
    lines.push(
      "",
      "The shared Parsing Skill library is not there. It is a git submodule of the pipeline;",
      "initialise it from the pipeline's checkout with:",
      "",
      "  git submodule update --init",
    );
  }

  lines.push(
    "",
    `A Skill is named after its path under skills/, so "${unfound.name}" is the file ` +
      `skills/${unfound.name}.md. Write it in the data repository if it is this school's alone, ` +
      "or contribute it to the shared library if the publisher serves more schools than this one.",
  );

  return lines;
}
