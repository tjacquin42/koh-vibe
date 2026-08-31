import { describe, expect, it, vi } from 'vitest';
import {
  closeSessionHere,
  needsConfirmation,
  requestCloseSession,
  sleepSessionHere,
  type CloseHereDeps,
  type RequestCloseDeps,
  type SleepHereDeps,
} from '../src/close/close';
import { shownSession } from '../src/claude/dormant';
import type { Session } from '../src/events/types';

const session = (over: Partial<Session> = {}): Session => ({
  id: 's1',
  cwd: '/Users/dev/projet',
  project: 'projet',
  origin: 'vscode',
  status: 'idle',
  toolCount: 0,
  lastEventAt: 0,
  ...over,
});

interface Calls {
  log: string[];
  confirmed: string[];
  routed: string[];
  forgotten: string[];
  removed: string[];
  archived: string[];
}

function calls(): Calls {
  return { log: [], confirmed: [], routed: [], forgotten: [], removed: [], archived: [] };
}

function requestDeps(c: Calls, answer = true): RequestCloseDeps {
  return {
    confirm: async (s: Session) => {
      c.log.push('confirm');
      c.confirmed.push(s.id);
      return answer;
    },
    archive: async (s: Session) => {
      c.log.push('archive');
      c.archived.push(s.id);
    },
    route: async (s: Session) => {
      c.log.push('route');
      c.routed.push(s.id);
    },
    forget: async (id: string) => {
      c.log.push('forget');
      c.forgotten.push(id);
    },
  };
}

function hereDeps(c: Calls, over: Partial<CloseHereDeps> = {}): CloseHereDeps {
  return {
    read: async () => session(),
    closeTab: async () => {
      c.log.push('closeTab');
      return 'closed' as const;
    },
    archive: async (s: Session) => {
      c.log.push('archive');
      c.archived.push(s.id);
    },
    forget: async (id: string) => {
      c.log.push('forget');
      c.forgotten.push(id);
    },
    remove: async (id: string) => {
      c.log.push('remove');
      c.removed.push(id);
    },
    ...over,
  };
}

describe('needsConfirmation', () => {
  it('asks before cutting a conversation that is working or waiting', () => {
    expect(needsConfirmation('running')).toBe(true);
    expect(needsConfirmation('waiting')).toBe(true);
  });

  it('does not ask when nothing is interrupted', () => {
    expect(needsConfirmation('done_unseen')).toBe(false);
    expect(needsConfirmation('idle')).toBe(false);
    expect(needsConfirmation('stale')).toBe(false);
  });
});

describe('requestCloseSession', () => {
  it('only forgets a conversation with no tab to close, and never asks', async () => {
    const c = calls();
    await requestCloseSession(session({ origin: 'terminal', status: 'running' }), requestDeps(c));

    expect(c.forgotten).toEqual(['s1']);
    expect(c.routed).toEqual([]);
    expect(c.confirmed).toEqual([]);
  });

  it('routes an idle editor conversation straight away, without asking', async () => {
    const c = calls();
    await requestCloseSession(session(), requestDeps(c));

    expect(c.routed).toEqual(['s1']);
    expect(c.confirmed).toEqual([]);
    expect(c.forgotten).toEqual([]);
  });

  it('asks first when the conversation is still working, then routes', async () => {
    const c = calls();
    await requestCloseSession(session({ status: 'running' }), requestDeps(c));

    expect(c.log).toEqual(['confirm', 'route']);
  });

  it('does nothing at all when the confirmation is declined — no close, no forget', async () => {
    const c = calls();
    await requestCloseSession(session({ status: 'waiting' }), requestDeps(c, false));

    expect(c.confirmed).toEqual(['s1']);
    expect(c.routed).toEqual([]);
    expect(c.forgotten).toEqual([]);
  });
});

describe('closeSessionHere', () => {
  it('archives the conversation, then REMOVES its row — never merely hides it — when a tab was really closed', async () => {
    const c = calls();
    await closeSessionHere('s1', hereDeps(c));

    // `forget` would only hide an open row, and the SessionEnd the closed tab
    // sends a moment later lifts a hiding: the row would come back, greyed.
    expect(c.log).toEqual(['closeTab', 'archive', 'remove']);
    expect(c.archived).toEqual(['s1']);
    expect(c.removed).toEqual(['s1']);
    expect(c.forgotten).toEqual([]);
  });

  it('removes the row WITHOUT archiving when no tab was found — nothing was closed', async () => {
    const c = calls();
    await closeSessionHere('s1', hereDeps(c, { closeTab: async () => 'notFound' }));

    expect(c.archived).toEqual([]);
    expect(c.forgotten).toEqual(['s1']);
    expect(c.removed).toEqual([]);
  });

  it('only forgets when the session state has already vanished, and touches no tab', async () => {
    const c = calls();
    await closeSessionHere('s1', hereDeps(c, { read: async () => undefined }));

    expect(c.log).toEqual(['forget']);
  });
});

