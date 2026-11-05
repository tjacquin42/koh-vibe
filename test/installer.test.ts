import { describe, expect, it } from 'vitest';
import {
  countKohEntries,
  foreignFingerprint,
  installHooks,
  KOH_MARKER,
  uninstallHooks,
} from '../src/hooks/installer';

const BRIDGE = '/Users/dev/koh-vibe/bin/koh-vibe-bridge';

const existing = {
  model: 'opus',
  hooks: {
    PermissionRequest: [
      { matcher: '*', hooks: [{ type: 'command', command: '/vibe/bridge --source claude', timeout: 86400 }] },
    ],
    PreToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: 'mon-hook-a-moi' }] },
    ],
  },
};

describe('installHooks', () => {
  it('adds our 8 entries', () => {
    expect(countKohEntries(installHooks(existing, BRIDGE))).toBe(8);
  });

  it('preserves the existing entries', () => {
    const out = installHooks(existing, BRIDGE) as typeof existing;
    const perm = out.hooks.PermissionRequest.flatMap((e) => e.hooks.map((h) => h.command));
    expect(perm).toContain('/vibe/bridge --source claude');
    expect(out.hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command))).toContain('mon-hook-a-moi');
    expect(out.model).toBe('opus');
  });

  it('never makes our PermissionRequest blocking', () => {
    const out = installHooks(existing, BRIDGE) as typeof existing;
    const ours = out.hooks.PermissionRequest.flatMap((e) => e.hooks).filter((h) =>
      h.command.includes(KOH_MARKER),
    );
    expect(ours).toHaveLength(1);
    expect(ours[0]).not.toHaveProperty('timeout');
  });

  it('is idempotent', () => {
    const once = installHooks(existing, BRIDGE);
    expect(countKohEntries(installHooks(once, BRIDGE))).toBe(8);
  });

  it('works on a settings.json with no hooks', () => {
    expect(countKohEntries(installHooks({}, BRIDGE))).toBe(8);
  });

  it('uninstalls only our own', () => {
    const out = uninstallHooks(installHooks(existing, BRIDGE)) as typeof existing;
    expect(countKohEntries(out)).toBe(0);
    expect(out.hooks.PermissionRequest.flatMap((e) => e.hooks.map((h) => h.command))).toContain(
      '/vibe/bridge --source claude',
    );
    expect(out.hooks.PreToolUse.flatMap((e) => e.hooks.map((h) => h.command))).toContain('mon-hook-a-moi');
  });

  it('uninstalling is idempotent', () => {
    expect(countKohEntries(uninstallHooks(uninstallHooks(installHooks(existing, BRIDGE))))).toBe(0);
  });

  it("removes the hooks key rather than leaving an empty object when nothing is left, neither ours nor anyone else's (M5)", () => {
    const out = uninstallHooks(installHooks({}, BRIDGE)) as Record<string, unknown>;
    expect(out).not.toHaveProperty('hooks');
    // The fingerprint guard must stay intact: nothing has changed for it,
    // whether "hooks": {} remains or the key disappears.
    expect(foreignFingerprint(out)).toEqual([]);
  });
});

// Reproduction of a review finding: a real Claude Code event we don't handle
// (PostCompact) can carry a malformed entry, and an event can have a value
// that isn't even an array. None of this belongs to us and nothing should
// disappear, neither at install nor at uninstall.
const withUnknownForms = {
  ...existing,
  hooks: {
    ...existing.hooks,
    PostCompact: [{ matcher: '*', hooks: 'not-an-array' }],
    PreCompact: 'valeur-inattendue',
  },
};

