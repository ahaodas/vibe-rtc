#!/usr/bin/env bash

set -euo pipefail

PUBLISH=0
if [[ "${1:-}" == "--publish" ]]; then
  PUBLISH=1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit/stash changes before release."
  exit 1
fi

echo "==> Versioning packages with Changesets"
pnpm version-packages

if [[ -z "$(git status --porcelain)" ]]; then
  echo "No version changes produced (no pending changesets)."
  exit 0
fi

echo "==> Running release checks"
pnpm build:libs
pnpm --filter @vibe-rtc/rtc-core test
pnpm --filter @vibe-rtc/rtc-react test
pnpm --filter @vibe-rtc/rtc-firebase test

echo "==> Committing version updates"
git add -A
git commit -m "chore(release): version packages"

echo "==> Creating tags"
pnpm release:tag

if [[ "${PUBLISH}" -eq 1 ]]; then
  echo "==> Publishing packages"
  pnpm release
else
  echo "Release commit and tags are ready. Push branch and tags:"
  echo "  git push && git push --tags"
fi
