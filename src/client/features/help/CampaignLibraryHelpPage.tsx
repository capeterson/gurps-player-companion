import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { Markdown } from '../../components/markdown/Markdown.tsx';
import { renderMarkdown } from '../../components/markdown/markdownProcessor.ts';
import { useAppHeaderBottom } from '../../hooks/useAppHeaderBottom.ts';
import { useExperimentalActiveEffects } from '../../hooks/useExperimentalActiveEffects.ts';
import guide from './campaign-library.md?raw';

const sections = guide
  .trim()
  .split(/^## /m)
  .filter(Boolean)
  .map((section) => {
    const end = section.indexOf('\n');
    const title = section.slice(0, end).trim();
    return {
      title,
      id: title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-$/, ''),
      body: section.slice(end + 1).trim(),
    };
  });

export function CampaignLibraryHelpPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const headerBottom = useAppHeaderBottom();
  const [ready, setReady] = useState(false);
  const campaign = params.get('campaign');
  const activeEffectsEnabled = useExperimentalActiveEffects(campaign);
  const visibleSections = useMemo(
    () =>
      sections.filter(
        (section) => section.id !== 'experimental-active-effects' || activeEffectsEnabled,
      ),
    [activeEffectsEnabled],
  );
  const libraryPath = campaign ? `/campaigns/${encodeURIComponent(campaign)}/library` : '/library';

  useEffect(() => {
    let cancelled = false;
    // Warm the shared renderer before mounting the article so deep links scroll
    // to their final position, rather than to headings above still-empty prose.
    void Promise.all(sections.map((section) => renderMarkdown(section.body))).then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !location.hash) return;
    const section = visibleSections.find((entry) => `#${entry.id}` === location.hash);
    if (!section) return;
    const heading = document.getElementById(section.id);
    heading?.scrollIntoView({ block: 'start' });
    heading?.focus({ preventScroll: true });
  }, [ready, location.hash, visibleSections]);

  return (
    <article className="mx-auto min-w-0 max-w-3xl space-y-8 pb-8" aria-busy={!ready}>
      <header className="space-y-3">
        <Link className="link text-sm" to={libraryPath}>
          Back to library
        </Link>
        <p className="label-eyebrow">Library guide</p>
        <h1 className="font-display text-3xl sm:text-4xl">Building your campaign library</h1>
        <p className="text-base leading-relaxed text-base-content/80">
          Turn your campaign's rules and equipment into reusable entries, check them on a character,
          and keep them accurate as your campaign grows.
        </p>
      </header>

      <nav className="card border border-base-300 p-card" aria-label="In this guide">
        <h2 className="font-display text-xl">In this guide</h2>
        <ol className="mt-3 grid list-inside list-decimal gap-3 text-sm sm:grid-cols-2">
          {visibleSections.map((section) => (
            <li key={section.id}>
              <Link
                className="link"
                to={{
                  pathname: location.pathname,
                  search: location.search,
                  hash: `#${section.id}`,
                }}
              >
                {section.title}
              </Link>
            </li>
          ))}
        </ol>
      </nav>

      {ready ? (
        visibleSections.map((section) => (
          <section key={section.id} aria-labelledby={section.id} className="min-w-0 space-y-4">
            <h2
              id={section.id}
              tabIndex={-1}
              style={{ scrollMarginTop: headerBottom + 16 }}
              className="font-display text-2xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            >
              {section.title}
            </h2>
            <Markdown source={section.body} />
          </section>
        ))
      ) : (
        <output>Loading library guide…</output>
      )}
    </article>
  );
}
