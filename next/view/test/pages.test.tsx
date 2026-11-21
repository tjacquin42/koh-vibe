import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SIDEBAR_TABS, type ActivityItemView, type SessionSheetView, type Snapshot } from '../../src/shared/protocol';
import { ArtifactRow } from '../src/components/organisms/ArtifactRow';
import { Header } from '../src/components/organisms/Header';
import type { ViewCtx } from '../src/context';
import { StatusPeek } from '../src/components/organisms/StatusPeek';
import { onEnter, type PeekGroup, type PeekState } from '../src/hooks/usePeekGroup';
import { inTone } from '../src/sections';
import { Hungriest } from '../src/components/organisms/Hungriest';
import { Inbox } from '../src/components/organisms/Inbox';
import { SessionRow } from '../src/components/organisms/SessionRow';
import { SessionSheet } from '../src/components/organisms/SessionSheet';
import { Shell } from '../src/components/templates/Shell';
import { sampleSheet, sampleSnapshot } from '../src/fixture';
import { translator } from '../src/i18n';
import { COCKPIT_VIEWS, DEFAULT_UI, type UiState } from '../src/ui-state';
import { ArtifactsTab } from '../src/views/Artifacts';
import { CockpitPage } from '../src/views/CockpitPage';
import { SessionsTab } from '../src/views/Sessions';
import { SettingsPanel } from '../src/views/Settings';
import { SidebarPage } from '../src/views/SidebarPage';
import { NOW, testCtx } from './ctx';

const html = (el: ReactElement): string => renderToStaticMarkup(el);
const noop = (): void => undefined;
const sample = (): Snapshot => sampleSnapshot(NOW);
const sessionOf = (snap: Snapshot, id: string) => {
  const s = snap.sessions.find((x) => x.id === id);
  if (s === undefined) throw new Error(`no session ${id} in the sample`);
  return s;
};

/** A question asked to the user, everywhere a tool's name can show: waiting on it, running it, in the feed, in the sheet. */
const QUIET = 'AskUserQuestion';
function asking(): { snapshot: Snapshot; sheet: SessionSheetView } {
  const snap = sample();
  const sheet = sampleSheet('s1', NOW);
  const question: ActivityItemView = { sessionId: 's1', at: NOW, kind: 'tool', tool: QUIET, text: 'Which one?', subagent: false };
  return {
    sheet: { ...sheet, tools: [{ at: NOW, tool: QUIET, target: 'Which one?' }, ...sheet.tools] },
    snapshot: {
      ...snap,
      sessions: snap.sessions.map((s) => (s.id === 's1' ? { ...s, pendingPermission: { tool: QUIET, summary: 'Which one?' } } : s.id === 's2' ? { ...s, currentAction: { tool: QUIET } } : s)),
      activity:
        snap.activity === undefined
          ? undefined
          : {
              ...snap.activity,
              feed: [question, ...snap.activity.feed],
              sessions: snap.activity.sessions.map((a) => (a.id === 's1' ? { ...a, tail: [question, ...a.tail] } : a)),
            },
    },
  };
}

describe('the sidebar', () => {
  it.each(SIDEBAR_TABS)('draws its %s tab, the tabs’ names whole', (tab) => {
    const ui: UiState = { ...DEFAULT_UI, tab };
    const out = html(<SidebarPage ctx={testCtx()} version="1.2.3" ui={ui} updateUi={noop} />);
    expect(out).toContain(`data-flip="tab:${tab}" data-name`);
    expect(out).toMatch(new RegExp(`data-flip="tab:${tab}"[^>]*aria-selected="true"`));
    expect(out).toContain('<span class="ver mono">v1.2.3</span>');
    // Never a tab's name cut short (15/11).
    for (const name of out.matchAll(/data-name="([^"]*)"/g)) expect(name[1]).not.toContain('…');
  });

  it('shows the usage at its foot — but under the Usage tab, which is all of it already, and when the setting hides it', () => {
    const strip = 'class="usage compact"';
    expect(html(<SidebarPage ctx={testCtx()} version="1" ui={DEFAULT_UI} updateUi={noop} />)).toContain(strip);
    expect(html(<SidebarPage ctx={testCtx()} version="1" ui={{ ...DEFAULT_UI, tab: 'usage' }} updateUi={noop} />)).not.toContain(strip);
    expect(html(<SidebarPage ctx={testCtx()} version="1" ui={{ ...DEFAULT_UI, showUsage: false }} updateUi={noop} />)).not.toContain(strip);
  });

  it('reads only the processes it is given: none yet says it is reading', () => {
    const { processes: _unread, ...snapshot } = sample();
    const out = html(<SidebarPage ctx={testCtx({ snapshot })} version="1" ui={{ ...DEFAULT_UI, tab: 'processes' }} updateUi={noop} />);
    expect(out).toContain(translator('en')('processes.reading'));
  });
});

