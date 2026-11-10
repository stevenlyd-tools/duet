# Release process

`package.json` is the release version authority. The existing distribution generator
synchronizes native plugin manifests and the distribution lock; keep one canonical
skill tree and existing native installation channels. GitHub Releases are human
upgrade records and immutable source identities, not npm publication, deployment,
or proof that a host has installed/reloaded a plugin. No release assets are uploaded;
GitHub's source archives contain the tagged repository. Follow [native distribution](distribution.md).

## Format and compatibility

Use root `CHANGELOG.md`, an `Unreleased` section, then descending stable
`MAJOR.MINOR.PATCH` sections dated `YYYY-MM-DD`. Keep nonempty Keep a Changelog
categories (Added, Changed, Deprecated, Removed, Fixed, Security) as applicable.
Every version must explicitly state Breaking changes and Migration, including
"None" where appropriate. Summarize user-visible behavior with PR/source links;
do not paste a commit log or invent historical dates. Backfills label their source
merge dates; GitHub records actual publication time separately.

Compatibility covers CLI commands/output, schemas/configuration, install contracts,
and skill instructions/workflow behavior. Before 1.0, use a minor bump for breaking
contracts or new functionality, patches for compatible fixes and release maintenance.
At/after 1.0, incompatible changes require a major bump. Shipped skill text counts as
product behavior. Never reuse a published version or move a release tag.

## Prepare and merge

1. Fetch remote main/tags, branch from current main, inspect existing releases/tags.
2. Update package version; move reviewed Unreleased notes into the matching dated
   section. Describe migration/rollback requirements and link source evidence.
3. Run `npm run distribution:generate` (Suo: build first if runtime source changed).
   Do not hand-edit generated manifests. Do not change marketplace identity,
   permissions, host caches, or plugin schemas as a release bookkeeping step.
4. Run:

```sh
npm run check
npm run release:check
npm run release:notes
```

5. Open a PR. Existing CI checks metadata/payload version increases and validates
   notes. Wait for **all checks on the latest PR head** and resolve review blockers
   before merging. No CI write permission or new credential is required.
6. Fetch main again, use a clean checkout of the exact merged commit, and wait for
   its push CI to succeed. The release date should be the intended publication date;
   if delayed across dates, correct it in a reviewed PR before publication.

## Publish with existing maintainer permissions

```sh
node scripts/release.mjs publish FULL_40_CHARACTER_MAIN_SHA
```

The command validates the current version/notes, clean exact checkout, current remote
main, distribution consistency, and latest successful repository push CI. It checks
existing tags/releases, creates a missing immutable `vVERSION` ref at that SHA,
then uses `gh release create --verify-tag --notes-file` with exactly that version's
changelog body. Existing matching releases are no-ops; conflicting tags/bodies,
failed/pending/missing CI, or API failures stop publication. The maintainer still
verifies PR review completion and every required check before invoking it.

Use existing `gh` authentication with repository release/ref write access. If denied,
stop and report the missing grant; do not refresh scopes, provision tokens, change
Actions permissions, or bypass branch/tag rules. CI remains read-only. No chained
`release.published` workflow, registry publication, or deployment is assumed.

If a network failure leaves an uncertain result, inspect the remote tag and release
before retrying. A created tag with no release can be retried at the same SHA.
Never delete/move it to recover. After publication, verify the URL, tag commit,
version, and body. Correct a factual note through a reviewed changelog change and
explicitly reviewed release edit; do not silently replace the artifact.

## Backfill and provenance

This initial record covers the latest verified behavior changes, not every old
version. Older GitHub releases/tags remain untouched. Publishing a historical
version requires separately verifying its original commit, package version, passing
checks and source notes; never tag today's code as an older version. The normal
publisher intentionally handles only the current main version.

## Official conventions reviewed 2026-10-21

- [Agent Plugins standard layout and plugin versions](https://agent-plugins.org/specification): root CHANGELOG.md is shown; plugin versions should follow SemVer. No changelog manifest field or mandatory prose syntax.
- [Agent Skills specification](https://agentskills.io/specification): optional version metadata does not prescribe changelog syntax.
- [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html): human-readable version history and compatibility semantics.
- [Claude publishing](https://code.claude.com/docs/en/plugins/publish) and [loading](https://code.claude.com/docs/en/plugins/loading): version changes matter for cached updates.
- [OpenAI native plugin packaging](https://developers.openai.com/plugins/build/plugins): retain native metadata and discovery.
- [Gemini extension releases](https://geminicli.com/docs/extensions/releasing/): preserve Git/ref distribution; no new release asset channel is introduced.
- [GitHub CLI release creation](https://cli.github.com/manual/gh_release_create): verified tags and a notes file preserve explicit identity/content.
