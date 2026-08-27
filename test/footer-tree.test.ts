import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { FooterTree, SETTING_TOGGLES, toggleLabel, toggleTooltip } from '../src/ui/footer-tree';

describe('the settings view — the two checkboxes', () => {
  it('puts them first, both checked until someone turns one off', () => {
    const tree = new FooterTree();
    expect(tree.getChildren().slice(0, 2)).toEqual([
      { kind: 'toggle', key: 'persistent', on: true },
      { kind: 'toggle', key: 'expireTemporary', on: true },
    ]);
    const item = tree.getTreeItem({ kind: 'toggle', key: 'persistent', on: true });
    expect(item.label).toBe('Persistent sessions');
    expect(item.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
    expect(item.command).toEqual({ command: 'kohVibe.toggleSetting', title: 'Toggle this setting', arguments: ['persistent'] });
  });

  it('explains each one where the mouse rests, both ways round', () => {
    for (const key of SETTING_TOGGLES) {
      const item = new FooterTree().getTreeItem({ kind: 'toggle', key, on: false });
      expect(item.checkboxState).toBe(vscode.TreeItemCheckboxState.Unchecked);
      expect(item.label).toBe(toggleLabel(key));
      expect(item.tooltip).toBe(toggleTooltip(key));
      expect(toggleTooltip(key)).toContain('Unchecked');
    }
    expect(toggleTooltip('persistent')).toContain('greyed');
    expect(toggleTooltip('persistent')).toContain('already greyed stay');
    expect(toggleTooltip('expireTemporary')).toContain('24 hours');
    expect(toggleTooltip('expireTemporary')).toContain('folder');
  });

  it('follows the settings, and redraws only when one changes', () => {
    const tree = new FooterTree();
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });
    tree.setToggles({ persistent: false, expireTemporary: true });
    tree.setToggles({ persistent: false, expireTemporary: true });
    expect(fired).toBe(1);
    expect(tree.getChildren()[0]).toEqual({ kind: 'toggle', key: 'persistent', on: false });
    expect(tree.getChildren()[1]).toEqual({ kind: 'toggle', key: 'expireTemporary', on: true });
  });
});
