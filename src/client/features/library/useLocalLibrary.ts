/**
 * Local-first campaign library (AGENTS.md S0): every read comes from the
 * Dexie stores the sync cursor fills, and every write goes through the
 * outbox. Nothing here talks to `/campaigns/{id}/library` directly.
 */
import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useRef, useState } from 'react';
import { validateLibrarySkillSpecializationDefault } from '../../../shared/domain/librarySkillSpecializations.ts';
import {
  activeEffectDefinitionCreate,
  activeEffectDefinitionUpdate,
} from '../../../shared/schemas/activeEffects.ts';
import {
  libraryEnchantmentCreate,
  libraryEnchantmentUpdate,
  libraryItemCreate,
  libraryItemUpdate,
  librarySkillCreate,
  librarySkillUpdate,
  librarySpellCreate,
  librarySpellUpdate,
  libraryTraitCreate,
  libraryTraitUpdate,
} from '../../../shared/schemas/campaignLibrary.ts';
import type { LibraryEntityClass } from '../../../shared/schemas/sync.ts';
import {
  type LocalLibraryActiveEffect,
  type LocalLibraryEnchantment,
  type LocalLibraryItem,
  type LocalLibraryLanguage,
  type LocalLibrarySkill,
  type LocalLibrarySpell,
  type LocalLibraryStyle,
  type LocalLibraryTechnique,
  type LocalLibraryTrait,
  getLocalDb,
} from '../../db/dexie.ts';
import { syncEntityTable } from '../../db/syncEntityStore.ts';
import {
  enqueueCreate,
  enqueueDelete,
  enqueueEntityPatch,
  newClientId,
} from '../../sync/outbox.ts';

export interface LocalLibrary {
  traits: LocalLibraryTrait[];
  skills: LocalLibrarySkill[];
  spells: LocalLibrarySpell[];
  items: LocalLibraryItem[];
  languages: LocalLibraryLanguage[];
  techniques: LocalLibraryTechnique[];
  styles: LocalLibraryStyle[];
  enchantments: LocalLibraryEnchantment[];
  activeEffects: LocalLibraryActiveEffect[];
}

export type LibrarySectionKey = keyof LocalLibrary;

type Row = { id: string; name: string; updatedAt?: string; revision?: number };

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/**
 * Reuse the previous object for rows whose revision and updatedAt did not
 * move. Dexie hands back fresh objects on every observed change; stable
 * identities let memoized rows and the search haystack cache skip untouched
 * entries when one entry changes. One `begin()` per read covers every store.
 */
function useRowReuse() {
  const previous = useRef(new Map<string, Row>());
  return useCallback(() => {
    const next = new Map<string, Row>();
    const keep = <T extends Row>(rows: T[]): T[] =>
      rows.map((row) => {
        const old = previous.current.get(row.id);
        const kept = (
          old && old.revision === row.revision && old.updatedAt === row.updatedAt ? old : row
        ) as T;
        next.set(row.id, kept);
        return kept;
      });
    return {
      keep,
      commit: () => {
        previous.current = next;
      },
    };
  }, []);
}

