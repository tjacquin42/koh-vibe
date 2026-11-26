import type { ReactNode } from 'react';
import type { ViewCtx } from '../../context';
import { IconButton } from '../atoms/IconButton';
import { Pressable } from '../atoms/Pressable';

/**
 * A conversation's card (15/11): a click, or Enter, goes to the conversation
 * and the card loads until its tab is in front; the sheet — the conversation's
 * details — is the card's own button, the index card, shown under the pointer.
 */
export function OpenCard({ ctx, id, className, context, children }: { ctx: ViewCtx; id: string; className: string; context: string; children: ReactNode }) {
  return (
    <Pressable className={`${className} open-card`} busy={ctx.reopening.has(id)} context={context} onPress={() => ctx.open(id)}>
      {children}
      <IconButton
        icon="sheet"
        label={ctx.t('row.sheet')}
        className="sheet-btn"
        onClick={(e) => {
          e.stopPropagation();
          ctx.show(id);
        }}
      />
    </Pressable>
  );
}
