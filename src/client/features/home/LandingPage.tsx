import { Link } from 'react-router-dom';
import { AppIcon } from '../../components/ui/AppIcon.tsx';
import { BrandMark } from '../../components/ui/BrandMark.tsx';
import { modeLabel, oppositeMode, setThemeMode, useThemeState } from '../../lib/theme.ts';

export function LandingPage() {
  const { mode } = useThemeState();
  return (
    <div className="min-h-dvh bg-base-200 arcane-edge">
      <header className="relative mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-5 sm:px-8">
        <Link to="/" className="flex items-center gap-3 no-cap">
          <BrandMark />
          <span className="font-display font-semibold">GURPS Player Companion</span>
        </Link>
        <nav aria-label="Public navigation" className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-square btn-sm"
            aria-label={`Switch to ${modeLabel(oppositeMode(mode))} mode`}
            onClick={() => setThemeMode(oppositeMode(mode))}
          >
            <AppIcon name={mode === 'dark' ? 'sun' : 'moon'} size={20} />
          </button>
          <Link to="/login" className="btn btn-ghost btn-sm">
            Sign in
          </Link>
        </nav>
      </header>
      <main className="relative mx-auto max-w-6xl px-5 pb-16 sm:px-8">
        <section className="hero py-12 sm:py-20">
          <div className="hero-content w-full flex-col gap-10 p-0 lg:flex-row lg:items-start">
            <div className="max-w-xl flex-1 space-y-6 xl:max-w-3xl">
              <p className="label-eyebrow">For GURPS 4e · At the table and on the go</p>
              <h1 className="font-display text-4xl font-semibold leading-tight sm:text-5xl xl:text-6xl">
                Your next adventure.
                <br />
                All on one sheet.
              </h1>
              <p className="text-lg leading-relaxed text-base-content/75">
                Meet GPC, your character sheet, combat companion, and campaign notebook. Keep the
                numbers straight and the rules close, so you can stay in the story.
              </p>
              <div className="flex flex-wrap gap-3">
                <Link to="/register" className="btn btn-primary">
                  Create your account
                </Link>
                <a href="#at-the-table" className="btn btn-outline">
                  Take a look
                </a>
              </div>
              <p className="text-sm text-muted">
                Phone, tablet, or desktop. Install from your browser. Open your characters online
                once, then keep editing when the connection drops.
              </p>
            </div>
            <figure className="w-full max-w-xs shrink-0 overflow-hidden rounded-box border border-base-300 shadow-arcane-lg">
              <img
                src="/screenshots/combat-mobile.png"
                alt="GPC combat sheet in Gilded Tome with HP, FP, attacks, and incoming attack controls."
                width="430"
                height="932"
                fetchPriority="high"
              />
            </figure>
          </div>
        </section>
        <section id="at-the-table" className="space-y-8 scroll-mt-8">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              [
                'A sheet that adds up',
                'Attributes, skills, traits, spells, and a live point ledger. Derived stats and campaign limits do the bookkeeping for you.',
              ],
              [
                'Ready when dice roll',
                'Roll attacks and defenses, explore armor coverage, preview incoming damage, and track HP, FP, and temporary bonuses.',
              ],
              [
                'A place for your party',
                'Share campaign libraries and house rules, invite your players, and record session notes and earned character points.',
              ],
            ].map(([title, body]) => (
              <article key={title} className="card card-border bg-base-100">
                <div className="card-body">
                  <h2 className="card-title font-display">{title}</h2>
                  <p className="text-muted leading-relaxed">{body}</p>
                </div>
              </article>
            ))}
          </div>
          <figure className="card card-border overflow-hidden bg-base-100">
            <img
              src="/screenshots/armor-desktop.png"
              alt="GPC Combat section showing armor coverage, active defenses, and damage protection in Gilded Tome."
              width="1224"
              height="1284"
              loading="lazy"
            />
            <figcaption className="px-6 py-4 text-sm text-muted">
              See what stops a hit. Select a location, check your defenses, and resolve damage with
              your equipment already accounted for.
            </figcaption>
          </figure>
          <figure className="card card-border overflow-hidden bg-base-100">
            <img
              src="/screenshots/inventory-desktop.png"
              alt="GPC inventory in Illuminated Manuscript with worn equipment and nested containers."
              width="1224"
              height="1506"
              loading="lazy"
            />
            <figcaption className="px-6 py-4 text-sm text-muted">
              A pack with a place for everything. Track worn gear, nested containers, weight, armor,
              and weapon modes.
            </figcaption>
          </figure>
          <p className="text-center">
            <a
              className="link link-hover text-sm"
              href="https://github.com/capeterson/gurps-player-companion"
            >
              Explore the project on GitHub →
            </a>
          </p>
        </section>
      </main>
      <footer className="relative border-t border-base-300 px-5 py-6 text-center text-sm text-muted">
        GURPS Player Companion · An independent companion for GURPS 4e. GURPS is a trademark of
        Steve Jackson Games.
      </footer>
    </div>
  );
}
