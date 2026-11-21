import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { menuGroups, type MenuItem as Item } from '../../../../src/shared/menus';
import type { ViewCtx } from '../../context';
import { menuBusyKey, readMenuContext } from '../../lib/menu-context';
import { Menu, MenuItem, MenuSeparator } from '../molecules/Menu';
import { Popover, type Point } from '../molecules/Popover';

interface Open {
  at: Point;
  context: Record<string, unknown>;
  groups: Item[][];
  row: HTMLElement;
}

/** A text field keeps the editor's own menu: Copy / Paste mean something there. */
const TEXT = 'input, textarea, [contenteditable="true"]';
const FOCUSABLE = 'button, [tabindex="0"]';

/** Where a right-click opens it: at the pointer — or, from the keyboard (Shift+F10), under the row. */
export function menuPoint(e: { clientX: number; clientY: number }, row: { left: number; bottom: number }): Point {
  return e.clientX === 0 && e.clientY === 0 ? { x: row.left + 12, y: row.bottom } : { x: e.clientX, y: e.clientY };
}

/**
 * The right-click menu (21/11): Koh-Vibe's own, in its style and its
 * language, in place of the editor's native one. A right-click on a row
 * carrying `data-kv-menu` opens the items of its kind (shared/menus.ts) at
 * the pointer; anywhere else, nothing. The arrows move between items,
 * Escape closes it and gives the focus back to the row.
 */
export function ContextMenu({ ctx }: { ctx: ViewCtx }) {
  const [open, setOpen] = useState<Open | undefined>();
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMenu = (e: MouseEvent): void => {
      const target = e.target instanceof Element ? e.target : null;
      if (target === null || target.closest(TEXT) !== null) return;
      e.preventDefault();
      const row = target.closest<HTMLElement>('[data-kv-menu]');
      const context = readMenuContext(row?.dataset['kvMenu']);
      const groups = context === undefined ? [] : menuGroups(context);
      if (row === null || context === undefined || groups.length === 0) {
        setOpen(undefined);
        return;
      }
      setOpen({ at: menuPoint(e, row.getBoundingClientRect()), context, groups, row });
    };
    document.addEventListener('contextmenu', onMenu);
    return () => document.removeEventListener('contextmenu', onMenu);
  }, []);

  // The row it was opened on stays marked while it is open; the first item takes the focus.
  useEffect(() => {
    if (open === undefined) return;
    open.row.classList.add('menu-on');
    // Once placed: hidden while it is measured, it cannot take the focus before.
    const frame = window.setTimeout(() => list.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true }), 0);
    return () => {
      window.clearTimeout(frame);
      open.row.classList.remove('menu-on');
    };
  }, [open]);

  const close = useCallback(() => {
    setOpen((o) => {
      // Closed from the keyboard: the focus goes back where it was.
      if (o !== undefined && list.current?.contains(document.activeElement) === true) {
        (o.row.matches(FOCUSABLE) ? o.row : o.row.querySelector<HTMLElement>(FOCUSABLE))?.focus({ preventScroll: true });
      }
      return undefined;
    });
  }, []);

  if (open === undefined) return null;
  const french = ctx.language.toLowerCase().startsWith('fr');
  const run = (m: Item): void => {
    close();
    const done = ctx.menu(m.id, open.context);
    const key = menuBusyKey(m.id, open.context);
    if (key !== undefined) void ctx.track(key, done, 4_000);
  };
  const move = (e: KeyboardEvent<HTMLDivElement>): void => {
    const items = [...(list.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = items.findIndex((x) => x === document.activeElement);
    if (e.key === 'Tab') close();
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : undefined;
    if (to === undefined || items.length === 0) return;
    e.preventDefault();
    items[(to + items.length) % items.length]?.focus();
  };
  return (
    <Popover label={ctx.t('menu.label')} at={open.at} role="menu" onClose={close}>
      <div ref={list} onKeyDown={move}>
        <Menu label={ctx.t('menu.label')}>
          {open.groups.map((g, i) => (
            <div key={g[0]?.id ?? i} className="fm-group" role="group">
              {i > 0 && <MenuSeparator />}
              {g.map((m) => (
                <MenuItem key={m.id} icon={m.icon} danger={m.danger === true} role="menuitem" onClick={() => run(m)}>
                  {french ? m.fr : m.en}
                </MenuItem>
              ))}
            </div>
          ))}
        </Menu>
      </div>
    </Popover>
  );
}
