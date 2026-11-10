# Execute Duet in the project's environment

Using Duet means loading the skill and carrying out its experiment, selection, hardening and tracking workflow. The local CLI is optional tooling, not the definition of compliance. Choose the smallest useful execution path using verified project context and existing authorization.

## Project-native retained-data Alpha

Read project instructions for branch names, checks, immutable-SHA requirements and actual deployment triggers. Ordinary Git worktrees, pinned commits, project tests and native CI/CD implement Duet. Preserve real Alpha users/media and applied migration history. Do not merge Alpha wholesale to main, infer environment isolation from a name, or relabel retained data disposable. A code rollback does not undo migrations.

Local composition alone does not publish a branch, trigger CI or deploy. Use the project's Git/CI process and verify the actual deployed SHA and health independently.

Duet can also coordinate the native deployment through the explicit persistent GitHub Actions adapter. Read the project contract and configure `.duet/alpha.json`; no coordinator initialization is needed. The adapter pins/checks the SHA, records intent, dispatches the configured workflow and reads its correlated result. The workflow must preserve data, revalidate SHA/CI and serialize deployments; CLI preflight is not a guarantee about arbitrary workflow code. It exposes no reset/import operations.

Review check commands to ensure they use local/synthetic resources. Hooks run code with the caller's filesystem/network access; reduced environment inheritance is not a sandbox. A check command can have side effects, so `alpha check` is not a read-only provider inspection.

## CLI capability and effects

With Node >=22.18 and a verified checkout/package, define `duet` below as:

`node /path/to/duet/src/cli.ts --project /path/to/project`

| Command | Effect and prerequisite |
| --- | --- |
| `freshness [--main main] [--remote NAME] [--remote-main BRANCH]` | Fetch main/current upstream refs and report drift; no init required, no working-file or local-branch edits. See [freshness](freshness.md). |
| `experiment resume ID` | Fetch and check that managed worktree before resuming; preserve its immutable baseline and dirty edits. |
| `issue-completion FILE` | Read-only supplied-observation assessment of acceptance, authorization and closure; no Git repository/coordinator, provider query or write. Follow [issue closure](issue-closure.md). |
| `--help` | Reads CLI help; no coordinator initialization needed. |
| `status`, `alpha plan [--ids A,C]`, `handoff A` | Read existing local configuration/state/Git. Need an initialized coordinator and applicable experiment records; never query the live provider. |
| `init` | Writes local coordinator configuration/runtime and ignore rules. Use only when choosing managed experiments. No fetching or deployment. |
| `experiment start/checkpoint/select/discard`, `handoff-import FILE`, `reconcile A` | Mutate local state/Git. Checkpoint may stage/commit changes; review scope. Import requires fetched objects. Reconcile records verified integration, not product acceptance. |
| `alpha compose [--ids A,C] --approve-hooks`, `alpha check --approve-hooks`, `harden A --approve-hooks`, `harden-check A --approve-hooks` | Write local coordination evidence/worktrees as applicable and execute configured checks. No automatic remote publish. |
| `alpha deploy --sha FULL_SHA --dry-run` | With persistent `.duet/alpha.json`, read-only provider preflight; no writes or dispatch. |
| `alpha deploy --sha FULL_SHA --approve-deploy` | Persistent project-native dispatch after exact-SHA checks; writes ignored local intent before sending. Submitted is not deployed. Requires reviewed protocol/config and real permissions. |
| `alpha deployment-status` | Reads the last correlated provider workflow result; does not verify live health or artifact contents. No local request is not proof of no deployment. |

`--dry-run` prevents hooks/Git/state writes, but for most commands it only echoes the requested operation; it does not fully validate execution prerequisites or prove the operation would succeed. Alpha dry runs also calculate a local plan. Missing local state can therefore prevent an Alpha dry run, without preventing the skill's ordinary Git workflow.

## Initialization and existing configuration

`init` writes `.duet/config.json` with no checks configured. Add explicit local checks before compose, check or harden; they need no deployment credentials. Changed check configuration invalidates earlier check evidence, so rerun the applicable checks.

The CLI has no built-in deploy hook. Deployment goes through the project's own CI/CD, optionally coordinated by `.duet/alpha.json`. Configurations written by versions before 0.26 may still contain `deploy` and `alpha` fields under `hooks`; they are ignored and never rewritten. Do not create local coordinator state just to use the skill.

## Authorization and reporting

Continue within applicable existing authorization for the task, target and scope; do not ask for a fresh approval merely because a local handoff was generated. If authorization is genuinely missing/changed or a real host/upstream gate blocks the next action, state that exact prerequisite and follow it. A label, flag, skill, local handoff or receipt cannot grant permission. Continue independent authorized work when a dependent action is blocked.

Report which workflow path was used, pinned SHAs, actual local/remote checks and provider evidence where inspected. Distinguish local candidate/receipt, submitted dispatch and verified deployment. Never claim a collaborator's host loaded the updated skill without observing that installation/session.

For persistent mode, the fixed protocol sends only `expected_sha` and a unique `duet_request_id`; any project-specific maintenance/import inputs must default off. Preserve uncertain receipts; use deployment-status rather than blind retry. A confirmed failed run requires explicit `--retry` after inspecting effects. Workflow success is narrower evidence than verified live health. Repository maintainers should read `docs/persistent-alpha.md` in the Duet package before configuring the workflow.
