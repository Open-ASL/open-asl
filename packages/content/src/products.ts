/**
 * The products scenario cards come from. Scenarios name one by id (`ScenarioDef.product`);
 * the lobby filters by it. Add a product here before encoding its scenarios.
 */
export type ProductSeries = 'starter-kit' | 'core' | 'historical' | 'action-pack' | 'journal' | 'third-party' | 'other';

export interface ProductDef {
  id: string;
  name: string;
  /** Short label for chips and codes. */
  short: string;
  series: ProductSeries;
  publisher: string;
  /** Four-digit year of first publication, when known. */
  year?: number;
}

export const SERIES_NAME: Record<ProductSeries, string> = {
  'starter-kit': 'Starter Kits',
  core: 'Core modules',
  historical: 'Historical modules',
  'action-pack': 'Action Packs',
  journal: 'Journals and annuals',
  'third-party': 'Third-party',
  other: 'Other',
};

const MMP = 'Multi-Man Publishing';
const AH = 'Avalon Hill';

export const PRODUCTS: ProductDef[] = [
  // Starter Kits
  { id: 'sk1', name: 'ASL Starter Kit #1', short: 'SK1', series: 'starter-kit', publisher: MMP, year: 2004 },
  { id: 'sk2', name: 'ASL Starter Kit #2: Guns', short: 'SK2', series: 'starter-kit', publisher: MMP, year: 2005 },
  { id: 'sk3', name: 'ASL Starter Kit #3: Tanks', short: 'SK3', series: 'starter-kit', publisher: MMP, year: 2007 },
  { id: 'sk4', name: 'ASL Starter Kit #4: Pacific Theater of Operations', short: 'SK4', series: 'starter-kit', publisher: MMP, year: 2017 },
  { id: 'sk-ep1', name: 'ASL Starter Kit Expansion Pack #1', short: 'SK EP1', series: 'starter-kit', publisher: MMP, year: 2010 },
  { id: 'sk-bp1', name: 'ASL Starter Kit Bonus Pack #1', short: 'SK BP1', series: 'starter-kit', publisher: MMP },
  { id: 'sk-bp2', name: 'ASL Starter Kit Bonus Pack #2', short: 'SK BP2', series: 'starter-kit', publisher: MMP },
  /** Scenario cards MMP publishes free at mmpgamers.com/aslsk-downloads-ezp-6. */
  { id: 'sk-dl', name: 'ASL Starter Kit downloads (free from MMP)', short: 'SK DL', series: 'starter-kit', publisher: MMP },
  // Core modules
  { id: 'bv', name: 'Beyond Valor', short: 'BV', series: 'core', publisher: AH, year: 1985 },
  { id: 'pb', name: 'Paratrooper', short: 'PB', series: 'core', publisher: AH, year: 1986 },
  { id: 'yanks', name: 'Yanks', short: 'Yanks', series: 'core', publisher: AH, year: 1987 },
  { id: 'partisan', name: 'Partisan!', short: 'Partisan', series: 'core', publisher: AH, year: 1987 },
  { id: 'woa', name: 'West of Alamein', short: 'WoA', series: 'core', publisher: AH, year: 1988 },
  { id: 'tlh', name: 'The Last Hurrah', short: 'TLH', series: 'core', publisher: AH, year: 1988 },
  { id: 'hl', name: 'Hollow Legions', short: 'HL', series: 'core', publisher: AH, year: 1989 },
  { id: 'cob', name: 'Code of Bushido', short: 'CoB', series: 'core', publisher: AH, year: 1990 },
  { id: 'gh', name: 'Gung Ho!', short: 'GH', series: 'core', publisher: AH, year: 1992 },
  { id: 'cdg', name: 'Croix de Guerre', short: 'CdG', series: 'core', publisher: AH, year: 1993 },
  { id: 'db', name: 'Doomed Battalions', short: 'DB', series: 'core', publisher: AH, year: 1998 },
  { id: 'ao', name: 'Armies of Oblivion', short: 'AoO', series: 'core', publisher: MMP, year: 2006 },
  { id: 'fkac', name: 'For King and Country', short: 'FKaC', series: 'core', publisher: MMP, year: 2004 },
  { id: 'rs', name: 'Rising Sun', short: 'RS', series: 'core', publisher: MMP, year: 2013 },
  { id: 'hp', name: 'Hakkaa Päälle!', short: 'HP', series: 'core', publisher: MMP, year: 2015 },
  { id: 'fw', name: 'Forgotten War', short: 'FW', series: 'core', publisher: MMP, year: 2017 },
  // Third-party: free scenarios by other designers.
  { id: 'lma', name: 'Laurent Martin Starter Kit scenarios', short: 'Laurent Martin', series: 'third-party', publisher: 'Laurent Martin' },
  // House: Open ASL's own demo scenarios, listed in the atlas under their own product.
  { id: 'demo', name: 'Open ASL', short: 'Open ASL', series: 'other', publisher: 'Open ASL' },
];

export const productById = (id: string | undefined): ProductDef | undefined => PRODUCTS.find((p) => p.id === id);
