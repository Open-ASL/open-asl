/*
 * The words on the chart binder (Charts.tsx): DRM lists, notes and the sequence of play.
 * Our own wording, kept short for the screen, with the rule number beside each line
 * (SK1 = ASLSK#1 2025, SK4 = ASLSK#4 2021). The tables the engine rolls against are not here:
 * Charts.tsx reads those from @asl/content so the two can never disagree.
 */

/** A DRM row, or a sub-heading row. */
export type Drm = { group: string } | DrmRow;
export interface DrmRow {
  /** The DRM or value, as printed in the left column: "+1", "−2", "×½", "±L". */
  v?: string;
  label: string;
  ref?: string;
  /** A second, smaller line under the label. */
  note?: string;
}
export interface DrmList {
  title: string;
  ref?: string;
  rows: Drm[];
  foot?: string;
}
export interface Bullet {
  lead?: string;
  text: string;
  ref?: string;
}

// ------------------------------------------------------------------------------------ Infantry Fire

export const IFT_RESULTS: { code: string; kind: string; text: string }[] = [
  { code: '#KIA', kind: 'KIA', text: '# targets (random) eliminated; the rest break, or take Casualty Reduction if already broken.' },
  { code: 'K/#', kind: 'K', text: 'One target (random) takes Casualty Reduction; every other target takes a Morale Check at +#.' },
  { code: '#MC', kind: 'MC', text: 'Every target takes a Morale Check, adding # to the DR.' },
  { code: 'NMC', kind: 'NMC', text: 'Every target takes an unmodified Morale Check.' },
  { code: 'PTC', kind: 'PTC', text: 'Every unbroken, unpinned target rolls against its Morale or is Pinned.' },
  { code: '–', kind: 'none', text: 'No effect (broken targets in the hex may still gain DM).' },
];

export const FIRE_LISTS: DrmList[] = [
  {
    title: 'IFT DRM',
    ref: 'SK1 3.2',
    rows: [
      { v: '±L', label: 'Leader directing the fire', ref: 'SK1 3.2', note: 'One unit or Fire Group per Player Turn; never with a FT' },
      { v: '+TEM', label: 'Terrain of the target hex', ref: 'SK1 1.1.1' },
      { v: '+1', label: 'Per Hindrance hex between firer and target', ref: 'SK1 2.0', note: 'Orchard, grain, brush; not the firer’s or target’s own hex' },
      { v: '+2', label: 'Per Smoke hex in or along the LOS', ref: 'SK1 3.3', note: '+3 firing out of a Smoke hex' },
      { v: '−1', label: 'FFMO: moving target in Open Ground', ref: 'SK1 3.3.1', note: 'Cancelled by any Hindrance' },
      { v: '−1', label: 'FFNAM: moving target not Assault Moving', ref: 'SK1 3.3.1' },
      { v: '+1', label: 'Firer or directing leader is CX', ref: 'SK1 3.3' },
      { v: '−1', label: 'Target carries a Flamethrower (each)', ref: 'SK1 4.2' },
      { v: '−2', label: 'Target is manhandling a Gun', ref: 'SK4 6.5', note: 'Hazardous Movement: no FFMO/FFNAM as well' },
      { v: '+1', label: 'Height Advantage: fired on from below', ref: 'SK4 1.1.1', note: 'Only with no other positive TEM; not vs mortars' },
      { v: '+2', label: 'Emplaced Gun and its crew', ref: 'SK4 6.3' },
      { v: '+2', label: 'Gunshield: crew fired on through its Covered Arc', ref: 'SK4 6.6', note: '+1 vs mortars; none vs FT' },
      { group: 'Notes' },
      { v: '≥+6', label: 'Hindrance + Smoke totalling +6 blocks the LOS', ref: 'SK1 3.2' },
      { v: '', label: 'FFMO/FFNAM: Defensive First Fire and Residual FP only', ref: 'SK1 3.4' },
      { v: '', label: 'FT ignores leadership and TEM', ref: 'SK1 4.2' },
    ],
  },
  {
    title: 'FP modifiers',
    ref: 'SK1 3.2',
    rows: [
      { v: '×2', label: 'Point Blank Fire: target adjacent', ref: 'SK1 3.2' },
      { v: '×½', label: 'Long range: beyond normal range, up to double', ref: 'SK1 3.2' },
      { v: '×½', label: 'Firing in the AFPh', ref: 'SK1 3.5' },
      { v: '×½', label: 'Pinned firer', ref: 'SK1 3.2.1' },
      { v: '×½', label: 'Subsequent First Fire', ref: 'SK1 3.3.1' },
      { v: '×½', label: 'Final Fire by a First Fire unit (adjacent only)', ref: 'SK1 3.4' },
      { v: '×½', label: 'Lone SMC firing a MG', ref: 'SK1 4.1' },
      { v: '×½', label: 'MG beyond 16 hexes with no leader directing', ref: 'SK1 4.1' },
      { v: '×½', label: 'Target concealed, or a hidden Gun', ref: 'SK4 8.3.2' },
      { v: '+1', label: 'Assault Fire: underlined-FP unit in the AFPh', ref: 'SK1 3.5', note: 'Added last, to its own FP; not beyond normal range' },
      { v: '−1 col', label: 'Cowering: original doubles, no leader directing', ref: 'SK1 3.2' },
      { v: '−2 col', label: 'Cowering with an Inexperienced MMC in the attack', ref: 'SK1 5.4' },
      { group: 'Notes' },
      { v: 'col', label: 'Fire on the highest column not above the total FP', ref: 'SK1 3.2.1' },
      { v: '', label: 'Halvings keep their fractions and all stack', ref: 'SK1 3.2' },
      { v: '½ col', label: 'Residual FP: half the column fired on, max 12', ref: 'SK1 3.3.1', note: 'One column less per positive DRM from outside the hex' },
      { v: '×½ ×2', label: 'Final Protective Fire: SFF and PBF together', ref: 'SK1 3.3.1', note: 'Then the firers take an NMC on the same DR' },
    ],
  },
];

