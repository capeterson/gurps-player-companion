/** Common GURPS Fourth Edition books, with the combined revised Basic Set.
 * Abbreviations follow the GCS page-reference list.
 * https://gurpscharactersheet.com/page_references
 */
export const DEFAULT_CAMPAIGN_SOURCES = [
  {
    name: 'GURPS Basic Set, Fourth Edition Revised',
    abbreviation: 'B',
    edition: 'Fourth Edition Revised',
  },
  { name: 'GURPS Magic', abbreviation: 'M' },
  { name: 'GURPS Martial Arts', abbreviation: 'MA' },
  { name: 'GURPS Powers', abbreviation: 'P' },
  { name: 'GURPS Fantasy', abbreviation: 'F' },
  { name: 'GURPS Space', abbreviation: 'S' },
  { name: 'GURPS Low-Tech', abbreviation: 'LT' },
  { name: 'GURPS High-Tech', abbreviation: 'HT' },
  { name: 'GURPS Ultra-Tech', abbreviation: 'UT' },
  { name: 'GURPS Bio-Tech', abbreviation: 'BT' },
  { name: 'GURPS Thaumatology', abbreviation: 'T' },
  { name: 'GURPS Social Engineering', abbreviation: 'SE' },
  { name: 'GURPS Horror', abbreviation: 'H' },
  { name: 'GURPS Supers', abbreviation: 'SU' },
  { name: 'GURPS Psionic Powers', abbreviation: 'PSI' },
  { name: 'GURPS Mass Combat', abbreviation: 'MC' },
] as const;
