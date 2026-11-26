import type { ReactNode } from 'react';
import { Icon } from './Icon';

/**
 * A setting's explanation (14/11), behind an (i) since 15/11: sentences, and a bullet per option where
 * its lines start with « - », in the order written. « Name: what it does »
 * (« Nom : … ») sets the name in bold, so the eye finds each option.
 */
export function Hint({ text }: { text: string }) {
  // Runs of plain lines make a paragraph, runs of « - » lines a list, in order.
  const blocks: { list: boolean; lines: string[] }[] = [];
  for (const line of text.split('\n')) {
    const list = line.startsWith('- ');
    const last = blocks[blocks.length - 1];
    if (last !== undefined && last.list === list) last.lines.push(list ? line.slice(2) : line);
    else blocks.push({ list, lines: [list ? line.slice(2) : line] });
  }
  // An (i) beside the setting's name, the explanation in a bubble while the
  // pointer rests on it, or while it has the keyboard's focus (15/11): read
  // when wanted, not in the way of the list of settings.
  return (
    <div className="hint-i" tabIndex={0} aria-label={text.replace(/\n- /g, ' ').replace(/\n/g, ' ')}>
      <Icon name="info" size={13} />
      <div className="sub hint-text hint-pop" role="tooltip" aria-hidden="true">
      {blocks.map((b, i) =>
        b.list ? (
          <ul key={i}>
            {b.lines.map((item) => (
              <li key={item}>{named(item)}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.lines.join(' ')}</p>
        ),
      )}
      </div>
    </div>
  );
}

function named(item: string): ReactNode {
  const m = /^([^:]{1,30}?)\s?:\s(.*)$/.exec(item);
  if (m === null) return item;
  return (
    <>
      <b>{m[1]}</b> {m[2]}
    </>
  );
}
