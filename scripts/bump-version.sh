#!/usr/bin/env bash
# Sets the version for a PR that has just landed on main.
#   scripts/bump-version.sh [major|minor|patch] [PR-number]
#
# With no argument, the level is read from the PR body (a "Version: minor" line)
# and the PR is the one whose merge sits at the head of origin/main.
# Creates the tag, the GitHub Release, the CHANGELOG entry, the label and the milestone.
#
# Called by the "version" job of the CD, the last step of the delivery.
set -euo pipefail

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
git fetch --quiet origin main --tags

PR="${2:-}"
if [ -z "$PR" ]; then
  PR=$(gh pr list --repo "$REPO" --state merged --base main --limit 1 --json number -q '.[0].number')
  [ -z "$PR" ] && { echo "Aucune PR mergée sur main trouvée." >&2; exit 1; }
fi

# The level comes from the PR body. Three cases, three distinct responses:
#
#   line absent     → "patch", with a warning. A delivery with no version is a
#                     permanent hole in the history; one patch too many is easy
#                     to fix. This is the majority case — across the last 30 PRs
#                     of the six repos, the line was missing almost everywhere,
#                     and three deliveries on 13 August were lost because the
#                     CD stopped right here.
#   line unreadable → error. "Version: majeur" expresses an intent we failed to
#                     read: guessing would mean silently shipping the wrong level.
#   line valid      → whatever it says.
LEVEL="${1:-}"
if [ -z "$LEVEL" ]; then
  BODY=$(gh pr view "$PR" --repo "$REPO" --json body -q .body | tr -d '\r')
  LEVEL=$(printf '%s\n' "$BODY" \
          | grep -iE '^[[:space:]]*Version:[[:space:]]*[^[:space:]]+' | head -1 \
          | sed -E 's/^[[:space:]]*[Vv]ersion:[[:space:]]*//' \
          | awk '{print $1}' | tr 'A-Z' 'a-z' || true)
  if [ -z "$LEVEL" ]; then
    echo "::warning::La PR #$PR ne porte pas de ligne « Version: » — niveau « patch » appliqué par défaut."
    LEVEL=patch
  fi
fi
case "$LEVEL" in
  major|minor|patch) ;;
  *) echo "Niveau « $LEVEL » non reconnu dans la PR #$PR — attendu major, minor ou patch." >&2; exit 1 ;;
esac

# The number is no longer computed here: it is ALREADY in package.json, set by
# scripts/set-version.sh in the promotion PR (see CLAUDE.md). Deriving it from
# tags was the original flaw — the tag lives on the merge commit, which `dev`
# does not contain, so any package built from `dev` announced the previous
# version. The manifest, on the other hand, follows the branch.
V=$(node -p "require(process.cwd() + '/package.json').version")
[[ "$V" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
  || { echo "Version « $V » illisible dans package.json — attendu X.Y.Z." >&2; exit 1; }
TAG="v$V"

# The bump may have been forgotten: the manifest then carries the version
# already shipped, whose tag exists. That is not a reason to abandon the
# delivery — a missing version is a permanent hole, a caught-up number can be
# fixed. So the announced level is applied to the current number, and it is
# said loudly.
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  IFS=. read -r MA MI PA <<< "$V"
  case "$LEVEL" in
    major) MA=$((MA+1)); MI=0; PA=0 ;;
    minor) MI=$((MI+1)); PA=0 ;;
    patch) PA=$((PA+1)) ;;
  esac
  V="$MA.$MI.$PA"; TAG="v$V"
  echo "::warning::package.json n'a pas été bumpé avant le merge — « $LEVEL » appliqué d'office, $TAG posée. Reporte le numéro dans package.json par une PR, sinon le prochain bump repartira du mauvais chiffre."
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && { echo "$TAG existe déjà." >&2; exit 1; }
fi

# The "publish" job follows in the same run and needs the number ACTUALLY set
# — not the one from package.json, from which the fallback above can diverge.
# As an `if` block, never as "[ -n … ] && echo …": under `set -e`, a false test
# at the end of an AND list would kill the script, which would abandon the
# delivery for a line that only serves CI. Outside Actions the variable does
# not exist, and this block does nothing.
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "tag=$TAG" >> "$GITHUB_OUTPUT"
fi

SHA=$(gh pr view "$PR" --repo "$REPO" --json mergeCommit -q .mergeCommit.oid)
TITLE=$(gh pr view "$PR" --repo "$REPO" --json title -q .title)
DATE=$(date +%Y-%m-%d)
URL="https://github.com/$REPO"

NOTES=$(printf '**[#%s](%s/pull/%s)** — %s\n\n`%s` · %s' "$PR" "$URL" "$PR" "$TITLE" "$LEVEL" "$DATE")
gh release create "$TAG" --repo "$REPO" --target "$SHA" --title "$V — $TITLE" --notes "$NOTES"

