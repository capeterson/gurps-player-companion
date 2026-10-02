/** Common GURPS Fourth Edition books, with the combined revised Basic Set.
 * Abbreviations follow the GCS page-reference list.
 * https://gurpscharactersheet.com/page_references
 */
export const DEFAULT_CAMPAIGN_SOURCES = [
  {
    name: 'GURPS Basic Set, Fourth Edition Revised',
    key: 'basic-set-fourth-edition-revised',
    abbreviation: 'B',
    edition: 'Fourth Edition Revised',
  },
  { name: 'GURPS Magic', key: 'magic', abbreviation: 'M' },
  { name: 'GURPS Martial Arts', key: 'martial-arts', abbreviation: 'MA' },
  { name: 'GURPS Powers', key: 'powers', abbreviation: 'P' },
  { name: 'GURPS Fantasy', key: 'fantasy', abbreviation: 'F' },
  { name: 'GURPS Space', key: 'space', abbreviation: 'S' },
  { name: 'GURPS Low-Tech', key: 'low-tech', abbreviation: 'LT' },
  { name: 'GURPS High-Tech', key: 'high-tech', abbreviation: 'HT' },
  { name: 'GURPS Ultra-Tech', key: 'ultra-tech', abbreviation: 'UT' },
  { name: 'GURPS Bio-Tech', key: 'bio-tech', abbreviation: 'BT' },
  { name: 'GURPS Thaumatology', key: 'thaumatology', abbreviation: 'T' },
  { name: 'GURPS Social Engineering', key: 'social-engineering', abbreviation: 'SE' },
  { name: 'GURPS Horror', key: 'horror', abbreviation: 'H' },
  { name: 'GURPS Supers', key: 'supers', abbreviation: 'SU' },
  { name: 'GURPS Psionic Powers', key: 'psionic-powers', abbreviation: 'PSI' },
  { name: 'GURPS Mass Combat', key: 'mass-combat', abbreviation: 'MC' },
] as const;
