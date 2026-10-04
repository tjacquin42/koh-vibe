#!/bin/bash
# Captures real hook payloads without touching the global configuration.
# Everything happens inside a throwaway directory with its own .claude/settings.json.
set -euo pipefail
BRIDGE="$PWD/bin/koh-vibe-bridge"
WORK="$(mktemp -d)"
export KOH_VIBE_HOME="$WORK/spool"
mkdir -p "$WORK/.claude" "$KOH_VIBE_HOME/events"
echo "Bac à sable : $WORK"

python3 - "$WORK/.claude/settings.json" "$BRIDGE" <<'PYEOF'
import json, sys
out, bridge = sys.argv[1], sys.argv[2]
events = ["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse",
          "PermissionRequest","Notification","Stop","SessionEnd"]
hooks = {e: [{"matcher": "*", "hooks": [{"type": "command",
        "command": f"/bin/sh -c '[ -x \"{bridge}\" ] && \"{bridge}\" {e}; exit 0'"}]}]
        for e in events}
json.dump({"hooks": hooks}, open(out, "w"), indent=2)
PYEOF

printf 'Bonjour.\n' > "$WORK/NOTES.md"
cd "$WORK"
# A headless session that actually calls a tool: check `claude --help` for the
# exact flags that allow running without an interactive prompt.
claude -p "Lis le fichier NOTES.md et réponds uniquement par son premier mot."

echo
echo "Payloads capturés :"
ls -1 "$KOH_VIBE_HOME/events/"

echo
echo "PermissionRequest et Notification n'apparaîtront pas : ils exigent une vraie"
echo "interaction. Ils sont capturés séparément, à la main."
