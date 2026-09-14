# Pipeline, Parsing Skills and school data live in three repositories

The pipeline is school-agnostic and is distributed as an npm CLI. A school's Config and Intake live in a separate data repository, located by a positional CLI argument, so that school-specific data never enters the pipeline repository and one installation can serve several schools. Parsing Skills live in a shared library repository, included in the pipeline repository as a git submodule, so that publisher-specific skills can be shared and contributed back; a data repository may carry local Skills, which take precedence.

## Considered Options

Vendoring the skills with a content-hashed lock file, as this repository already does for its own agent skills in `skills-lock.json`, would give the same reproducibility without `git submodule update --init` friction for users. It remains a reasonable alternative if the submodule proves awkward.