export const SPECIAL_DR: Bullet[] = [
  { lead: 'Doubles', text: 'on MMC fire with no leader directing: the attack cowers.', ref: 'SK1 3.2' },
  { lead: '12', text: 'on a Morale Check: Casualty Reduction as well as breaking (eliminated if already broken).', ref: 'SK1 3.2.1' },
  { lead: '12', text: 'on a Rally DR: Casualty Reduction.', ref: 'SK1 3.1' },
  { lead: '2', text: 'on a first MMC self-rally or any MMC CC DR: roll for a new leader.', ref: 'SK1 5.3' },
  { lead: 'Exact pass', text: 'of a Morale Check (DR = Morale): the unit is Pinned.', ref: 'SK1 3.2.1' },
  { lead: '> ELR', text: 'failing an MC by more than ELR: the unit is replaced by a lesser one.', ref: 'SK1 5.1' },
  { lead: 'ROF', text: 'coloured die ≤ ROF: the weapon may fire again.', ref: 'SK1 1.2.4' },
  { lead: 'B#', text: 'original DR ≥ B# (12 if none printed): the weapon malfunctions. −2 in SFF or Final Fire after First Fire.', ref: 'SK1 4.1' },
  { lead: 'X#', text: 'FT removed after an original DR ≥ 10; DC used up after it attacks.', ref: 'SK1 4.2–4.3' },
  { lead: 'Repair', text: 'dr ≤ repair #; dr 6 destroys it.', ref: 'SK1 3.1' },
  { lead: 'Inexperienced', text: 'or captured: SW B#/X# lowered (−1 / −2), captured ROF −1.', ref: 'SK1 5.4–5.5' },
];

// ------------------------------------------------------------------------------------ Close Combat

export const CC_RESOLUTION: Bullet[] = [
  { lead: 'Below', text: 'the Kill #: every attacked unit is eliminated.', ref: 'SK1 3.8' },
  { lead: 'Equal to', text: 'the Kill #: one attacked unit (random) takes Casualty Reduction.', ref: 'SK1 3.8' },
  { lead: 'Above', text: 'the Kill #: no effect.', ref: 'SK1 3.8' },
  { text: 'Odds are attacker FP to defender FP; an SMC counts 1. No TEM, no SW, no PBF.', ref: 'SK1 3.8' },
  { text: 'Simultaneous unless there is an Ambush: the ATTACKER declares, the DEFENDER declares, then all attacks resolve.', ref: 'SK1 3.8' },
  { text: 'No unit attacks, or is attacked, more than once a CCPh. Unbroken units of both sides left in the hex: Melee.', ref: 'SK1 3.8' },
];

export const CC_LISTS: DrmList[] = [
  {
    title: 'CC DRM',
    ref: 'SK1 3.8',
    rows: [
      { v: '±L', label: 'Leader adding to his MMC’s attack (not when alone)', ref: 'SK1 3.8' },
      { v: '−2', label: 'Attacking broken units', ref: 'SK1 3.8', note: 'Broken units only defend' },
      { v: '+1', label: 'Attacker is CX', ref: 'SK1 3.3' },
      { v: '−1', label: 'Attacking a CX unit', ref: 'SK1 3.3' },
      { v: '−1', label: 'Ambusher attacking', ref: 'SK1 3.8' },
      { v: '+1', label: 'Attacking an ambusher', ref: 'SK1 3.8' },
      { v: '×½', label: 'Pinned unit’s FP', ref: 'SK1 3.2.1' },
    ],
  },
  {
    title: 'Ambush',
    ref: 'SK1 3.8',
    foot: 'Checked when Advancing into CC in woods or a building (any terrain if a side is concealed). Each side rolls a dr; one at least 3 lower ambushes, and resolves its attacks first.',
    rows: [
      { v: '+1', label: 'CX', ref: 'SK1 3.8' },
      { v: '+1', label: 'Pinned', ref: 'SK1 3.8' },
      { v: '+1', label: 'Inexperienced', ref: 'SK1 5.4' },
      { v: '±L', label: 'One leader (if not alone)', ref: 'SK1 3.8' },
      { v: '−2', label: 'Concealed', ref: 'SK4 8.3.2' },
    ],
  },
];

// ------------------------------------------------------------------------------------ Morale & Rally

