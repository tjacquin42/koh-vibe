#!/usr/bin/env node
// Installs or uninstalls the koh-vibe hooks in ~/.claude/settings.json.
//   node scripts/install-hooks.cjs --bridge <path>
//   node scripts/install-hooks.cjs --uninstall
const {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} = require('node:fs');
const { homedir } = require('node:os');
const { dirname, join } = require('node:path');
const {
  countKohEntries,
  foreignFingerprint,
  installHooks,
  uninstallHooks,
  installStatusLine,
  uninstallStatusLine,
  wrappedStatusLine,
} = require('../out/hooks/installer.js');
const { kohVibeHome, spoolDirs } = require('../out/paths.js');

const SETTINGS = join(homedir(), '.claude', 'settings.json');
const HOME = kohVibeHome();
const BACKUPS = spoolDirs(HOME).backups;
const uninstall = process.argv.includes('--uninstall');
const bridgeArg = process.argv.indexOf('--bridge');
// Source to copy, never the hooks' target. Resolved next to the script
// itself, never from the cwd: this way the script behaves identically
// whether launched from the repository (scripts/ and bin/ are siblings) or
// from the installed extension (same tree inside the .vsix, cf. .vscodeignore).
// `--bridge` with no value after it: refused right away with a message,
// rather than letting existsSync(undefined) throw a TypeError further down.
// The message itself stays French like every other message this script
// prints — its output is user-facing text, not code.
if (bridgeArg > -1 && process.argv[bridgeArg + 1] === undefined) {
  fail(`--bridge attend un chemin.\nRien n'a été écrit.`);
}
const bridgeSource =
  bridgeArg > -1 ? process.argv[bridgeArg + 1] : join(__dirname, '..', 'bin', 'koh-vibe-bridge');
// Stable target, under kohVibeHome(): neither the repository nor the
// installed extension is a stable location (the former can be moved or
// deleted, the latter is a versioned folder that disappears on the next
// update). The hooks always point at this copy, never at the source.
const bridgeTarget = join(HOME, 'bin', 'koh-vibe-bridge');
// Second bridge, same rule for source and target: it captures the snapshot
// that Claude Code passes to the statusline, the only place where usage
// limits are readable locally.
const statusSource = join(__dirname, '..', 'bin', 'koh-vibe-statusline');
const statusTarget = join(HOME, 'bin', 'koh-vibe-statusline');

function fail(message) {
  console.error(message);
  process.exit(1);
}

/**
 * Detects the indentation and the presence of a trailing newline in the
 * original file, so as to rewrite it in the same style rather than impose
 * our own: a file indented with four spaces must not come back reformatted
 * to two.
 */
function detectStyle(raw) {
  const match = /^[ \t]+/m.exec(raw);
  return { indent: match ? match[0] : 2, newline: raw.endsWith('\n') };
}

let raw;
let creating = false;
if (existsSync(SETTINGS)) {
  raw = readFileSync(SETTINGS, 'utf8');
} else {
  creating = true;
  raw = '{}';
}

let before;
try {
  before = JSON.parse(raw);
} catch (err) {
  fail(`JSON invalide dans ${SETTINGS} : ${err.message}\nRien n'a été écrit.`);
  return; // fail() exits the process; the return is a belt-and-suspenders guard, not a requirement
}

if (!uninstall && !existsSync(bridgeSource)) {
  fail(`Bridge introuvable : ${bridgeSource}\nRien n'a été écrit.`);
}

const style = creating ? { indent: 2, newline: true } : detectStyle(raw);
const afterHooks = uninstall ? uninstallHooks(before) : installHooks(before, bridgeTarget);
const after = uninstall ? uninstallStatusLine(afterHooks) : installStatusLine(afterHooks, statusTarget);

// Safety net: a count cannot prove preservation (two trees where a foreign
// command moved elsewhere, or was lost at the same time another one
// appeared, can share the same count). So a fingerprint — every foreign
// command qualified by its ancestry — is compared before and after the
// transformation, and writing is refused at the slightest discrepancy rather
// than risk losing another program's tooling (e.g. Vibe Island).
function diffFingerprints(beforeFp, afterFp) {
  const beforeSet = new Set(beforeFp);
  const afterSet = new Set(afterFp);
  return {
    disparu: beforeFp.filter((e) => !afterSet.has(e)),
    apparu: afterFp.filter((e) => !beforeSet.has(e)),
  };
}

const fpBefore = foreignFingerprint(before);
const fpAfter = foreignFingerprint(after);
if (JSON.stringify(fpBefore) !== JSON.stringify(fpAfter)) {
  const { disparu, apparu } = diffFingerprints(fpBefore, fpAfter);
  fail(
    [
      `Refus d'écrire : l'empreinte de ce qui n'est pas à nous a changé pendant la transformation.`,
      disparu.length > 0 ? `Disparu (${disparu.length}) :\n  ${disparu.join('\n  ')}` : null,
      apparu.length > 0 ? `Apparu (${apparu.length}) :\n  ${apparu.join('\n  ')}` : null,
      `Rien n'a été écrit.`,
    ]
      .filter((line) => line !== null)
      .join('\n'),
  );
}

if (creating) {
  console.log(`${SETTINGS} n'existe pas : il sera créé.`);
  mkdirSync(dirname(SETTINGS), { recursive: true });
} else {
  mkdirSync(BACKUPS, { recursive: true });
  const backup = join(BACKUPS, `settings-${Date.now()}.json`);
  copyFileSync(SETTINGS, backup);
  console.log(`Sauvegarde : ${backup}`);
}

// Copy the bridge before writing settings.json: if the copy fails (source
// gone between the check and here, disk full…), the hooks referenced in
// settings.json must never be set before the target exists. copyFileSync
// overwrites a previous copy without complaint: a reinstall stays idempotent.
if (!uninstall) {
  mkdirSync(dirname(bridgeTarget), { recursive: true });
  copyFileSync(bridgeSource, bridgeTarget);
  chmodSync(bridgeTarget, 0o755);
  console.log(`Bridge copié : ${bridgeSource} → ${bridgeTarget}`);
  copyFileSync(statusSource, statusTarget);
  chmodSync(statusTarget, 0o755);
  console.log(`Pont statusline copié : ${statusSource} → ${statusTarget}`);
}

// Atomic write: a concurrent reader sees the old file or the new one, never a
// half-written file.
const serialized = JSON.stringify(after, null, style.indent);
const tmp = join(dirname(SETTINGS), `.tmp-settings-${process.pid}`);
writeFileSync(tmp, style.newline ? `${serialized}\n` : serialized, 'utf8');
renameSync(tmp, SETTINGS);

console.log(`Entrées koh-vibe : ${countKohEntries(before)} → ${countKohEntries(after)}`);

// Say what happened to the statusline: it is the only setting shared with
// other tools, and the only one restored on uninstall.
const wrapped = wrappedStatusLine(after);
if (uninstall) {
  console.log('Statusline : rendue à son occupant précédent.');
} else if (wrapped === undefined) {
  console.log('Statusline : inchangée.');
} else if (wrapped.length === 0) {
  console.log('Statusline : place prise (elle était libre).');
} else {
  console.log(`Statusline : place prise, délègue à ${wrapped}`);
}
