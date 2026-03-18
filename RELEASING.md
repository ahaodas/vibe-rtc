# Releasing

This repository uses `release-please` for package versioning, changelog generation, Git tags, and GitHub Releases.

Published packages:
- `@vibe-rtc/rtc-core`
- `@vibe-rtc/rtc-firebase`
- `@vibe-rtc/rtc-react`

Not part of npm release flow:
- `@vibe-rtc/rtc-e2e`
- `@vibe-rtc/demo`

# Prerequisites

- Installed dependencies: `pnpm install`
- Clean working tree
- GitHub Actions enabled for the repository
- npm trusted publishing configured for each published package:
    - `@vibe-rtc/rtc-core`
    - `@vibe-rtc/rtc-firebase`
    - `@vibe-rtc/rtc-react`

# Daily Development

For every change that should affect a published package:

1. Commit changes using Conventional Commits
2. Open a normal PR into `master`
3. Merge the PR

Recommended commit discipline:
- keep commits focused by package when possible
- avoid mixing `demo` / infra / multiple package changes in one commit unless really necessary
- use correct scopes such as:
    - `fix(rtc-core): ...`
    - `feat(rtc-firebase): ...`
    - `fix(rtc-react): ...`

Version bump rules are derived automatically from commit history:
- `fix:` -> patch
- `feat:` -> minor
- `feat!:` or `BREAKING CHANGE:` -> major

# Release Flow

Releases are created automatically from commits already merged into `master`.

## How it works

On every push to `master`, GitHub Actions runs `release-please`:

1. analyzes Conventional Commits since the previous package release
2. updates or creates a Release PR
3. proposes version bumps and package changelog updates
4. after the Release PR is merged:
    - creates package tags
    - creates GitHub Releases
    - runs verification
    - publishes packages to npm

There is no manual local version bump flow anymore.

# Release PR

`release-please` maintains a dedicated Release PR for publishable packages.

Recommended merge method:
- `Rebase and merge`

# npm Publish from CI

npm publish is executed inside `.github/workflows/release-please.yml`.

Flow after merging the Release PR:

1. `release-please` creates package tags and GitHub Releases
2. `verify` job runs package tests/build checks
3. `publish` job builds publishable packages and publishes them to npm

Publishing uses npm trusted publishing via GitHub OIDC.
No long-lived `NPM_TOKEN` secret is required.

# Useful Commands

General development:
- `pnpm install`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test:int`
- `pnpm test:e2e:emu`
- `pnpm test:demo:e2e:emu`

Manual local verification before merging important PRs:
- `pnpm --filter @vibe-rtc/rtc-core test`
- `pnpm --filter @vibe-rtc/rtc-react test`
- `pnpm --filter @vibe-rtc/rtc-firebase test`
- `pnpm build:libs`

# Notes

- `release-please` uses path-based package changelog attribution, not commit-scope-based attribution
- dependency bumps between workspace packages may produce dependency entries in downstream package changelogs
- clean, package-focused commits produce much better release notes