export const MORALE_LISTS: DrmList[] = [
  {
    title: 'Morale Check',
    ref: 'SK1 3.2.1',
    rows: [
      { v: 'DR ≤ M', label: 'Pass: roll at or under current Morale', ref: 'SK1 3.2.1' },
      { v: 'fail', label: 'Break: flip, mark DM; Pin and CX removed', ref: 'SK1 3.2.1', note: 'Broken unit failing: Casualty Reduction instead' },
      { v: '±L', label: 'Leader’s modifier for others, if he passed unpinned', ref: 'SK1 3.2.1', note: 'Best leader checks first; never applies to himself' },
      { v: 'LLMC', label: 'Leader killed: lower-Morale units take an NMC', ref: 'SK1 3.2.1' },
      { v: 'LLTC', label: 'Leader broken: lower-Morale units take a PTC', ref: 'SK1 3.2.1' },
      { group: 'Pinned' },
      { v: '×½', label: 'FP halved, no movement, no ROF, no leadership', ref: 'SK1 3.2.1', note: 'Removed at the end of the CCPh' },
    ],
  },
  {
    title: 'Rally',
    ref: 'SK1 3.1',
    foot: 'One attempt per unit per Player Turn. Boxed-Morale units may self-rally, and the ATTACKER may try with one other MMC; no self-rally beside a Good Order leader (ASL A10.63).',
    rows: [
      { v: '±L', label: 'Rallying leader', ref: 'SK1 3.1f' },
      { v: '−1', label: 'In woods or a building', ref: 'SK1 3.1f' },
      { v: '+4', label: 'Under Desperation Morale (DM)', ref: 'SK1 3.1f' },
      { v: '+1', label: 'Self-rally (a leader can’t use his own modifier)', ref: 'SK1 3.1e' },
      { v: 'DM', label: 'DM removed at end of RPh unless next to a Known Enemy', ref: 'SK1 3.1g' },
    ],
  },
];

/** The drm the engine applies (packages/content tables.ts leaderCreation). */
export const LEADER_CREATION_DRM: Drm[] = [
  { group: 'drm' },
  { v: '−1', label: 'American, British or German', ref: 'SK1 5.3' },
  { v: '+1', label: 'Russian or Italian', ref: 'SK1 5.3' },
  { v: '−1', label: 'Per CC odds column below 1-1', ref: 'SK4 3.8' },
  { v: '+1', label: 'Creating unit’s Morale ≤ 6', ref: 'SK1 5.3' },
  { v: '+1', label: 'Creating unit was broken', ref: 'SK1 5.3' },
];

export const WOUNDS: DrmList = {
  title: 'Wounds',
  ref: 'SK1 3.2.1',
  foot: 'Wounded: 3 MF, no portage, no Double Time, Morale and leadership one worse.',
  rows: [
    { v: '1–4', label: 'Wounded: place a Wound counter', ref: 'SK1 3.2.1' },
    { v: '5–6', label: 'Eliminated', ref: 'SK1 3.2.1' },
    { v: '+1', label: 'Already wounded', ref: 'SK1 3.2.1' },
  ],
};

// ------------------------------------------------------------------------------------ Movement & Rout

export const MF_PP = {
  ref: 'SK1 3.3, 4.0',
  columns: ['Alone', 'Alone CX', 'With leader', 'CX + leader'],
  rows: [
    { pp: '≤ 2', mf: ['4', '6', '6', '8'] },
    { pp: '3', mf: ['4', '5', '6', '7'] },
    { pp: '4', mf: ['3', '4', '6', '6'] },
    { pp: '5', mf: ['2', '3', '5', '5'] },
    { pp: '6', mf: ['1', '2', '4', '4'] },
    { pp: '7', mf: ['0', '1', '3', '3'] },
  ],
  foot: 'An MMC carries 3 PP free (2 when CX) and spends 1 MF per PP over that. A leader moving with it adds his 1 PP (none when he is CX too). CX + leader assumes both are CX. Inexperienced MMC: 1 MF less. SMC: 6 MF (8 CX), 1 PP free, 2 PP at most.',
};

export const MOVEMENT: Bullet[] = [
  { lead: '4 MF', text: 'MMC; 6 MF SMC (3 wounded); 3 MF Inexperienced MMC.', ref: 'SK1 3.3, 5.4' },
  { lead: '+2 MF', text: 'MMC starting and ending with a leader, moving as one stack.', ref: 'SK1 3.3' },
  { lead: 'Double Time', text: '+2 MF, declared at the start; the unit becomes CX.', ref: 'SK1 3.3' },
  { lead: 'Road', text: '+1 MF if every hexside crossed this phase is a road.', ref: 'SK1 1.1.1' },
  { lead: 'Assault Move', text: 'one hex only, not all MF: no FFNAM.', ref: 'SK1 3.3' },
  { lead: 'Smoke', text: '+1 MF to enter. Grenades: 1 MF own hex, 2 adjacent; dr ≤ exponent.', ref: 'SK1 3.3' },
  { lead: 'Stacking', text: '3 squads (or equivalent) plus 4 SMC per side per hex.', ref: 'SK1 3.3' },
  { lead: 'Advance', text: 'one hex in the APh, into enemy hexes too; becomes CX if it takes all MF.', ref: 'SK1 3.7' },
];

export const ROUT: Bullet[] = [
  { text: 'Only units under DM rout. A broken unit must rout if adjacent to a Known Enemy, or in Open Ground where it could be Interdicted.', ref: 'SK1 3.6' },
  { lead: '6 MF', text: '(3 wounded SMC), never more.', ref: 'SK1 3.6' },
  { text: 'Head for the nearest woods or building within 6 MF and stop there; one no farther from the enemy may be ignored.', ref: 'SK1 3.6' },
  { text: 'Never closer to a Known Enemy in LOS, and never adjacent again to one it is already next to.', ref: 'SK1 3.6' },
  { lead: 'Low Crawl', text: 'one hex for all MF; cannot be Interdicted.', ref: 'SK1 3.6' },
  { text: 'A unit that must rout and cannot is eliminated. SW over portage is dropped first.', ref: 'SK1 3.6' },
  { lead: 'Interdiction', text: 'routing into Open Ground in LOS and normal range of a Good Order enemy: NMC; failure is Casualty Reduction.', ref: 'SK1 3.6' },
];

// ------------------------------------------------------------------------------------ Terrain

