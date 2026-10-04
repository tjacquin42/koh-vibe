#!/usr/bin/env bash
# Sets the next version number in package.json.
#   scripts/set-version.sh <major|minor|patch>
#
# Run this on the promotion branch, BEFORE opening the PR to main — that is
# the only window in which the number can still reach the repository. `main`
# is protected and the Actions token has no bypass: the delivery cannot push
# anything there, the CHANGELOG entry already pays that price. A bump set
# after the merge would therefore never make it into the file.
#
# The number is derived from package.json itself, never from tags: it is
# `package.json` that is the source of truth (CLAUDE.md), and it alone
# follows the current branch.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MANIFEST="$ROOT/package.json"

LEVEL="${1:-}"
case "$LEVEL" in
  major|minor|patch) ;;
  *) echo "Usage: $(basename "$0") <major|minor|patch>" >&2; exit 1 ;;
esac

CURRENT=$(node -p "require('$MANIFEST').version")
# A number we cannot read is not incremented by guesswork: the next one would
# be wrong, and a wrong number is worse than a missing one.
[[ "$CURRENT" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "Version « $CURRENT » illisible dans package.json — attendu X.Y.Z." >&2; exit 1; }

IFS=. read -r MA MI PA <<< "$CURRENT"
case "$LEVEL" in
  major) MA=$((MA+1)); MI=0; PA=0 ;;
  minor) MI=$((MI+1)); PA=0 ;;
  patch) PA=$((PA+1)) ;;
esac
NEXT="$MA.$MI.$PA"

# TEXTUAL substitution, never JSON.parse + stringify: the manifest keeps its
# menu arrays each on a single line, and a full reformat would drown the bump
# in a two-hundred-line diff.
node - "$MANIFEST" "$NEXT" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const [file, next] = process.argv.slice(2);
const source = readFileSync(file, 'utf8');
const out = source.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`);
if (out === source) {
  console.error(`Aucun champ « version » remplacé dans ${file}.`);
  process.exit(1);
}
writeFileSync(file, out);
NODE

echo "package.json : $CURRENT → $NEXT ($LEVEL)"
echo "Commit ce fichier, puis ouvre la PR vers main avec « Version: $LEVEL » dans son corps."
