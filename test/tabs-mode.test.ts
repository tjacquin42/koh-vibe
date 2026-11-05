import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { parseTabsMode, TABS_MODES, tabsTarget } from '../src/settings/tabs';
import { FooterTree, tabsModeLabel, tabsRowLabel } from '../src/ui/footer-tree';

describe('parseTabsMode — what the editor holds in workbench.editor.showTabs', () => {
  it('takes the three values the editor knows', () => {
    for (const mode of TABS_MODES) expect(parseTabsMode(mode)).toBe(mode);
  });

  it('reads the boolean of editors older than VSCode 1.81: false was one tab as a title', () => {
    expect(parseTabsMode(true)).toBe('multiple');
    expect(parseTabsMode(false)).toBe('single');
  });

  it('falls back to the editor default on anything else', () => {
    expect(parseTabsMode(undefined)).toBe('multiple');
    expect(parseTabsMode('both')).toBe('multiple');
  });
});

describe('tabsTarget — where a change takes effect', () => {
  it('writes to the user settings unless a narrower scope already sets the value', () => {
    // Written to the user settings while the workspace holds its own value,
    // the change would be saved and never seen.
    expect(tabsTarget({})).toBe('global');
    expect(tabsTarget({ globalValue: 'single' })).toBe('global');
    expect(tabsTarget({ workspaceValue: 'none' })).toBe('workspace');
    expect(tabsTarget({ workspaceValue: 'none', workspaceFolderValue: 'single' })).toBe('workspaceFolder');
  });
});

describe('the settings view — the tabs row', () => {
  it('sits right after the checkboxes, and states the current choice', () => {
    const tree = new FooterTree();
    tree.setTabs('single');
    const row = tree.getChildren().find((n) => n.kind === 'tabs')!;
    expect(row).toEqual({ kind: 'tabs', mode: 'single' });
    const item = tree.getTreeItem(row);
    expect(item.label).toBe(tabsRowLabel('single'));
    expect(item.label).toBe('Editor tabs: one');
    expect(item.command?.command).toBe('kohVibe.chooseTabs');
    expect(item.tooltip).toContain('workbench.editor.showTabs');
    expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
  });

  it('names every mode, each differently', () => {
    expect(new Set(TABS_MODES.map(tabsModeLabel)).size).toBe(TABS_MODES.length);
  });

  it('redraws only when the mode changes', () => {
    const tree = new FooterTree();
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });
    tree.setTabs('none');
    tree.setTabs('none');
    expect(fired).toBe(1);
  });
});