export const TERRAIN_NOTES: Record<string, string> = {
  open: 'FFMO and Interdiction apply.',
  woods: 'Rout and rally shelter. Mortars: Air Burst −1 instead of +1.',
  orchard: 'Inherent: hexsides count. No FFMO.',
  grain: 'June–September only; Open Ground otherwise. No FFMO.',
  brush: 'No FFMO.',
  'building-stone': 'Rout and rally shelter. No mortar fire from inside.',
  'building-wood': 'Rout and rally shelter.',
};

export const TERRAIN_EXTRA: { name: string; mf: string; tem: string; los: string; notes: string }[] = [
  { name: 'Road', mf: '1', tem: '0', los: '—', notes: 'Open Ground. +1 MF road bonus.' },
  { name: 'Woods-Road', mf: '1 / 2', tem: '0 / +1', los: 'Obstacle', notes: 'On the road: road rate, no woods TEM, FFMO possible.' },
  { name: 'Orchard-Road', mf: '1', tem: '0', los: 'Hindrance', notes: 'A LOS along the road is not hindered. On the road: FFMO possible; the orchard instead forfeits the road bonus.' },
  { name: 'Hill (uphill)', mf: '×2', tem: '+1 HA', los: 'Obstacle', notes: 'Crossing a Crest Line upward doubles the cost. Bare hill is Open Ground.' },
  { name: 'Smoke', mf: '+1', tem: '—', los: '+2 / +3', notes: 'Inherent Hindrance.' },
];

export const TERRAIN_LISTS: DrmList[] = [
  {
    title: 'Hills',
    ref: 'SK4 1.1.1',
    rows: [
      { v: '+1', label: 'Height Advantage: fired on from a lower level', ref: 'SK4 1.1.1', note: 'Only with no other positive TEM; not vs mortars. Negates FFMO and Interdiction.' },
      { v: 'LOS', label: 'A hill blocks LOS for any unit not on it', ref: 'SK4 1.1.1' },
      { v: 'LOS', label: 'Two hill units see over ground-level terrain', ref: 'SK4 1.1.1' },
      { v: 'LOS', label: 'A one-level obstacle on a hill counts as two', ref: 'SK4 1.1.1' },
      { v: 'LOS', label: 'Looking down: leave through a Crest Line, cross no other', ref: 'SK4 1.1.1' },
    ],
  },
  {
    title: 'Line of Sight',
    ref: 'SK1 3.2',
    rows: [
      { v: '', label: 'Traced centre dot to centre dot', ref: 'SK1 2.0' },
      { v: '', label: 'Firer’s and target’s own hexes never block', ref: 'SK1 3.2' },
      { v: '≥+6', label: 'Hindrances totalling +6 block the LOS', ref: 'SK1 3.2' },
      { v: '−1', label: 'Woods or building: rally DRM', ref: 'SK1 3.1f' },
    ],
  },
];

// ------------------------------------------------------------------------------------ Guns

export const TH_KEY: Bullet[] = [
  { lead: 'Hit', text: 'when the final TH DR is ≤ the TH#. Critical Hit on ITT when it is ≤ the bracketed CH#; on ATT on an original 2.', ref: 'SK4 3.2.4, 6.1' },
  { lead: 'Red', text: 'numbers (after the slash) are used for Area Target Type, captured or non-qualified use, and Russian, Italian and pre-1944 American Guns.', ref: 'SK4 3.2.4' },
  { lead: 'FP column', text: 'is the IFT column of a hit: Infantry Target / Area Target / Critical Hit.', ref: 'SK4 3.2.4' },
];

export const GUN_LISTS: DrmList[] = [
  {
    title: 'To Hit DRM',
    ref: 'SK4 3.2.4',
    rows: [
      { group: 'Firer' },
      { v: '+2', label: 'Firing in the AFPh (Gun that did not move)', ref: 'SK4 3.5' },
      { v: '+2', label: 'Pinned crew', ref: 'SK4 3.2.4' },
      { v: '+2', label: 'Non-qualified use (fired by a squad or HS)', ref: 'SK4 3.2.4' },
      { v: '+2', label: 'Captured Gun', ref: 'SK4 5.5' },
      { v: '+1', label: 'CX firer', ref: 'SK4 3.3.1' },
      { v: '+2', label: 'Intensive Fire', ref: 'SK4 3.2.4' },
      { v: '+CA', label: 'Covered Arc change, first shot after it', ref: 'SK4 3.2.4', note: 'Per hexspine: 360° mount +1 each; others +3, then +1 each. ×2 in woods or a building.' },
      { v: '+2', label: 'LATW (Bazooka): avoiding Backblast in a building; firing in the AFPh (each)', ref: 'SK4 4.4.3' },
      { group: 'Target' },
      { v: '+TEM', label: 'Target terrain (Infantry Target Type only)', ref: 'SK4 3.2.4' },
      { v: '+H', label: 'Hindrances', ref: 'SK4 3.2.4' },
      { v: '−1', label: 'FFMO, FFNAM (each)', ref: 'SK4 3.2.4' },
      { v: '−1/−2', label: 'Acquired target (not for a LATW)', ref: 'SK4 6.10' },
      { v: '−2', label: 'Target in Hazardous Movement', ref: 'SK4 6.5' },
      { v: '∓1', label: 'Large target −1, small target +1', ref: 'SK4 6.7' },
      { v: '+2', label: 'Concealed, hidden, or firing at an empty hex', ref: 'SK4 8.3.2, 6.4' },
    ],
  },
  {
    title: 'Gun Manhandling',
    ref: 'SK4 6.5',
    foot: 'DR below M#: enter and carry on. Equal: enter and stop. Above: no movement. Double MF cost, no Assault Move, no road bonus; the Gun loses Emplacement.',
    rows: [
      { v: '+TEM', label: 'TEM of the hex entered', ref: 'SK4 6.5' },
      { v: '+MF', label: 'MF spent to enter it', ref: 'SK4 6.5' },
      { v: '−1', label: 'Per extra crew or HS helping', ref: 'SK4 6.5' },
      { v: '−2', label: 'Per extra squad helping (−4 at most)', ref: 'SK4 6.5' },
      { v: '−2', label: 'Crossing a road hexside', ref: 'SK4 6.5' },
    ],
  },
];

