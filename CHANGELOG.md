# Changelog

Notable changes use [Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
and [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
This public history starts at 0.26.0, when Duet was refocused on the two-role
workflow. Earlier versions were developed privately and are not listed.
See [release process](https://github.com/stevenlyd/duet/blob/main/docs/releases.md) for publication and compatibility rules.

## [Unreleased]

## [0.26.0] - 2026-11-10

Duet is now scoped to one thing: a workflow for two roles, a prototyper and an engineer, who both work through coding agents. Everything that served a single team's own machines and projects was removed.

### Changed

- The skill is rewritten around the two roles. It says who Duet fits, decides the role per task, and gives each role one path. It is about a third of its former length and no longer pins project-specific wording.
- Suo is recommended, not required. A new `references/suo.md` maps Duet's stages onto Suo's Unit states and says what a handoff carries with and without it.
- The engineering-principles skill is no longer a requirement. A project opts into an engineering standard through its own instructions.
- CI runs on GitHub-hosted runners and no longer skips pull requests from forks.
- The repository is MIT licensed.

### Removed

- The personal workspace/VM runtime, its infrastructure, the Codex remote-status tooling and the global work index (`workspace`, `work-index` and related commands).
- Writer provenance (`writer check`, `writer record`, `.duet/writer.json`).
- `principles check`.
- Project adapters (`adapter install`). Use the host's native plugin installation.
- The built-in deploy hook for disposable targets (`alpha deploy` without `--sha`, and the `deploy`/`alpha` hook fields of `.duet/config.json`). Alpha deployment goes through the project's CI/CD, optionally coordinated by `.duet/alpha.json`.
- The `ws` runtime dependency. The CLI has no dependencies.

### Breaking changes

- The commands listed under Removed no longer exist; scripts that call them fail with a usage error.
- `alpha deploy` requires `--sha` and a reviewed `.duet/alpha.json`.
- The skill no longer instructs agents to load engineering-principles or to record writer provenance.

### Migration

- Projects that called `writer check`, `writer record`, `principles check`, `adapter install` or the workspace commands must remove those calls before updating.
- An existing `.duet/config.json` keeps working. Its `deploy` and `alpha` hook fields are ignored and never rewritten; delete them when convenient. Experiment state is preserved.
- Replace copied adapter skills and instruction blocks with a native plugin installation; see `docs/distribution.md`. Delete `.duet/writer.json`.
- To keep using an engineering standard, declare it in the project's own agent instructions.