/** The whole library of one campaign, live from Dexie. `undefined` while the first read resolves. */
export function useLocalLibrary(campaignId: string | null): LocalLibrary | undefined {
  const reuse = useRowReuse();
  return useLiveQuery(async () => {
    if (!campaignId) return emptyLibrary();
    const db = getLocalDb();
    const [traits, skills, spells, items, languages, techniques, styles, enchantments, effects] =
      await Promise.all([
        db.campaignLibraryTraits.where('campaignId').equals(campaignId).toArray(),
        db.campaignLibrarySkills.where('campaignId').equals(campaignId).toArray(),
        db.campaignLibrarySpells.where('campaignId').equals(campaignId).toArray(),
        db.campaignLibraryItems.where('campaignId').equals(campaignId).toArray(),
        db.campaignLibraryLanguages.where('campaignId').equals(campaignId).toArray(),
        db.campaignLibraryTechniques.where('campaignId').equals(campaignId).toArray(),
        db.campaignLibraryStyles.where('campaignId').equals(campaignId).toArray(),
        db.campaignLibraryEnchantments.where('campaignId').equals(campaignId).toArray(),
        db.campaignLibraryActiveEffects.where('campaignId').equals(campaignId).toArray(),
      ]);
    const { keep, commit } = reuse();
    const library: LocalLibrary = {
      traits: keep(traits).sort((a, b) => a.kind.localeCompare(b.kind) || byName(a, b)),
      skills: keep(skills).sort(byName),
      spells: keep(spells).sort(byName),
      items: keep(items).sort(byName),
      languages: keep(languages).sort(byName),
      techniques: keep(techniques).sort(byName),
      styles: keep(styles).sort(byName),
      enchantments: keep(enchantments).sort(byName),
      activeEffects: keep(effects).sort(byName),
    };
    commit();
    return library;
  }, [campaignId, reuse]);
}

export function emptyLibrary(): LocalLibrary {
  return {
    traits: [],
    skills: [],
    spells: [],
    items: [],
    languages: [],
    techniques: [],
    styles: [],
    enchantments: [],
    activeEffects: [],
  };
}

/** Sections the in-app editor writes, with the shared schemas the server applies too. */
export const EDITABLE_LIBRARY_CLASSES = {
  traits: {
    entityClass: 'campaign_library_trait',
    noun: 'trait',
    create: libraryTraitCreate,
    update: libraryTraitUpdate,
  },
  skills: {
    entityClass: 'campaign_library_skill',
    noun: 'skill',
    create: librarySkillCreate,
    update: librarySkillUpdate,
  },
  spells: {
    entityClass: 'campaign_library_spell',
    noun: 'spell',
    create: librarySpellCreate,
    update: librarySpellUpdate,
  },
  items: {
    entityClass: 'campaign_library_item',
    noun: 'item',
    create: libraryItemCreate,
    update: libraryItemUpdate,
  },
  enchantments: {
    entityClass: 'campaign_library_enchantment',
    noun: 'enchantment',
    create: libraryEnchantmentCreate,
    update: libraryEnchantmentUpdate,
  },
  activeEffects: {
    entityClass: 'campaign_library_active_effect',
    noun: 'active effect',
    create: activeEffectDefinitionCreate,
    update: activeEffectDefinitionUpdate,
  },
} as const satisfies Partial<
  Record<
    LibrarySectionKey,
    {
      entityClass: LibraryEntityClass;
      noun: string;
      create: { parse(value: unknown): unknown };
      update: { parse(value: unknown): unknown };
    }
  >
>;

export type EditableLibrarySection = keyof typeof EDITABLE_LIBRARY_CLASSES;

/** The natural key the server's unique index enforces: kind + name for traits, name otherwise. */
function naturalKey(section: EditableLibrarySection, body: Record<string, unknown>): string {
  const name = String(body.name ?? '')
    .trim()
    .toLowerCase();
  return section === 'traits' ? `${String(body.kind)}::${name}` : name;
}

function firstIssue(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issue = (error as { issues: { path: (string | number)[]; message: string }[] }).issues[0];
    if (issue)
      return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
  }
  return error instanceof Error ? error.message : 'Save failed';
}

/**
 * Run every check the server would that the client can decide on its own,
 * so an invalid draft stays open in its form instead of being queued and
 * visibly rolled back later (AGENTS.md S13).
 */
async function validateEntry(
  section: EditableLibrarySection,
  campaignId: string,
  body: Record<string, unknown>,
  existingId: string | null,
): Promise<void> {
  if (section === 'skills') {
    validateLibrarySkillSpecializationDefault(
      String(body.name ?? ''),
      body.specializationPolicy as never,
      body.defaultSpecialization as string | null | undefined,
    );
  }
  const entityClass = EDITABLE_LIBRARY_CLASSES[section].entityClass;
  const table = syncEntityTable(entityClass);
  if (!table) return;
  const key = naturalKey(section, body);
  const siblings = (await table.where('campaignId').equals(campaignId).toArray()) as Array<
    Record<string, unknown> & { id: string }
  >;
  if (siblings.some((row) => row.id !== existingId && naturalKey(section, row) === key)) {
    throw new Error(`A ${EDITABLE_LIBRARY_CLASSES[section].noun} with that name already exists`);
  }
}