describe('unrecognized forms', () => {
  it('preserves an entry whose hooks is not an array, at install', () => {
    const out = installHooks(withUnknownForms, BRIDGE) as typeof withUnknownForms;
    expect(out.hooks.PostCompact).toEqual([{ matcher: '*', hooks: 'not-an-array' }]);
  });

  it('preserves an event whose value is not an array, at install', () => {
    const out = installHooks(withUnknownForms, BRIDGE) as typeof withUnknownForms;
    expect(out.hooks.PreCompact).toBe('valeur-inattendue');
  });

  it('preserves both these forms at uninstall', () => {
    const out = uninstallHooks(withUnknownForms) as typeof withUnknownForms;
    expect(out.hooks.PostCompact).toEqual([{ matcher: '*', hooks: 'not-an-array' }]);
    expect(out.hooks.PreCompact).toBe('valeur-inattendue');
  });

  it('a round trip returns the object strictly unchanged in the presence of these forms', () => {
    const back = uninstallHooks(installHooks(withUnknownForms, BRIDGE));
    expect(back).toEqual(withUnknownForms);
  });
});

describe('foreignFingerprint', () => {
  it('qualifies each foreign command by its ancestry of names', () => {
    expect(foreignFingerprint(existing)).toEqual([
      '["hooks","PermissionRequest","*",{"type":"command","command":"/vibe/bridge --source claude","timeout":86400}]',
      '["hooks","PreToolUse","Bash",{"type":"command","command":"mon-hook-a-moi"}]',
    ]);
  });

  it('yields an empty array on a settings.json with no hooks', () => {
    expect(foreignFingerprint({})).toEqual([]);
  });

  it('does not change after install', () => {
    expect(foreignFingerprint(installHooks(existing, BRIDGE))).toEqual(foreignFingerprint(existing));
  });

  it('does not change after a round trip, even in the presence of unrecognized forms', () => {
    const back = uninstallHooks(installHooks(withUnknownForms, BRIDGE));
    expect(foreignFingerprint(back)).toEqual(foreignFingerprint(withUnknownForms));
  });

  // Counter-examples from the re-review: a simple count of foreign commands
  // yields the same number for these two pairs of trees even though a
  // command has objectively moved, or was lost at the same time as another
  // appeared. The fingerprint, qualified by ancestry, must distinguish them —
  // otherwise the script's guard would let a regression like the one from
  // Finding 1 slip through.
  it('distinguishes a foreign command moved from one event to another', () => {
    const treeA = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'foo' }] }],
        PostToolUse: [],
      },
    };
    const treeB = {
      hooks: {
        PreToolUse: [],
        PostToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'foo' }] }],
      },
    };
    expect(foreignFingerprint(treeA)).not.toEqual(foreignFingerprint(treeB));
  });

  it('distinguishes a foreign command lost at the same time another appears', () => {
    const treeC = {
      hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'foo' }] }] },
    };
    const treeD = {
      hooks: {
        PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'bar-completement-different' }] }],
      },
    };
    expect(foreignFingerprint(treeC)).not.toEqual(foreignFingerprint(treeD));
  });

  // Counter-example from the re-review (round 3, point 2): the ancestry key
  // was built by concatenation with a separator ('.'), so it was injectable.
  // An event named "PreToolUse.Bash" with a matcher "foo" produced the same
  // key as an event "PreToolUse" with a matcher "Bash.foo", even though these
  // are two genuinely distinct locations. The ancestry encoded as a sequence
  // of segments (JSON array) must distinguish them.
  it('distinguishes two genuinely different ancestries that concatenation would confuse', () => {
    const treeA = {
      hooks: {
        PreToolUse: [{ matcher: 'Bash.foo', hooks: [{ type: 'command', command: 'evil' }] }],
      },
    };
    const treeB = {
      hooks: {
        'PreToolUse.Bash': [{ matcher: 'foo', hooks: [{ type: 'command', command: 'evil' }] }],
      },
    };
    expect(foreignFingerprint(treeA)).not.toEqual(foreignFingerprint(treeB));
  });

  // Round 3, point 3: the two tests below die if the branch of
  // foreignFingerprint that folds the corresponding non-classifiable form
  // into the fingerprint is removed — unlike a test that compares two
  // already-identical objects (blind on both sides to such a removal). The
  // form that works is the asymmetry: the fingerprint of a tree carrying the
  // malformed form must differ from the fingerprint of the same tree without
  // it.
  it('a non-array event value is distinguished from its absence in the fingerprint', () => {
    const withForm = { hooks: { PreCompact: 'valeur-inattendue' } };
    const withoutForm = { hooks: {} };
    expect(foreignFingerprint(withForm)).not.toEqual(foreignFingerprint(withoutForm));
  });

  it('a matcher entry whose hooks is not an array is distinguished from its absence', () => {
    const withForm = { hooks: { PostCompact: [{ matcher: '*', hooks: 'not-an-array' }] } };
    const withoutForm = { hooks: { PostCompact: [] } };
    expect(foreignFingerprint(withForm)).not.toEqual(foreignFingerprint(withoutForm));
  });
});

