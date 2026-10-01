import { useState } from 'react';
import type { CharacterDetailEnvelope } from '../../shared/schemas/character.ts';
import { Stat, StatCard } from '../components/ui/StatCard.tsx';
import { CharacterIdentityDetails } from '../features/characters/CharacterIdentityDetails.tsx';
import { InventoryPanel } from '../features/characters/sections/InventoryPanel.tsx';
import { LanguagesPanel } from '../features/characters/sections/LanguagesPanel.tsx';
import { SkillsPanel } from '../features/characters/sections/SkillsPanel.tsx';
import { SpellsPanel } from '../features/characters/sections/SpellsPanel.tsx';
import { TechniquesPanel } from '../features/characters/sections/TechniquesPanel.tsx';
import { TraitsPanel } from '../features/characters/sections/TraitsPanel.tsx';

const sections = ['Overview', 'Traits', 'Skills', 'Magic', 'Inventory'] as const;
type Section = (typeof sections)[number];

export function CharacterDetailsApp({
  data,
  error,
  refresh,
  refreshing = false,
}: {
  data: CharacterDetailEnvelope | null;
  error: string | null;
  refresh?: (() => void) | undefined;
  refreshing?: boolean;
}) {
  const [section, setSection] = useState<Section>('Overview');
  if (error)
    return (
      <main className="grid gap-3 p-3">
        <p role="alert" className="alert alert-error">
          {error}
        </p>
        {refresh && (
          <button type="button" className="btn btn-sm" onClick={refresh}>
            Refresh
          </button>
        )}
      </main>
    );
  if (!data)
    return (
      <output className="block p-3">
        {refreshing ? 'Refreshing character details…' : 'Waiting for character details…'}
      </output>
    );
  if (data.view === 'minimal')
    return (
      <main className="grid gap-4 p-3">
        <h1 className="font-name text-3xl [overflow-wrap:anywhere]">{data.name}</h1>
        <p>Limited view — detailed sheet information is hidden by the campaign owner.</p>
        {refresh && (
          <button type="button" className="btn btn-sm" onClick={refresh}>
            Refresh
          </button>
        )}
        <CharacterIdentityDetails data={data} />
      </main>
    );
  const derived = data.derived;
  return (
    <main className="grid min-w-0 gap-4 p-3 sm:p-5">
      <header className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-name text-3xl [overflow-wrap:anywhere]">{data.name}</h1>
          <p className="text-sm text-base-content/60">Read-only character details</p>
        </div>
        {refresh && (
          <button type="button" className="btn btn-sm" disabled={refreshing} onClick={refresh}>
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        )}
      </header>
      <nav aria-label="Character details sections" className="flex flex-wrap gap-2">
        {sections.map((label) => (
          <button
            key={label}
            type="button"
            className={`btn btn-sm ${section === label ? 'btn-active' : 'btn-ghost'}`}
            aria-current={section === label ? 'page' : undefined}
            onClick={() => setSection(label)}
          >
            {label}
          </button>
        ))}
      </nav>
      {section === 'Overview' && (
        <div className="grid gap-4">
          <StatCard title="Attributes">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ['ST', derived.effectiveSt],
                ['DX', derived.effectiveDx],
                ['IQ', derived.effectiveIq],
                ['HT', derived.effectiveHt],
              ].map(([label, value]) => (
                <Stat key={label} label={label} value={value} />
              ))}
            </div>
          </StatCard>
          <StatCard title="Secondary attributes">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              {[
                ['HP', `${data.combat?.currentHp ?? derived.hp} / ${derived.hp}`],
                ['FP', `${data.combat?.currentFp ?? derived.fp} / ${derived.fp}`],
                ['Will', derived.will],
                ['Per', derived.per],
                ['Basic Speed', derived.basicSpeed],
                ['Basic Move', derived.basicMove],
                ['Basic Lift', `${derived.basicLift} lb`],
                ['Thrust / Swing', `${derived.thrust} / ${derived.swing}`],
              ].map(([label, value]) => (
                <Stat key={label} label={label} value={value} />
              ))}
            </div>
          </StatCard>
          <StatCard title="Point ledger" points={data.points.total}>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              {[
                ['Attributes', data.points.attributes],
                ['Secondary', data.points.secondary],
                ['Skills', data.points.skills],
                ['Spells', data.points.spells],
                ['Advantages', data.points.advantages],
                ['Disadvantages', data.points.disadvantages],
                ['Quirks', data.points.quirks],
                ['Languages', data.points.languages],
                ['Techniques', data.points.techniques],
                ['Unspent', data.points.unspent],
              ].map(([label, value]) => (
                <Stat key={label} label={label} value={value} />
              ))}
            </div>
          </StatCard>
          <StatCard title="Encumbrance">
            <p>
              {data.encumbrance.label} · {data.encumbrance.playerWeightLbs} lb carried
            </p>
          </StatCard>
          {data.warnings.map((warning) => (
            <p key={warning.code} className="text-warning">
              {warning.message}
            </p>
          ))}
          <CharacterIdentityDetails data={data} />
        </div>
      )}
      {section === 'Traits' && (
        <TraitsPanel
          character={data}
          canWrite={false}
          activeEffectsSnapshot={data.effects.some((effect) => Boolean(effect.conditionGroup))}
        />
      )}
      {section === 'Skills' && (
        <div className="grid gap-4">
          <SkillsPanel character={data} canWrite={false} />
          <LanguagesPanel character={data} canWrite={false} />
          <TechniquesPanel character={data} canWrite={false} />
        </div>
      )}
      {section === 'Magic' && <SpellsPanel character={data} canWrite={false} />}
      {section === 'Inventory' && <InventoryPanel character={data} canWrite={false} />}
    </main>
  );
}
