# school-schedule

## Agent skills

### Issue tracker

Issues live as GitHub issues in `triffon/school-schedule`, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, label strings equal to their names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Parsing Skills

`skills/` is a git submodule holding the shared **Parsing Skill** library — prose an agent reads to turn one publisher's artifact into part of an Intake (ADR-0001, ADR-0002). It is not this repo's own agent skills, which are vendored under `.agents/skills/` and locked in `skills-lock.json`.

Run `git submodule update --init` after cloning. Its contract is `skills/docs/skill-format.md`; edit a Skill in that repository, not here.
