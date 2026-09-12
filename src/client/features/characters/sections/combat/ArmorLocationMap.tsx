import { useId, useState } from 'react';
import type { DrByLocationMap } from '../../../../../shared/domain/armorDr.ts';
import { effectiveDrAgainstAttack } from '../../../../../shared/domain/injuryCalc.ts';
import { locationLabel } from './armorViewOptions.ts';

/** The reviewed rounded silhouette; left/right are the character's perspective. */
const ZONES = [
  {
    id: 'skull',
    side: 'left',
    y: 56,
    point: [249, 73],
    d: 'M246 84C246 66 257 54 280 54C303 54 314 66 314 84Z',
  },
  {
    id: 'face',
    side: 'right',
    y: 93,
    point: [311, 103],
    d: 'M246 89H314C314 110 300 124 280 124C260 124 246 110 246 89Z',
  },
  {
    id: 'neck',
    side: 'left',
    y: 159,
    point: [264, 143],
    d: 'M264 129H296L300 150L280 161L260 150Z',
  },
  {
    id: 'torso',
    side: 'right',
    y: 223,
    point: [331, 205],
    d: 'M256 154L280 168L304 154L330 167L335 211L323 246L322 309Q280 321 238 309L237 246L225 211L230 167Z',
  },
  {
    id: 'arm_right',
    side: 'left',
    y: 240,
    point: [188, 231],
    d: 'M218 169L204 175Q192 181 188 198L172 246L166 289L158 333L183 341L196 298L201 254L215 212Z',
  },
  {
    id: 'arm_left',
    side: 'right',
    y: 163,
    point: [359, 207],
    d: 'M342 169L356 175Q368 181 372 198L388 246L394 289L402 333L377 341L364 298L359 254L345 212Z',
  },
  {
    id: 'hand_right',
    side: 'left',
    y: 352,
    point: [153, 366],
    d: 'M156 339L182 348L179 369L168 386Q164 390 161 384L157 391Q153 394 150 390L141 380Q138 376 142 366Z',
  },
  {
    id: 'hand_left',
    side: 'right',
    y: 352,
    point: [407, 366],
    d: 'M404 339L378 348L381 369L392 386Q396 390 399 384L403 391Q407 394 410 390L419 380Q422 376 418 366Z',
  },
  {
    id: 'groin',
    side: 'right',
    y: 412,
    point: [306, 359],
    d: 'M238 316Q280 328 322 316L326 355L307 378L280 359L253 378L234 355Z',
  },
  {
    id: 'leg_right',
    side: 'left',
    y: 487,
    point: [225, 482],
    d: 'M234 364L251 386L276 369L273 441L264 497L258 556H227L222 507L220 459L223 410Z',
  },
  {
    id: 'leg_left',
    side: 'right',
    y: 487,
    point: [335, 482],
    d: 'M326 364L309 386L284 369L287 441L296 497L302 556H333L338 507L340 459L337 410Z',
  },
  {
    id: 'foot_right',
    side: 'left',
    y: 583,
    point: [220, 585],
    d: 'M226 563H257L259 590Q259 599 250 601H214Q208 599 211 591Z',
  },
  {
    id: 'foot_left',
    side: 'right',
    y: 583,
    point: [340, 585],
    d: 'M303 563H334L349 591Q352 599 346 601H310Q301 599 301 590Z',
  },
  {
    id: 'vitals',
    side: 'right',
    y: 282,
    point: [295, 236],
    d: 'M265 217Q280 207 295 217V245L280 258L265 245Z',
  },
  // Eyes follow face in paint order so both small shapes remain clickable.
  {
    id: 'eye',
    side: 'left',
    y: 107,
    point: [252, 92],
    d: 'M252 88H273V96H252ZM287 88H308V96H287Z',
  },
] as const;

export function ArmorLocationMap({
  map,
  type,
  divisor,
  known,
  protectNaturalDr = false,
  selected,
  onSelect,
}: {
  map: DrByLocationMap;
  type: string;
  divisor: string;
  known: boolean;
  protectNaturalDr?: boolean;
  selected: string;
  onSelect: (location: string) => void;
}) {
  const id = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const dr = (location: string) =>
    effectiveDrAgainstAttack(type, map.get(location), divisor, protectNaturalDr);
  const label = (location: string) =>
    `${locationLabel(location)}, ${known ? `DR ${dr(location)}` : 'DR unavailable'}`;
  return (
    <div className="armor-map-container">
      <div className="armor-orientation">
        <span>Character’s right</span>
        <span>Front view</span>
        <span>Character’s left</span>
      </div>
      <div className="armor-map">
        {/* biome-ignore lint/a11y/useSemanticElements: interactive SVG paths cannot be grouped with an HTML fieldset inside SVG. */}
        <svg viewBox="0 20 560 610" role="group" aria-labelledby={`${id}-title`}>
          <title id={`${id}-title`}>Armor locations — select a zone or its label</title>
          <defs>
            <pattern
              id={`${id}-open`}
              patternUnits="userSpaceOnUse"
              width="7"
              height="7"
              patternTransform="rotate(40)"
            >
              <rect width="7" height="7" fill="var(--color-base-200)" />
              <path d="M0 0V7" stroke="var(--color-base-300)" strokeWidth="2" />
            </pattern>
          </defs>
          <g className="armor-leaders">
            {ZONES.map((zone) => (
              <path
                key={zone.id}
                d={`M${zone.side === 'left' ? 120 : 440} ${zone.y}H${zone.side === 'left' ? Math.min(zone.point[0] - 15, 206) : Math.max(zone.point[0] + 15, 354)}L${zone.point.join(' ')}`}
              />
            ))}
          </g>
          {ZONES.map((zone) => (
            <path
              key={zone.id}
              d={zone.d}
              data-location={zone.id}
              className={`armor-zone ${selected === zone.id ? 'is-selected' : ''} ${hovered === zone.id ? 'is-hovered' : ''}`}
              style={known && dr(zone.id) === 0 ? { fill: `url(#${id}-open)` } : undefined}
              role="button"
              tabIndex={0}
              aria-label={label(zone.id)}
              aria-pressed={selected === zone.id}
              onClick={() => onSelect(zone.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelect(zone.id);
                }
              }}
              onPointerEnter={() => setHovered(zone.id)}
              onPointerLeave={() => setHovered(null)}
            />
          ))}
        </svg>
        {ZONES.map((zone) => (
          <button
            key={zone.id}
            type="button"
            className={`armor-callout ${zone.side} ${hovered === zone.id ? 'is-hovered' : ''}`}
            style={{ top: `${((zone.y - 20) / 610) * 100}%` }}
            aria-label={label(zone.id)}
            aria-pressed={selected === zone.id}
            onClick={() => onSelect(zone.id)}
            onPointerEnter={() => setHovered(zone.id)}
            onPointerLeave={() => setHovered(null)}
          >
            <span>{locationLabel(zone.id)}</span>
            <b>{known ? dr(zone.id) : '—'}</b>
          </button>
        ))}
      </div>
      <p className="text-xs text-muted text-center">
        Select a zone or use Hit location. Hatched zones have no DR.
      </p>
    </div>
  );
}
