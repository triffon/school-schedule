import schema from "./intake.schema.json" with { type: "json" };

/**
 * The single contract for the Intake. The validator compiles it and the
 * `prompt` command embeds it, so what an agent is asked for and what the
 * validator accepts cannot drift apart.
 */
export const INTAKE_SCHEMA = schema;

/**
 * The version of the contract this pipeline speaks. Read out of the schema
 * rather than restated, so there is only one place to change it.
 */
export const SCHEMA_VERSION: string = schema.$defs.schemaVersion.const;
