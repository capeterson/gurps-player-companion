import { raceName } from '../../../shared/domain/race.ts';
import type { CharacterDetail } from '../../../shared/schemas/character.ts';
import type { CharacterRace } from '../../../shared/schemas/race.ts';
import { Markdown } from '../../components/markdown/Markdown.tsx';

/** Identity-only presentation shared by the limited sheet and MCP Apps. */
export function CharacterIdentityDetails({
  data,
}: {
  data: Pick<
    CharacterDetail,
    'height' | 'weight' | 'age' | 'birthdate' | 'techLevel' | 'appearance'
  > & { race?: CharacterRace | undefined; raceName?: string | undefined };
}) {
  const fields = [
    { label: 'Race', value: data.raceName ?? raceName(data.race) },
    { label: 'Height', value: data.height },
    { label: 'Weight', value: data.weight },
    { label: 'Age', value: data.age },
    { label: 'Birthdate', value: data.birthdate },
    { label: 'Tech level', value: data.techLevel == null ? null : `TL ${data.techLevel}` },
  ];
  return (
    <section className="card border border-base-300/60 bg-base-100 rounded-2xl">
      <div className="card-body p-5 grid gap-5">
        <div>
          <h2 className="label-eyebrow mb-3">At a glance</h2>
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
            {fields.map(({ label, value }) => (
              <div key={label} className="min-w-0 [overflow-wrap:anywhere]">
                <dt className="label-eyebrow">{label}</dt>
                <dd>{value == null || value === '' ? '—' : value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {data.appearance && (
          <div>
            <h2 className="label-eyebrow mb-2">Description</h2>
            <Markdown source={data.appearance} />
          </div>
        )}
      </div>
    </section>
  );
}
