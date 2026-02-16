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
- runs `changeset version`
- runs release checks (`build:libs` + tests)
- creates release commit `chore(release): version packages`
- creates package tags

Use `pnpm release:local:publish` to also run publish at the end.

Manual flow (if needed):

1. Create release branch from `master`:
   - `git checkout master`
   - `git pull`
   - `git checkout -b release/<version-or-date>`
2. Update versions/changelogs:
   - `pnpm version-packages`
3. Run checks:
   - `pnpm build:libs`
   - `pnpm --filter @vibe-rtc/rtc-core test`
   - `pnpm --filter @vibe-rtc/rtc-react test`
   - `pnpm --filter @vibe-rtc/rtc-firebase test`
4. Commit version update:
   - `git add .`
   - `git commit -m "chore(release): version packages"`
5. Create tags:
   - `pnpm release:tag`
6. Merge release branch into `master` (prefer fast-forward)
7. Push branch and tags:
   - `git push`
   - `git push --tags`
8. Publish:
   - `pnpm release`

## Useful Commands

- Check pending changesets:
  - `pnpm changeset:status`
- Add new changeset:
  - `pnpm changeset`
