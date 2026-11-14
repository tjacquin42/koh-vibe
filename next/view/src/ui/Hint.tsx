import type { ReactNode } from 'react';

/**
 * A setting's explanation (14/11): sentences, then a bullet per option when
 * its lines start with « - ». « Name: what it does » (« Nom : … ») sets the
 * name in bold, so the eye finds each option.
 */
export function Hint({ text }: { text: string }) {
  const lines = text.split('\n');
  const intro = lines.filter((l) => !l.startsWith('- '));
  const items = lines.filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  return (
    <div className="sub hint-text">
      {intro.length > 0 && <p>{intro.join(' ')}</p>}
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item}>{named(item)}</li>
          ))}
        </ul>
      )}
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
