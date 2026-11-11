# Native distribution and updates

Duet packages instructions, not an MCP server, credential store, permission policy, or background service. No host installation, marketplace publication, account setting, GitHub App access, or automatic-update preference is changed by this repository.

## Requirements and companions

The requirement uses the Agent Skills standard [`compatibility`](https://agentskills.io/specification#compatibility-field) field. Skill version metadata lives under `metadata.version`; `package.json` remains the release version authority. Neither the Agent Skills format nor the [Agent Plugins 1.0 manifest](https://agent-plugins.org/specification#52-manifest-object) defines a portable dependency resolver, so Duet declares no dependencies and installs nothing else.

Duet works on its own. Two independent skills pair well with it and are installed separately through the host's normal mechanism:

- [Suo](https://github.com/stevenlyd-tools/suo) keeps product definitions as Units. Recommended: handoffs then reference Units instead of free-text acceptance criteria, and `duet completion` can check coverage. That command needs a Suo CLI runtime that matches the loaded Suo skill; a plugin cache or source checkout is not one. See the [Suo reference](../skills/duet/references/suo.md).
- An engineering standard for the hardening step, for example [engineering-principles](https://github.com/stevenlyd/engineering-principles). Opt in by declaring it in the project's own instructions; Duet neither bundles nor requires one.

## One source, native delivery

`skills/duet/` is the only authored skill tree. The repository root is the package root:

- `plugin.json`: Agent Plugins 1.0 for Codex, Cursor, and Copilot.
- `.claude-plugin/plugin.json`: Claude compatibility manifest reading the same `skills/`.
- `gemini-extension.json`: Gemini CLI extension, discovering the same `skills/`.
- `package.json` → `pi.skills`: Pi package discovery, with no extensions or dependencies.

Host catalogs are not in this repository. The `stevenlyd-tools` marketplace in [stevenlyd-tools/plugins](https://github.com/stevenlyd-tools/plugins) lists Duet and Suo for Claude Code, Codex and Copilot, each pinned to a release tag; a Duet release reaches users when that pin moves.

Metadata is generated from `package.json` by `npm run distribution:generate`. There are no generated copies of the skill. Hermes can consume the skill directory directly through its own hub. A host without plugin support can read `skills/duet/` from a reviewed checkout; such a copy does not update itself.

## Install and update by host

These are commands/instructions for a user who has reviewed the package, not commands run by Duet during a task. A missing permission, unsupported client version, or unavailable marketplace is a blocker, not permission to bypass policy.

| Host | Install / activation | Update classification and path |
| --- | --- | --- |
| **Codex** | `codex plugin marketplace add stevenlyd-tools/plugins`, then `codex plugin add duet@stevenlyd-tools` (or choose `duet` in the desktop Plugins UI) and verify in a new task. | **Native manual refresh:** `codex plugin marketplace upgrade stevenlyd-tools`. Confirm the installed plugin version afterward; catalog refresh alone is not proof of activation. No blanket personal-install auto-update claim. [Official packaging/marketplaces](https://developers.openai.com/plugins/build/plugins). |
| **Claude Code** | `claude plugin marketplace add stevenlyd-tools/plugins`, then `claude plugin install duet@stevenlyd-tools`. | **Native manual or opt-in automatic:** `claude plugin update duet@stevenlyd-tools`. Third-party marketplace auto-update defaults off; user may enable it in `/plugin` → Marketplaces. Current sessions keep their loaded version; use a new session or intentional `/reload-plugins`. [Install/update](https://code.claude.com/docs/en/discover-plugins), [manifest](https://code.claude.com/docs/en/plugins-reference). |
| **Cursor** | Portable root `plugin.json` is supported. For local testing, place a reviewed copy of the package inside `~/.cursor/plugins/local/duet`, then reload and verify in Customize. Do not overwrite an existing directory. Team marketplace import is a separate admin action. | **Local copy: manual replacement. Team catalog: native manual refresh or optional GitHub Auto Refresh.** Auto Refresh requires the Cursor GitHub App and eligible team setup; it re-indexes the catalog, not proof every local install upgraded. Public listing needs submission/review and licensing eligibility. [Official plugins guide](https://cursor.com/docs/plugins). |
| **GitHub Copilot CLI** | `copilot plugin marketplace add stevenlyd-tools/plugins`, then `copilot plugin install duet@stevenlyd-tools`. Not yet verified against the combined catalog. | **Native manual or user opt-in automatic:** `copilot plugin update duet`. Third-party marketplace session-start updates require its user-level `autoUpdate` opt-in; repository settings cannot enable that. [CLI reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-plugin-reference). |
| **GitHub Copilot in VS Code** | In Copilot chat, `/plugin marketplace add stevenlyd-tools/plugins`, then `/plugin install duet@stevenlyd-tools`; verify plugin support is enabled by existing user/admin settings. | **Native manual or configured automatic:** `/plugin update duet@stevenlyd-tools`; the documented Extensions update check runs automatically every 24 hours when `extensions.autoUpdate` is enabled. Do not equate VS Code binary updates with plugin updates. [VS Code plugin management](https://code.visualstudio.com/docs/agent-customization/agent-plugins), [authoring](https://code.visualstudio.com/docs/agents/reference/agent-plugin-reference). |
| **Gemini CLI** | `gemini extensions install https://github.com/stevenlyd-tools/duet.git`; inspect prompts normally. `--ref` can select a reviewed commit/tag. No `--consent` bypass is needed. | **Native manual or opt-in automatic:** `gemini extensions update duet`; installation supports `--auto-update` if the user chooses it. Restart the CLI session to activate management changes. Skills come from `skills/`; no always-loaded context or tool policy is added. [Extension reference](https://geminicli.com/docs/extensions/reference/). |
| **Hermes** | `hermes skills inspect stevenlyd-tools/duet/skills/duet`, then `hermes skills install stevenlyd-tools/duet/skills/duet`. | **Native manual check/update:** `hermes skills check`, `hermes skills update duet`. Hub provenance/content hashes drive checking; locally edited skills are skipped. Do not add `--force`. No periodic automatic-check claim. [Official skills guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/skills). |
| **Pi** | `pi install git:github.com/stevenlyd-tools/duet`; the explicit `pi.skills` manifest loads skills only. A reviewed tag/commit can be selected with `@REF`. | **Native manual reconciliation:** `pi update --extensions` reconciles configured packages; pinned tags/commits do not move. Local package paths load directly and need manual source updates. [Official package guide](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). |

The optional CLI needs Node >=22.18 and a verified path to `src/cli.ts`. A skill-only host install is not proof that the CLI exists. Plugin installation alone neither authorizes deployment nor changes a project's Alpha workflow.

## Migrate, pin, and recover

Releases before 0.26 could copy the skill and instruction blocks into a project with `adapter install`. Those copies never update themselves and that command was removed. Each person needs a one-time, reviewed migration to their host's native installation: inventory `.duet/skills`, `.agents`, `.claude`, `.cursor`, `.github`, `.hermes`, `.pi` and the marked Duet block in shared instruction files; preserve unrelated text and local edits; remove the duplicate copies only after the native installation is verified. `duet doctor` lists copied skills that differ from the running package.

Keep local customizations in project instructions, not managed plugin caches. Select the trusted `stevenlyd-tools` marketplace (or the `stevenlyd-tools/duet` repository) and record the installed version and full Git SHA. Use the host's documented ref pinning where available; otherwise keep an immutable local checkout and disable native auto-update explicitly if desired. Do not assume every host has a version selector. Offline or failed refresh means **last installed version, freshness unknown**, not up to date.

Finish active work under its original loaded version. Apply updates at a new session boundary and verify the loaded skill/version before work. Use native rollback/reinstall of a recorded known-good revision where supported; otherwise restore the reviewed backup at the next session. Duet does not promise a cross-host atomic update, edit caches behind a host, or replace instructions mid-task. No polling, cron, startup scripts, or per-message network requests are bundled.

## Release and validation

`package.json` is the version authority. Bump its stable MAJOR.MINOR.PATCH version for changed shipped skills, CLI, Pi discovery, or generated metadata, then run:

```sh
npm run distribution:generate
npm run distribution:check
npm test
node scripts/distribution.ts --check --base FULL_BASE_COMMIT_SHA
```

`distribution-lock.json` records SHA-256 hashes for shipped skill/CLI files and generated manifests, plus Pi discovery metadata. Tests reject stale metadata, missing references/layout drift, and unexpected executable/permission surfaces. PR CI compares the payload against the PR base and requires a newer version when it changes. The hashes detect drift; they are not signatures or publisher authentication. Git commit identity records the reviewed source, and CI must pass on the exact PR head before merge.

Use immutable release tags only after the versioned PR passes review/CI. Preparing a version does not publish a tag, npm package, public marketplace entry, or release asset. Git-based native sources can consume merged main, while users needing reproducibility can select its exact SHA. Never move an existing release tag. A public marketplace listing is a separate, deliberate publication decision.

**Verification limits:** generated metadata, structural checks, content hashes and CLI tests run locally and in CI. They are not vendor-schema certification or native runtime tests. Before claiming a host verified, record its version, install the reviewed package in an isolated profile, confirm discovery, perform an update to a different version, and verify session-boundary activation. Each collaborator's installation is verified separately; one person's successful setup proves nothing about another's.
