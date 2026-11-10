# Security boundaries

## What Duet does and does not isolate

Git worktrees and pinned commits separate code changes. They are not process, filesystem, network, credential, or tenant sandboxes. Any code run by a hook has the operating-system permissions of the account running Duet. It can read accessible files, use the network, spawn other processes, and perform destructive actions.

Duet's local state, role guidance, and agent instructions are not authentication or tamper-proof access controls. Anyone with write access to the project and state can alter them. Use host permissions, code review, separate accounts, provider controls, and protected branches for real boundaries.

## Hook approval

Configured checks require explicit `--approve-hooks`. Review both:

- The hook configuration, including executable, arguments, and timeout
- The code that those commands execute at the exact candidate or hardening commit

Review transitive scripts, package-manager hooks, dependencies, and executable resolution as well. An innocent-looking command may execute changed code. Shell interpretation is not automatic because hook commands use argv arrays, but explicitly invoking a shell, Node, Python, or a package manager can still run arbitrary code.

The flag records explicit local consent, not identity. Agents may use it within valid existing bounded authorization; they must not infer new permissions from a past flag. Any authorized collaborator can iterate within the project's supported Alpha route and that authorization without inventing a new product decision at every step. The host or assistant's actual permission policy still applies. A dry run does not run the hooks.

## Environment and credentials

Hooks receive a reduced environment and temporary home directory. Additional variables must be deliberately listed in `hooks.envAllow`; invalid and high-risk credential variable names are rejected. Treat this as accidental-leak reduction, not a security perimeter.

Environment filtering does not remove credentials embedded in code, configuration, files reachable by absolute paths, cloud metadata endpoints, command arguments, or inherited network access. `PATH` can resolve an untrusted executable. Temporary `HOME` does not prevent reading the user's real home when the process otherwise has access.

The checkpoint guard rejects several risky filenames, such as `.env` and private-key files. It is not a content secret scanner and cannot prove a diff is safe. Review staged and committed contents before checkpointing or sharing.

Checks need no deployment credentials; do not add any to `envAllow`. Alpha deployment belongs in the project's existing CI/CD with appropriate migration and recovery procedures. If that workflow needs a credential, provision the least-privileged alpha-only credential through the CI provider's secret store. Do not commit it or put it in checkpoint text.

The hooks do not persist stdout/stderr in Duet state because command output may accidentally contain secrets. Exit status is evidence about the command result; it is not proof of safety or an independent audit of the deployment provider.

## Deployment

The CLI never runs a deployment command itself. It can coordinate a project's own GitHub Actions workflow through the [persistent Alpha configuration](persistent-alpha.md): it records intent before dispatch, suppresses retry when the outcome is uncertain, and distinguishes workflow success from live verification. The project workflow owns exact-SHA checks, migration protection, concurrency and the actual deployment. Publishing code does not authorize reset, import or destructive data changes. No staging or production deployment interface is provided.

An environment name is not proof of isolation. Validate account IDs, resource permissions and endpoints independently.

## Git driver boundary

Duet disables Git hooks and filesystem monitors for its own Git commands and rejects configured external clean/smudge/process filters and merge drivers, including globally installed Git LFS drivers. This conservative check applies even when no current file uses the driver. Use a reviewed isolated plain-Git environment; do not disable a needed driver on an existing LFS project or pretend raw pointer files are its actual content.

The test suite ignores ambient global/system Git configuration for its own process tree, then configures a repository-local external driver and asserts that Duet rejects it. This does not change user-machine settings or relax the runtime guard.

## Source and state integrity

- Use validated experiment identifiers, reviewed configuration, and explicit project paths.
- Keep experiment branches independent. Pin reviewed checkpoints rather than using moving tips.
- Review all declared dependencies and the composed commit before checking or deploying.
- Keep the main worktree and managed worktrees clean when performing coordination operations.
- Treat a conflict as an unresolved change, not a reason to merge or reset unrelated branches.
- Keep runtime coordination state local and ignored. The portable project configuration is tracked; never place credentials in it. A deliberately exported handoff can be shared with an approved engineer along with approved Git refs. Do not publish runtime state as a credential store or assume it is a shared team transaction log.
- Retain normal Git and provider backups. Duet is not a disaster-recovery system.

## Agents and plugins

The skill and its plugin manifests are plain workflow instructions for coding-agent hosts. They ship no hooks, MCP servers or settings, and cannot confer permissions, establish identity, or replace repository policy. Host-specific restrictions and required confirmations continue to apply.

## Staging and production

An engineer reviews and hardens an isolated main-based branch. The existing release system then promotes an exact reviewed SHA with its normal controls. Keep production deployment credentials away from the prototype/alpha execution environment. Duet's “engineer” role is procedural guidance; production authorization belongs to your team and deployment provider.