// ------------------------------------------------------------------------------------ Vehicles

export const VEHICLE_LISTS: DrmList[] = [
  {
    title: 'To Hit DRM, vehicles',
    ref: 'SK4 3.2.4 cases 13–16, 22, 24, 25',
    rows: [
      { group: 'Firing vehicle' },
      { v: '+1', label: 'Buttoned Up', ref: 'case 13' },
      { v: '+1', label: 'Stunned crew (+1 marker)', ref: 'case 15' },
      { v: '+4/+5/+6', label: 'Bounding First Fire, turret: more than 3 / 2½–3 / ≤ 2 MP spent in the target\'s LOS', ref: 'case 14', note: 'Non-turreted +5/+6/+7. Fire in the AFPh after moving, and fire in Motion, use the first column.' },
      { v: '×2', label: 'Non-Stopped or Motion firer: the lower die is doubled', ref: 'case 16', note: 'Plus +2 at 1 hex, +1 at 2 hexes on the Infantry Target Type. No acquisition.' },
      { v: '+CA', label: 'Covered Arc change, first shot after it', ref: 'case 8', note: 'Per hexspine: T +1 each; ST, RST, 1MT +2 then +1; NT +3 then +1. Never for Bounding First Fire.' },
      { group: 'Vehicle target' },
      { v: '∓1/∓2', label: 'Target size: Large −1, Very Large −2, Small +1, Very Small +2', ref: 'case 22' },
      { v: '+2', label: 'Target in Motion, or moved more than 3 MP in the firer\'s LOS', ref: 'case 24' },
      { v: '+3/+4', label: 'Target moved ≤ 3 / ≤ 1 MP in the firer\'s LOS', ref: 'case 24' },
      { v: '−2/−1', label: 'Stopped vehicle at 1 / 2 hexes', ref: 'case 25', note: 'Not from a Non-Stopped or Motion firer, not on the Area Target Type, not for a LATW other than an ATR.' },
      { v: '+2', label: 'Crew Exposed vehicle attacked on the IFT (crew only)', ref: 'SK4 7.7' },
      { v: '+1', label: 'Infantry sharing a hex with a friendly AFV or wreck, when no other positive TEM applies', ref: 'SK4 7.6' },
    ],
  },
  {
    title: 'AFV Destruction Table',
    ref: 'SK4 7.3',
    foot: 'Final TK# = TK# (+1 vs the rear) × 2 on a Critical Hit, minus the AF of the aspect hit. Hull or turret: colored die < white die hits the turret. An original 12 is a dud.',
    rows: [
      { v: '< TK', label: 'Eliminated: the vehicle burns as a wreck' },
      { v: '= TK', label: 'Hull hit: Immobilized. Turret hit: Shock', note: 'A MG hit equal to its TK# Stuns the crew instead.' },
      { v: 'TK+1', label: 'HE: Immobilized (hull) or Shock (turret). AP, APCR, HEAT: Possible Shock, a NTC on the crew morale' },
      { group: 'Crew Exposed crew, same DR on the IFT' },
      { v: 'KIA, K', label: 'STUN: Buttoned Up for the rest of the game and Recalled; +1 to its fire thereafter', ref: 'SK4 7.7' },
      { v: 'MC failed', label: 'Stun: Buttoned Up, no move or fire this Player Turn, then +1 to its fire', ref: 'SK4 7.7' },
      { v: 'PTC failed', label: 'Buttoned Up for the rest of the Player Turn', ref: 'SK4 7.7' },
    ],
  },
  {
    title: 'Close Combat with vehicles',
    ref: 'SK4 3.7, 3.8, 3.3.4',
    foot: 'Attacks are declared one at a time (non-vehicular player first). An MMC advancing into an enemy AFV\'s hex, placing a DC on one or Reaction Firing at one first passes a PAATC: DR ≤ morale (leader DRM; +1 Inexperienced, non-elite Italian, Allied or Axis Minor), a failure pins it.',
    rows: [
      { group: 'Infantry vs a vehicle: DR < CCV destroys, = CCV Immobilizes' },
      { v: '5/4/3/2', label: 'CCV of a squad / crew / half-squad / SMC; +1 when a SMC joins an MMC (at most two units, one a SMC)' },
      { v: '−1', label: 'CCV per Area Fire reason (pinned); CC Reaction Fire by a unit that already fired' },
      { v: '−1', label: 'vs Crew Exposed AFV', ref: 'SK4 3.8' },
      { v: '+2', label: 'vs Motion or Non-Stopped vehicle' },
      { v: '−1', label: 'vs immobile AFV; vs a vehicle without a usable MG (a BMG counts)' },
      { v: '−2', label: 'vs Open-Topped AFV', ref: 'SK4 7.13' },
      { v: '±L', label: 'Leadership (a SMC attacking with the MMC); ambush ∓1' },
      { v: '2', label: 'An original 2 that could not succeed rolls a third die: 1-2 destroyed, 3 Immobilized; an original 12 is a Casualty Reduction for the attacker' },
      { group: 'A vehicle vs Infantry: MG/IFE FP at odds against their CCV' },
      { v: 'FP', label: 'CMG (turreted), AAMG when CE, RMG, turreted IFE ≤ 15mm; ½ in Motion; nothing when Shocked or Stunned' },
      { v: '+1', label: 'Stunned crew (+1 marker)', ref: 'SK4 7.10' },
      { group: 'Melee' },
      { v: '—', label: 'A vehicle is never held in Melee; it holds enemy Infantry unless in Motion, and fires only into its hex while it stays. AFVs never attack each other in CC.' },
    ],
  },
  {
    title: 'Bog Check',
    ref: 'SK4 7.6',
    foot: 'DR + DRM ≥ 12 bogs the vehicle: it stops at once. To free itself at the start of a later move: colored × white MP spent, 1–4 freed, 5 Mired, 6 Immobilized.',
    rows: [
      { v: '+1/+2', label: 'Normal / high ground pressure (none for low)' },
      { v: '+1', label: 'Not fully tracked' },
      { v: '+3', label: 'Woods or wooden building entered at half MP' },
      { v: '+4', label: 'Stone building entered at half MP' },
      { v: '+1', label: 'Gaining elevation into woods' },
    ],
  },
  {
    title: 'Vehicle MP costs',
    ref: 'SK4 3.3.2, 1.1.1',
    foot: 'A vehicle may always move one hex by spending every MP. 1 MP to start, 1 to stop; 1 MP per hexspine of hull turn (2 and a Bog Check in woods or a building); turning the turret costs no MP, the first shot after it takes the Covered Arc DRM.',
    rows: [
      { v: '1', label: 'Open Ground, orchard, grain (Armored Car 3, grain 4)' },
      { v: '2', label: 'Brush (Armored Car 4)' },
      { v: '½ / all', label: 'Woods: half its MP with a Bog Check, or every MP left (Armored Car: all)' },
      { v: '½', label: 'Building: fully tracked and Buttoned Up only, with a Bog Check' },
      { v: '½ / 1', label: 'Road hexside, Crew Exposed / Buttoned Up' },
      { v: '+4', label: 'Up a crest line (+2 by road)' },
      { v: '+1', label: 'Per other vehicle or wreck in the hex (+2 by road; doubled in woods); +1 for Smoke' },
    ],
  },
];

