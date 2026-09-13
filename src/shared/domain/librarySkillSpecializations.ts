import type {
  LibrarySkillOut,
  LibrarySkillSpecializationPolicy,
} from '../schemas/campaignLibrary.ts';

export interface ResolvedLibrarySkillSpecialization {
  specialization: string | null;
  description: string | null;
  prerequisites: string | null;
  defaults: LibrarySkillOut['defaults'];
}

export function librarySkillCopyNotes(
  source: string | null | undefined,
  resolved: Pick<ResolvedLibrarySkillSpecialization, 'description' | 'prerequisites'>,
): string | null {
  return (
    [
      resolved.description,
      source ? `Source: ${source}` : null,
      resolved.prerequisites ? `Prerequisites: ${resolved.prerequisites}` : null,
    ]
      .filter(Boolean)
      .join('\n\n') || null
  );
}

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();

export function effectiveSpecializationPolicy(
  policy: LibrarySkillSpecializationPolicy | undefined,
  defaultSpecialization?: string | null,
): LibrarySkillSpecializationPolicy {
  if (policy) return policy;
  return defaultSpecialization ? { kind: 'optional_freeform' } : { kind: 'none' };
}

/** Ensure the optional preselected specialty is compatible with its policy. */
export function validateLibrarySkillSpecializationDefault(
  name: string,
  policy: LibrarySkillSpecializationPolicy | undefined,
  defaultSpecialization: string | null | undefined,
): void {
  const effective = effectiveSpecializationPolicy(policy, defaultSpecialization);
  const value = defaultSpecialization?.trim();
  if (!value) return;
  if (effective.kind === 'none') {
    throw new Error(
      `${name} cannot have a default specialization when specializations are disabled`,
    );
  }
  if (effective.kind === 'required_catalog' || effective.kind === 'optional_catalog') {
    if (!effective.options.some((option) => normalize(option.name) === normalize(value))) {
      throw new Error(`${value} is not an available default specialization for ${name}`);
    }
  }
}

/** Initial concrete value for the character-sheet picker. */
export function initialLibrarySkillSpecialization(
  skill: Parameters<typeof resolveLibrarySkillSpecialization>[0],
): string | null {
  const policy = effectiveSpecializationPolicy(
    skill.specializationPolicy,
    skill.defaultSpecialization,
  );
  const defaultSpecialization = skill.defaultSpecialization?.trim();
  if (defaultSpecialization) {
    return resolveLibrarySkillSpecialization(skill, defaultSpecialization).specialization;
  }
  return policy.kind === 'required_catalog' ? (policy.options[0]?.name ?? null) : null;
}

/** Resolve and validate the specialization copied onto a character skill. */
export function resolveLibrarySkillSpecialization(
  skill: Pick<
    LibrarySkillOut,
    'name' | 'defaultSpecialization' | 'description' | 'prerequisites' | 'defaults'
  > & { specializationPolicy?: LibrarySkillSpecializationPolicy },
  requested: string | null | undefined,
): ResolvedLibrarySkillSpecialization {
  const policy = effectiveSpecializationPolicy(
    skill.specializationPolicy,
    skill.defaultSpecialization,
  );
  validateLibrarySkillSpecializationDefault(
    skill.name,
    skill.specializationPolicy,
    skill.defaultSpecialization,
  );
  const value = requested?.trim() || null;
  const required = policy.kind === 'required_freeform' || policy.kind === 'required_catalog';
  if (policy.kind === 'none') {
    if (value) throw new Error(`${skill.name} does not accept a specialization`);
    return {
      specialization: null,
      description: skill.description,
      prerequisites: skill.prerequisites,
      defaults: skill.defaults,
    };
  }
  if (!value) {
    if (required) throw new Error(`${skill.name} requires a specialization`);
    return {
      specialization: null,
      description: skill.description,
      prerequisites: skill.prerequisites,
      defaults: skill.defaults,
    };
  }
  if (policy.kind === 'required_freeform' || policy.kind === 'optional_freeform') {
    return {
      specialization: value,
      description: skill.description,
      prerequisites: skill.prerequisites,
      defaults: skill.defaults,
    };
  }
  const option = policy.options.find((candidate) => normalize(candidate.name) === normalize(value));
  if (!option) throw new Error(`${value} is not an available specialization for ${skill.name}`);
  return {
    specialization: option.name,
    description: option.description === undefined ? skill.description : option.description,
    prerequisites: option.prerequisites === undefined ? skill.prerequisites : option.prerequisites,
    defaults: option.defaults === undefined ? skill.defaults : option.defaults,
  };
}
