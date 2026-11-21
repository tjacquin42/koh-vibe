import { describe, expect, it, vi } from 'vitest';
import type { ArtifactView, RoutineView } from '../../src/shared/protocol';
import { MAX_NAME, MAX_TITLE } from '../../src/shared/actions';
import { Toast } from '../src/components/molecules/Toast';
import { Confirm, NameInput } from '../src/components/molecules/Inline';
import { TidyRules } from '../src/components/molecules/TidyRules';
import { ArtifactRow } from '../src/components/organisms/ArtifactRow';
import { FolderArtifacts } from '../src/components/organisms/FolderArtifacts';
import type { Dnd, Drag } from '../src/components/organisms/folder-dnd';
import type { ArtifactDnd, ArtifactDrag } from '../src/components/organisms/artifact-dnd';
import { HooksMissing } from '../src/components/organisms/HooksMissing';
import { NewFolder } from '../src/components/organisms/NewFolder';
import { NewProject } from '../src/components/organisms/NewProject';
import { ProjectSection } from '../src/components/organisms/ProjectSection';
import { SessionRow } from '../src/components/organisms/SessionRow';
import { RoutineCard } from '../src/components/organisms/RoutineCard';
import { translator } from '../src/i18n';
import type { ViewCtx } from '../src/context';
import { Mounted, textOf, type HostNode } from './mini';
import { NOW, testCtx } from './ctx';

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), ...(await import('./mini')).hooks }));

const t = translator('en');
const noop = (): void => undefined;
const typed = (m: Mounted, v: string): void => m.fire(m.find((n) => n.tag === 'input'), 'onChange', { target: { value: v } });

