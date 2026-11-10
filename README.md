# Duet

Duet is a workflow for two roles that both work through coding agents:

- the **prototyper** turns ideas into working prototypes and decides which ones are worth keeping;
- the **engineer** makes the chosen ones production-ready and owns what reaches `main`.

It ships as an [Agent Skill](https://agentskills.io) that tells each person's coding agent how to behave in their role, plus an optional CLI that keeps the bookkeeping exact.

## The problem

Coding agents let someone with product sense and no engineering background build a working prototype in an afternoon. That is valuable, and it creates a new problem: the prototype works, people want to try it, and nobody has decided whether its code is fit for production.

Teams usually pick one of two bad answers. Either every prototype waits for full engineering review, and the prototyper slows to the engineer's pace. Or prototypes are merged as they are, and `main` fills with code nobody is responsible for.

Duet keeps the two speeds apart:

```
prototyper                                              engineer

experiment ──► checkpoint ──► Alpha preview ──► select ──► handoff ──► harden ──► main
(own branch)   (pinned SHA)   (main + selected             (one pinned  (fresh branch
                               checkpoints)                 checkpoint)  from main)
```

- Every idea is an isolated **experiment** on its own branch, started from `main`.
- A **checkpoint** pins an exact commit together with what it does and how to tell that it works.
- **Alpha** is a preview composed from `main` plus the checkpoints the prototyper selected. People can use it. Its code is replaceable; its users and data are not.
- The prototyper **selects** what is worth keeping and **hands off** one pinned checkpoint.
- The engineer **hardens** it on a fresh branch from `main`: only that checkpoint and its declared dependencies, reworked as far as production needs. Alpha itself is never merged.

Unselected experiments stay in Alpha, or get discarded, without ever touching `main`.

## Is this for you?

Duet fits when the answer to this question is yes:

> Is there code in your project that should reach a preview, but should not go into `main` as it is?

That is the case when one side of the team is not responsible for production quality: a founder or product manager who prototypes with an agent next to an engineer, a designer next to a developer, or one person who deliberately separates "trying things" from "shipping things".

A role belongs to a task, not to a person. The same person can prototype one change and engineer another.

Duet does **not** fit a team where everyone is responsible for production quality. Ordinary pull-request review already covers that, and Duet would only add ceremony. It also assumes both roles work through coding agents; the skill is written for agents to follow, not as a process handbook for people.

## Install

Duet is a plain skill directory with native plugin manifests. Install it through your agent host:

| Host | Install |
| --- | --- |
| Claude Code | `claude plugin marketplace add stevenlyd/duet`, then `claude plugin install duet@stevenlyd-duet` |
| Codex | `codex plugin marketplace add stevenlyd/duet`, then choose `duet` in the Plugins UI |
| GitHub Copilot CLI | `copilot plugin marketplace add stevenlyd/duet`, then `copilot plugin install duet@stevenlyd-duet` |
| Gemini CLI | `gemini extensions install https://github.com/stevenlyd/duet.git` |
| Pi | `pi install git:github.com/stevenlyd/duet` |

Cursor, Copilot in VS Code, Hermes, updates and pinning are covered in [distribution](docs/distribution.md). Both people install it; each agent then works out its role from the request and the project's instructions.

The skill works with ordinary Git and your existing CI/CD. The CLI is optional and needs Git and Node.js 22.18 or newer, with no dependencies:

```sh
git clone https://github.com/stevenlyd/duet.git
alias duet='node /path/to/duet/src/cli.ts'
```

## A first round

You normally just talk to your agent ("try a dark mode toggle", "put it in Alpha", "harden the toggle"). These are the commands it runs for you, in a project with the CLI initialized:

```sh
duet --project . init
```

Review and commit `.duet/config.json`. Add the checks that should pass before something enters Alpha ([example](docs/config.example.json)).

**Prototyper**

```sh
duet --project . experiment start dark-mode
# build and commit the prototype in the reported worktree

duet --project . experiment checkpoint dark-mode --select \
  --description "Dark mode toggle in settings; colors are rough" \
  --acceptance "The toggle switches the theme and survives a reload"

duet --project . alpha compose --approve-hooks   # main + selected checkpoints, then checks
duet --project . handoff dark-mode               # the pinned handoff for the engineer
```

**Engineer**

```sh
duet --project . harden dark-mode --approve-hooks
# rework, test and commit in the reported worktree; open a PR; review; merge

duet --project . reconcile dark-mode --merged FULL_SHA
duet --project . alpha compose --approve-hooks   # Alpha from the new main + what is still selected
```

The full procedure, including conflicts, dependencies between experiments and recovery, is in [workflow](docs/workflow.md).

### Deploying Alpha

The CLI never runs a deployment command of its own. Deploying is your project's CI/CD. Duet can coordinate a GitHub Actions workflow that you declare in `.duet/alpha.json`, pinned to an exact commit:

```sh
duet --project . alpha deploy --sha FULL_SHA --dry-run
duet --project . alpha deploy --sha FULL_SHA --approve-deploy
duet --project . alpha deployment-status
```

See [persistent Alpha](docs/persistent-alpha.md). Alpha keeps real users and data across deployments; Duet has no reset, reseed or import operation.

## Suo: recommended, not required

A handoff has to say what the work is meant to do and how to accept it. Without anything else, that lives in the checkpoint's description and acceptance criteria.

[Suo](https://github.com/stevenlyd/suo) is a separate skill that keeps product definitions as versioned Units with states. With it, handoffs reference Units instead of free text, Duet's stages map onto Suo's states (`proposed` → `experimental` → `approved` → implemented), and `duet completion` can check that what was merged covers what was decided. See [Duet with Suo](skills/duet/references/suo.md).

Likewise, Duet does not prescribe an engineering standard for the hardening step. If your project declares one in its own instructions, the engineer's agent applies it.

## What Duet does not do

- **It is not access control.** Roles are conventions. The skill authenticates nobody and grants nothing; branch protection, reviews and deployment gates stay with your repository and CI provider.
- **It does not sandbox anything.** Configured checks run as ordinary commands after explicit `--approve-hooks`. Review them first. See [security](docs/security.md).
- **It does not manage staging or production.** After hardening, releases follow your existing process.
- **It does not sync experiments with `main` automatically.** A conflict stops composition and is reported; nothing is dropped or rewritten to get past it.
- **No Git LFS** and no external diff, merge or filter drivers; the CLI fails closed on them.

## Repository layout

| Path | What |
| --- | --- |
| `skills/duet/SKILL.md` | the workflow agents follow; `references/` are loaded only when needed |
| `src/` | the optional CLI (TypeScript, run directly by Node) |
| `docs/` | [workflow](docs/workflow.md), [persistent Alpha](docs/persistent-alpha.md), [security](docs/security.md), [distribution](docs/distribution.md), [releases](docs/releases.md) |
| `plugin.json`, `.claude-plugin/`, `.agents/plugins/`, `gemini-extension.json` | generated plugin manifests |

## Development

```sh
npm run check
```

This runs the test suite and verifies the generated manifests and the changelog. After changing anything under `skills/` or `src/`, bump the version in `package.json` and run `npm run distribution:generate`. See [releases](docs/releases.md).

## License

[MIT](LICENSE)
