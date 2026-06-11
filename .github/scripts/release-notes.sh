#!/usr/bin/env bash
# Build the GitHub release body for TAG:
#   1. a changelog of every non-merge commit since the previous vX.Y.Z tag
#   2. an avatar grid of every GitHub user who authored a commit in that range
#
# Requires: git (full history + tags), gh (authenticated), jq.
# Usage: release-notes.sh <tag>   (writes the markdown to stdout)
set -euo pipefail

TAG="${1:?usage: release-notes.sh <tag>}"
REPO="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY not set}"

# The version tag immediately before TAG (empty if TAG is the first release).
PREV="$(git tag --sort=-version:refname | awk -v t="$TAG" 'found{print; exit} $0==t{found=1}')"

if [ -n "$PREV" ]; then
  range="$PREV..$TAG"
  api_authors=(gh api --paginate "repos/$REPO/compare/$PREV...$TAG"
               --jq '.commits[].author | select(. != null) | [.login, .avatar_url] | @tsv')
  header="## Changes since $PREV"
else
  range="$TAG"
  api_authors=(gh api --paginate "repos/$REPO/commits?sha=$TAG"
               --jq '.[].author | select(. != null) | [.login, .avatar_url] | @tsv')
  header="## Changes"
fi

# --- Changelog ---------------------------------------------------------------
changelog="$(git log "$range" --no-merges --pretty=format:'- %s (%h)')"
[ -z "$changelog" ] && changelog="- _No changes._"

# --- Contributors: one circular avatar per unique GitHub author --------------
contributors=""
while IFS=$'\t' read -r login avatar; do
  [ -z "$login" ] && continue
  contributors+="<a href=\"https://github.com/${login}\" title=\"@${login}\">"
  contributors+="<img src=\"${avatar}&s=64\" width=\"64\" height=\"64\" "
  contributors+="alt=\"${login}\" style=\"border-radius:50%\" /></a> "
done < <("${api_authors[@]}" | awk '!seen[$1]++')  # dedupe by login, keep order

[ -z "$contributors" ] && contributors="_No linked GitHub accounts in this range._"

# --- Body --------------------------------------------------------------------
cat <<EOF
$header

$changelog

## Contributors

$contributors
EOF
