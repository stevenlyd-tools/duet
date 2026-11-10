# Duet review and environment boundaries

## Selection and dependencies

For a selected experiment, record both direct and transitive dependencies with immutable commits. A dependency already present in the new `main` base does not need to be applied again. If a selected change depends on an unselected experiment, explain the smallest dependency closure and ask the human to approve including it or revise the change to remove that dependency. Selection of A is not approval of B/C.

Compare the hardening diff with its latest-main base. Verify the resulting behavior and commit ancestry, not only branch names. Shared changes cherry-picked under different hashes still count as dependencies. Record any integration fix needed to make A work on newer main and review that fix with A.

## Data and secrets

- Alpha gets a separate database and isolated credentials. Prefer synthetic data in local experiments. Live Alpha can hold real users’ data: preserve it by default and run schema changes through the project’s migration process. Its credentials must not be able to reach staging or production resources.
- Keep secrets out of Git, skill files, manifests, receipts, prompts, logs, and screenshots. Refer to configured secret names or handles only. Never echo a connection URL containing credentials to demonstrate isolation.
- An Alpha database reset needs explicit authorization for the specific target and operation; environment isolation alone is not reset permission. Check provider/project/database identity and isolation before executing destructive steps. A string containing `alpha` is not proof.
- Staging and production must have separate configured targets and access controls. Review database migrations, backward compatibility, backups, and rollback before manual release approval. A code rollback may not reverse a destructive migration.
- Missing provider setup or credentials is a blocker, not permission to create accounts, broaden access, or substitute another environment. A local mock demonstrates the workflow only; it does not establish a real deployment or database.

## Review packet and human gates

The review packet should identify the exact hardening SHA, latest-main base SHA, selected experiment and pinned source SHA, approved dependency closure, scoped diff, test/security results, migration/rollback implications, and known gaps. Label evidence that is local, simulated, unavailable, or unverified.

Human approval must come from the authorized human through the upstream review/release mechanism. Local records may aid auditability but are editable data and must not be treated as credentials, signed attestations, branch protection, or deployment authorization. Check actual provider permissions; never claim that generated instructions enforce them.

Inspect actual project triggers; do not add a manual staging gate when CI already deploys staging. Bind each required manual staging/production decision to one target and full immutable SHA. If code, dependencies, configuration with security/release impact, or the target changes, obtain a new applicable decision. Confirm the provider's final deployment identity and health status; do not equate a successful CLI exit, mock receipt, branch name, or accepted job with a healthy production release.