export const TK_KEY: Bullet[] = [
  { lead: 'AP', text: 'the black number; APCR or APDS in brackets. The Russian 76L has its own row; a MG MA uses the MG row at any range.', ref: 'SK4 7.3' },
  { lead: 'HE', text: 'by caliber: 20+ 3, 30+ 4, 40+ 5, 50+ 6, 70+ 7, 80+ 8, 100+ 10, 120+ 12, 150+ 16. A Flamethrower 8, a DC 16 (placed against an AFV).', ref: 'SK4 7.3' },
  { lead: 'HEAT', text: 'by caliber, range not counted: 37 26, 75–76 13, 95 16, 105 15, 122 17; a LATW carries its own (BAZ43 13, BAZ44/45 16, PSK 26, PF 31).', ref: 'SK4 4.4, 7.3' },
  { lead: 'Area Target hit', text: 'on the IFT at half the FP column, −1 DRM against a vehicle whose every AF is ≤ 4 and +1 when every AF is ≥ 8; KIA kills, a K result or the one above it Shocks (turret) or Immobilizes (hull).', ref: 'SK4 7.11' },
];

export const GUN_PROCESS: Bullet[] = [
  { lead: 'Infantry Target', text: 'HE: TEM goes on the To Hit DR; a hit attacks the hex on the ITT column.', ref: 'SK4 3.2.4' },
  { lead: 'Area Target', text: 'red TH#, no TEM on the To Hit DR (it goes on the IFT), FP halved; not at range 0.', ref: 'SK4 3.2.4' },
  { lead: 'Critical Hit', text: 'HE FP doubled; positive TEM becomes negative. Kills a Gun outright.', ref: 'SK4 6.1' },
  { lead: 'ROF', text: 'lost on SFF, AFPh fire, a pinned crew, or non-mortar Area Target fire.', ref: 'SK4 1.2.4.1' },
  { lead: 'Intensive Fire', text: 'one more shot after ROF is lost: +2 TH, B# −2. Not in the AFPh.', ref: 'SK4 3.2.4' },
  { lead: 'Malfunction', text: 'original TH DR ≥ B# (12 if none). Repair dr 1; dr 6 removes it.', ref: 'SK4 6.12' },
  { lead: 'Gun hit', text: 'KIA: Gun and crew destroyed. K: Gun malfunctions, crew reduced. Else a Near Miss (gunshield applies).', ref: 'SK4 6.7' },
  { lead: 'Emplaced', text: 'a Gun that has not moved: +2 TEM and may set up hidden.', ref: 'SK4 6.3–6.4' },
];

// ------------------------------------------------------------------------------------ Sequence of Play

