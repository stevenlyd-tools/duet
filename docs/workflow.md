# Duet operating procedure

This is the step-by-step procedure for the optional CLI. The [skill](../skills/duet/SKILL.md) defines the workflow itself; everything here can also be done with ordinary Git and the project's CI/CD.

## The invariant

Alpha is an integration preview assembled from main plus an explicit set of immutable experiment checkpoints. Its code is replaceable; its users and data are not. Production work starts from main and receives only the selected experiment and its declared prerequisites. Never promote the alpha branch wholesale.

There are two roles:

- The **prototyper** creates isolated experiments, explains their intent, records acceptance criteria, and selects checkpoints for alpha.
- The **engineer** reviews a pinned handoff, hardens it on a fresh main-based branch, tests and reviews the exact diff, and uses the team's existing release process.

Roles belong to tasks, not people: the same person may prototype one change and engineer another. Both roles work through coding agents. These are collaboration conventions. Duet is a local tool, not an identity system, authorization server, or enforcement of who may prototype or release.

## 1. Choose tooling and review configuration

Load the Duet skill and apply it even when the CLI is unavailable or unsuitable. Ordinary Git and project CI/CD are supported; do not initialize merely to demonstrate tool use. The following initialization steps apply only when local managed experiments are useful. See [command effects and compatibility](../skills/duet/references/execution.md).

1. Choose one Git project and its local main branch. Begin with an initial commit and a clean working tree.
2. Run `duet --project PATH init --main main`.
3. Review `.duet/config.json`. Configure the smallest useful local check. The CLI has no deploy hook; Alpha deployment uses the project's CI/CD (see step 5).
4. Check that no production secrets, databases, buckets, accounts, or network destinations are involved. A target name containing “alpha” is not proof of isolation.
5. Commit the portable `.duet/config.json` and generated `.gitignore` rules after review. Runtime state and worktrees remain local and ignored; they are not a shared team database or deployment provider history. Never store secrets in the tracked config.

Use a single coordinator for mutations. Do not edit the state file, manually repoint Duet-managed refs, or delete its worktrees while a command is running.

## 2. Start an experiment

```sh
duet experiment start A
```

Work only in the returned worktree. A separate experiment gets a separate identifier and worktree. Use simple, stable identifiers accepted by the CLI; do not use paths, option-like names, or shell snippets as IDs.

If C truly requires A, declare that relationship at creation:

```sh
duet experiment start C --depends A
```

Dependencies are part of the review scope. Do not silently copy code from another experiment and describe the result as independent. Inspect the plan before composition and the handoff before hardening. If the tool refuses an incomplete or incompatible dependency selection, resolve it explicitly instead of bypassing the guard.

### Refresh when main moves

Follow the [remote freshness procedure](../skills/duet/references/freshness.md) at task start/resume, before editing existing branches, and before PR/merge/deploy. `experiment start`, `harden` and `alpha compose` fetch and use verified remote main without moving local main. Local-only status/plan/handoff do not fetch. For ordinary Git, fetch both main and the actual branch upstream; integrate incoming shared work safely, then refresh from main when appropriate, test and pin a new SHA.

Duet records an immutable experiment baseline and has no refresh command. Create a new experiment ID from updated main, transfer only the outstanding selected commits/diff (with declared dependencies), and checkpoint it. Inspect the diff, then discard the old selection and recompose. Do not merge main into an old managed experiment and checkpoint the combined diff: unrelated main changes can enter its snapshot. Do not edit state to hide a baseline mismatch. Preserve the old branch/checkpoints for reference.

## 3. Checkpoint and select

Review and commit the intended changes in the experiment's own worktree, then record the checkpoint. Checkpointing may stage and commit a dirty worktree; explicit review and committing first avoids pulling unrelated edits into the snapshot:

```sh
duet experiment checkpoint A \
  --description "What this experiment changes and why" \
  --acceptance "Concrete observations that make it worth keeping" \
  --select
```

Use clear, falsifiable acceptance criteria. Commit only the intended experiment. Review for credentials and unrelated edits before committing.

The selected checkpoint is pinned. New commits on the experiment branch do not automatically enter alpha. To update it, record another checkpoint and explicitly select it. To return to an older recorded checkpoint:

```sh
duet experiment select A --checkpoint cp-1
```

Use the checkpoint identifier reported by Duet in place of `cp-1`. Link known limitations to the project-designated records using the follow-up policy below; checkpoint prose is supplementary. A successful basic check is not a claim of production readiness.

## 4. Compose alpha

```sh
duet alpha plan
duet alpha compose --approve-hooks
```

