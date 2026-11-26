import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudBar } from '../src/components/organisms/CloudBar';
import { useReorder } from '../src/hooks/useReorder';
import { translator } from '../src/i18n';
import { Mounted, textOf } from './mini';
import { NOW, testCtx } from './ctx';

vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), ...(await import('./mini')).hooks }));

const t = translator('en');
const noop = (): void => undefined;

afterEach(() => vi.unstubAllGlobals());

type Id = 'a' | 'b' | 'c';

/** A bar of three items, each 100 px wide, side by side from x = 0. */
function bar(order: readonly Id[], onChange: (next: Id[]) => void) {
  const dragged: { type: string; id: string }[] = [];
  const m = new Mounted(() => <Probe order={order} onChange={onChange} />);
  function Probe(p: { order: readonly Id[]; onChange(n: Id[]): void }) {
    const r = useReorder<Id>(p.order, p.onChange);
    return (
      <div {...r.barProps} data-dragging={r.dragging}>
        {r.shown.map((id) => (
          <span key={id} {...r.itemProps(id)} />
        ))}
      </div>
    );
  }
  const item = (id: Id) => m.find((n) => n.props['data-order'] === id);
  const shown = (): string[] => m.all((n) => n.props['data-order'] !== undefined).map((n) => String(n.props['data-order']));
  /** The item `id` as an element 100 px wide starting at its place in the list drawn now. */
  const el = (id: Id) => ({ getBoundingClientRect: () => ({ left: shown().indexOf(id) * 100, width: 100 }) });
  const start = (id: Id): void => m.fire(item(id), 'onDragStart', { dataTransfer: { effectAllowed: '', setData: (type: string, v: string) => dragged.push({ type, id: v }) } });
  const over = (id: Id, x: number): { preventDefault: ReturnType<typeof vi.fn>; dataTransfer: { dropEffect: string } } => {
    const e = { preventDefault: vi.fn(), clientX: x, currentTarget: el(id), dataTransfer: { dropEffect: '' } };
    m.fire(item(id), 'onDragOver', e);
    return e;
  };
  return { m, item, shown, el, start, over, dragged };
}