// Sleeping is the trash's quieter twin. The trash ends a conversation and
// takes its row away, filing it under "recently closed"; the moon closes the
// tab and leaves the row exactly where it was, greyed. Nothing is archived:
// the conversation has not left the dashboard, and an entry in the history
// would show it in two places at once.
describe('sleepSessionHere — closes the tab and keeps the row', () => {
  const deps = (over: Partial<SleepHereDeps> = {}): SleepHereDeps => ({
    read: async () => session(),
    closeTab: async () => 'closed',
    markEnded: async () => undefined,
    now: () => 1_000,
    ...over,
  });

  it('closes the tab, then greys the row where it stands', async () => {
    const calls: string[] = [];
    await sleepSessionHere('s1', deps({
      closeTab: async () => {
        calls.push('closeTab');
        return 'closed';
      },
      markEnded: async (s, at) => {
        calls.push(`markEnded:${s.id}:${at}`);
      },
    }));
    expect(calls).toEqual(['closeTab', 'markEnded:s1:1000']);
  });

  it('greys nothing when no tab was found — nothing was closed, so nothing ended', async () => {
    const markEnded = vi.fn();
    await sleepSessionHere('s1', deps({ closeTab: async () => 'notFound', markEnded }));
    expect(markEnded).not.toHaveBeenCalled();
  });

  it('touches no tab for a conversation already asleep', async () => {
    const closeTab = vi.fn();
    await sleepSessionHere('s1', deps({ read: async () => session({ endedAt: 5 }), closeTab }));
    expect(closeTab).not.toHaveBeenCalled();
  });

  it('does nothing at all when the state file has already gone', async () => {
    const closeTab = vi.fn();
    const markEnded = vi.fn();
    await sleepSessionHere('s1', deps({ read: async () => undefined, closeTab, markEnded }));
    expect(closeTab).not.toHaveBeenCalled();
    expect(markEnded).not.toHaveBeenCalled();
  });
});

// The trash's contract, stated against the moon's — the two are twins and easy
// to confuse. Whatever the row, one click archives the conversation and takes
// it off the dashboard; it is then reachable in "recently closed" and nowhere
// else.
describe('requestCloseSession — the trash always files what it removes', () => {
  const deps = (over: Partial<RequestCloseDeps> = {}): RequestCloseDeps => ({
    confirm: async () => true,
    route: async () => undefined,
    archive: async () => undefined,
    forget: async () => undefined,
    ...over,
  });

  it('archives an asleep conversation before removing it — the moon never filed it', async () => {
    const calls: string[] = [];
    await requestCloseSession(session({ endedAt: 10 }), deps({
      archive: async (s) => {
        calls.push(`archive:${s.id}`);
      },
      forget: async (id) => {
        calls.push(`forget:${id}`);
      },
    }));
    expect(calls).toEqual(['archive:s1', 'forget:s1']);
  });

  it('never asks before removing an asleep row — nothing runs behind it', async () => {
    const confirm = vi.fn();
    await requestCloseSession(session({ endedAt: 10, status: 'running' }), deps({ confirm }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('closes no tab for an asleep row — its tab went when it fell asleep', async () => {
    const route = vi.fn();
    await requestCloseSession(session({ endedAt: 10 }), deps({ route }));
    expect(route).not.toHaveBeenCalled();
  });

  it('still routes a live conversation rather than archiving it here — the closing window does that', async () => {
    const archive = vi.fn();
    const route = vi.fn();
    await requestCloseSession(session(), deps({ archive, route }));
    expect(route).toHaveBeenCalledTimes(1);
    expect(archive).not.toHaveBeenCalled();
  });
});

// La couture qui a cassé une fois déjà : après un redémarrage de l éditeur, une
// conversation marquée terminée dont l onglet a été restauré est AFFICHÉE
// éveillée. C est cette ligne-là qu on clique, et c est donc elle que le geste
// doit lire — le fichier d état brut, lui, porte encore sa fin et faisait
// sortir la commande en silence.
describe('sleepSessionHere — sur la conversation telle que sa ligne la montre', () => {
  it('endort une conversation que son onglet restauré fait paraître éveillée', async () => {
    const onDisk = session({ endedAt: 10 });
    const restored = session({ dormant: true, lastEventAt: 0 });
    const shown = shownSession(onDisk, restored);
    expect(shown?.endedAt).toBeUndefined();

    const calls: string[] = [];
    await sleepSessionHere('s1', {
      read: async () => shown,
      closeTab: async () => {
        calls.push('closeTab');
        return 'closed';
      },
      markEnded: async () => {
        calls.push('markEnded');
      },
      now: () => 1_000,
    });

    expect(calls).toEqual(['closeTab', 'markEnded']);
  });

  it('refuse toujours celle que RIEN ne fait paraître éveillée', async () => {
    const onDisk = session({ endedAt: 10 });
    const closeTab = vi.fn();
    await sleepSessionHere('s1', {
      read: async () => shownSession(onDisk, undefined),
      closeTab,
      markEnded: async () => undefined,
      now: () => 1_000,
    });
    expect(closeTab).not.toHaveBeenCalled();
  });
});
