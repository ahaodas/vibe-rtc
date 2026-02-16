#!/usr/bin/env bash

set -euo pipefail

PUBLISH=0
CREATE_GH_RELEASE=0
META_TAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --publish)
      PUBLISH=1
      shift
      ;;
    --github-release)
      CREATE_GH_RELEASE=1
      shift
      ;;
    --meta-tag)
      META_TAG="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown arg: $1"
      echo "Usage: bash ./scripts/release-local.sh [--publish] [--github-release] [--meta-tag <tag>]"
      exit 1
      ;;
  esac
done

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

if [[ -z "${META_TAG}" ]]; then
  META_TAG="v$(date +%Y.%m.%d-%H%M)"
fi

if git rev-parse -q --verify "refs/tags/${META_TAG}" >/dev/null; then
  echo "Meta tag ${META_TAG} already exists. Choose a different --meta-tag value."
  exit 1
fi

echo "==> Creating meta release tag: ${META_TAG}"
git tag "${META_TAG}"

if [[ "${CREATE_GH_RELEASE}" -eq 1 ]]; then
  if command -v gh >/dev/null 2>&1; then
    echo "==> Creating GitHub release for ${META_TAG}"
    gh release create "${META_TAG}" --generate-notes
  else
    echo "gh CLI is not installed; skipping GitHub release creation."
  fi
fi

if [[ "${PUBLISH}" -eq 1 ]]; then
  echo "==> Publishing packages"
  pnpm release
else
  echo "Release commit and tags are ready. Push branch and tags:"
  echo "  git push && git push --tags"
fi