describe('dragging an item of a bar to a new place (14/11)', () => {
  it('carries the item’s id under a type of its own, which the session list ignores', () => {
    const b = bar(['a', 'b', 'c'], noop);
    b.start('a');
    expect(b.dragged).toEqual([{ type: 'application/x-kvn-order', id: 'a' }]);
    expect(b.m.find((n) => n.props['data-order'] === 'a').props['data-dragging']).toBe(true);
    expect(b.m.find((n) => n.props['data-order'] === 'b').props['data-dragging']).toBeUndefined();
  });

  it('shows where it would land while it moves: before an item when over its first half, after it over its second', () => {
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'none' }));
    const b = bar(['a', 'b', 'c'], noop);
    b.start('a');
    const e = b.over('c', 260);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.dataTransfer.dropEffect).toBe('move');
    expect(b.shown()).toEqual(['b', 'c', 'a']);
    b.over('b', 10);
    expect(b.shown()).toEqual(['a', 'b', 'c']);
  });

  it('measures an item where it stands, not where its slide has got to', () => {
    // 40 px into a slide to the right: the box says 40 more than its real place.
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'matrix(1, 0, 0, 1, 40, 0)' }));
    vi.stubGlobal('DOMMatrixReadOnly', class { m41 = 40; });
    const b = bar(['a', 'b', 'c'], noop);
    b.start('a');
    // b really spans 100..200, its middle is 150 (the box says 140..240, middle 190).
    const e = { preventDefault: noop, clientX: 120, currentTarget: { getBoundingClientRect: () => ({ left: 140, width: 100 }) }, dataTransfer: { dropEffect: '' } };
    b.m.fire(b.item('b'), 'onDragOver', e);
    expect(b.shown()).toEqual(['a', 'b', 'c']);
    // 160 is past the real middle, though before the one the slide shows.
    b.m.fire(b.item('b'), 'onDragOver', { ...e, clientX: 160 });
    expect(b.shown()).toEqual(['b', 'a', 'c']);
  });

  it('keeps the new order at the drop, and reports it once', () => {
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'none' }));
    const onChange = vi.fn();
    const b = bar(['a', 'b', 'c'], onChange);
    b.start('a');
    b.over('c', 260);
    b.m.fire(b.item('c'), 'onDrop', { preventDefault: noop, clientX: 260, currentTarget: b.el('c') });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(['b', 'c', 'a']);
    expect(b.m.find((n) => n.tag === 'div').props['data-dragging']).toBe(false);
  });

  it('reports nothing when it was dropped back where it was', () => {
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'none' }));
    const onChange = vi.fn();
    const b = bar(['a', 'b', 'c'], onChange);
    b.start('b');
    b.m.fire(b.item('b'), 'onDrop', { preventDefault: noop, clientX: 150, currentTarget: b.el('b') });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('lets the whole bar take the drop, wherever on it', () => {
    const onChange = vi.fn();
    const b = bar(['a', 'b', 'c'], onChange);
    b.start('c');
    const root = b.m.find((n) => n.tag === 'div');
    const e = { preventDefault: vi.fn() };
    b.m.fire(root, 'onDragOver', e);
    b.m.fire(root, 'onDrop', e);
    expect(e.preventDefault).toHaveBeenCalledTimes(2);
    // Nothing moved: nothing to report, and the drag is over.
    expect(onChange).not.toHaveBeenCalled();
    expect(b.m.find((n) => n.tag === 'div').props['data-dragging']).toBe(false);
  });

  it('takes no part in a drag it did not start: another drag type passes through untouched', () => {
    const b = bar(['a', 'b', 'c'], noop);
    const e = { preventDefault: vi.fn(), clientX: 0, currentTarget: b.el('a'), dataTransfer: { dropEffect: '' } };
    b.m.fire(b.item('a'), 'onDragOver', e);
    b.m.fire(b.item('a'), 'onDrop', e);
    b.m.fire(b.m.find((n) => n.tag === 'div'), 'onDragOver', e);
    b.m.fire(b.m.find((n) => n.tag === 'div'), 'onDrop', e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('puts everything back when the drag ends outside the bar', () => {
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'none' }));
    const onChange = vi.fn();
    const b = bar(['a', 'b', 'c'], onChange);
    b.start('a');
    b.over('c', 260);
    const parent = { getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 30 }) };
    b.m.fire(b.item('c'), 'onDragEnd', { clientX: 900, clientY: 10, currentTarget: { parentElement: parent } });
    expect(onChange).not.toHaveBeenCalled();
    expect(b.shown()).toEqual(['a', 'b', 'c']);
  });

  it('keeps the place under the pointer when the drag ends over the bar before it was dragged over', () => {
    vi.stubGlobal('getComputedStyle', () => ({ transform: 'none' }));
    const onChange = vi.fn();
    const b = bar(['a', 'b', 'c'], onChange);
    b.start('a');
    const under = { dataset: { order: 'c' }, getBoundingClientRect: () => ({ left: 200, width: 100 }) };
    const parent = { getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 30 }), contains: (n: unknown) => n === under };
    vi.stubGlobal('document', { elementFromPoint: () => ({ closest: () => under }) });
    b.m.fire(b.item('a'), 'onDragEnd', { clientX: 280, clientY: 10, currentTarget: { parentElement: parent } });
    expect(onChange).toHaveBeenCalledWith(['b', 'c', 'a']);
  });

  it('keeps the drag as it stands when it ends over the bar on nothing it knows', () => {
    const onChange = vi.fn();
    const b = bar(['a', 'b', 'c'], onChange);
    b.start('a');
    const parent = { getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 30 }), contains: () => false };
    vi.stubGlobal('document', { elementFromPoint: () => null });
    b.m.fire(b.item('a'), 'onDragEnd', { clientX: 50, clientY: 10, currentTarget: { parentElement: parent } });
    expect(onChange).not.toHaveBeenCalled();
    expect(b.m.find((n) => n.tag === 'div').props['data-dragging']).toBe(false);
  });
});

