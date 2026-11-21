/**
 * A very small renderer, to click what `renderToStaticMarkup` can only draw.
 *
 * There is no jsdom here (it breaks under the local Node), and the string
 * renderer never calls a handler. This one expands function components — with
 * their `useState` / `useRef` / `useMemo` / `useCallback` kept between
 * renders — down to plain host nodes (a tag, its props, its children), which a
 * test then finds, reads and « clicks » by calling the prop. Effects are not
 * run (as under `renderToStaticMarkup`): what a test asks of an effect, it
 * calls itself.
 *
 * Meant for a test file that mocks `react` with `hooks` (see its use):
 *   vi.mock('react', async (orig) => ({ ...(await orig<typeof import('react')>()), ...(await import('./mini')).hooks }));
 */

export interface HostNode {
  tag: string;
  props: Record<string, unknown>;
  kids: Child[];
}
export type Child = HostNode | string;

interface ElementLike {
  $$typeof: symbol;
  type: unknown;
  key: string | null;
  props: Record<string, unknown>;
}

const isElement = (x: unknown): x is ElementLike => typeof x === 'object' && x !== null && '$$typeof' in x && 'props' in x;

interface Instance {
  cells: unknown[];
  next: number;
}

let current: Instance | undefined;
let dirty = false;

function inst(): Instance {
  if (current === undefined) throw new Error('a hook was called outside a mini render');
  return current;
}

export const hooks = {
  useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
    const i = inst();
    const at = i.next++;
    if (!(at in i.cells)) i.cells[at] = typeof initial === 'function' ? (initial as () => S)() : initial;
    const set = (next: S | ((prev: S) => S)): void => {
      const prev = i.cells[at] as S;
      const value = typeof next === 'function' ? (next as (p: S) => S)(prev) : next;
      if (Object.is(value, prev)) return;
      i.cells[at] = value;
      dirty = true;
    };
    return [i.cells[at] as S, set];
  },
  useRef<T>(initial: T): { current: T } {
    const i = inst();
    const at = i.next++;
    if (!(at in i.cells)) i.cells[at] = { current: initial };
    return i.cells[at] as { current: T };
  },
  useMemo<T>(make: () => T, deps: readonly unknown[]): T {
    const i = inst();
    const at = i.next++;
    const old = i.cells[at] as { deps: readonly unknown[]; value: T } | undefined;
    if (old !== undefined && old.deps.length === deps.length && old.deps.every((d, k) => Object.is(d, deps[k]))) return old.value;
    const value = make();
    i.cells[at] = { deps, value };
    return value;
  },
  useCallback<T>(fn: T, deps: readonly unknown[]): T {
    return hooks.useMemo(() => fn, deps);
  },
  useEffect(): void {
    inst().next++;
  },
  useLayoutEffect(): void {
    inst().next++;
  },
};

const FRAGMENT = Symbol.for('react.fragment');

/** The renderer's own bookkeeping: one hook table per component instance, by its place in the tree. */
export class Mounted {
  private readonly instances = new Map<string, Instance>();
  tree: Child[] = [];

  constructor(private readonly root: () => unknown) {
    this.render();
  }

  /** Draws again, from the state as it stands — until what a handler set has settled. */
  render(): void {
    for (let pass = 0; pass < 10; pass += 1) {
      dirty = false;
      this.tree = this.expand(this.root(), 'root');
      if (!dirty) return;
    }
    throw new Error('the tree never settled');
  }

  private expand(node: unknown, path: string): Child[] {
    if (node === null || node === undefined || typeof node === 'boolean') return [];
    if (typeof node === 'string' || typeof node === 'number') return [String(node)];
    if (Array.isArray(node)) return node.flatMap((n, i) => this.expand(n, `${path}[${isElement(n) && n.key !== null ? n.key : i}]`));
    if (!isElement(node)) return [];
    const { type, props } = node;
    const children = props['children'];
    if (typeof type === 'string') {
      const { children: _c, ...rest } = props;
      return [{ tag: type, props: rest, kids: this.expand(children, `${path}/${type}`) }];
    }
    if (type === FRAGMENT) return this.expand(children, path);
    // memo(): an object holding the function.
    const fn = typeof type === 'function' ? type : typeof type === 'object' && type !== null && 'type' in type ? (type as { type: unknown }).type : undefined;
    if (typeof fn !== 'function') return [];
    const at = `${path}/${(fn as { name?: string }).name ?? 'anon'}`;
    let i = this.instances.get(at);
    if (i === undefined) {
      i = { cells: [], next: 0 };
      this.instances.set(at, i);
    }
    const before = current;
    current = i;
    i.next = 0;
    try {
      return this.expand((fn as (p: unknown) => unknown)(props), at);
    } finally {
      current = before;
    }
  }

  /** Every host node for which `match` holds, in document order. */
  all(match: (n: HostNode) => boolean): HostNode[] {
    const out: HostNode[] = [];
    const walk = (c: Child): void => {
      if (typeof c === 'string') return;
      if (match(c)) out.push(c);
      c.kids.forEach(walk);
    };
    this.tree.forEach(walk);
    return out;
  }

  find(match: (n: HostNode) => boolean): HostNode {
    const [first] = this.all(match);
    if (first === undefined) throw new Error('no such node in the tree');
    return first;
  }

  /** A button, by the text it shows or its aria-label. */
  button(name: string): HostNode {
    return this.find((n) => n.tag === 'button' && (textOf(n).trim() === name || n.props['aria-label'] === name));
  }

  /** What is written in the tree, space-joined. */
  text(): string {
    return this.tree.map(textOf).join(' ');
  }

  /** Calls a handler prop, then draws again. */
  fire(node: HostNode, handler: string, ...args: unknown[]): void {
    const fn = node.props[handler];
    if (typeof fn !== 'function') throw new Error(`no ${handler} on <${node.tag}>`);
    (fn as (...a: unknown[]) => unknown)(...args);
    this.render();
  }

  click(node: HostNode): void {
    this.fire(node, 'onClick', { stopPropagation: () => undefined, preventDefault: () => undefined });
  }
}

export function textOf(c: Child): string {
  return typeof c === 'string' ? c : c.kids.map(textOf).join(' ').replace(/\s+/g, ' ');
}
