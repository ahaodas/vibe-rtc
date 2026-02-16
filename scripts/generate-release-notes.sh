#!/usr/bin/env bash

set -euo pipefail

tag="${1:-}"
output="${2:-release-notes.md}"

if [[ -z "${tag}" ]]; then
  echo "Usage: bash ./scripts/generate-release-notes.sh <tag> [output-file]"
  exit 1
fi

{
  echo "# ${tag}"
  echo
  echo "## Published Packages"

  for package_json in packages/*/package.json; do
    if [[ ! -f "${package_json}" ]]; then
      continue
    fi

    pkg_dir="$(dirname "${package_json}")"
    changelog_path="${pkg_dir}/CHANGELOG.md"

    if [[ ! -f "${changelog_path}" ]]; then
      continue
    fi

    name="$(node -p "require('./${package_json}').name")"
    version="$(node -p "require('./${package_json}').version")"
    echo "- \`${name}@${version}\`"
  done

  echo
  echo "## Changelog"
  echo

  found_section=0

  for package_json in packages/*/package.json; do
    pkg_dir="$(dirname "${package_json}")"
    changelog_path="${pkg_dir}/CHANGELOG.md"

    if [[ ! -f "${changelog_path}" ]]; then
      continue
    fi

    name="$(node -p "require('./${package_json}').name")"
    version="$(node -p "require('./${package_json}').version")"

    release_block="$(
      awk -v v="${version}" '
        $0 == "## " v { in_section = 1; next }
        /^## / && in_section { exit }
        in_section { print }
      ' "${changelog_path}"
    )"

    if [[ -z "${release_block}" ]]; then
      continue
    fi

    found_section=1
    echo "### ${name}@${version}"
    echo
    echo "${release_block}"
    echo
  done

  if [[ "${found_section}" -eq 0 ]]; then
    echo "_No package changelog entries were found for current versions._"
    echo
  fi
} >"${output}"

echo "Release notes generated: ${output}"
