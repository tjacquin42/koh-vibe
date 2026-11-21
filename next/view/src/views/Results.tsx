import type { ViewCtx } from '../context';
import { isEmpty, type SearchResults } from '../search';
import { Section } from '../components/molecules/Section';
import { ArtifactRow } from '../components/organisms/ArtifactRow';
import { ClosedRow } from '../components/organisms/ClosedRow';
import { SessionRow } from '../components/organisms/SessionRow';

/** What the search found, in place of the tabs: conversations, closed ones, artifacts. */
export function Results({ ctx, results, query }: { ctx: ViewCtx; results: SearchResults; query: string }) {
  const { t } = ctx;
  if (isEmpty(results)) return <p className="hint pad">{t('search.none', { q: query.trim() })}</p>;
  return (
    <>
      {results.sessions.length > 0 && (
        <Section title={t('search.sessions')} count={results.sessions.length}>
          {results.sessions.map((s) => (
            <SessionRow key={s.id} ctx={ctx} s={s} />
          ))}
        </Section>
      )}
      {results.closed.length > 0 && (
        <Section title={t('search.closed')} count={results.closed.length}>
          {results.closed.map((c) => (
            <ClosedRow key={c.sessionId} ctx={ctx} c={c} />
          ))}
        </Section>
      )}
      {results.artifacts.length > 0 && (
        <Section title={t('search.artifacts')} count={results.artifacts.length}>
          {results.artifacts.map((a) => (
            <ArtifactRow key={a.slug} ctx={ctx} a={a} />
          ))}
        </Section>
      )}
    </>
  );
}
