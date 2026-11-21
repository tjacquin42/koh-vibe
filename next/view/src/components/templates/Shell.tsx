import type { ReactNode } from 'react';
import type { Surface } from '../../../../src/shared/protocol';
import { NO_MENU } from '../../lib/menu-context';
import { TipLayer } from '../atoms/Tip';

/**
 * What every view stands in, the sidebar and the cockpit alike: the page's
 * frame, the layer of tips, the banner of the browser preview, and the toast
 * over everything — a refusal is said wherever the click was (16/11).
 */
export function Shell({ surface, banner, toast, children }: { surface: Surface; /** Outside the editor: says this is a preview. */ banner?: string; toast: ReactNode; children: ReactNode }) {
  return (
    <div className={`app surface-${surface}`} data-vscode-context={NO_MENU}>
      <TipLayer />
      {banner !== undefined && <div className="preview">{banner}</div>}
      {children}
      {toast}
    </div>
  );
}