describe('the bar showing how old claude.ai’s list is', () => {
  const bar2 = (what: 'artifacts' | 'routines', at: number | undefined, over = {}) => {
    const ctx = testCtx(over);
    return { ctx, m: new Mounted(() => <CloudBar ctx={ctx} what={what} at={at} />) };
  };
  const withTidy = (ask: boolean, rules: string[] = ['Recipes go to Cooking']) => {
    const base = testCtx();
    return { snapshot: { ...base.snapshot, tidy: { ask, rules } } };
  };

  it('says how old the list is, or that it was never read', () => {
    expect(bar2('routines', NOW - 120_000).m.text()).toContain(t('cloud.age', { age: '2 min' }));
    expect(bar2('routines', undefined).m.text()).toContain(t('cloud.never'));
  });

  it('asks the host to read the routines again at its button', () => {
    const { ctx, m } = bar2('routines', NOW);
    m.click(m.button(t('cloud.refresh')));
    expect(ctx.acted).toEqual([{ kind: 'cloud.refresh', what: 'routines' }]);
  });

  it('is busy while the list is being read again, and free after', async () => {
    let release: () => void = noop;
    const gate = new Promise<{ ok: true }>((r) => (release = () => r({ ok: true })));
    const { m } = bar2('routines', NOW, { act: () => gate });
    m.click(m.button(t('cloud.refresh')));
    expect(m.button(t('cloud.refreshing')).props['disabled']).toBe(true);
    release();
    await vi.waitFor(() => {
      m.render();
      expect(m.button(t('cloud.refresh')).props['disabled']).toBe(false);
    });
  });

  it('offers no tidying on the routines', () => {
    const { m } = bar2('routines', NOW, withTidy(false));
    expect(m.all((n) => n.tag === 'button' && n.props['aria-label'] === t('tidy.rulesTitle'))).toHaveLength(0);
    expect(m.button(t('cloud.refresh'))).toBeDefined();
  });

  it('tidies at once when the person asked not to be asked, and says how many pages it filed', async () => {
    const notes: string[] = [];
    const { ctx, m } = bar2('artifacts', NOW, { ...withTidy(false), act: async () => ({ ok: true, count: 3 }), notify: (s: string) => notes.push(s) });
    void ctx;
    m.click(m.button(t('tidy.button')));
    await vi.waitFor(() => expect(notes).toEqual([t('tidy.done', { n: 3 })]));
  });

  it('says nothing was filed when nothing was', async () => {
    const notes: string[] = [];
    const { m } = bar2('artifacts', NOW, { ...withTidy(false), act: async () => ({ ok: true }), notify: (s: string) => notes.push(s) });
    m.click(m.button(t('tidy.button')));
    await vi.waitFor(() => expect(notes).toEqual([t('tidy.none')]));
  });

  it('says nothing when the tidying failed', async () => {
    const notes: string[] = [];
    const acts: unknown[] = [];
    const { m } = bar2('artifacts', NOW, {
      ...withTidy(false),
      act: async (a: unknown) => {
        acts.push(a);
        return { ok: false, error: 'failed' };
      },
      notify: (s: string) => notes.push(s),
    });
    m.click(m.button(t('tidy.button')));
    await vi.waitFor(() => expect(acts).toEqual([{ kind: 'artifact.tidy' }]));
    await Promise.resolve();
    expect(notes).toEqual([]);
  });

  it('shows the tidying under way, from the host’s own busy mark', () => {
    const { m } = bar2('artifacts', NOW, { ...withTidy(false), isBusy: (k: string) => k === 'tidy' });
    expect(m.button(t('tidy.running')).props['disabled']).toBe(true);
  });

  it('asks first when it is told to: what it does, and three ways out', () => {
    const { ctx, m } = bar2('artifacts', NOW, withTidy(true));
    m.click(m.button(t('tidy.button')));
    expect(m.text()).toContain(t('tidy.explain'));
    m.click(m.button(t('action.cancel')));
    expect(m.all((n) => n.props['role'] === 'dialog')).toHaveLength(0);
    expect(ctx.acted).toEqual([]);
  });

  it('runs the tidying from its question, and no longer asks when the box is ticked', async () => {
    const { ctx, m } = bar2('artifacts', NOW, withTidy(true));
    m.click(m.button(t('tidy.button')));
    m.fire(m.find((n) => n.tag === 'input' && n.props['type'] === 'checkbox'), 'onChange', { target: { checked: true } });
    m.click(m.button(t('tidy.run')));
    await vi.waitFor(() => expect(ctx.acted).toEqual([{ kind: 'tidy.settings', ask: false }, { kind: 'artifact.tidy' }]));
    expect(m.all((n) => n.props['role'] === 'dialog')).toHaveLength(0);
  });

  it('runs it, still asking next time, when the box is left alone', async () => {
    const { ctx, m } = bar2('artifacts', NOW, withTidy(true));
    m.click(m.button(t('tidy.button')));
    m.click(m.button(t('tidy.run')));
    await vi.waitFor(() => expect(ctx.acted).toEqual([{ kind: 'artifact.tidy' }]));
  });

  it('only lists the artifacts again when that is all that is wanted', () => {
    const { ctx, m } = bar2('artifacts', NOW, withTidy(true));
    m.click(m.button(t('tidy.button')));
    m.click(m.button(t('tidy.listOnly')));
    expect(ctx.acted).toEqual([{ kind: 'cloud.refresh', what: 'artifacts' }]);
  });

  it('adds a rule or opens the rules from the question, closing it', () => {
    const { ctx, m } = bar2('artifacts', NOW, withTidy(true));
    m.click(m.button(t('tidy.button')));
    m.click(m.button(t('tidy.addRule')));
    expect(m.all((n) => n.props['role'] === 'dialog')).toHaveLength(0);
    m.click(m.button(t('tidy.button')));
    m.click(m.button(t('tidy.openRules')));
    expect(ctx.acted).toEqual([
      { kind: 'tidy.rules', mode: 'add' },
      { kind: 'tidy.rules', mode: 'open' },
    ]);
  });

  it('keeps the rules at hand beside the button: their list, and the way to add one or open the file', () => {
    const { ctx, m } = bar2('artifacts', NOW, withTidy(false));
    const rulesButton = (): ReturnType<Mounted['button']> => m.button(t('tidy.rulesTitle'));
    m.click(rulesButton());
    expect(m.all((n) => n.tag === 'li').map(textOf)).toEqual(['Recipes go to Cooking']);
    m.click(m.button(t('tidy.addRule')));
    expect(m.all((n) => n.tag === 'li')).toHaveLength(0);
    m.click(rulesButton());
    m.click(m.button(t('tidy.openRules')));
    expect(ctx.acted).toEqual([
      { kind: 'tidy.rules', mode: 'add' },
      { kind: 'tidy.rules', mode: 'open' },
    ]);
    // A second click on the button shuts them.
    m.click(rulesButton());
    m.click(rulesButton());
    expect(m.all((n) => n.tag === 'li')).toHaveLength(0);
  });
});