For an explicit subset, use `--ids A,C` and review any declared dependency requirements. The plan should give enough information to inspect which main commit, experiments, and checkpoint SHAs will be combined. A candidate is built in its own worktree, and composition runs the configured basic checks. It therefore requires explicit hook approval.

If composition conflicts, inspect the reported conflict and resolve the underlying experiments in their own worktrees. Record and select new checkpoints, then compose again. Do not resolve the conflict by making undocumented edits to the candidate or manually merging the alpha branch into main.

## 5. Check and deploy

Local composition does not push a branch or dispatch CI. Review the configured commands and the candidate code, then recheck the candidate whenever its inputs or the check configuration changed:

```sh
duet alpha check --approve-hooks
```

A failed composition or check never replaces the last good candidate. A changed candidate needs checks for that candidate, not an old success from another SHA.

Deployment belongs to the project's own CI/CD. Publish the composed branch through your normal Git workflow, then either use the project's workflow directly or let Duet coordinate it through a reviewed `.duet/alpha.json`:

```sh
duet alpha deploy --sha FULL_SHA --dry-run
duet alpha deploy --sha FULL_SHA --approve-deploy
duet alpha deployment-status
```

See [persistent Alpha](persistent-alpha.md). A submitted dispatch is not a deployment; verify the provider's release and the live application match the intended commit. If CI only accepts main, report experiment publishing as blocked rather than merging into main just to preview.

## 6. Review a pinned handoff

```sh
duet handoff A
```

Review and save the reported handoff and its exact checkpoint. It explains the purpose, acceptance criteria, dependencies, and source commits. The JSON report pins that review; it does not lock the experiment forever. Pass its checkpoint identifier to `harden --checkpoint` so a changed selection fails visibly instead of silently hardening a different idea.

For alpha containing independent A, B, and C, handing off A does not authorize shipping B or C. If A depends on another experiment, that prerequisite is part of the release scope and must be consciously reviewed.

## 7. Harden from main

With ordinary Git, merge a pinned experiment when all its ancestry is in scope, or cherry-pick the selected commits onto fresh main. Review the resulting diff and dependencies. There is no mandatory rewrite. The CLI below uses a three-way baseline-to-checkpoint patch and an import commit instead of preserving experiment ancestry. If using ordinary Git outside managed hardening, keep review evidence there; do not fabricate Duet reconciliation state.

```sh
duet harden A --checkpoint cp-1 --approve-hooks
```

`harden` fetches and uses verified remote main when a remote is configured. Use the reviewed checkpoint ID in place of `cp-1`. Inspect the reported main-based hardening branch and worktree. The engineer should:

1. Confirm the base main SHA and pinned experiment SHA are the intended ones.
2. Inspect the complete diff against main. Reject unrelated alpha content.
3. Replace prototype shortcuts, validate data migrations and error paths, and add appropriate tests.
4. Commit engineering changes in the hardening worktree and run `duet harden-check A --approve-hooks` to pin and check that exact HEAD. Reconciliation must use this reviewed result, not the original prototype import.
5. Run the project's full test and review process. Duet's basic hooks are an early gate, not a replacement.
6. Open a normal pull request or review for the hardening branch. Review production configuration and rollout separately.

Do not assume `harden` committed engineering changes, submitted a pull request, granted release permission, or deployed anything. Use the actual CLI result to locate what it created.

### Return engineering fixes to alpha

If a useful engineering fix should appear in alpha before release, explicitly cherry-pick only the additional fix commits into A's experiment worktree. Do not cherry-pick the original Duet import commits, merge the entire hardening or alpha branch, or copy unrelated experiments. Review the resulting diff, checkpoint A with updated acceptance criteria, select it, and recompose alpha.

A changed selected checkpoint needs a new reviewed handoff and a fresh hardening pass. Prefer feeding fixes back before the final hardening/release review. Duet has no automatic bidirectional sync.

### Transfer a handoff to another computer

Runtime state is local. A second clone needs both the reviewed JSON handoff and the referenced Git objects. Import creates checkpoint metadata and durable Git refs, not a copy of the prototyper's worktree. `harden` creates the receiving engineer's isolated worktree:

```sh
# Source project:
duet handoff A > /safe/review-location/A-handoff.json
# Publish only the approved source refs using your normal authorized Git workflow.

# Receiving clone, with the same committed project configuration:
duet init
# Fetch the approved refs using normal Git, then transfer the reviewed handoff file.
duet handoff-import /safe/review-location/A-handoff.json
duet harden A --checkpoint cp-1 --approve-hooks
```

