import { useState } from 'react';
import { SKILL_ATTRIBUTES } from '../../../shared/constants/skills.ts';
import {
  type SkillPrerequisite,
  skillDefaults,
  skillPrerequisites,
} from '../../../shared/schemas/skillRules.ts';
import { LibraryAdvancedFields } from './LibraryAdvancedFields.tsx';
import { libraryFormError } from './libraryFormErrors.ts';

function summarize(rule: SkillPrerequisite): string {
  switch (rule.kind) {
    case 'all':
      return `All of: ${rule.children.map(summarize).join('; ')}`;
    case 'any':
      return `Any of: ${rule.children.map(summarize).join('; ')}`;
    case 'attribute':
      return `${rule.attribute} ${rule.minimum}+`;
    case 'trait':
      return `${rule.name}${rule.minimumLevel === undefined ? '' : ` level ${rule.minimumLevel}+`}`;
    case 'skill':
      return `${rule.name}${rule.minimumLevel === undefined ? '' : ` ${rule.minimumLevel}+`}${rule.minimumRelativeLevel === undefined ? '' : ` relative ${rule.minimumRelativeLevel}+`}${rule.minimumPoints === undefined ? '' : ` (${rule.minimumPoints}+ points)`}${rule.specialization ? ` [${rule.specialization.kind === 'exact' ? rule.specialization.value : `${rule.specialization.kind} specialization`}]` : ''}`;
    case 'tech_level':
      return `TL ${rule.minimum ?? 'any'}–${rule.maximum ?? 'any'}`;
    case 'campaign_rule':
      return `Campaign rule: ${rule.ruleKey} = ${String(rule.expectedValue ?? true)}`;
    case 'gm_permission':
      return `GM permission: ${rule.label}`;
  }
}