# CHANGELOG: insertion right below the header
ENTRY=$(printf '## [%s](%s/releases/tag/%s) — %s\n\n`%s` · [#%s](%s/pull/%s) — %s\n' \
        "$V" "$URL" "$TAG" "$DATE" "$LEVEL" "$PR" "$URL" "$PR" "$TITLE")
# The entry passes through the environment, not through "awk -v": a multiline
# value there gets refused ("awk: newline in string") by macOS's awk. And no
# "&& mv" either — in an "&&" list, set -e does not kill the script when the
# left-hand command fails, so the first version actually posted for real
# created its tag and its Release without ever writing its entry, without a
# word.
#
# The nominal case is that the entry is ALREADY there: it is written by hand
# in the promotion PR, the only place from which it can reach the repository —
# main is protected and the Actions token has no bypass. Inserting a second
# heading for the same number would produce a duplicate that the delivery
# could not push anyway, and a false warning at every version.
#
# The insertion below is therefore no longer the normal path but the safety
# net: the promotion forgot the entry, and a bare heading, flagged, is better
# than a hole.
if [ -f CHANGELOG.md ] && grep -q "^## \[$V\]" CHANGELOG.md; then
  echo "L'entrée $V est déjà dans CHANGELOG.md — portée par la PR de promotion, rien à insérer."
elif [ -f CHANGELOG.md ]; then
  echo "::warning::La PR #$PR n'a pas écrit l'entrée $V dans CHANGELOG.md. Un titre nu est inséré ; il reste à écrire ce que la version change, et main étant protégée, ce titre ne pourra pas être poussé d'ici."
  ENTRY="$ENTRY" awk 'BEGIN{done=0} /^## /&&!done{print ENVIRON["ENTRY"]"\n";done=1} {print} END{if(!done)print "\n"ENVIRON["ENTRY"]}' \
      CHANGELOG.md > CHANGELOG.tmp
  mv CHANGELOG.tmp CHANGELOG.md
else
  printf '# Changelog\n\n%s\n' "$ENTRY" > CHANGELOG.md
fi

# The tag and the Release already exist at this point: if the entry is
# missing, it needs to be known now, not discovered at the next version.
grep -q "^## \[$V\]" CHANGELOG.md || { echo "L'entrée $V n'a pas été écrite dans CHANGELOG.md." >&2; exit 1; }

COLOR=$([ "$LEVEL" = major ] && echo B60205 || { [ "$LEVEL" = minor ] && echo 0E8A16 || echo 5319E7; })
gh label create "$TAG" --repo "$REPO" --color "$COLOR" --description "Livré dans $TAG" >/dev/null 2>&1 || true
MS=$(gh api "repos/$REPO/milestones" -f title="$TAG" -f description="Version $V — PR #$PR" -q .number 2>/dev/null \
     || gh api "repos/$REPO/milestones?state=all&per_page=100" -q ".[]|select(.title==\"$TAG\")|.number")

# The main PR, and every PR it carries along: a dev → main promotion ships the
# work merged into dev between the previous version and this one. Without
# this, those PRs would stay forever without a version even though they are
# genuinely live.
CARRIED=$(gh pr list --repo "$REPO" --state merged --limit 200 \
  --json number,baseRefName,mergedAt,labels \
  -q "[.[] | select(.baseRefName != \"main\")
          | select((.labels|map(.name)|map(startswith(\"v\"))|any) == false)
          | select(.mergedAt <= \"$(gh pr view "$PR" --repo "$REPO" --json mergedAt -q .mergedAt)\")
          | .number] | .[]")

for N in $PR $CARRIED; do
  gh pr edit "$N" --repo "$REPO" --add-label "$TAG" --remove-label "non livré" >/dev/null 2>&1 || true
  [ -n "$MS" ] && gh api -X PATCH "repos/$REPO/issues/$N" -F milestone="$MS" >/dev/null 2>&1 || true
done
[ -n "$MS" ] && gh api -X PATCH "repos/$REPO/milestones/$MS" -f state=closed >/dev/null

# What remains on dev is flagged as such, so a PR with no version reads as
# "not yet shipped" rather than "forgotten".
gh label create "non livré" --repo "$REPO" --color FBCA04 --description "Mergé sur dev, pas encore promu sur main" >/dev/null 2>&1 || true
gh pr list --repo "$REPO" --state merged --limit 200 --json number,baseRefName,labels \
  -q '.[] | select(.baseRefName != "main") | select((.labels|map(.name)|map(startswith("v"))|any) == false) | .number' \
  | while read -r N; do gh pr edit "$N" --repo "$REPO" --add-label "non livré" >/dev/null 2>&1 || true; done

echo "$TAG posée sur $SHA — $(echo $CARRIED | wc -w | tr -d ' ') PR embarquée(s) étiquetée(s)"