export interface LibraryMutationState {
  readonly isPending: boolean;
  readonly error: Error | null;
}

/**
 * Local-first CRUD for one editable library section. Each call validates,
 * then writes Dexie and the outbox in one transaction; the form closes as
 * soon as the edit is durable. Later server rejections roll back with a
 * persisted toast and a row flash (S5).
 */
export function useLibraryEntryMutations<Body extends Record<string, unknown>>(
  campaignId: string | null,
  section: EditableLibrarySection,
) {
  const config = EDITABLE_LIBRARY_CLASSES[section];
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [createState, setCreateState] = useState<LibraryMutationState>(idle);
  const [updateState, setUpdateState] = useState<LibraryMutationState>(idle);
  const [removeState, setRemoveState] = useState<LibraryMutationState>(idle);

  async function run(
    setState: (state: LibraryMutationState) => void,
    work: () => Promise<void>,
  ): Promise<boolean> {
    setState({ isPending: true, error: null });
    try {
      await work();
      setState(idle);
      return true;
    } catch (error) {
      setState({ isPending: false, error: new Error(firstIssue(error)) });
      return false;
    }
  }

  const createAsync = async (raw: Body): Promise<void> => {
    if (!campaignId) throw new Error('No campaign selected');
    const body = config.create.parse(raw) as Record<string, unknown>;
    await validateEntry(section, campaignId, body, null);
    await enqueueCreate({
      entityClass: config.entityClass,
      entityId: newClientId(),
      campaignId,
      attemptedValue: body,
      humanName: `library ${config.noun} "${String(body.name)}"`,
    });
  };

  const updateAsync = async (id: string, raw: Body): Promise<void> => {
    if (!campaignId) throw new Error('No campaign selected');
    const body = config.update.parse(raw) as Record<string, unknown>;
    const table = syncEntityTable(config.entityClass);
    const current = (await table?.get(id)) as Record<string, unknown> | undefined;
    if (!current) throw new Error(`This ${config.noun} no longer exists`);
    const merged = { ...current, ...body };
    await validateEntry(section, campaignId, merged, id);
    await enqueueEntityPatch({
      entityClass: config.entityClass,
      entityId: id,
      campaignId,
      attemptedValue: body,
      humanName: `library ${config.noun} "${String(merged.name)}"`,
    });
  };

  const removeAsync = async (id: string): Promise<void> => {
    if (!campaignId) throw new Error('No campaign selected');
    const current = (await syncEntityTable(config.entityClass)?.get(id)) as
      | Record<string, unknown>
      | undefined;
    await enqueueDelete({
      entityClass: config.entityClass,
      entityId: id,
      campaignId,
      humanName: `library ${config.noun} "${String(current?.name ?? '')}"`,
    });
  };

  return {
    addOpen,
    setAddOpen,
    editId,
    setEditId,
    deleteId,
    setDeleteId,
    createAsync,
    updateAsync,
    removeAsync,
    create: {
      ...createState,
      mutate: (body: Body) =>
        void run(setCreateState, () => createAsync(body)).then((ok) => ok && setAddOpen(false)),
    },
    update: {
      ...updateState,
      mutate: ({ id, body }: { id: string; body: Body }) =>
        void run(setUpdateState, () => updateAsync(id, body)).then(
          (ok) => ok && setEditId((current) => (current === id ? null : current)),
        ),
    },
    remove: {
      ...removeState,
      mutate: (id: string) =>
        void run(setRemoveState, () => removeAsync(id)).then(
          (ok) => ok && setDeleteId((current) => (current === id ? null : current)),
        ),
    },
  };
}

const idle: LibraryMutationState = { isPending: false, error: null };
