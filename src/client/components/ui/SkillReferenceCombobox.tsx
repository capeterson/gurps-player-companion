import { useQuery } from '@tanstack/react-query';
import { type FocusEventHandler, type KeyboardEventHandler, useMemo, useState } from 'react';
import { ComboBox, Input, ListBox, ListBoxItem, Popover } from 'react-aria-components';
import { skillDisplayName, skillReferencesMatch } from '../../../shared/domain/defenseCalc.ts';
import type { LibrarySkillOut } from '../../../shared/schemas/campaignLibrary.ts';
import type { SkillOut } from '../../../shared/schemas/skill.ts';
import { useViewportBoundedOverlay } from '../../hooks/useViewportBoundedOverlay.ts';
import { api } from '../../lib/api.ts';

type CharacterSkill = Pick<SkillOut, 'name' | 'specialization'>;
type CampaignSkill = Pick<
  LibrarySkillOut,
  'name' | 'defaultSpecialization' | 'specializationPolicy'
>;

export interface SkillReferenceOption {
  label: string;
  source: 'campaign' | 'character';
}

/** Campaign definitions replace character entries with the same skill reference. */
export function skillReferenceOptions(
  characterSkills: readonly CharacterSkill[] = [],
  campaignSkills: readonly CampaignSkill[] = [],
): SkillReferenceOption[] {
  const options: SkillReferenceOption[] = [];
  const add = (label: string, source: SkillReferenceOption['source']) => {
    if (label && !options.some((option) => skillReferencesMatch(option.label, label))) {
      options.push({ label, source });
    }
  };
  for (const skill of campaignSkills) {
    add(skillDisplayName(skill.name, skill.defaultSpecialization), 'campaign');
    if (
      skill.specializationPolicy.kind === 'required_catalog' ||
      skill.specializationPolicy.kind === 'optional_catalog'
    ) {
      for (const specialization of skill.specializationPolicy.options) {
        add(skillDisplayName(skill.name, specialization.name), 'campaign');
      }
    }
  }
  for (const skill of characterSkills) {
    add(skillDisplayName(skill.name, skill.specialization), 'character');
  }
  return options.sort((a, b) => a.label.localeCompare(b.label));
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onPick?: (option: SkillReferenceOption) => void;
  campaignId?: string | null | undefined;
  characterSkills?: readonly CharacterSkill[];
  /** Supply a loaded library directly when the parent already has it. */
  campaignSkills?: readonly CampaignSkill[];
  'aria-label': string;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  inputProps?: {
    id?: string;
    onFocus?: FocusEventHandler<HTMLInputElement>;
    onBlur?: FocusEventHandler<HTMLInputElement>;
    onKeyDown?: KeyboardEventHandler<HTMLInputElement>;
    'aria-invalid'?: boolean | 'true' | 'false' | undefined;
    'aria-describedby'?: string | undefined;
    'data-flashing'?: string;
    'data-flash-parity'?: string;
  };
  disabled?: boolean;
}

/** A free-text skill reference with React Aria's keyboard and screen-reader behavior. */
export function SkillReferenceCombobox({
  value,
  onChange,
  onPick,
  campaignId,
  characterSkills = [],
  campaignSkills,
  'aria-label': ariaLabel,
  placeholder,
  className = '',
  inputClassName = '',
  inputProps,
  disabled = false,
}: Props) {
  const campaign = useQuery({
    queryKey: ['campaigns', campaignId, 'library'],
    enabled: !!campaignId && campaignSkills === undefined,
    queryFn: () => api<{ skills: LibrarySkillOut[] }>(`/campaigns/${campaignId}/library`),
    staleTime: 30_000,
  });
  const options = useMemo(
    () => skillReferenceOptions(characterSkills, campaignSkills ?? campaign.data?.skills ?? []),
    [characterSkills, campaignSkills, campaign.data?.skills],
  );
  const visibleOptions = useMemo(() => {
    const needle = value.trim().toLocaleLowerCase();
    return needle
      ? options.filter((option) => option.label.toLocaleLowerCase().includes(needle))
      : options;
  }, [options, value]);
  const [open, setOpen] = useState(false);
  const panelRef = useViewportBoundedOverlay<HTMLDivElement>(open);
  return (
    <ComboBox
      aria-label={ariaLabel}
      allowsCustomValue
      items={visibleOptions}
      inputValue={value}
      onInputChange={onChange}
      onChange={(key) => {
        const option = options.find((item) => item.label === key);
        if (!option) return;
        if (onPick) onPick(option);
        else onChange(option.label);
      }}
      isDisabled={disabled}
      menuTrigger="focus"
      onOpenChange={setOpen}
      className={`relative min-w-0 ${className}`}
    >
      <Input
        {...(inputProps?.id ? { id: inputProps.id } : {})}
        {...(inputProps?.onFocus ? { onFocus: inputProps.onFocus } : {})}
        {...(inputProps?.onBlur ? { onBlur: inputProps.onBlur } : {})}
        {...(inputProps?.onKeyDown ? { onKeyDown: inputProps.onKeyDown } : {})}
        {...(inputProps?.['aria-invalid'] !== undefined
          ? { 'aria-invalid': inputProps['aria-invalid'] }
          : {})}
        {...(inputProps?.['aria-describedby']
          ? { 'aria-describedby': inputProps['aria-describedby'] }
          : {})}
        {...(inputProps?.['data-flashing'] ? { 'data-flashing': inputProps['data-flashing'] } : {})}
        {...(inputProps?.['data-flash-parity']
          ? { 'data-flash-parity': inputProps['data-flash-parity'] }
          : {})}
        className={`input input-bordered input-sm w-full min-w-0 ${inputClassName}`}
        placeholder={placeholder ?? ''}
      />
      <Popover
        ref={panelRef}
        maxHeight={320}
        className="z-50 w-[var(--trigger-width)] max-h-[calc(100dvh-1rem)] max-w-[calc(100dvw-1rem)] overflow-y-auto rounded-box border border-base-300 bg-base-100 shadow-lg [translate:var(--viewport-overlay-shift-x,0px)_0]"
      >
        <ListBox className="p-1 outline-none" items={visibleOptions}>
          {(option) => (
            <ListBoxItem
              id={option.label}
              textValue={option.label}
              className="cursor-pointer rounded-field px-3 py-2 text-sm text-base-content outline-none data-[focused]:bg-base-200 data-[selected]:font-medium"
            >
              <span className="block break-words">{option.label}</span>
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}