export const SEQUENCE: { abbr: string; name: string; who: string; ref?: string; steps: Bullet[] }[] = [
  {
    abbr: 'RPh',
    name: 'Rally Phase',
    who: 'Both, ATTACKER first',
    ref: 'SK1 3.1',
    steps: [
      { text: 'Reinforcements set up offboard.' },
      { text: 'Recover SW (dr < 6), repair malfunctioned ones, transfer SW within a stack.' },
      { text: 'Self-rally, then leaders rally. DM removed where no Known Enemy is adjacent.' },
    ],
  },
  {
    abbr: 'PFPh',
    name: 'Prep Fire',
    who: 'ATTACKER',
    ref: 'SK1 3.2.2',
    steps: [
      { text: 'Fire and mark Prep Fire: those units cannot move this turn.' },
      { text: 'Guns fire on the To Hit chart; ordnance Smoke first. Owner’s Smoke dispersed or removed.', ref: 'SK4' },
    ],
  },
  {
    abbr: 'MPh',
    name: 'Movement',
    who: 'ATTACKER moves',
    ref: 'SK1 3.3',
    steps: [
      { text: 'Move one stack at a time; Smoke grenades and SW recovery along the way.' },
      { text: 'DEFENDER may Defensive First Fire, then Subsequent First Fire, then Final Protective Fire.', ref: 'SK1 3.3.1' },
      { text: 'Residual FP attacks anything entering. Grenade Smoke removed at the end.' },
    ],
  },
  {
    abbr: 'DFPh',
    name: 'Defensive Fire',
    who: 'DEFENDER',
    ref: 'SK1 3.4',
    steps: [
      { text: 'Final Fire: any unit not yet fired; First Fire units only at adjacent hexes, half FP.' },
      { text: 'No FFMO or FFNAM. First and Final Fire counters removed at the end.' },
    ],
  },
  {
    abbr: 'AFPh',
    name: 'Advancing Fire',
    who: 'ATTACKER',
    ref: 'SK1 3.5',
    steps: [
      { text: 'Units that did not Prep Fire fire at half FP; Assault Fire applies.' },
      { text: 'Moved MMG/HMG, Guns and mortars cannot fire. Ordnance +2 TH, no ROF.', ref: 'SK4 3.5' },
      { text: 'Prep Fire counters removed.' },
    ],
  },
  {
    abbr: 'RtPh',
    name: 'Rout',
    who: 'ATTACKER first',
    ref: 'SK1 3.6',
    steps: [{ text: 'Mark DM on units that must rout; broken units rout, risking Interdiction.' }],
  },
  {
    abbr: 'APh',
    name: 'Advance',
    who: 'ATTACKER',
    ref: 'SK1 3.7',
    steps: [{ text: 'Transfer SW, then move one hex, into enemy hexes as well. CX if it takes all MF. Guns stay put.' }],
  },
  {
    abbr: 'CCPh',
    name: 'Close Combat',
    who: 'Both',
    ref: 'SK1 3.8',
    steps: [{ text: 'Ambush, declare, resolve; Melee where both sides remain. Pins removed at the end.' }],
  },
  {
    abbr: 'Turn',
    name: 'Turn Record',
    who: 'Both',
    ref: 'SK1 3.9',
    steps: [{ text: 'Sides swap ATTACKER and DEFENDER; the turn marker moves on after the second player turn.' }],
  },
];

// ------------------------------------------------------------------------------------ AFV counter

/**
 * How a mark is printed on the counter, so the key can draw it: boxed, circled, red, on a white disc,
 * over- or underlined; or one of the MP backgrounds that say what kind of vehicle it is.
 */
export type MarkStyle =
  | 'sq' | 'ring' | 'red' | 'disc' | 'over' | 'under' | 'rof' | 'rofWhite'
  | 'tracked' | 'truck' | 'ht' | 'ac' | 'sledge';
export interface Mark {
  t: string;
  s?: MarkStyle;
  /** Printed before the mark, unstyled ("B" before a circled B#). */
  pre?: string;
  /** Superscript after it ("s" for amphibious MP, "R#" for a rear MG). */
  sup?: string;
}
export interface AfvKeyRow {
  m: Mark[];
  label: string;
  ref?: string;
}
/** One area of the counter: its number on the diagram, an example as printed, and the key to its marks. */
export interface AfvKey {
  n: number;
  title: string;
  ref?: string;
  example: { m: Mark[]; text: string };
  rows: AfvKeyRow[];
  notes?: string[];
}