describe('Toast', () => {
  it('says its line, and closes at its ×', () => {
    const onClose = vi.fn();
    const m = new Mounted(() => <Toast text="Link copied" closeLabel="Close" onClose={onClose} />);
    expect(m.text()).toContain('Link copied');
    expect(m.find((n) => n.props['role'] === 'status')).toBeDefined();
    m.click(m.button('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('NameInput', () => {
  const field = (over: Partial<Parameters<typeof NameInput>[0]> = {}) => {
    const done = vi.fn<(n: string | undefined) => void>();
    const m = new Mounted(() => <NameInput initial="Old" label="Name" max={20} onDone={done} {...over} />);
    return { m, done };
  };

  it('starts on what it was given, limited to the size asked, and named for screen readers', () => {
    const { m } = field();
    const input = m.find((n) => n.tag === 'input');
    expect(input.props['value']).toBe('Old');
    expect(input.props['maxLength']).toBe(20);
    expect(input.props['aria-label']).toBe('Name');
  });

  it('keeps the trimmed name at Enter', () => {
    const { m, done } = field();
    typed(m, '  New name  ');
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Enter' });
    expect(done).toHaveBeenCalledWith('New name');
  });

  it('gives up at Escape, whatever was typed', () => {
    const { m, done } = field();
    typed(m, 'something');
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Escape' });
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it('gives up on an emptied field — but answers an empty name when that is a choice of its own', () => {
    const plain = field();
    typed(plain.m, '   ');
    plain.m.fire(plain.m.find((n) => n.tag === 'input'), 'onBlur');
    expect(plain.done).toHaveBeenCalledWith(undefined);
    const choice = field({ allowEmpty: true });
    typed(choice.m, '');
    choice.m.fire(choice.m.find((n) => n.tag === 'input'), 'onBlur');
    expect(choice.done).toHaveBeenCalledWith('');
  });

  it('answers once only: Enter then the blur it causes is not a second answer', () => {
    const { m, done } = field();
    const input = m.find((n) => n.tag === 'input');
    m.fire(input, 'onKeyDown', { key: 'Enter' });
    m.fire(input, 'onBlur');
    m.fire(input, 'onKeyDown', { key: 'Escape' });
    expect(done).toHaveBeenCalledTimes(1);
  });

  it('ignores the other keys, selects its text on focus, and offers a datalist only when given one', () => {
    const { m, done } = field({ list: 'projects' });
    const input = m.find((n) => n.tag === 'input');
    m.fire(input, 'onKeyDown', { key: 'a' });
    expect(done).not.toHaveBeenCalled();
    const select = vi.fn();
    m.fire(input, 'onFocus', { currentTarget: { select } });
    expect(select).toHaveBeenCalled();
    expect(input.props['list']).toBe('projects');
    expect(field().m.find((n) => n.tag === 'input').props).not.toHaveProperty('list');
  });
});

describe('Confirm', () => {
  const ask = (danger: boolean) => {
    const onYes = vi.fn();
    const onNo = vi.fn();
    const m = new Mounted(() => (
      <Confirm yes="Delete" no="Cancel" danger={danger} onYes={onYes} onNo={onNo}>
        Sure?
      </Confirm>
    ));
    return { m, onYes, onNo };
  };

  it('asks in a red box for what destroys, and a calm one for what only acts', () => {
    expect(ask(true).m.find((n) => n.props['role'] === 'alertdialog').props['className']).toBe('confirm');
    expect(ask(false).m.find((n) => n.props['role'] === 'alertdialog').props['className']).toBe('confirm calm');
    expect(ask(true).m.button('Delete').props['className']).toBe('btn-danger');
    expect(ask(false).m.button('Delete').props['className']).toBe('btn-go');
  });

  it('answers yes or no, never both', () => {
    const a = ask(true);
    a.m.click(a.m.button('Delete'));
    expect([a.onYes.mock.calls.length, a.onNo.mock.calls.length]).toEqual([1, 0]);
    const b = ask(true);
    b.m.click(b.m.button('Cancel'));
    expect([b.onYes.mock.calls.length, b.onNo.mock.calls.length]).toEqual([0, 1]);
  });
});

describe('TidyRules', () => {
  it('says there is no rule yet, and offers only to add one', () => {
    const m = new Mounted(() => <TidyRules t={t} rules={[]} onAdd={noop} onOpen={noop} />);
    expect(m.text()).toContain(t('tidy.noRule'));
    expect(m.all((n) => n.tag === 'li')).toHaveLength(0);
    expect(m.all((n) => n.tag === 'button')).toHaveLength(1);
  });

  it('lists the rules and offers to open their file as well', () => {
    const onAdd = vi.fn();
    const onOpen = vi.fn();
    const m = new Mounted(() => <TidyRules t={t} rules={['Recipes go to Cooking', 'Recipes go to Cooking']} onAdd={onAdd} onOpen={onOpen} />);
    expect(m.all((n) => n.tag === 'li').map((n) => n.kids[0])).toEqual(['Recipes go to Cooking', 'Recipes go to Cooking']);
    m.click(m.button(t('tidy.addRule')));
    m.click(m.button(t('tidy.openRules')));
    expect([onAdd.mock.calls.length, onOpen.mock.calls.length]).toEqual([1, 1]);
  });
});

describe('HooksMissing', () => {
  it('says what is missing and installs the hooks at its one button, the button busy meanwhile', () => {
    const tracked: [string, number | undefined][] = [];
    const track: ViewCtx['track'] = (key, p, hold) => {
      tracked.push([key, hold]);
      return p;
    };
    const ctx = testCtx({ track });
    const m = new Mounted(() => <HooksMissing ctx={ctx} />);
    expect(m.text()).toContain(t('hooks.missing.title'));
    m.click(m.button(t('hooks.missing.install')));
    expect(ctx.acted).toEqual([{ kind: 'hooks.install' }]);
    expect(tracked).toEqual([['hooks', 3_000]]);
    const busy = new Mounted(() => <HooksMissing ctx={testCtx({ isBusy: (k) => k === 'hooks' })} />);
    expect(busy.button(t('hooks.missing.install')).props['className']).toBe('btn-go busy');
  });
});

describe('NewFolder', () => {
  it('is a button until clicked, then the field that names the folder', () => {
    const ctx = testCtx();
    const m = new Mounted(() => <NewFolder ctx={ctx} />);
    expect(m.all((n) => n.tag === 'input')).toHaveLength(0);
    m.click(m.button(t('folder.new')));
    const input = m.find((n) => n.tag === 'input');
    expect(input.props['maxLength']).toBe(MAX_NAME);
  });

  it('creates the folder with the name typed, and goes back to its button', () => {
    const ctx = testCtx();
    const m = new Mounted(() => <NewFolder ctx={ctx} />);
    m.click(m.button(t('folder.new')));
    typed(m, 'Shop');
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Enter' });
    expect(ctx.acted).toEqual([{ kind: 'folder.create', name: 'Shop' }]);
    expect(m.all((n) => n.tag === 'input')).toHaveLength(0);
  });

  it('changes nothing at Escape', () => {
    const ctx = testCtx();
    const m = new Mounted(() => <NewFolder ctx={ctx} />);
    m.click(m.button(t('folder.new')));
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Escape' });
    expect(ctx.acted).toEqual([]);
    expect(m.button(t('folder.new'))).toBeDefined();
  });
});

describe('NewProject', () => {
  const dndWith = (drag: ArtifactDrag | undefined) => {
    const calls: string[] = [];
    const dnd: ArtifactDnd = {
      drag,
      setDrag: (d) => calls.push(`setDrag ${d === undefined ? 'none' : d.slug}`),
      file: (d, p) => calls.push(`file ${d.slug} ${String(p)}`),
      landed: undefined,
      moving: undefined,
      setMoving: noop,
      place: noop,
    };
    return { dnd, calls };
  };

  it('makes an empty project from the name typed', () => {
    const ctx = testCtx();
    const { dnd } = dndWith(undefined);
    const m = new Mounted(() => <NewProject ctx={ctx} dnd={dnd} />);
    m.click(m.button(t('artifacts.newProject')));
    typed(m, 'Cooking');
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Enter' });
    expect(ctx.acted).toEqual([{ kind: 'artifact.newProject', name: 'Cooking' }]);
  });

  it('makes nothing at Escape', () => {
    const ctx = testCtx();
    const { dnd, calls } = dndWith(undefined);
    const m = new Mounted(() => <NewProject ctx={ctx} dnd={dnd} />);
    m.click(m.button(t('artifacts.newProject')));
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Escape' });
    expect(ctx.acted).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('lights up under an artifact carried over it, and puts it in the folder it then names', () => {
    const ctx = testCtx();
    const { dnd, calls } = dndWith({ slug: 'a1', project: undefined });
    const m = new Mounted(() => <NewProject ctx={ctx} dnd={dnd} />);
    const event = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' } };
    m.fire(m.button(t('artifacts.newProject')), 'onDragOver', event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.dataTransfer.dropEffect).toBe('move');
    expect(m.button(t('artifacts.newProject')).props['className']).toBe('new-folder drop-in');
    m.fire(m.button(t('artifacts.newProject')), 'onDragLeave');
    expect(m.button(t('artifacts.newProject')).props['className']).toBe('new-folder');
    m.fire(m.button(t('artifacts.newProject')), 'onDrop', { preventDefault: noop });
    expect(calls).toEqual(['setDrag none']);
    typed(m, 'Cooking');
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Enter' });
    expect(calls).toEqual(['setDrag none', 'file a1 Cooking']);
    expect(ctx.acted).toEqual([]);
  });

  it('ignores a drag over it, and a drop on it, when nothing of ours is carried', () => {
    const { dnd, calls } = dndWith(undefined);
    const m = new Mounted(() => <NewProject ctx={testCtx()} dnd={dnd} />);
    const event = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' } };
    m.fire(m.button(t('artifacts.newProject')), 'onDragOver', event);
    m.fire(m.button(t('artifacts.newProject')), 'onDrop', event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});

describe('RoutineCard', () => {
  const routine = (over: Partial<RoutineView> = {}): RoutineView => ({ id: 'r1', name: 'Nightly', enabled: true, group: 'today', repos: [], spent: false, nextRunAt: NOW + 3_600_000, cron: '0 3 * * *', ...over });
  const card = (r: RoutineView, over = {}) => {
    const ctx = testCtx(over);
    return { ctx, m: new Mounted(() => <RoutineCard ctx={ctx} r={r} />) };
  };

  it('pauses an active routine, and resumes a paused one — but never a spent one-shot', () => {
    const a = card(routine());
    a.m.click(a.m.button(t('routines.pause')));
    expect(a.ctx.acted).toEqual([{ kind: 'routine.pause', id: 'r1', paused: true }]);
    const b = card(routine({ enabled: false, group: 'paused' }));
    b.m.click(b.m.button(t('routines.resume')));
    expect(b.ctx.acted).toEqual([{ kind: 'routine.pause', id: 'r1', paused: false }]);
    const spent = card(routine({ enabled: false, spent: true, group: 'paused' }));
    expect(spent.m.all((n) => n.tag === 'button' && textOf(n) === t('routines.resume'))).toHaveLength(0);
    expect(spent.m.all((n) => n.tag === 'button' && textOf(n) === t('routines.run'))).toHaveLength(0);
  });

  it('asks before it runs, runs on the yes and says it started, and runs nothing on the no', async () => {
    const notes: string[] = [];
    const { ctx, m } = card(routine(), { notify: (s: string) => notes.push(s) });
    m.click(m.button(t('routines.run')));
    expect(m.text()).toContain(t('routines.runConfirm', { name: 'Nightly' }));
    m.click(m.button(t('action.cancel')));
    expect(ctx.acted).toEqual([]);
    expect(m.button(t('routines.run'))).toBeDefined();
    m.click(m.button(t('routines.run')));
    m.click(m.button(t('routines.run')));
    await vi.waitFor(() => expect(notes).toEqual([t('routines.launched', { name: 'Nightly' })]));
    expect(ctx.acted).toEqual([{ kind: 'routine.run', id: 'r1' }]);
  });

  it('keeps quiet when the run was refused', async () => {
    const notes: string[] = [];
    const { m } = card(routine(), { act: async () => ({ ok: false, error: 'failed' }), notify: (s: string) => notes.push(s) });
    m.click(m.button(t('routines.run')));
    m.click(m.button(t('routines.run')));
    await Promise.resolve();
    await Promise.resolve();
    expect(notes).toEqual([]);
  });

  it('copies and opens its page on claude.ai', () => {
    const { ctx, m } = card(routine());
    m.click(m.button(t('routines.copyLink')));
    m.click(m.button(t('routines.open')));
    expect(ctx.acted).toEqual([
      { kind: 'routine.copyLink', id: 'r1' },
      { kind: 'routine.open', id: 'r1' },
    ]);
  });

  it('shows a run under way, with since when', () => {
    const { m } = card(routine({ runningSince: NOW - 120_000 }));
    expect(m.text()).toContain(t('routines.running'));
  });
});

describe('ArtifactRow', () => {
  const art = (over: Partial<ArtifactView> = {}): ArtifactView => ({ slug: 'a1', title: 'Plan', pinned: false, updatedAt: NOW - 3_600_000, ...over });
  const row = (a: ArtifactView, over = {}, dnd?: ArtifactDnd) => {
    const ctx = testCtx(over);
    return { ctx, m: new Mounted(() => <ArtifactRow ctx={ctx} a={a} {...(dnd === undefined ? {} : { dnd })} />) };
  };
  const menuOf = (m: Mounted): void => m.click(m.button(t('artifacts.menu', { name: 'Plan' })));

  it('pins and unpins from its pin, named for what the click will do', () => {
    const a = row(art());
    a.m.click(a.m.button(t('artifacts.pin')));
    expect(a.ctx.acted).toEqual([{ kind: 'artifact.pin', slug: 'a1', pinned: true }]);
    const b = row(art({ pinned: true }));
    b.m.click(b.m.button(t('artifacts.unpin')));
    expect(b.ctx.acted).toEqual([{ kind: 'artifact.pin', slug: 'a1', pinned: false }]);
  });

  it('opens its page through the host', () => {
    const posted: unknown[] = [];
    const bridge = { inEditor: true, post: (m: unknown) => posted.push(m), listen: () => noop, load: () => undefined, save: noop };
    const { m } = row(art(), { bridge });
    m.click(m.button(`Plan — ${t('artifacts.open')}`));
    expect(posted).toEqual([{ type: 'openArtifact', slug: 'a1' }]);
  });

  it('names an untitled page', () => {
    const { m } = row(art({ title: '' }));
    expect(m.text()).toContain(t('artifacts.untitled'));
  });

  it('opens a menu under its ⋯, and closes it at a second click', () => {
    const { m } = row(art());
    menuOf(m);
    expect(m.all((n) => n.props['role'] === 'menu').length + m.all((n) => n.props['role'] === 'dialog').length).toBeGreaterThan(0);
    menuOf(m);
    expect(m.all((n) => n.props['role'] === 'dialog')).toHaveLength(0);
  });

  it('copies the link from the menu and closes it', () => {
    const { ctx, m } = row(art());
    menuOf(m);
    m.click(m.button(t('artifacts.copyLink')));
    expect(ctx.acted).toEqual([{ kind: 'artifact.copyLink', slug: 'a1' }]);
    expect(m.all((n) => n.props['role'] === 'dialog')).toHaveLength(0);
  });

  it('renames in place: the field takes the row, and a changed title is sent', () => {
    const { ctx, m } = row(art());
    menuOf(m);
    m.click(m.button(t('artifacts.rename')));
    expect(m.find((n) => n.tag === 'input').props['maxLength']).toBe(MAX_TITLE);
    expect(m.all((n) => n.props['className'] === 'tools')).toHaveLength(0);
    typed(m, 'Better plan');
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Enter' });
    expect(ctx.acted).toEqual([{ kind: 'artifact.rename', slug: 'a1', title: 'Better plan' }]);
    expect(m.all((n) => n.tag === 'input')).toHaveLength(0);
  });

  it('sends nothing for a title left as it was', () => {
    const { ctx, m } = row(art());
    menuOf(m);
    m.click(m.button(t('artifacts.rename')));
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Enter' });
    expect(ctx.acted).toEqual([]);
  });

  it('asks before deleting, deletes on the yes and says so; the no keeps it', async () => {
    const notes: string[] = [];
    const { ctx, m } = row(art(), { notify: (s: string) => notes.push(s) });
    menuOf(m);
    m.click(m.button(t('artifacts.delete')));
    expect(m.text()).toContain(t('artifacts.deleteConfirm', { name: 'Plan' }));
    m.click(m.button(t('action.cancel')));
    expect(ctx.acted).toEqual([]);
    menuOf(m);
    m.click(m.button(t('artifacts.delete')));
    m.click(m.all((n) => n.tag === 'button' && textOf(n) === t('artifacts.delete')).at(-1) as HostNode);
    await vi.waitFor(() => expect(notes).toEqual([t('artifacts.deleted', { name: 'Plan' })]));
    expect(ctx.acted).toEqual([{ kind: 'artifact.delete', slug: 'a1' }]);
  });

  it('files it in a folder of conversations, and says where for a moment', async () => {
    vi.stubGlobal('window', { setTimeout: () => 1, clearTimeout: noop });
    const { ctx, m } = row(art());
    menuOf(m);
    m.click(m.button(t('artifacts.toFolder')));
    const folder = ctx.snapshot.folders[0];
    if (folder === undefined) throw new Error('sample has a folder');
    m.click(m.button(folder.name));
    await vi.waitFor(() => {
      // State set after an awaited action: drawn again, as the browser would.
      m.render();
      expect(m.text()).toContain(t('artifacts.filedIn', { name: folder.name }));
    });
    expect(ctx.acted).toEqual([{ kind: 'artifact.folder', slug: 'a1', title: 'Plan', folder: folder.id }]);
    vi.unstubAllGlobals();
  });

  it('takes it out of its folder from the same list', () => {
    const { ctx, m } = row(art());
    menuOf(m);
    m.click(m.button(t('artifacts.toFolder')));
    m.click(m.button(t('artifacts.noFolder')));
    expect(ctx.acted).toEqual([{ kind: 'artifact.folder', slug: 'a1', title: 'Plan' }]);
  });

  it('offers no folder choice when there is no folder', () => {
    const base = testCtx();
    const { m } = row(art(), { snapshot: { ...base.snapshot, folders: [] } });
    menuOf(m);
    expect(m.all((n) => n.tag === 'button' && textOf(n) === t('artifacts.toFolder'))).toHaveLength(0);
  });

  it('is carried to another project by dragging, and let go where it falls', () => {
    const calls: unknown[] = [];
    const dnd: ArtifactDnd = { drag: undefined, setDrag: (d) => calls.push(d), file: noop, landed: undefined, moving: undefined, setMoving: noop, place: noop };
    const { m } = row(art({ project: 'nti' }), {}, dnd);
    const root = m.find((n) => n.props['draggable'] === true);
    const setData = vi.fn();
    const dataTransfer = { effectAllowed: '', setData };
    m.fire(root, 'onDragStart', { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe('move');
    expect(setData).toHaveBeenCalledWith('text/plain', 'Plan');
    m.fire(m.find((n) => n.props['draggable'] === true), 'onDragEnd');
    expect(calls).toEqual([{ slug: 'a1', project: 'nti' }, undefined]);
  });

  it('cannot be dragged without a drag to hand it to, nor while its name is typed', () => {
    const plain = row(art());
    expect(plain.m.all((n) => n.props['draggable'] === true)).toHaveLength(0);
    const dnd: ArtifactDnd = { drag: undefined, setDrag: noop, file: noop, landed: undefined, moving: undefined, setMoving: noop, place: noop };
    const { m } = row(art(), {}, dnd);
    menuOf(m);
    m.click(m.button(t('artifacts.rename')));
    expect(m.all((n) => n.props['draggable'] === true)).toHaveLength(0);
  });

  it('marks the row being dragged, the one that just landed, and a busy one', () => {
    const dnd: ArtifactDnd = { drag: { slug: 'a1', project: undefined }, setDrag: noop, file: noop, landed: undefined, moving: undefined, setMoving: noop, place: noop };
    const dragging = row(art(), {}, dnd);
    expect(dragging.m.find((n) => n.props['draggable'] === true).props['className']).toContain('dragging');
    const busy = row(art(), { isBusy: (k: string) => k === 'a1' });
    expect(busy.m.find((n) => String(n.props['className']).startsWith('arow')).props['className']).toContain('busy');
  });
});



describe('SessionRow', () => {
  const sample = () => {
    const ctx = testCtx();
    const open = ctx.snapshot.sessions.find((x) => x.id === 's2');
    if (open === undefined) throw new Error('sample has s2');
    return { ctx, open };
  };

  it('opens the conversation at a click, and keeps the row busy for a beat', () => {
    const opened: string[] = [];
    const tracked: [string, number | undefined][] = [];
    const track: ViewCtx['track'] = (key, p, hold) => {
      tracked.push([key, hold]);
      return p;
    };
    const base = sample();
    const ctx = testCtx({ open: (id: string) => opened.push(id), track });
    const m = new Mounted(() => <SessionRow ctx={ctx} s={base.open} />);
    m.click(m.find((n) => n.props['className'] === 'srow-main'));
    expect(opened).toEqual(['s2']);
    expect(tracked).toEqual([['s2', 600]]);
  });

  it('puts an open conversation of a folder to sleep, and closes it, from its hover buttons', () => {
    const { ctx, open } = sample();
    const m = new Mounted(() => <SessionRow ctx={ctx} s={open} />);
    m.click(m.button(t('row.sleep')));
    m.click(m.button(t('row.close')));
    expect(ctx.acted).toEqual([
      { kind: 'session.command', command: 'sleep', id: 's2' },
      { kind: 'session.command', command: 'close', id: 's2' },
    ]);
  });

  it('offers no sleep to a conversation that has ended', () => {
    const ctx = testCtx();
    const ended = ctx.snapshot.sessions.find((x) => x.endedAt !== undefined);
    if (ended === undefined) throw new Error('sample has an ended one');
    const m = new Mounted(() => <SessionRow ctx={ctx} s={ended} />);
    expect(m.all((n) => n.props['aria-label'] === t('row.sleep'))).toHaveLength(0);
  });

  it('opens its details behind the (i), and closes them at a second click', () => {
    const { ctx, open } = sample();
    const m = new Mounted(() => <SessionRow ctx={ctx} s={open} />);
    expect(m.all((n) => n.tag === 'dl')).toHaveLength(0);
    m.click(m.button(t('info.button')));
    expect(m.text()).toContain(t('info.project'));
    expect(m.find((n) => n.props['aria-label'] === t('info.button')).props['aria-expanded']).toBe(true);
    m.click(m.button(t('info.button')));
    expect(m.all((n) => n.tag === 'dl')).toHaveLength(0);
  });

  it('opens the sheet in the cockpit and copies the id from its details', () => {
    const posted: unknown[] = [];
    const bridge = { inEditor: true, post: (x: unknown) => posted.push(x), listen: () => noop, load: () => undefined, save: noop };
    const base = sample();
    const ctx = testCtx({ bridge });
    const m = new Mounted(() => <SessionRow ctx={ctx} s={base.open} />);
    m.click(m.button(t('info.button')));
    m.click(m.button(t('row.sheet')));
    m.click(m.button(t('row.copyId')));
    expect(posted).toEqual([{ type: 'openCockpit', sessionId: 's2' }]);
    expect(ctx.acted).toEqual([{ kind: 'session.copyId', id: 's2' }]);
  });
});

describe('ProjectSection', () => {
  const items: ArtifactView[] = [
    { slug: 'a1', title: 'Plan', pinned: false },
    { slug: 'a2', title: 'Notes', pinned: false },
  ];
  const dndOf = (over: Partial<ArtifactDnd> = {}) => {
    const filed: string[] = [];
    const dnd: ArtifactDnd = { drag: undefined, setDrag: noop, file: (d, p) => filed.push(`${d.slug}→${String(p)}`), landed: undefined, moving: undefined, setMoving: noop, place: noop, ...over };
    return { dnd, filed };
  };
  const section = (project: string | undefined, dnd: ArtifactDnd, extra: { made?: boolean; items?: ArtifactView[]; ctx?: ReturnType<typeof testCtx> } = {}) => {
    const ctx = extra.ctx ?? testCtx();
    return { ctx, m: new Mounted(() => <ProjectSection ctx={ctx} project={project} items={extra.items ?? items} dnd={dnd} {...(extra.made === undefined ? {} : { made: extra.made })} />) };
  };

  it('starts folded, and opens at a click on its heading', () => {
    const toggled: string[] = [];
    const folded = section('nti', dndOf().dnd, { ctx: testCtx({ isFolded: () => false, toggle: (k: string) => toggled.push(k) }) });
    expect(folded.m.text()).not.toContain('Plan');
    folded.m.click(folded.m.find((n) => n.props['className'] === 'sec-btn'));
    expect(toggled).toEqual(['proj:nti']);
    const open = section('nti', dndOf().dnd, { ctx: testCtx({ isFolded: (k: string) => k === 'proj:nti' }) });
    expect(open.m.text()).toContain('Plan');
    expect(open.m.text()).toContain('Notes');
  });

  it('calls the project without one « Other », with no ⋯ menu', () => {
    const { m } = section(undefined, dndOf().dnd);
    expect(m.text()).toContain(t('artifacts.other'));
    // Its heading has no tools: no button but the fold.
    expect(m.all((n) => n.tag === 'button').map((n) => n.props['className'])).toEqual(['sec-btn']);
  });

  it('renames in place from its menu, sending every page it holds with the new name', () => {
    const { ctx, m } = section('nti', dndOf().dnd);
    m.click(m.button(t('folder.menu', { name: 'nti' })));
    m.click(m.button(t('folder.rename')));
    typed(m, 'NTI tests');
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Enter' });
    expect(ctx.acted).toEqual([{ kind: 'artifact.renameProject', from: 'nti', to: 'NTI tests', slugs: ['a1', 'a2'] }]);
    expect(m.all((n) => n.tag === 'input')).toHaveLength(0);
  });

  it('sends nothing for a name left as it was or given up', () => {
    const { ctx, m } = section('nti', dndOf().dnd);
    m.click(m.button(t('folder.menu', { name: 'nti' })));
    m.click(m.button(t('folder.rename')));
    m.fire(m.find((n) => n.tag === 'input'), 'onKeyDown', { key: 'Enter' });
    expect(ctx.acted).toEqual([]);
  });

  it('deletes a folder made by hand only while it holds nothing', () => {
    const empty = section('Ideas', dndOf().dnd, { made: true, items: [], ctx: testCtx({ isFolded: () => true }) });
    expect(empty.m.text()).toContain(t('artifacts.emptyProject'));
    empty.m.click(empty.m.button(t('folder.menu', { name: 'Ideas' })));
    empty.m.click(empty.m.button(t('artifacts.deleteProject')));
    expect(empty.ctx.acted).toEqual([{ kind: 'artifact.deleteProject', name: 'Ideas' }]);
    const full = section('Ideas', dndOf().dnd, { made: true });
    full.m.click(full.m.button(t('folder.menu', { name: 'Ideas' })));
    expect(full.m.all((n) => n.tag === 'button' && textOf(n) === t('artifacts.deleteProject'))).toHaveLength(0);
    const notMade = section('Ideas', dndOf().dnd, { items: [] });
    notMade.m.click(notMade.m.button(t('folder.menu', { name: 'Ideas' })));
    expect(notMade.m.all((n) => n.tag === 'button' && textOf(n) === t('artifacts.deleteProject'))).toHaveLength(0);
  });

  it('files an artifact dropped on it, and lights up only for one that comes from elsewhere', () => {
    const { dnd, filed } = dndOf({ drag: { slug: 'x', project: 'other' } });
    const { m } = section('nti', dnd);
    const e = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' } };
    m.fire(m.find((n) => n.tag === 'section'), 'onDragOver', e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.dataTransfer.dropEffect).toBe('move');
    expect(m.find((n) => n.tag === 'section').props['className']).toContain('drop-in');
    m.fire(m.find((n) => n.tag === 'section'), 'onDrop', e);
    expect(filed).toEqual(['x→nti']);
    expect(m.find((n) => n.tag === 'section').props['className']).not.toContain('drop-in');
  });

  it('files into « Other » with null, and refuses an artifact already in the project', () => {
    const other = dndOf({ drag: { slug: 'x', project: 'nti' } });
    section(undefined, other.dnd).m.fire(section(undefined, other.dnd).m.find((n) => n.tag === 'section'), 'onDrop', { preventDefault: noop });
    expect(other.filed).toEqual(['x→null']);
    const same = dndOf({ drag: { slug: 'x', project: 'nti' } });
    const { m } = section('nti', same.dnd);
    const e = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' } };
    m.fire(m.find((n) => n.tag === 'section'), 'onDragOver', e);
    m.fire(m.find((n) => n.tag === 'section'), 'onDrop', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(same.filed).toEqual([]);
  });

  it('stops lighting up when the pointer leaves it, but not for its own rows', () => {
    const { dnd } = dndOf({ drag: { slug: 'x', project: 'other' } });
    const { m } = section('nti', dnd);
    m.fire(m.find((n) => n.tag === 'section'), 'onDragOver', { preventDefault: noop, dataTransfer: { dropEffect: '' } });
    m.fire(m.find((n) => n.tag === 'section'), 'onDragLeave', { relatedTarget: {}, currentTarget: { contains: () => true } });
    expect(m.find((n) => n.tag === 'section').props['className']).toContain('drop-in');
    m.fire(m.find((n) => n.tag === 'section'), 'onDragLeave', { relatedTarget: null, currentTarget: { contains: () => false } });
    expect(m.find((n) => n.tag === 'section').props['className']).not.toContain('drop-in');
  });

  it('is dragged by its heading to another place, and lands before or after the project it is dropped on (21/11)', () => {
    const moved: string[] = [];
    const starts: (string | undefined)[] = [];
    const head = section('nti', dndOf({ setMoving: (n) => starts.push(n) }).dnd).m;
    const h2 = head.find((n) => n.tag === 'h2');
    expect(h2.props['draggable']).toBe(true);
    head.fire(h2, 'onDragStart', { dataTransfer: { effectAllowed: '', setData: noop } });
    head.fire(h2, 'onDragEnd', {});
    expect(starts).toEqual(['nti', undefined]);
    const { m } = section('docs', dndOf({ moving: 'nti', place: (name, target, after) => moved.push(`${name}→${String(target)} ${after ? 'after' : 'before'}`) }).dnd);
    const box = { getBoundingClientRect: () => ({ top: 100, height: 40 }) };
    const top = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' }, clientY: 110, currentTarget: box };
    m.fire(m.find((n) => n.tag === 'section'), 'onDragOver', top);
    expect(top.preventDefault).toHaveBeenCalled();
    expect(m.find((n) => n.tag === 'section').props['className']).toContain('drop-before');
    m.fire(m.find((n) => n.tag === 'section'), 'onDragOver', { ...top, clientY: 130 });
    expect(m.find((n) => n.tag === 'section').props['className']).toContain('drop-after');
    m.fire(m.find((n) => n.tag === 'section'), 'onDrop', { ...top, clientY: 130 });
    expect(moved).toEqual(['nti→docs after']);
  });

  it('takes no project dropped on itself, and has no handle for « Other » nor while renamed', () => {
    const moved: string[] = [];
    const { m } = section('nti', dndOf({ moving: 'nti', place: (name) => moved.push(name) }).dnd);
    const e = { preventDefault: vi.fn(), dataTransfer: { dropEffect: '' }, clientY: 0, currentTarget: { getBoundingClientRect: () => ({ top: 0, height: 10 }) } };
    m.fire(m.find((n) => n.tag === 'section'), 'onDragOver', e);
    m.fire(m.find((n) => n.tag === 'section'), 'onDrop', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(moved).toEqual([]);
    expect(section(undefined, dndOf().dnd).m.find((n) => n.tag === 'h2').props['draggable']).toBeUndefined();
  });

  it('marks where an artifact just landed: its project, and its row', () => {
    const { dnd } = dndOf({ landed: { slug: 'a2', project: 'nti' } });
    const { m } = section('nti', dnd, { ctx: testCtx({ isFolded: () => true }) });
    expect(m.find((n) => n.tag === 'section').props['className']).toContain('landed');
    expect(m.all((n) => String(n.props['className']).includes('landed') && n.tag === 'div')).toHaveLength(1);
  });
});

describe('FolderArtifacts', () => {
  const list = [
    { slug: 'a1', title: 'Carnet' },
    { slug: 'a2', title: 'Budget' },
    { slug: 'a3', title: 'HealthFit' },
  ];
  const mount = (drag: Drag | undefined) => {
    const ctx = testCtx({ isFolded: () => false });
    const dnd: Dnd = { drag, setDrag: noop, landed: undefined, land: noop };
    return { ctx, m: new Mounted(() => <FolderArtifacts ctx={ctx} folder="f1" artifacts={list} dnd={dnd} />) };
  };
  const row = (m: Mounted, slug: string) => m.find((n) => n.tag === 'div' && String(n.props['className']).split(' ').includes('arow') && textOf(n).includes(list.find((a) => a.slug === slug)?.title ?? '?'));
  const at = (y: number) => ({ preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { dropEffect: '' }, clientY: y, currentTarget: { getBoundingClientRect: () => ({ top: 100, height: 20 }) } });

  it('puts an artifact dragged among its folder\'s own above or below the row it is dropped on (21/11)', () => {
    const { ctx, m } = mount({ kind: 'artifact', slug: 'a3', title: 'HealthFit', from: 'f1' });
    const e = at(105);
    m.fire(row(m, 'a1'), 'onDragOver', e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(String(row(m, 'a1').props['className'])).toContain('drop-above');
    m.fire(row(m, 'a1'), 'onDragOver', at(115));
    expect(String(row(m, 'a1').props['className'])).toContain('drop-below');
    m.fire(row(m, 'a1'), 'onDrop', at(105));
    expect(ctx.acted).toEqual([{ kind: 'artifact.folderOrder', folder: 'f1', slugs: ['a3', 'a1', 'a2'] }]);
  });

  it('leaves to the folder an artifact from another one, and writes nothing for one dropped where it is', () => {
    const other = mount({ kind: 'artifact', slug: 'x', title: 'X', from: 'f2' });
    const e = at(105);
    other.m.fire(row(other.m, 'a1'), 'onDragOver', e);
    other.m.fire(row(other.m, 'a1'), 'onDrop', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(other.ctx.acted).toEqual([]);
    const same = mount({ kind: 'artifact', slug: 'a1', title: 'Carnet', from: 'f1' });
    same.m.fire(row(same.m, 'a2'), 'onDrop', at(105));
    expect(same.ctx.acted).toEqual([]);
  });
});