Already-merged dependencies must be verifiable on the receiving main through commit ancestry, matching changed-file contents, or existing local reconciliation evidence. If engineering or a squash changed the original prototype contents, a foreign “merged” label alone is insufficient. Import fails closed; sync main and recreate/re-export the dependent work against that verified baseline, or reconcile it locally with appropriate evidence.

Reimporting the identical handoff is safe. A different checkpoint under an existing experiment ID is rejected rather than silently overwriting the receiver's work; coordinate a fresh clone or manually reconcile that work. This is a one-way reviewed transfer, not automatic synchronization.

Publishing a branch shares its reachable history, which can include later unselected work. Review that history and use an approved dedicated ref pinned to the checkpoint when needed; selecting a checkpoint does not limit what Git publishes. Publishing branches or transferring the report requires the normal explicit authorization for its recipients and data. Duet does not push, upload, grant access, or fetch objects for you. Review the imported checkpoint and dependency closure; the report is untrusted input until checked against the fetched Git objects and intended project identity. Keep the report outside the working tree, or intentionally ignore it, so it is not accidentally checkpointed.

## 8. Release and reconcile

Staging and production are outside Duet. Use the team's authorized release process to promote the exact reviewed SHA, with normal approvals, migrations, monitoring, and rollback.

Once the work is genuinely integrated into main, update local main and identify the actual merged commit:

```sh
duet reconcile A --merged ACTUAL_MAIN_COMMIT_SHA
duet alpha plan
duet alpha compose --approve-hooks
```

Use a SHA that represents the approved integration. Squash or rebased merges require particular care: an arbitrary ancestor of main does not prove the experiment was merged. Inspect the merged diff and the actual source/review record. Do not use reconciliation to mark unfinished work as shipped.

Review any dependents of the reconciled experiment, rebuild the remaining alpha selection from updated main, and run checks again before publishing it. Confirm there is no duplicate application of work that is now in main.

## Lifecycle cleanup

After merge or explicit abandonment, follow the [task-scoped cleanup procedure](../skills/duet/references/cleanup.md) automatically within existing authorization. Preserve durable handoff and issue records first. A completed PR can be cleaned after a squash merge even without source ancestry on main, provided its exact merged head and recoverability are verified. Keep managed checkpoints, dependent selections and live deployment recovery refs; discard/reconcile alone do not remove branches. This replaces indefinite retention of obsolete temporary branch names, not recovery evidence.

## Discard, dry runs, and recovery

An experiment or project failing is a valid outcome. Record the observation and what you learned in the project's normal notes, then discard the selection when the idea no longer helps. Retained branches and checkpoints preserve the work without forcing it toward production.

- `experiment discard ID` removes an unwanted experiment from the active workflow. Review the command result before assuming worktrees or source branches were deleted.
- `--dry-run` previews a mutation; it does not constitute approval to run hooks or change a provider.
- If a command fails, keep the full error and inspect `status` plus Git worktree/ref state before retrying.
- Preserve original experiment commits and the last good candidate until the replacement is verified.
- A manually changed or dirty managed worktree should be reviewed and cleaned by its owner. Do not use force-reset or broad deletion to make a guard disappear.
- Duet is local coordination state. Back up valuable commits through your normal Git remote. Back up any needed local metadata separately, without credentials.

## Acceptance walkthrough

In a throwaway fixture project:

1. Create independent experiments A, B, and C, each adding an identifiable file.
2. Commit, checkpoint, and select each. Compose and verify all three files are in the alpha candidate.
3. Make a check fail and confirm the candidate is marked `check-failed`. Restore the check and run `alpha check` again.
4. Handoff and harden A. Verify A's file is present and B's and C's are absent from the engineering branch.
5. Merge the reviewed A hardening result into main using normal review. Reconcile A, then rebuild alpha from updated main and the remaining selected experiments.
6. Exercise a conflict, an undeclared or missing dependency, an unapproved hook, and an invalid experiment identifier. Each should fail without disturbing the last good candidate.

The automated CLI suite covers the local behavior described by its assertions. Real provider behavior and coding-agent integration require separate validation in the intended environments.

## Work discovery and capture

Follow the [tracking reference](../skills/duet/references/tracking.md). GitHub Issues index ideas, exploration, definition, implementation, hardening and release. With [Suo](../skills/duet/references/suo.md), product definitions live in Units; without it, in the project's existing product notes. Product definitions and code may be promoted independently. Experiments are optional: fixes and definition-only changes can go straight to a reviewed PR. Completion follows the Issue's stated outcome, never a merge, a green CI run or a deployment alone.