// Round 3, point 1: isOurs used to compare by substring
// (`command.includes(KOH_MARKER)`), which classified as ours any foreign
// command merely mentioning our bridge in passing — installHooks/uninstallHooks
// would remove it, and foreignFingerprint, which shares that same predicate,
// wouldn't see it disappear either. isOurs now recognizes exactly the
// template we write, never a command that merely contains it.
describe('isOurs (precision of the recognition)', () => {
  it('does not classify as ours a foreign command that wraps our bridge', () => {
    const wrapped = {
      hooks: {
        PreToolUse: [
          {
            matcher: '*',
            hooks: [{ type: 'command', command: "sh -c 'autre-chose && ~/.koh-vibe/bin/koh-vibe-bridge'" }],
          },
        ],
      },
    };
    const out = uninstallHooks(wrapped) as typeof wrapped;
    expect(out.hooks.PreToolUse[0]?.hooks.map((h) => h.command)).toContain(
      "sh -c 'autre-chose && ~/.koh-vibe/bin/koh-vibe-bridge'",
    );
    expect(foreignFingerprint(wrapped).length).toBeGreaterThan(0);
  });

  it('recognizes exactly our own installed command: nothing foreign after an install from scratch', () => {
    const out = installHooks({}, BRIDGE);
    expect(foreignFingerprint(out)).toEqual([]);
  });
});

describe('migration from the old name', () => {
  const LEGACY = "/bin/sh -c '[ -x \"/Users/dev/.koh-claude/bin/koh-claude-bridge\" ] && \"/Users/dev/.koh-claude/bin/koh-claude-bridge\" Stop; exit 0'";

  it('recognizes an entry laid down under the old name', () => {
    const before = { hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: LEGACY }] }] } };
    expect(countKohEntries(before)).toBe(1);
  });

  it('removes the old entries at uninstall, instead of leaving them orphaned', () => {
    const before = { hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: LEGACY }] }] } };
    expect(countKohEntries(uninstallHooks(before))).toBe(0);
  });

  it('does not lay down a second set of hooks alongside the old one', () => {
    // The real risk of the renaming: two bridges installed, each event
    // duplicated in the spool.
    const before = { hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: LEGACY }] }] } };
    const after = installHooks(before, '/Users/dev/.koh-vibe/bin/koh-vibe-bridge');
    const stop = (after as { hooks: { Stop: Array<{ hooks: unknown[] }> } }).hooks.Stop;
    expect(stop.flatMap((m) => m.hooks)).toHaveLength(1);
    expect(JSON.stringify(after)).not.toContain('koh-claude-bridge');
  });

  it('never installs the old name: a fresh install carries only the current name', () => {
    expect(JSON.stringify(installHooks({}, '/Users/dev/.koh-vibe/bin/koh-vibe-bridge'))).not.toContain('koh-claude');
  });

  it('does not confuse a foreign bridge whose name ends differently', () => {
    const foreign = "/bin/sh -c '[ -x \"/opt/autre-bridge\" ] && \"/opt/autre-bridge\" Stop; exit 0'";
    const before = { hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: foreign }] }] } };
    expect(countKohEntries(before)).toBe(0);
    expect(JSON.stringify(uninstallHooks(before))).toContain('/opt/autre-bridge');
  });
});
