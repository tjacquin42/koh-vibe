import { beforeEach, describe, expect, it, vi } from 'vitest';

class TabInputWebview {
  constructor(readonly viewType: string) {}
}
interface FakeTab {
  label: string;
  input: unknown;
}
interface FakeGroup {
  tabs: FakeTab[];
  activeTab: FakeTab | undefined;
}

const window: { tabGroups: { all: FakeGroup[]; activeTabGroup: FakeGroup } | undefined } = { tabGroups: undefined };
const memento = vi.fn<(db: string) => Promise<string | undefined>>();

vi.mock('vscode', () => ({
  TabInputWebview,
  window: {
    get tabGroups() {
      return window.tabGroups;
    },
  },
}));
vi.mock('../../src/claude/dormant', async (orig) => ({ ...(await orig<typeof import('../../src/claude/dormant')>()), readEditorMemento: (db: string) => memento(db) }));

const { ActiveTab } = await import('../src/host/active-tab');

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const claude = (label: string): FakeTab => ({ label, input: new TabInputWebview('mainThreadWebview-claudeVSCodePanel') });
const file = (label: string): FakeTab => ({ label, input: { uri: 'file' } });
const group = (tabs: FakeTab[], active: FakeTab | undefined = tabs[0]): FakeGroup => ({ tabs, activeTab: active });
const show = (groups: FakeGroup[], active: FakeGroup | undefined = groups[0]): void => {
  if (active === undefined) throw new Error('no group');
  window.tabGroups = { all: groups, activeTabGroup: active };
};
/** The editor's memento, as it persists it: one leaf per group, one editor per tab. */
const raw = (leaves: { title: string; id: string }[][]): string =>
  JSON.stringify(
    leaves.map((editors) => ({
      type: 'leaf',
      data: {
        editors: editors.map((e) => ({
          id: 'workbench.editors.webviewInput',
          value: JSON.stringify({ providedId: 'claudeVSCodePanel', title: e.title, state: JSON.stringify({ sessionID: e.id }) }),
        })),
      },
    })),
  );

beforeEach(() => {
  window.tabGroups = undefined;
  memento.mockReset();
  memento.mockResolvedValue(undefined);
});

describe('the conversation whose tab is in front (14/11)', () => {
  it('says nothing outside an editor that has tab groups', async () => {
    expect(await new ActiveTab('db').current(1)).toBeUndefined();
    expect([...(await new ActiveTab('db').restored(1))]).toEqual([]);
  });

  it('says nothing when the tab in front is a file, or when no tab is', async () => {
    const f = file('a.ts');
    show([group([f])]);
    expect(await new ActiveTab('db').current(1)).toBeUndefined();
    show([group([f], undefined)]);
    expect(await new ActiveTab('db').current(1)).toBeUndefined();
    expect(memento).not.toHaveBeenCalled();
  });

  it('says the conversation, through the memento, when the title belongs to one only', async () => {
    const tab = claude('Fix the bug');
    show([group([tab])]);
    memento.mockResolvedValue(raw([[{ title: 'Fix the bug', id: ID_A }]]));
    expect(await new ActiveTab('db').current(1_000)).toEqual({ label: 'Fix the bug', sessionId: ID_A });
  });

  it('gives the title alone for a tab the memento does not know yet — a conversation just opened', async () => {
    show([group([claude('Brand new')])]);
    memento.mockResolvedValue(raw([[{ title: 'Another', id: ID_B }]]));
    expect(await new ActiveTab('db').current(1_000)).toEqual({ label: 'Brand new' });
  });

  it('gives the title alone when there is no state database to read', async () => {
    show([group([claude('Fix the bug')])]);
    expect(await new ActiveTab(undefined).current(1_000)).toEqual({ label: 'Fix the bug' });
    expect(memento).not.toHaveBeenCalled();
  });

  it('reads the memento at most every two seconds while the tabs move, then once a minute', async () => {
    show([group([claude('T')])]);
    const tabs = new ActiveTab('db');
    await tabs.current(1_000);
    await tabs.current(2_500);
    expect(memento).toHaveBeenCalledTimes(1);
    await tabs.current(3_100);
    expect(memento).toHaveBeenCalledTimes(2);
    // Past the settling window (20 s after the tabs last moved) the table is trusted for a minute.
    await tabs.current(30_000);
    expect(memento).toHaveBeenCalledTimes(2);
    await tabs.current(63_100);
    expect(memento).toHaveBeenCalledTimes(2);
    await tabs.current(63_101);
    expect(memento).toHaveBeenCalledTimes(3);
  });

  it('reads again at once after the tab in front changed', async () => {
    show([group([claude('T')])]);
    const tabs = new ActiveTab('db');
    await tabs.current(1_000);
    tabs.forget(1_100);
    await tabs.current(1_200);
    expect(memento).toHaveBeenCalledTimes(2);
  });

  it('reads the memento afresh, an unreadable one counting as no tab', async () => {
    show([group([claude('T')])]);
    memento.mockResolvedValue('not json');
    expect(await new ActiveTab('db').current(1_000)).toEqual({ label: 'T' });
  });
});

describe('the conversations whose tab is open in this window (15/11)', () => {
  it('keeps those of the memento whose title is still on a Claude tab, leaving out one closed a moment ago', async () => {
    show([group([claude('Open one'), file('Open one')])]);
    memento.mockResolvedValue(
      raw([
        [
          { title: 'Open one', id: ID_A },
          { title: 'Closed just now', id: ID_B },
        ],
      ]),
    );
    expect([...(await new ActiveTab('db').restored(1_000))]).toEqual([ID_A]);
  });

  it('is empty without a state database', async () => {
    show([group([claude('Open one')])]);
    expect((await new ActiveTab(undefined).restored(1)).size).toBe(0);
  });
});
