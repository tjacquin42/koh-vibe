import { describe, expect, it } from 'vitest';
import type { Session } from '../src/events/types';
import type { ClosedEntry } from '../src/closed/model';
import type { Group } from '../src/groups/model';
import { searchItems } from '../src/ui/search';

const session = (id: string, extra: Partial<Session> = {}): Session => ({
  id,
  cwd: '/Users/dev/projet',
  project: 'projet',
  origin: 'vscode',
  status: 'idle',
  toolCount: 0,
  lastEventAt: 0,
  ...extra,
});
const video: Group = { id: 'g1', name: 'VIDEO', order: 0 };
const closed: ClosedEntry = { id: 'c1', cwd: '/Users/dev/autre', project: 'autre', title: 'Vieille conv', origin: 'vscode', closedAt: 1 };

describe('search list', () => {
  it('lists conversations, filed artifacts and closed ones, each under its separator', () => {
    const items = searchItems({
      sessions: [session('s1', { title: 'Montage vidéo', branch: 'dev' }), session('s2', { endedAt: 5 })],
      folderOf: (id) => (id === 's1' ? video : undefined),
      artifacts: [{ artifact: { slug: 'a1', title: 'Carnet' }, group: video }],
      closed: [closed],
    });
    expect(items.map((i) => i.label)).toEqual([
      'Conversations',
      '$(comment-discussion) Montage vidéo',
      '$(circle-slash) projet',
      'Artifacts',
      '$(book) Carnet',
      'Recently closed',
      '$(history) Vieille conv',
    ]);
    expect(items[1]).toMatchObject({ description: '$(symbol-folder) VIDEO', detail: 'projet · dev', target: { kind: 'session' } });
    expect(items[2]?.description).toBe('Temporary sessions');
    expect(items[4]).toMatchObject({ description: '$(symbol-folder) VIDEO', target: { kind: 'artifact', slug: 'a1' } });
    expect(items[6]?.target).toEqual({ kind: 'closed', entry: closed });
  });

  it('leaves out the separator of an empty section', () => {
    const items = searchItems({ sessions: [session('s1')], folderOf: () => undefined, artifacts: [], closed: [] });
    expect(items.map((i) => i.label)).toEqual(['Conversations', '$(comment-discussion) projet']);
  });
});
