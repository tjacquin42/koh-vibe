import { describe, expect, it } from 'vitest';
import * as vscode from 'vscode';
import { FooterTree, persistentTooltip } from '../src/ui/footer-tree';

describe('the settings view — persistent sessions', () => {
  it('puts the checkbox first, checked until someone turns it off', () => {
    const tree = new FooterTree();
    expect(tree.getChildren()[0]).toEqual({ kind: 'persistent', on: true });
    const item = tree.getTreeItem({ kind: 'persistent', on: true });
    expect(item.label).toBe('Persistent sessions');
    expect(item.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
    expect(item.command?.command).toBe('kohVibe.togglePersistentSessions');
  });

  it('explains itself where the mouse rests, both ways round', () => {
    const item = new FooterTree().getTreeItem({ kind: 'persistent', on: false });
    expect(item.checkboxState).toBe(vscode.TreeItemCheckboxState.Unchecked);
    expect(item.tooltip).toBe(persistentTooltip());
    expect(persistentTooltip()).toContain('greyed out');
    expect(persistentTooltip()).toContain('Recently closed');
  });

  it('follows the setting, and redraws only when it changes', () => {
    const tree = new FooterTree();
    let fired = 0;
    tree.onDidChangeTreeData(() => {
      fired += 1;
    });
    tree.setPersistent(false);
    tree.setPersistent(false);
    expect(fired).toBe(1);
    expect(tree.getChildren()[0]).toEqual({ kind: 'persistent', on: false });
  });
});