/** The AFV counter, area by area (after Neal Ulen's AFV Cheat Sheet v1.3; rule numbers are the ASLRB's, SK4 beside). */
export const AFV_KEYS: AfvKey[] = [
  {
    n: 1,
    title: 'Vehicle identifier',
    ref: 'SK4 7.6',
    example: { m: [{ t: 'A', s: 'sq' }], text: 'Identifier, low ground pressure' },
    rows: [
      { m: [{ t: '#' }], label: 'Normal ground pressure', ref: 'D1.42' },
      { m: [{ t: '#', s: 'sq' }], label: 'Low ground pressure', ref: 'D1.41' },
      { m: [{ t: '#', s: 'ring' }], label: 'High ground pressure', ref: 'D1.43' },
    ],
  },
  {
    n: 2,
    title: 'Movement',
    ref: 'SK4 1.2.7, 3.3.2',
    example: { m: [{ t: '13', s: 'tracked' }], text: '13 MP, Fully Tracked' },
    rows: [
      { m: [{ t: '13', s: 'tracked' }], label: 'Fully Tracked', ref: 'D1.13' },
      { m: [{ t: '13', s: 'ht' }], label: 'Half-Track', ref: 'D1.14' },
      { m: [{ t: '13', s: 'truck' }], label: 'Truck', ref: 'D1.15' },
      { m: [{ t: '13', s: 'ac' }], label: 'Armored Car', ref: 'D1.12' },
      { m: [{ t: '13', s: 'sledge' }], label: 'Air sledge' },
      { m: [{ t: '#' }], label: 'Vehicle Movement Points (MP)', ref: 'D1.1' },
      { m: [{ t: '#', s: 'red' }], label: 'Mechanical Breakdown (SK: Mechanical Reliability DR on each start)', ref: 'D2.5' },
      { m: [{ t: '#', sup: 's' }], label: 'Amphibious MP', ref: 'D1.1' },
    ],
  },
  {
    n: 3,
    title: 'Armor Factors',
    ref: 'SK4 7.1',
    example: { m: [{ t: '8', s: 'red' }, { t: '4', s: 'sq' }], text: 'Front AF 8, large target · Side/Rear AF 4, superior turret AF' },
    rows: [
      { m: [{ t: '#' }], label: 'Armor Factor (AF)', ref: 'D1.6' },
      { m: [{ t: '#', s: 'red' }], label: '−1 To Hit DRM, per occurrence (larger target)', ref: 'D1.7' },
      { m: [{ t: '#', s: 'disc' }], label: '+1 To Hit DRM, per occurrence (smaller target)', ref: 'D1.7' },
      { m: [{ t: '#', s: 'ring' }], label: 'Inferior turret: next AF down the ladder', ref: 'D1.64' },
      { m: [{ t: '#', s: 'sq' }], label: 'Superior turret: next AF up the ladder', ref: 'D1.63' },
      { m: [{ t: '★' }], label: 'Unarmored', ref: 'D1.21' },
    ],
    notes: ['AF ladder: 0, 1, 2, 3, 4, 6, 8, 11, 14, 18, 26'],
  },
  {
    n: 4,
    title: 'MA breakdown',
    ref: 'SK4 7.2, 7.2.1',
    example: { m: [{ t: 'B11' }], text: 'MA breaks down on a TH DR of 11+' },
    rows: [
      { m: [{ t: 'B#' }], label: 'MA Breakdown number; none printed means B12', ref: 'D3.7' },
      { m: [{ pre: 'B', t: '#', s: 'ring' }], label: 'Low Ammo penalty', ref: 'D3.71' },
    ],
  },
  {
    n: 5,
    title: 'MA Rate of Fire',
    ref: 'SK4 1.2.4.1',
    example: { m: [{ t: '1', s: 'rof' }], text: 'MA ROF of 1' },
    rows: [
      { m: [{ t: '#', s: 'rof' }], label: 'MA ROF', ref: 'C2.24' },
      { m: [{ t: '#', s: 'rofWhite' }], label: 'MA capable of Multiple Hits', ref: 'C3.8' },
    ],
  },
  {
    n: 6,
    title: 'Main Armament',
    ref: 'SK4 7.2, 6.8',
    example: { m: [{ t: '75(20)' }], text: '75mm main gun with 20 IFE' },
    rows: [
      { m: [{ t: '##' }], label: 'MA size in mm', ref: 'D1.3' },
      { m: [{ t: '##', s: 'over' }], label: 'HE ammo only', ref: 'C2.21' },
      { m: [{ t: '##', s: 'under' }], label: 'AP ammo only', ref: 'C2.21' },
      { m: [{ t: '##', sup: '*' }], label: 'Low muzzle velocity', ref: 'C4.11' },
      { m: [{ t: '##L' }], label: 'High muzzle velocity', ref: 'C4.12' },
      { m: [{ t: '##LL' }], label: 'Very high muzzle velocity', ref: 'C4.13' },
      { m: [{ t: '(##)' }], label: 'Infantry Firepower Equivalent', ref: 'C2.29' },
    ],
    notes: ['Check the back of the counter for Special Ammo and its Depletion Numbers.'],
  },
  {
    n: 7,
    title: 'Machine guns',
    ref: 'SK4 7.8',
    example: { m: [{ t: '2/-/4' }], text: '2 FP BMG and 4 FP AAMG, no CMG' },
    rows: [
      { m: [{ t: '#/#/#' }], label: 'BMG / CMG / AAMG', ref: 'D1.8' },
      { m: [{ t: '#', sup: 'R#' }], label: 'Rear-facing MG', ref: 'D1.81' },
      { m: [{ t: '#' }], label: 'FP factor in that position' },
      { m: [{ t: '-' }], label: 'No MG in that position' },
      { m: [{ t: '#', s: 'disc' }], label: 'Fixed-mount BMG', ref: 'D1.81' },
      { m: [{ t: '(R)BMG' }], label: '(Rear) bow MG: 8 hex range' },
      { m: [{ t: '(R)CMG' }], label: '(Rear) coaxial MG: 12 hex range' },
      { m: [{ t: 'AAMG' }], label: 'Anti-aircraft MG: 8 hex range' },
    ],
    notes: [
      'No ROF unless the MG is the MA.',
      'B12 DR; repair on a dr of 1, an original 6 disables it.',
      'AAMG fires only while CE.',
      '#/# means no AAMG.',
    ],
  },
];

/** Turret types (SK4 7.2): the line around the vehicle depiction. */
export const TURRET_TYPES: { kind: 'NT' | 'T' | 'ST' | 'RST' | '1MT'; name: string; ref: string; text?: string }[] = [
  { kind: 'NT', name: 'Non-Turreted', ref: 'D1.33', text: 'No symbol: the MA is bow-mounted and fires through the VCA.' },
  { kind: 'T', name: 'Fast Traverse (T)', ref: 'D1.31', text: 'Thin white circle.' },
  { kind: 'ST', name: 'Slow Traverse (ST)', ref: 'D1.32', text: 'Thin white square.' },
  { kind: 'RST', name: 'Restricted Slow Traverse (RST)', ref: 'D1.321', text: 'Thick white square. Treated as ST; cannot fire MA or CMG while CE.' },
  { kind: '1MT', name: 'One-Man Turret (1MT)', ref: 'D1.322', text: 'Thick white square without corners. Treated as RST; can fire neither MA nor CMG while CE; one Stun Recalls it.' },
];