/** Guided common rules plus a lossless escape hatch for nested/conditional rules. */
export function SkillRequirementsEditor({
  prerequisites,
  defaults,
  onPrerequisitesChange,
  onDefaultsChange,
  error,
}: {
  prerequisites: string;
  defaults: string;
  onPrerequisitesChange: (value: string) => void;
  onDefaultsChange: (value: string) => void;
  error?: string | null;
}) {
  const [kind, setKind] = useState<'attribute' | 'skill' | 'trait' | 'gm_permission'>('attribute');
  const [attribute, setAttribute] = useState<(typeof SKILL_ATTRIBUTES)[number]>('IQ');
  const [name, setName] = useState('');
  const [minimum, setMinimum] = useState('10');
  const [join, setJoin] = useState<'all' | 'any'>('all');
  const [defaultKind, setDefaultKind] = useState<'attribute' | 'skill'>('attribute');
  const [defaultAttribute, setDefaultAttribute] = useState<(typeof SKILL_ATTRIBUTES)[number]>('IQ');
  const [defaultName, setDefaultName] = useState('');
  const [penalty, setPenalty] = useState('-5');
  const [localError, setLocalError] = useState<string | null>(null);
  let requirement: SkillPrerequisite | null = null;
  let defaultRules: ReturnType<typeof skillDefaults.parse> = null;
  let parseError: string | null = null;
  try {
    requirement = skillPrerequisites.parse(prerequisites.trim() ? JSON.parse(prerequisites) : null);
    defaultRules = skillDefaults.parse(defaults.trim() ? JSON.parse(defaults) : null);
  } catch (cause) {
    parseError = libraryFormError(cause);
  }
  function addRequirement() {
    try {
      if (parseError) throw new Error('Correct the advanced JSON before adding a guided rule.');
      if (kind !== 'gm_permission' && !minimum.trim()) throw new Error('Enter the minimum value.');
      const next = skillPrerequisites.parse(
        kind === 'attribute'
          ? { kind, attribute, minimum: Number(minimum) }
          : kind === 'gm_permission'
            ? { kind, label: name }
            : { kind, name, minimumLevel: Number(minimum) },
      );
      const combined = requirement ? { kind: join, children: [requirement, next] } : next;
      onPrerequisitesChange(JSON.stringify(skillPrerequisites.parse(combined), null, 2));
      setLocalError(null);
    } catch (cause) {
      setLocalError(libraryFormError(cause));
    }
  }
  function addDefault() {
    try {
      if (parseError) throw new Error('Correct the advanced JSON before adding a guided rule.');
      if (!penalty.trim()) throw new Error('Enter a default penalty, from -50 to 0.');
      const next =
        defaultKind === 'attribute'
          ? { kind: defaultKind, attribute: defaultAttribute, modifier: Number(penalty) }
          : { kind: defaultKind, name: defaultName, modifier: Number(penalty) };
      onDefaultsChange(
        JSON.stringify(skillDefaults.parse([...(defaultRules ?? []), next]), null, 2),
      );
      setLocalError(null);
    } catch (cause) {
      setLocalError(libraryFormError(cause));
    }
  }
  return (
    <div className="min-w-0 space-y-3">
      <fieldset className="fieldset min-w-0">
        <legend className="fieldset-legend">Prerequisites</legend>
        <p className="text-xs">
          Requirements warn players when learning the skill; GM permission remains a manual
          decision.
        </p>
        {requirement && (
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 break-words">{summarize(requirement)}</p>
            <button
              className="btn btn-ghost btn-xs"
              type="button"
              onClick={() => onPrerequisitesChange('')}
            >
              Clear prerequisites
            </button>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label>
            Requirement type
            <select
              className="select select-sm w-full"
              value={kind}
              onChange={(event) => setKind(event.target.value as typeof kind)}
            >
              {(['attribute', 'skill', 'trait', 'gm_permission'] as const).map((value) => (
                <option key={value} value={value}>
                  {value === 'gm_permission' ? 'GM permission' : value}
                </option>
              ))}
            </select>
          </label>
          {kind === 'attribute' ? (
            <label>
              Required attribute
              <select
                className="select select-sm w-full"
                value={attribute}
                onChange={(event) => setAttribute(event.target.value as typeof attribute)}
              >
                {SKILL_ATTRIBUTES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          ) : (
            <label className="min-w-0">
              {kind === 'gm_permission' ? 'Permission description' : 'Required name'}
              <input
                className="input input-sm w-full"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
          )}
          {kind !== 'gm_permission' && (
            <label>
              Minimum {kind === 'attribute' ? 'value' : 'level'}
              <input
                className="input input-sm w-24"
                inputMode="numeric"
                value={minimum}
                onChange={(event) => setMinimum(event.target.value)}
              />
            </label>
          )}
          {requirement && (
            <label>
              Combine with existing
              <select
                className="select select-sm w-full"
                value={join}
                onChange={(event) => setJoin(event.target.value as typeof join)}
              >
                <option value="all">Require both</option>
                <option value="any">Allow either</option>
              </select>
            </label>
          )}
          <button
            className="btn btn-sm"
            type="button"
            disabled={Boolean(parseError)}
            onClick={addRequirement}
          >
            Add prerequisite
          </button>
        </div>
      </fieldset>
      <fieldset className="fieldset min-w-0">
        <legend className="fieldset-legend">Skill defaults</legend>
        <p className="text-xs">
          Add each allowed fallback. No defaults is different from an unspecified rule.
        </p>
        {defaultRules === null ? (
          <p>Defaults not specified.</p>
        ) : defaultRules.length === 0 ? (
          <p>No defaults allowed.</p>
        ) : (
          <ul className="space-y-2">
            {defaultRules.map((rule, index) => (
              <li key={`${index}-${rule.kind}`} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 break-words">
                  {rule.kind === 'attribute'
                    ? rule.attribute
                    : rule.kind === 'skill'
                      ? rule.name
                      : rule.kind === 'skill_group'
                        ? `Group: ${rule.group}`
                        : `Tag: ${rule.tag}`}{' '}
                  {rule.modifier}
                  {rule.conditions?.length ? ' · conditional (see advanced rules)' : ''}
                  {'specialization' in rule && rule.specialization ? ' · specialization rule' : ''}
                </span>
                <button
                  className="btn btn-ghost btn-xs"
                  type="button"
                  aria-label={`Remove default ${index + 1}`}
                  onClick={() =>
                    onDefaultsChange(
                      JSON.stringify(
                        defaultRules?.filter((_, i) => i !== index),
                        null,
                        2,
                      ),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label>
            Default from
            <select
              className="select select-sm w-full"
              value={defaultKind}
              onChange={(event) => setDefaultKind(event.target.value as typeof defaultKind)}
            >
              <option value="attribute">Attribute</option>
              <option value="skill">Skill</option>
            </select>
          </label>
          {defaultKind === 'attribute' ? (
            <label>
              Default attribute
              <select
                className="select select-sm w-full"
                value={defaultAttribute}
                onChange={(event) =>
                  setDefaultAttribute(event.target.value as typeof defaultAttribute)
                }
              >
                {SKILL_ATTRIBUTES.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
          ) : (
            <label>
              Default skill name
              <input
                className="input input-sm w-full"
                value={defaultName}
                onChange={(event) => setDefaultName(event.target.value)}
              />
            </label>
          )}
          <label>
            Default penalty
            <input
              className="input input-sm w-24"
              inputMode="numeric"
              value={penalty}
              onChange={(event) => setPenalty(event.target.value)}
            />
          </label>
          <button
            className="btn btn-sm"
            type="button"
            disabled={Boolean(parseError)}
            onClick={addDefault}
          >
            Add default
          </button>
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={Boolean(parseError) || defaultRules?.length === 0}
            onClick={() => onDefaultsChange('[]')}
          >
            Set no defaults
          </button>
        </div>
      </fieldset>
      {localError && (
        <p role="alert" className="text-error break-words">
          {localError}
        </p>
      )}
      <LibraryAdvancedFields
        title="Advanced prerequisites and defaults (JSON)"
        error={parseError || error || null}
        hint="Use this for nested alternatives, specializations, relative levels, campaign rules and conditional defaults. Guided additions preserve these rules."
      >
        <label className="block">
          Structured prerequisites (JSON)
          <textarea
            className="textarea w-full font-mono text-xs"
            rows={6}
            value={prerequisites}
            onChange={(event) => onPrerequisitesChange(event.target.value)}
          />
        </label>
        <label className="block">
          Default rules (JSON)
          <textarea
            className="textarea w-full font-mono text-xs"
            rows={6}
            value={defaults}
            onChange={(event) => onDefaultsChange(event.target.value)}
          />
        </label>
        {parseError && (
          <p role="alert" className="text-error break-words">
            {parseError}
          </p>
        )}
      </LibraryAdvancedFields>
    </div>
  );
}
