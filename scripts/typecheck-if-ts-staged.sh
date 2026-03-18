#!/usr/bin/env bash
set -euo pipefail

if git diff --cached --name-only --diff-filter=ACMR | grep -Eq '(\.(ts|tsx|mts|cts)$|(^|/)(tsconfig(\..+)?\.json)$)'; then
  echo "Staged TypeScript or tsconfig changes detected, running full repository typecheck..."
  pnpm typecheck
else
  echo "No staged TypeScript or tsconfig changes, skipping typecheck."
fi