describe('the header', () => {
  const t = translator('en');
  it('counts the open conversations over the list, but not over the settings', () => {
    const tools = { onCockpit: noop, onNew: noop, newBusy: false, settingsOpen: false, onSettings: noop };
    const list = html(<Header t={t} snapshot={sample()} surface="sidebar" version="preview" tools={tools} />);
    expect(list).toContain('class="counts"');
    expect(list).toContain('class="head-tools"');
    // « preview » is no version number: not shown.
    expect(list).not.toContain('class="ver');
    expect(html(<Header t={t} snapshot={sample()} surface="sidebar" version="2.0.0" tools={{ ...tools, settingsOpen: true }} />)).not.toContain('class="counts"');
  });

  it('is a title alone in the cockpit, which counts its chosen folder itself', () => {
    const out = html(<Header t={t} snapshot={sample()} surface="cockpit" version="2.0.0" />);
    expect(out).not.toContain('head-tools');
    expect(out).not.toContain('class="counts"');
    expect(out).not.toContain('class="ver');
  });
});

describe('the cockpit', () => {
  const draw = (ui: UiState, sheet?: string): string => html(<CockpitPage ctx={testCtx()} version="1" ui={ui} updateUi={noop} sheet={sheet} onSheet={noop} />);

  it.each(COCKPIT_VIEWS)('draws its %s view', (view) => {
    const out = draw({ ...DEFAULT_UI, cockpit: { ...DEFAULT_UI.cockpit, view } });
    expect(out).toMatch(new RegExp(`data-flip="view:${view}"[^>]*aria-selected="true"`));
    expect(out).toContain('class="ck-main"');
  });

  it('names the board’s columns in English in every language, as every state is (16/11)', () => {
    const out = html(<CockpitPage ctx={testCtx({ language: 'fr' })} version="1" ui={DEFAULT_UI} updateUi={noop} sheet={undefined} onSheet={noop} />);
    for (const name of ['Waiting for you', 'Working', 'Finished', 'Idle and ended']) expect(out).toContain(`aria-label="${name}"`);
    expect(out).not.toContain('Travaillent');
  });

  it('shows a conversation’s name and age on its card, and nothing under them (16/11)', () => {
    const out = draw(DEFAULT_UI);
    expect(out).toContain('class="bcard');
    // Neither where it lives nor the command it runs.
    expect(out).not.toContain('class="l2"');
    expect(out).not.toContain('src/dates.ts');
  });

  it('counts the chosen folder only', () => {
    const counts = (folder: string | null): string[] => [...draw({ ...DEFAULT_UI, cockpit: { ...DEFAULT_UI.cockpit, folder } }).matchAll(/class="count tone-\w+[^"]*"[^>]*>(?:<span class="count-ink">)?<b>(\d+)<\/b>/g)].map((m) => m[1] ?? '');
    expect(counts(null)).toEqual(['1', '1', '1']);
    // Shop holds the one that waits and the one that finished; Backend the one that works.
    expect(counts('f1')).toEqual(['1', '0', '1']);
    expect(counts('f2')).toEqual(['0', '1', '0']);
    expect(counts('unfiled')).toEqual(['0', '0', '0']);
  });

  it('shows a conversation’s sheet over the view, with no view selected under it', () => {
    const out = draw(DEFAULT_UI, 's1');
    expect(out).toContain('class="sheet"');
    expect(out).not.toContain('aria-selected="true"');
  });
});

describe('what never shows', () => {
  it('« AskUserQuestion »: nowhere in the sidebar, the cockpit or a sheet (15/11)', () => {
    const { snapshot, sheet } = asking();
    const ctx = testCtx({ snapshot: { ...snapshot, sheet } });
    const drawn = [
      ...SIDEBAR_TABS.map((tab) => html(<SidebarPage ctx={ctx} version="1" ui={{ ...DEFAULT_UI, tab }} updateUi={noop} />)),
      ...COCKPIT_VIEWS.map((view) => html(<CockpitPage ctx={ctx} version="1" ui={{ ...DEFAULT_UI, cockpit: { ...DEFAULT_UI.cockpit, view } }} updateUi={noop} sheet={undefined} onSheet={noop} />)),
      html(<SessionSheet ctx={ctx} id="s1" onClose={noop} />),
      // Behind the (i) of the conversation that runs it, too.
      html(<SessionsTab ctx={ctx} />),
    ];
    for (const out of drawn) expect(out).not.toContain(QUIET);
    // The question itself still shows where the tool's name does not.
    expect(drawn.join('')).toContain('Which one?');
  });
});

/** A bubble group frozen in `state`: what the counts draw for it. */
const group = (state: PeekState = {}): PeekGroup => ({ state, enter: noop, leave: noop, press: noop, close: noop });

describe('the counts share one bubble (21/11)', () => {
  it('opens after a pause with none open, at once going from one to the next, never for an empty count', () => {
    expect(onEnter({}, true)).toBe('later');
    expect(onEnter({ open: 'wait' }, true)).toBe('now');
    expect(onEnter({ leaving: 'run' }, true)).toBe('now');
    expect(onEnter({ open: 'wait' }, false)).toBe('none');
  });

  it('draws the open one only, and the fading one as leaving', () => {
    const ctx = testCtx();
    const open = { open: 'wait' as const };
    expect(html(<StatusPeek ctx={ctx} tone="wait" sessions={ctx.snapshot.sessions} group={group(open)} />)).toContain('class="popover"');
    expect(html(<StatusPeek ctx={ctx} tone="run" sessions={ctx.snapshot.sessions} group={group(open)} />)).not.toContain('popover');
    expect(html(<StatusPeek ctx={ctx} tone="run" sessions={ctx.snapshot.sessions} group={group({ leaving: 'run' })} />)).toContain('popover leaving');
  });
});

describe('« waiting for you » (21/11)', () => {
  const cards = (ctx: ViewCtx) => html(<Inbox ctx={ctx} tone="wait" sessions={inTone(ctx.snapshot.sessions, 'wait')} />);

  it('lists what waits as cards, and nothing at all when nothing does', () => {
    expect(cards(testCtx())).toContain('Rename the export button');
    const snap = sample();
    const quiet = { ...snap, sessions: snap.sessions.map((s) => ({ ...s, status: 'idle' as const })) };
    expect(cards(testCtx({ snapshot: quiet }))).toBe('');
  });

  it('says what it waits on — the tool and its command', () => {
    expect(cards(testCtx())).toContain('<b>Bash</b> pnpm test');
  });

  it('darkens the count, with its rainbow, while something waits — and no longer shows a « For you » section', () => {
    const ctx = testCtx();
    const out = html(<StatusPeek ctx={ctx} tone="wait" sessions={ctx.snapshot.sessions} group={group()} />);
    expect(out).toContain('count tone-wait peekable asking');
    expect(out).toContain('aria-haspopup="dialog"');
    expect(html(<SessionsTab ctx={ctx} />)).not.toContain('For you');
    expect(out).toContain('asking moving');
    // Without the Animations setting, darkened still, no rainbow.
    expect(html(<StatusPeek ctx={testCtx({ animate: false })} tone="wait" sessions={ctx.snapshot.sessions} group={group()} />)).not.toContain('moving');
  });

  it('stays plain when nothing waits', () => {
    const snap = sample();
    const quiet = { ...snap, sessions: snap.sessions.map((s) => ({ ...s, status: 'idle' as const })) };
    const ctx = testCtx({ snapshot: quiet });
    const out = html(<StatusPeek ctx={ctx} tone="wait" sessions={quiet.sessions} group={group()} />);
    expect(out).not.toContain('asking');
    expect(out).toContain('aria-disabled="true"');
    expect(out).toMatch(/<b>0<\/b>/);
  });

  it('lists the working and the finished ones too, on hover — in the sidebar only, plain in the cockpit', () => {
    const ctx = testCtx();
    const run = html(<StatusPeek ctx={ctx} tone="run" sessions={ctx.snapshot.sessions} group={group()} />);
    expect(run).toContain('count tone-run peekable');
    expect(run).not.toContain('asking');
    expect(html(<Inbox ctx={ctx} tone="done" sessions={inTone(ctx.snapshot.sessions, 'done')} />)).toContain('ask ask-go tone-done');
    expect(html(<Inbox ctx={ctx} tone="run" sessions={inTone(ctx.snapshot.sessions, 'run')} />)).toContain('Fix the flaky date test');
    const done = inTone(ctx.snapshot.sessions, 'done').map((s) => ({ ...s, lastEventAt: ctx.now - 5 * 60_000 }));
    expect(html(<Inbox ctx={ctx} tone="done" sessions={done} />)).toContain('5 min ago');
    const cockpit = html(<CockpitPage ctx={ctx} version="1" ui={DEFAULT_UI} updateUi={noop} sheet={undefined} onSheet={noop} />);
    expect(cockpit).not.toContain('peekable');
    expect(cockpit).not.toContain('asking');
    const sidebar = html(<SidebarPage ctx={ctx} version="1" ui={DEFAULT_UI} updateUi={noop} />);
    expect(sidebar).toContain('count tone-wait peekable asking');
  });

  it('puts the latest question on top, and offers no × — a question waits until it is answered', () => {
    const snap = sample();
    const base = sessionOf(snap, 's1');
    const older = { ...base, id: 'old', title: 'Asked first', lastEventAt: base.lastEventAt - 60_000 };
    const newer = { ...base, id: 'new', title: 'Asked last', lastEventAt: base.lastEventAt + 60_000 };
    expect(inTone([older, newer], 'wait').map((s) => s.id)).toEqual(['new', 'old']);
    const out = cards(testCtx({ snapshot: { ...snap, sessions: [older, newer] } }));
    expect(out.indexOf('Asked last')).toBeLessThan(out.indexOf('Asked first'));
    expect(out).not.toContain('ask-x');
  });
});

describe('a conversation’s row', () => {
  const t = translator('en');
  const row = (id: string, over = {}): string => {
    const ctx = testCtx(over);
    return html(<SessionRow ctx={ctx} s={sessionOf(ctx.snapshot, id)} />);
  };

  it('offers sleep only to an open conversation in a folder (15/11)', () => {
    const sleep = `aria-label="${t('row.sleep')}"`;
    expect(row('s1')).toContain(sleep);
    // In no folder: closed, never put to sleep.
    expect(row('s4')).not.toContain(sleep);
    // Asleep already.
    expect(row('s5')).not.toContain(sleep);
    expect(row('s5')).toContain(`aria-label="${t('row.close')}"`);
  });

  it('offers « Mark as unread » on its right-click to an open conversation at rest only (19/11)', () => {
    const can = (id: string): boolean => /&quot;kvnCanUnread&quot;:true/.test(row(id));
    // s4 rests, open; s3 is unread already; s2 works; s1 waits; s5 is asleep.
    expect(can('s4')).toBe(true);
    for (const id of ['s3', 's2', 's1', 's5']) expect(can(id)).toBe(false);
  });

  it('spins while its conversation is being opened, and marks the one in front', () => {
    expect(row('s1', { reopening: new Set(['s1']) })).toContain('class="spinner"');
    expect(row('s1', { activeId: 's1' })).toMatch(/class="srow [^"]*active"[^>]*aria-current="true"/);
    expect(row('s1', { activeId: 's2' })).not.toContain('aria-current');
  });
});

describe('the artifacts of a folder (16/11)', () => {
  const t = translator('en');
  /** Backend holds a conversation that works, one asleep — and now two artifacts, one of them on claude.ai's list. */
  const filed = (): Snapshot => {
    const snap = sample();
    return { ...snap, folders: snap.folders.map((f) => (f.id === 'f2' ? { ...f, artifacts: [{ slug: 'a2', title: 'API error budget' }, { slug: 'old', title: 'Left claude.ai' }] } : f)) };
  };
  const draw = (over = {}): string => html(<SessionsTab ctx={testCtx({ snapshot: filed(), ...over })} />);

  it('sit between the folder’s conversations and its closed ones, under a heading of their own', () => {
    const out = draw();
    const live = out.indexOf('data-session="s2"');
    const head = out.indexOf('data-fold="f2:artifacts"');
    const first = out.indexOf('API error budget');
    const closed = out.indexOf('data-flip-anchor="f2:ended"');
    expect(live).toBeGreaterThan(-1);
    expect(live).toBeLessThan(head);
    expect(head).toBeLessThan(first);
    expect(first).toBeLessThan(closed);
    // Their count, and what the heading is for a screen reader.
    expect(out).toContain(`aria-label="${t('folder.artifacts', { n: 2 })}"`);
    expect(out).toContain('Left claude.ai');
  });

  it('fold under their heading, as the closed conversations do', () => {
    const out = draw({ isFolded: (key: string) => key === 'f2:artifacts' });
    expect(out).toMatch(/data-fold="f2:artifacts"[^>]*aria-expanded="false"/);
    expect(out).not.toContain('API error budget');
    // The conversations of the folder still show.
    expect(out).toContain('data-session="s2"');
  });

  it('open on a click, and leave the folder by their ×', () => {
    const out = draw();
    expect(out).toContain(`aria-label="API error budget — ${t('artifacts.open')}"`);
    expect(out.split(`aria-label="${t('folder.artifactOut')}"`).length - 1).toBe(2);
  });

  it('show no heading in a folder that holds none', () => {
    const snap = sample();
    const none = { ...snap, folders: snap.folders.map(({ artifacts: _none, ...f }) => f) };
    const out = html(<SessionsTab ctx={testCtx({ snapshot: none })} />);
    expect(out).not.toContain(':artifacts"');
  });

  it('keep a folder that holds only artifacts from saying it is empty', () => {
    const snap = sample();
    const only = { ...snap, folders: snap.folders.map((f) => (f.id === 'f2' ? { ...f, sessionIds: [], artifacts: [{ slug: 'a2', title: 'API error budget' }] } : f)) };
    const out = html(<SessionsTab ctx={testCtx({ snapshot: only })} />);
    const backend = out.slice(out.indexOf('data-flip-anchor="f2"'), out.indexOf('data-flip-anchor="f3"'));
    expect(backend).toContain('API error budget');
    expect(backend).not.toContain(t('folder.empty'));
  });
});

describe('the artifacts, by project (16/11)', () => {
  const t = translator('en');
  const tab = (): string => html(<ArtifactsTab ctx={testCtx()} />);

  it('are moved between projects by dragging them: every row can be picked up', () => {
    const out = tab();
    const rows = [...out.matchAll(/<div class="arow(?: [^"]*)?"[^>]*>/g)].map((m) => m[0]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row).toContain('draggable="true"');
  });

  it('have no field to type a project in any more: no list of the browser’s own', () => {
    const out = tab();
    expect(out).not.toContain('<datalist');
    expect(out).not.toContain('list="');
  });

  it('offer « New folder » right under « By project », above the projects (16/11)', () => {
    const out = tab();
    const heading = out.indexOf(t('artifacts.byProject'));
    const button = out.indexOf(t('artifacts.newProject'));
    const first = out.indexOf('>api<');
    expect(heading).toBeGreaterThan(-1);
    expect(heading).toBeLessThan(button);
    expect(button).toBeLessThan(first);
  });

  it('show a folder made by hand though it is empty, and offer to delete it only then', () => {
    const snap = sample();
    const artifacts = snap.artifacts === undefined ? undefined : { ...snap.artifacts, folders: ['Veille', 'api'] };
    const open = testCtx({ snapshot: { ...snap, artifacts }, isFolded: (key: string) => key.startsWith('proj:') });
    const out = html(<ArtifactsTab ctx={open} />);
    const veille = out.slice(out.indexOf('>Veille<'));
    expect(veille).toContain(t('artifacts.emptyProject'));
    // Asked in a menu the test cannot open: the row only says the menu is there, for both.
    expect(out).toContain(`aria-label="${t('folder.menu', { name: 'Veille' })}"`);
  });

  it('keep the folders made by hand on screen when claude.ai lists no artifact at all', () => {
    const none = testCtx({ snapshot: { ...sample(), artifacts: { at: NOW, items: [], folders: ['Veille'] } } });
    const out = html(<ArtifactsTab ctx={none} />);
    expect(out).toContain('>Veille<');
    expect(out).toContain(t('artifacts.newProject'));
  });

  it('are not picked up from the search’s results, which have nowhere to drop them', () => {
    const out = html(<SidebarPage ctx={testCtx()} version="1" ui={DEFAULT_UI} updateUi={noop} />);
    // The sessions tab: its own rows drag, an artifact's row from the Artifacts tab is not there.
    expect(out).not.toContain('class="arow" draggable');
    const found = html(<ArtifactRow ctx={testCtx()} a={{ slug: 'a1', title: 'Release plan', pinned: true }} />);
    expect(found).not.toContain('draggable="true"');
  });
});

describe('the hungriest conversations', () => {
  it('goes to an open conversation, brings back a closed one that can be, and offers nothing for one that cannot', () => {
    const snap = sample();
    const closed = snap.closed[0];
    if (closed === undefined) throw new Error('the sample has no closed conversation');
    const spend = { at: NOW, windows: { '5h': [{ sessionId: 's1', share: 0.6 }, { sessionId: closed.sessionId, share: 0.395 }, { sessionId: 'unknown-0000', share: 0.004, title: 'Left the lists' }], '24h': [], '7d': [] } };
    const out = html(<Hungriest ctx={testCtx({ snapshot: { ...snap, spend, closed: [{ ...closed, resumable: true }] } })} />);
    const rows = [...out.matchAll(/<button type="button" class="spend-row"[^>]*>/g)].map((m) => m[0].includes('disabled'));
    expect(rows).toEqual([false, false, true]);
    expect(out).toContain('Left the lists');
    expect(out).toContain('60 %');
    expect(out).toContain('40 %');
    // Under one percent says so rather than « 0 % ».
    expect(out).toContain('&lt; 1 %');
  });

  it('says it is reading until the first ranking, and that nothing was spent when it is empty', () => {
    const t = translator('en');
    const { spend: _none, ...unread } = sample();
    expect(html(<Hungriest ctx={testCtx({ snapshot: unread })} />)).toContain(t('usage.top.reading'));
    const empty = { ...sample(), spend: { at: NOW, windows: { '5h': [], '24h': [], '7d': [] } } };
    expect(html(<Hungriest ctx={testCtx({ snapshot: empty })} />)).toContain(t('usage.top.none'));
  });
});

describe('the settings', () => {
  it('greys « in the editor » where the editor has no integrated browser, and says which editor', () => {
    const draw = (integratedBrowser: boolean): string =>
      html(<SettingsPanel ctx={testCtx({ snapshot: { ...sample(), editor: { name: 'Antigravity IDE', integratedBrowser }, artifactOpen: 'editor' } })} onClose={noop} showUsage onShowUsage={noop} onSort={noop} onArchives={noop} />);
    const without = draw(false);
    expect(without).toMatch(/aria-checked="true"[^>]*>[^<]*<\/button><button type="button" role="radio" aria-checked="false" disabled=""/);
    expect(without).toContain('Antigravity IDE');
    const withOne = draw(true);
    expect(withOne).not.toContain('class="sub set-note"');
  });
});

describe('the shell', () => {
  it('frames both views, with the preview’s banner only outside the editor', () => {
    const inEditor = html(
      <Shell surface="cockpit" toast={null}>
        page
      </Shell>,
    );
    expect(inEditor).toContain('class="app surface-cockpit"');
    expect(inEditor).not.toContain('class="preview"');
    expect(html(<Shell surface="sidebar" banner="Preview" toast={<i>said</i>}>page</Shell>)).toContain('<div class="preview">Preview</div>page<i>said</i>');
  });
});
