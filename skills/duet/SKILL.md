---
name: duet
metadata:
  version: "0.26.2"
description: Coordinate a two-role team where one person prototypes ideas and another engineers the chosen ones for production, both working through coding agents. Use for prototype experiments, Alpha previews, handoff, hardening selected work onto main, cleanup of finished branches, and "what is next / show TODOs / 有什么 todo" questions in a project that uses Duet.
compatibility: Requires Git. The optional CLI needs Node.js 22.18 or newer. Pairs with the suo Skill when the project uses Suo for product definitions; Suo is recommended, not required.
---

# Duet

Duet is a workflow for **two roles that both work through coding agents**:

- the **prototyper** turns ideas into working prototypes and decides which ones are worth keeping;
- the **engineer** makes the chosen ones robust and production-ready, and owns what reaches `main`.

The roles differ in who is responsible for code quality. A prototype only has to express the idea well enough to judge it. It may reach the Alpha preview, but it never goes into `main` as-is. Duet keeps those two speeds from blocking each other: prototypes move fast and stay isolated, and only selected work is hardened on a clean branch.

Duet does not fit a team where everyone is responsible for production quality; ordinary pull-request review already covers that. If no code in the project should reach a preview without also being ready for `main`, say so and use the project's normal process.

## Decide the role for this task

A role belongs to the task, not to the person. Decide it from the request and the project instructions:

| The user wants to… | Role | Path |
| --- | --- | --- |
| try an idea, change how something looks or behaves, see it running | prototyper | [Prototype](#prototyper-path) |
| take selected work to `main`, review, fix, release | engineer | [Harden](#engineer-path) |
| fix a bug that restores already agreed behavior | either | ordinary reviewed PR; no experiment needed |

If the request does not show which role applies and the difference changes what you would do, ask one short question. Never treat a role label, a name or a phrase as proof of identity or as permission.

## Rules for both roles

- **Project instructions come first.** Read the project's own instructions, deployment workflows and `.duet/` configuration before acting. Branch names, checks, URLs and deployment triggers are project policy, not part of this skill.
- **This skill grants nothing.** It is workflow guidance. It does not authenticate anyone, grant permissions or replace the host agent's confirmation policy. When authorization is missing, stop the dependent step, say exactly what is missing, and continue independent work.
- **Start from fresh remote state.** At task start, on resume, and before a PR, merge or deployment, follow [freshness](references/freshness.md). A failed fetch means freshness is unknown. Never stash, reset or force-push to get there.
- **Push at meaningful checkpoints**, before a handoff, and before ending a turn that created commits. Report anything that exists only locally.
- **Use the CLI when it helps, Git when it does not.** The optional CLI coordinates pinned experiments locally; ordinary Git and the project's CI/CD are equally valid. Read [execution](references/execution.md) before choosing commands. Do not stop because a command is unavailable.
- **Evidence is exact.** Report the SHAs you actually checked. Keep planned, dry-run, submitted and verified apart. A local record is not a deployment.

## Prototyper path

The goal is a running preview of the idea, with as little ceremony as possible.

1. **Start an experiment** on its own branch and worktree from the current `main`. Never start from Alpha or from another experiment. If the idea needs another experiment, declare that dependency instead of quietly including it.
2. **Build the smallest thing that shows the idea.** Robustness, test coverage and production configuration are the engineer's job later. Do not spend the prototyper's time on them, and do not present a prototype as production-ready.
3. **Checkpoint** when the prototype shows something worth looking at. A checkpoint pins an exact commit and records what it does and how to tell that it works (a description and acceptance criteria, or Suo Units, see [Suo](references/suo.md)).
4. **Put it in Alpha.** Alpha is a preview composed from `main` plus explicitly selected checkpoints. Its code is replaceable; its users and data are not. A conflict stops composition: report it, never drop or rewrite an experiment to get past it. Follow [boundaries](references/boundaries.md) for data, secrets and migrations.
5. **Select or discard.** The prototyper decides which experiments are worth keeping. Selecting for Alpha is not approval to release.
6. **Hand off** the selected checkpoint. The handoff names the exact commit, what it is meant to do, how to accept it and what it depends on. Record who is meant to pick it up separately from whether they have; a handoff does not prove anyone accepted or started the work.

A prototyper's agent does not merge to `main`, deploy outside Alpha, or change repository protections.

## Engineer path

The goal is to make one selected piece of work correct and maintainable, without dragging the rest of Alpha along.

1. **Read the handoff** and check that it is still current: the selected checkpoint has not moved and its description and acceptance criteria are concrete. If something is missing, ask for that specific thing instead of guessing.
2. **Harden on a fresh branch from the latest `main`.** Apply only the selected checkpoint and its declared dependencies. Never branch from Alpha or merge Alpha into `main`.
3. **Do the engineering.** Rework the prototype as far as needed: tests, failure handling, security, migrations and rollback, documentation. Passing Alpha checks is not hardening evidence. If the project declares an engineering standard, apply it here.
4. **Feed back what changed.** If hardening changes user-visible behavior, tell the prototyper before merging; that is a product decision, not an engineering detail.
5. **Review and merge** through the project's real process and protections. A local flag or record cannot approve a merge. Approval of one SHA or environment does not cover another.
6. **Reconcile.** After the merge, record it, recompose Alpha from the new `main` plus the remaining selections, close what the acceptance criteria say is done ([issue closure](references/issue-closure.md)), and clean up this task's temporary branches ([cleanup](references/cleanup.md)).

## Product definitions

When a request changes user-visible behavior, scope or acceptance criteria, compare it with the current product definition before implementing. Carry forward a decision the user has already made; do not ask for the same approval twice. Brainstorming, praise, quoted speech and tentative suggestions are not decisions.

Projects that use [Suo](https://github.com/stevenlyd-tools/suo) keep those definitions as Units, and Duet's stages map onto Suo's states. This is the recommended setup; read [Suo](references/suo.md). Projects without Suo carry the same information in the checkpoint's description and acceptance criteria.

## Finding and tracking work

For "what is next" or "show TODOs", and before recording follow-up work, read [tracking](references/tracking.md). GitHub Issues in the owning repository are the shared index of work. Listing work does not authorize implementing or closing it.

## References

| Read | When |
| --- | --- |
| [execution](references/execution.md) | before choosing CLI commands or a Git-only path |
| [freshness](references/freshness.md) | at task start or resume, and before PR, merge or deployment |
| [boundaries](references/boundaries.md) | before Alpha deployment, review or release: data, secrets, migrations, human gates |
| [suo](references/suo.md) | the project uses Suo, or a handoff needs acceptance criteria |
| [tracking](references/tracking.md) | TODO discovery, follow-up capture, handoff ownership |
| [delivery](references/delivery.md) | reporting what was delivered; project preflight; installation diagnostics |
| [issue closure](references/issue-closure.md) | closing Issues after verified delivery |
| [cleanup](references/cleanup.md) | removing temporary branches after a merge or abandonment |

## Report back

Say which role you acted in and which path you took. Give the experiment or checkpoint, the base and result SHAs, declared dependencies, the checks you actually ran and their results, and deployment evidence if any. Name the next step and who owns it: the prototyper (look at the preview, select, decide) or the engineer (harden, review, merge). Leave out secrets. If something is blocked, name the exact missing permission or prerequisite.
