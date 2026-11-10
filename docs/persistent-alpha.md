# Persistent Alpha through Duet

Duet can deploy code to retained-data Alpha by coordinating an explicitly configured project GitHub Actions workflow. Ordinary deployment does not make data disposable. No reset, reseed, destructive cleanup or import command/input is exposed by this adapter.

## Project contract

Review and commit `.duet/alpha.json` using [the example](persistent-alpha.example.json); add `/.duet/alpha-deployments/` to `.gitignore`. No `.duet/config.json`, managed experiment or `init` is required. Use the actual repository, branch and workflow filenames; the core contains no project-specific identifiers. Only github.com is supported. Use an installed/authenticated `gh` on PATH and actual repository/Actions permissions; no credentials belong in config. The adapter uses fixed `gh api --hostname github.com` argv calls, never an arbitrary command.

The reviewed project workflow must implement this protocol:

- Accept string inputs `expected_sha` (full lowercase SHA) and `duet_request_id` (UUID). All other workflow inputs must default to ordinary data-preserving code deployment. Use run-name `Duet Alpha <duet_request_id>` exactly for correlation; empty IDs may retain a separate manual route.
- Reject an invalid request ID and, for Duet requests on any allowed branch, require exact `expected_sha == github.sha` and reject maintenance/import. Revalidate the latest successful same-repository, same-branch, same-SHA **push** run of the configured check workflow at execution. CLI preflight cannot eliminate branch/CI races after dispatch.
- Pin checkout, reviewed migrations and release artifacts to that SHA. Serialize deployments with project workflow concurrency; local locks do not coordinate machines. Preserve real users/data and applied migration history. Use normal scoped Alpha credentials and existing environment gates.
- Fail on deployment/migration/health errors and publish the project's usual release evidence. A failed run may have applied migrations: inspect before retry; no automatic rollback or reset is implied.

The CLI validates config, provider identities, preflight evidence and correlation. It cannot prove that arbitrary workflow code preserves data or enforce a reviewer assertion about infrastructure. Review the actual workflow, credentials and migration guards before enabling the configuration. The project workflow remains the enforcement point. Existing manual deployment authority is unchanged.

## Commands

With Node >=22.18 and a verified Duet package, use:

```sh
node /path/to/duet/src/cli.ts --project /path/to/project \
  alpha deploy --sha FULL_40_CHARACTER_COMMIT_SHA --dry-run
node /path/to/duet/src/cli.ts --project /path/to/project \
  alpha deploy --sha FULL_40_CHARACTER_COMMIT_SHA --approve-deploy
node /path/to/duet/src/cli.ts --project /path/to/project alpha deployment-status
```

First compose/push the intended project branch using ordinary Git or local coordination as appropriate; the adapter does not push, merge or change branches. Persistent dry-run performs read-only provider preflight and does not initialize/write local state or dispatch. `--approve-deploy` records local consent within existing authorization, not authentication or a host-policy bypass. `--approve-hooks` is rejected in persistent mode.

The adapter checks branch SHA twice around checking the latest push run/current attempt. It records and fsyncs intent before POST, then sends only the two fixed inputs. A successful POST returns **submitted**, never deployed. `alpha deployment-status` is a provider read of the correlated workflow result and does not update receipt files. It validates repository, head repository, SHA, branch, event, workflow path and unique request title. It reports pending, failed or succeeded; failed/uncertain outcomes exit unsuccessfully. Succeeded means the workflow succeeded, not that this CLI independently inspected release artifact contents or live health. Inspect those separately before claiming full release verification. No local receipt means no local request, not an undeployed environment.

Missing/access-denied/incomplete provider results are not empty queues. Unknown POST outcome or no visible correlated run blocks redispatch, even with `--retry` or changed config/SHA. Preserve the receipt and inspect provider state; never delete it to bypass uncertainty. A confirmed failed run needs explicit `--retry` after inspecting migration/provider effects. A successful same-config/same-SHA request is idempotent. Previous request archives remain local; the latest receipt tracks one operation at a time. Cross-host request suppression is not provided; coordinate operators and retain project concurrency safeguards.

## Compatibility

`.duet/alpha.json` is the only deployment configuration. Before 0.26 a `.duet/config.json` could also carry a `deploy` hook for disposable targets; that hook was removed. Such fields are ignored and never rewritten, and existing experiment state is preserved. No data migration is involved.
