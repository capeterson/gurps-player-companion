import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { skillReferencesMatch } from '../shared/domain/defenseCalc.ts';
import type { LibrarySkillOut } from '../shared/schemas/campaignLibrary.ts';
import type { SkillOut } from '../shared/schemas/skill.ts';
import {
  SkillReferenceCombobox,
  skillReferenceOptions,
} from './components/ui/SkillReferenceCombobox.tsx';
import './styles/theme.css';

type CampaignSkill = Pick<
  LibrarySkillOut,
  'name' | 'defaultSpecialization' | 'specializationPolicy'
>;
type CharacterSkill = Pick<SkillOut, 'name' | 'specialization'>;

const campaignSkills: CampaignSkill[] = [
  { name: 'Broadsword', defaultSpecialization: null, specializationPolicy: { kind: 'none' } },
  {
    name: 'Guns',
    defaultSpecialization: 'Pistol',
    specializationPolicy: {
      kind: 'required_catalog',
      options: [{ name: 'Pistol' }, { name: 'Rifle' }, { name: 'Shotgun' }],
    },
  },
  { name: 'First Aid', defaultSpecialization: null, specializationPolicy: { kind: 'none' } },
  { name: 'Observation', defaultSpecialization: null, specializationPolicy: { kind: 'none' } },
  { name: 'Research', defaultSpecialization: null, specializationPolicy: { kind: 'none' } },
  { name: 'Shield', defaultSpecialization: null, specializationPolicy: { kind: 'none' } },
  { name: 'Stealth', defaultSpecialization: null, specializationPolicy: { kind: 'none' } },
];

const characterSkills: CharacterSkill[] = [
  { name: 'Broadsword', specialization: null },
  { name: 'Guns', specialization: 'Pistol' },
  { name: 'Acrobatics', specialization: null },
  { name: 'Climbing', specialization: null },
  { name: 'Swimming', specialization: null },
  { name: 'Tracking', specialization: null },
];

const resolvedOptions = skillReferenceOptions(characterSkills, campaignSkills);
const queryClient = new QueryClient();

function SkillReferenceDemo() {
  const [value, setValue] = useState('');
  const match = resolvedOptions.find((option) => skillReferencesMatch(option.label, value));

  return (
    <main className="min-h-dvh bg-base-200 px-4 py-8 text-base-content sm:px-8 sm:py-12">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Component preview
          </p>
          <h1 className="font-display text-3xl font-semibold sm:text-4xl">
            Skill reference combobox
          </h1>
          <p className="max-w-2xl text-sm leading-6 text-base-content/70 sm:text-base">
            Search campaign and character skills in one field. Select a suggestion with the mouse or
            keyboard, or enter a skill that is not listed.
          </p>
        </header>

        <section className="card card-border bg-base-100 shadow-sm" aria-labelledby="try-heading">
          <div className="card-body gap-5">
            <div>
              <h2 id="try-heading" className="card-title">
                Try it
              </h2>
              <p className="mt-1 text-sm text-base-content/60">
                Try “gun”, “broadsword”, or a custom name. Arrow keys move through suggestions;
                Enter selects one.
              </p>
            </div>
            <div className="max-w-lg space-y-2">
              <label htmlFor="demo-skill" className="block text-sm font-medium">
                Governing skill
              </label>
              <SkillReferenceCombobox
                aria-label="Governing skill"
                value={value}
                onChange={setValue}
                onPick={(option) => setValue(option.label)}
                campaignSkills={campaignSkills}
                characterSkills={characterSkills}
                placeholder="Search or type a skill"
                inputProps={{ id: 'demo-skill' }}
              />
            </div>
            <div className="rounded-box border border-base-300 bg-base-200 p-4" aria-live="polite">
              <p className="text-xs uppercase tracking-wider text-base-content/60">Current value</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="font-medium">{value.trim() || 'Nothing entered yet'}</span>
                {value.trim() && (
                  <span className="badge badge-sm badge-outline">
                    {match ? `${match.source} skill` : 'custom text'}
                  </span>
                )}
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="card card-border bg-base-100" aria-labelledby="campaign-heading">
            <div className="card-body">
              <h2 id="campaign-heading" className="card-title text-base">
                Campaign library
              </h2>
              <p className="text-sm text-base-content/60">
                Includes the Guns specialization catalog.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {campaignSkills.map((skill) => (
                  <li key={skill.name} className="badge badge-outline">
                    {skill.name}
                  </li>
                ))}
              </ul>
            </div>
          </section>
          <section className="card card-border bg-base-100" aria-labelledby="character-heading">
            <div className="card-body">
              <h2 id="character-heading" className="card-title text-base">
                Character skills
              </h2>
              <p className="text-sm text-base-content/60">
                Broadsword and Guns/Pistol also appear in the campaign. Campaign entries win.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {characterSkills.map((skill) => (
                  <li
                    key={`${skill.name}/${skill.specialization ?? ''}`}
                    className="badge badge-outline"
                  >
                    {skill.name}
                    {skill.specialization ? `/${skill.specialization}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        </div>
        <p className="text-xs text-base-content/50">
          Sample data only. This page does not save edits.
        </p>
      </div>
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');
createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <SkillReferenceDemo />
  </QueryClientProvider>,
);
