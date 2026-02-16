# Changesets

This folder stores release notes entries for package versioning in the monorepo.

Usage:

1. Create a changeset when a package changes:
   - `pnpm changeset`
2. Before release, update package versions and changelogs:
   - `pnpm version-packages`
3. Create release tags:
   - `pnpm release:tag`
4. Publish packages:
   - `pnpm release`

Notes:

- `@vibe-rtc/demo` and `@vibe-rtc/rtc-e2e` are excluded from publish versioning.
- Release process details are documented in `RELEASING.md`.
