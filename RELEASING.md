# Releasing

This repository uses Changesets for package versioning and changelog generation.

## Prerequisites

- Installed dependencies: `pnpm install`
- NPM auth configured (`npm whoami` works) for publish
- Clean working tree

## Daily Development

For every change that should affect a published package:

1. `pnpm changeset`
2. Select affected package(s)
3. Select bump type (`patch` / `minor` / `major`)
4. Write a short release note
5. Commit code + `.changeset/*.md`

## Local Release Flow (release branch + tags + merge)

Recommended single-command flow:

```bash
pnpm release:local
```

This command:
- validates clean git tree
- runs dense pre-bump checks:
  - `pnpm release:check:prebump`
  - includes `typecheck`, package/app precommit checks, `build:all`, demo UI smoke e2e on emulator, and transport smoke e2e on emulator
- runs `changeset version`
- runs post-bump sanity checks:
  - `pnpm release:check:postbump`
  - includes `build:all` + package unit/integration tests
- creates release commit `chore(release): version packages`
- creates package tags
- creates one meta repository tag (default format `vYYYY.MM.DD-HHMM`)

Options:
- `pnpm release:local:publish` -> also publish to npm
- `pnpm release:local:gh` -> also create GitHub Release (requires `gh` CLI)
- `pnpm release:local:full` -> publish + create GitHub Release
- custom meta tag: `bash ./scripts/release-local.sh --meta-tag v0.2.0`

Recommendation: keep npm publish manual/explicit (`--publish`) to avoid accidental public releases.

## npm Publish from CI

`Publish Packages to npm` workflow (`.github/workflows/publish-npm.yml`) runs on meta release tags (`v*`):

1. verifies tests/build
2. publishes packages via `pnpm release` (changesets)
3. creates/updates GitHub Release for the same tag with a description composed from package `CHANGELOG.md` entries

Required repository secret:

- `NPM_TOKEN` (automation/granular token with publish rights and 2FA bypass for CI)

Manual flow (if needed):

1. Create release branch from `master`:
   - `git checkout master`
   - `git pull`
   - `git checkout -b release/<version-or-date>`
2. Run dense pre-bump checks:
   - `pnpm release:check:prebump`
3. Update versions/changelogs:
   - `pnpm version-packages`
4. Run post-bump sanity checks:
   - `pnpm release:check:postbump`
5. Commit version update:
   - `git add .`
   - `git commit -m "chore(release): version packages"`
6. Create tags:
   - `pnpm release:tag`
7. Merge release branch into `master` (prefer fast-forward)
8. Push branch and tags:
   - `git push`
   - `git push --tags`
9. Publish:
   - `pnpm release`

## Useful Commands

- Check pending changesets:
  - `pnpm changeset:status`
- Add new changeset:
  - `pnpm changeset`
- Dense release gate before version bump:
  - `pnpm release:check:prebump`
- Post-bump sanity gate:
  - `pnpm release:check:postbump`
