import { useLayoutEffect, useRef, useState } from 'react';
import type { HexId, Piece, PieceId, QueryEnv } from '@asl/engine';
import { AMMO_NAME, acquisitionsAt, ammoOut, defOf, gunIdent, isWeaponDef, moveState, shownFireMarker, stackOrder, swHeldBy, terrainOf, type Statics, type VehicleDef } from '@asl/rules';
import { counterImage, cxMarker, markerImage } from '../game/assets';
import { identCss } from './ident';
import { pieceLabel } from '../game/describe';
import { smoke58Marker } from '../game/smoke';
import { HexArt, type ArtPlacement } from './HexArt';

interface Props {
  env: QueryEnv;
  hex: HexId;
  /** Anchor in board-pane pixels (the pointer when the card opened). */
  at: { x: number; y: number };
  /** Board pane size, to keep the card on screen. */
  bounds: { w: number; h: number };
  /** The boards as placed and the view rotation, to draw the hex's own artwork (none: no picture). */
  placements?: ArtPlacement[];
  rotation?: number;
  /**
   * Interactive card: the pointer may move onto it, chits can be clicked to select them and
   * right-clicked for their own actions. Without it the card is a passive peek.
   */
  interactive?: {
    selected: Set<PieceId>;
    /** Which chits may be selected (the acting side's). */
    selectable(p: Piece): boolean;
    onToggle(id: PieceId): void;
    onChitContextMenu(p: Piece, at: { x: number; y: number }): void;
    onEnter(): void;
    onLeave(): void;
  };
}

const SPINE_NAME = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];

/** A vehicle's vehicular MGs (SK4 7.8) and their state: pieces held by the vehicle, never drawn themselves. */
function vehicleMgStates(env: QueryEnv, p: Piece): { type: string; state: 'malfunctioned' | 'disabled' | null }[] {
  if (p.tags['vca'] === undefined) return [];
  return swHeldBy(env.state, p.id).flatMap((w) => {
    const d = defOf(env, w);
    if (d.kind !== 'sw' || !d.fixed) return [];
    return [{ type: d.type, state: w.tags['mgDisabled'] ? ('disabled' as const) : w.tags['malf'] ? ('malfunctioned' as const) : null }];
  });
}

/** Status of a counter: the marker chit that sits on it on the board (if any) and a label. */
function statusOf(env: QueryEnv, p: Piece): { label: string; marker?: string }[] {
  const t = p.tags;
  const out: { label: string; marker?: string }[] = [];
  if (t['broken']) out.push({ label: 'broken' });
  if (t['dm']) out.push({ label: 'DM', marker: 'dm' });
  if (t['pinned']) out.push({ label: 'pinned', marker: 'pin' });
  if (t['cx']) out.push({ label: 'CX', marker: cxMarker(defOf(env, p).nationality) });
  if (t['malf']) out.push({ label: 'malfunctioned' });
  const fire = shownFireMarker(p);
  if (fire === 'prep') out.push({ label: 'Prep Fire', marker: 'FirePrep' });
  if (fire === 'adv') out.push({ label: 'Advancing Fire', marker: 'FireAdv' });
  if (fire === 'first') out.push({ label: 'First Fire', marker: 'First' });
  if (fire === 'final') out.push({ label: 'Final Fire', marker: 'Final' });
  if (t['wounds']) out.push({ label: 'wounded', marker: 'Wound' });
  // A leader relieved of command by SSR (LMA5 SSR 4): why he stays pinned.
  if (typeof t['relieved'] === 'string') out.push({ label: t['relieved'] });
  if (t['moved']) out.push({ label: 'moved' });
  if (t['advanced']) out.push({ label: 'advanced' });
  // SK2 Guns.
  if (t['intensive']) out.push({ label: 'Intensive Fire' });
  if (t['acqHex']) out.push({ label: `has acquired ${String(t['acqHex']).replace(/^[a-z]/, '')} (-${t['acqLevel']})` });
  if (t['emplaced']) out.push({ label: 'emplaced' });
  // Limited ammo the Gun has run out of (SK4 6.2 depletion).
  if (ammoOut(p).length) out.push({ label: `out of ${ammoOut(p).map((k) => AMMO_NAME[k]).join(', ')}` });
  if (t['hip']) out.push({ label: 'hidden' });
  if (t['concealed']) out.push({ label: 'concealed' });
  if (t['banzai'] !== undefined) out.push({ label: t['banzai'] === 'charging' ? 'Banzai Charge' : 'Banzai (charged)', marker: 'Banzai' });
  if (t['caLocked']) out.push({ label: 'turned (cannot move)' });
  if (t['hazardous']) out.push({ label: 'hazardous movement' });
  if (t['manhandled']) out.push({ label: 'manhandled' });
  // A unit still in its prepared position (SSR).
  if (p.loc.kind === 'hex' && t['prepared'] === p.loc.hex) out.push({ label: 'dug in (+TEM)' });
  // SK3 vehicles.
  if (t['vca'] !== undefined) {
    if (t['wreck']) out.push({ label: 'wreck' });
    if (t['motion']) out.push({ label: 'in Motion', marker: 'Motion' });
    if (t['movingTarget'] && !t['motion']) out.push({ label: 'moving target' });
    if (t['bog'] === 'bogged') out.push({ label: 'bogged', marker: 'Bog' });
    if (t['bog'] === 'mired') out.push({ label: 'mired', marker: 'Mired' });
    if (t['immob']) out.push({ label: 'immobilized', marker: 'Immob' });
    if (t['dugIn']) out.push({ label: 'dug in' });
    if (t['shock'] === 'shock') out.push({ label: 'Shocked', marker: 'Shock' });
    if (t['shock'] === 'uk') out.push({ label: 'Unconfirmed Kill', marker: 'UK' });
    if (t['stun'] === 'fresh') out.push({ label: 'Stunned', marker: 'Stun' });
    if (t['stun'] === 'plus1') out.push({ label: 'Stun +1', marker: 'StunPlus1' });
    if (t['recall']) out.push({ label: 'Recalled', marker: 'Recall' });
    if (t['bff']) out.push({ label: 'Bounding First Fire', marker: 'FireBnd' });
    if (t['lowAmmo']) out.push({ label: 'Low Ammo', marker: 'LowAmmo' });
    if (t['maDisabled']) out.push({ label: 'MA disabled', marker: 'DisMA' });
    // Its MGs' malfunctions wear MG Malfunction / Disabled markers on the vehicle (SK4 7.8).
    for (const mg of vehicleMgStates(env, p)) {
      if (mg.state === 'malfunctioned') out.push({ label: `${mg.type} malfunctioned`, marker: `Malf${mg.type}` });
      if (mg.state === 'disabled') out.push({ label: `${mg.type} disabled`, marker: `Dis${mg.type}` });
    }
    if (t['stalled']) out.push({ label: 'stalled' });
  }
  return out;
}

/** A vehicle's crew posture (SK4 3.3.2), shown as its own pill rather than lost among the status words. */
function crewOf(p: Piece): 'ce' | 'bu' | null {
  if (p.tags['vca'] === undefined || p.tags['wreck']) return null;
  return p.tags['ce'] ? 'ce' : 'bu';
}

function CrewPill({ crew, big }: { crew: 'ce' | 'bu'; big?: boolean }) {
  const title = crew === 'ce' ? 'Crew Exposed: the crew is out of its hatches' : 'Buttoned Up: hatches closed';
  return (
    <span className={`crew-pill ${crew} ${big ? 'big' : ''}`} title={title}>
      <b>{crew === 'ce' ? 'CE' : 'BU'}</b>
      {big && <span>{crew === 'ce' ? 'Crew Exposed' : 'Buttoned Up'}</span>}
    </span>
  );
}

const TURRET_NAME: Record<VehicleDef['turret'], string> = { T: 'Fast Turret', ST: 'Slow Turret', RST: 'Restricted Slow Turret', '1MT': 'One Man Turret', NT: 'non-turreted' };
const SIZE_NAME: Record<VehicleDef['targetSize'], string> = { veryLarge: 'Very Large (−2 To Hit)', large: 'Large (−1 To Hit)', normal: 'Average', small: 'Small (+1 To Hit)', verySmall: 'Very Small (+2 To Hit)' };

/**
 * A vehicle's counter read out line by line, so the hover card says what the counter under its
 * Motion/CE markers says (vehicles do not stack on the map, so there is room for it).
 */
function vehicleSheet(env: QueryEnv, p: Piece, d: VehicleDef): [string, string][] {
  const rows: [string, string][] = [];
  const ms = moveState(env);
  const moving = ms?.units[0] === p.id ? `${(ms.allowance[p.id] ?? 0) - (ms.spent[p.id] ?? 0)} of ${ms.allowance[p.id]} left` : null;
  rows.push(['Move', `${d.mp} MP${d.redMp ? ' (red: Mech. Reliability)' : ''} · ${d.tracked ? 'Fully Tracked' : 'Armored Car'}${d.groundPressure !== 'normal' ? ` · ${d.groundPressure} GP` : ''}${moving ? ` · ${moving}` : ''}`]);
  const { hull, turret } = d.af;
  const tdiff = d.turret !== 'NT' && (turret.front !== hull.front || turret.side !== hull.side);
  rows.push(['Armor', `hull ${hull.front} front / ${hull.side} side${tdiff ? ` · turret ${turret.front} / ${turret.side}` : ''}${d.openTopped ? ' · Open-Topped' : ''}`]);
  const ma = d.ma;
  if (!ma) rows.push(['MA', 'none']);
  else if (d.maMg) rows.push(['MA', `its ${d.maMg.mg.toUpperCase()}${d.maMg.rof ? ` · ROF ${d.maMg.rof}` : ''}`]);
  else {
    // Ammo with a Depletion Number is listed as Special Ammo, not as always on hand (SK4 6.2).
    const limited = new Set((ma.specialAmmo ?? []).map((a) => a.kind));
    const basic = [ma.ammo.he && !limited.has('HE') ? 'HE' : null, ma.ammo.ap && !limited.has('AP') ? 'AP' : null].filter(Boolean);
    const ammo = basic.length ? basic.join(', ') : null;
    const special = (ma.specialAmmo ?? []).map((a) => `${AMMO_NAME[a.kind] ?? a.kind} (depletion ${a.steps.map((x) => x.n).join('/')})`);
    const out = ammoOut(p).map((k) => AMMO_NAME[k]);
    rows.push([
      'MA',
      [`${ma.caliber}${ma.barrel ?? ''} ${ma.type}`, ma.rof ? `ROF ${ma.rof}` : null, `B${ma.b ?? 12}${ma.lowAmmo ? ' (Low Ammo)' : ''}`, ammo, ...special, ma.ife ? `IFE ${ma.ife}` : null, out.length ? `out of ${out.join(', ')}` : null]
        .filter(Boolean)
        .join(' · '),
    ]);
  }
  rows.push(['Turret', TURRET_NAME[d.turret]]);
  const mg = d.mg;
  const mgState = (type: string) => {
    const s = vehicleMgStates(env, p).find((x) => x.type === type)?.state;
    return s ? ` (${s})` : '';
  };
  const mgs = [
    mg.bmg !== undefined ? `BMG ${mg.bmg}${mg.bmgFixed ? ' (fixed)' : ''}${mgState('BMG')}` : null,
    mg.cmg !== undefined ? `CMG ${mg.cmg}${mgState('CMG')}` : null,
    mg.aamg !== undefined ? `AAMG ${mg.aamg}${mgState('AAMG')}` : null,
    mg.rmg !== undefined ? `RMG ${mg.rmg}${mgState('RMG')}` : null,
  ].filter(Boolean);
  rows.push(['MGs', mgs.length ? mgs.join(' · ') : 'none']);
  rows.push(['Target', SIZE_NAME[d.targetSize]]);
  rows.push(['Crew', `morale ${d.crewMorale} · CE +${d.ceDrm} DRM${d.smoke?.length ? ` · ${d.smoke.map((x) => `${x.kind}${x.n}`).join(', ')} smoke` : ''}`]);
  return rows;
}

/** A vehicular MG piece: part of its vehicle, not a counter of its own. */
const isFixedMg = (d: { kind: string; fixed?: boolean }) => d.kind === 'sw' && !!d.fixed;

/** A road or similar feature of a hex, in words: `road:dirt` is a dirt road. */
const FEATURE_NAME: Record<string, string> = { 'road:dirt': 'dirt road', 'road:paved': 'paved road', 'road:offboard': 'road', 'woods-road': 'woods road', 'orchard-road': 'orchard road', path: 'path (1 MF into jungle)' };

/**
 * The ground under the stack: the terrain as the rules see it (grain out of season is Open
 * Ground), its TEM, the level on a hill, and any road through it.
 */
function groundOf(env: QueryEnv, hex: HexId): string {
  const map = (env.statics as { map: { hex(id: HexId): { elevation?: number; features: string[] } | undefined } }).map;
  const t = terrainOf(env, hex);
  const h = map.hex(hex);
  const parts = [t.name, `${t.tem > 0 ? '+' : ''}${t.tem} TEM`];
  if (h?.elevation) parts.push(`level ${h.elevation}`);
  for (const f of h?.features ?? []) parts.push(FEATURE_NAME[f] ?? f.replace(':', ' '));
  return parts.join(' · ');
}

/** Markers on the hex itself (Smoke, CC, Melee, Residual FP, Acquired Target counters). */
function locationMarkers(env: QueryEnv, hex: HexId): { marker: string; label: string; tint?: string }[] {
  const m = env.state.hexMarkers[hex] ?? {};
  const out: { marker: string; label: string; tint?: string }[] = [];
  // One Acquired Target counter per Gun, in that Gun's colour (as the board draws them).
  for (const a of acquisitionsAt(env, hex)) {
    const letter = gunIdent(env, a.gun);
    out.push({ marker: a.level === 2 ? 'acq2wh' : 'acq1wh', label: `Acquired -${a.level} by Gun ${letter} (${pieceLabel(env, a.gun)})${a.type === 'ATT' ? ', Area' : ''}`, ...(letter ? { tint: identCss(letter) } : {}) });
  }
  if (m['smoke']) out.push({ marker: 'Smk2', label: 'Smoke grenades (+2)' });
  const s58 = smoke58Marker(m);
  if (s58) out.push(s58);
  if (m['cc']) out.push({ marker: 'CC', label: 'Close Combat' });
  if (m['melee']) out.push({ marker: 'Melee', label: 'Melee' });
  const rfp = m['residualFp'] as number | undefined;
  if (rfp) out.push({ marker: `RFP${String(Math.min(12, rfp)).padStart(2, '0')}`, label: `Residual ${rfp} FP` });
  return out.filter((x) => markerImage(x.marker));
}

/** Everything in a hex, each side read from the top of its stack down (as the board stacks it), each with its SW (held: bottom up), loose SW last. */
export function stackIn(env: QueryEnv, hex: HexId): { piece: Piece; held: Piece[] }[] {
  const s = env.state;
  const here = Object.values(s.pieces).filter((p) => (p.loc.kind === 'hex' || p.loc.kind === 'offboard') && p.loc.hex === hex);
  const people = here.filter((p) => !isWeaponDef(defOf(env, p)));
  return [...new Set(people.map((p) => p.side))]
    .sort()
    .flatMap((side) => stackOrder(env, people.filter((p) => p.side === side)).reverse())
    .map((piece) => ({ piece, held: swHeldBy(s, piece.id).filter((w) => !isFixedMg(defOf(env, w))).sort((a, b) => Number(defOf(env, b).kind === 'gun') - Number(defOf(env, a).kind === 'gun')) }))
    .concat(here.filter((p) => isWeaponDef(defOf(env, p))).map((piece) => ({ piece, held: [] })));
}

/** The building level a counter stands on (full ASL; 0 at ground level and off the map). */
const levelOfPiece = (p: Piece): number => (p.loc.kind === 'hex' ? (p.loc.level ?? 0) : 0);

/** Card listing every counter in a hex; interactive, chits can be picked from it. */
export function StackPeek({ env, hex, at, bounds, placements, rotation, interactive }: Props) {
  // The card's drawn height, so a tall card (a vehicle's) is kept on screen; estimated until measured.
  const card = useRef<HTMLDivElement>(null);
  const [drawnH, setDrawnH] = useState<number | null>(null);
  useLayoutEffect(() => {
    const h = card.current?.offsetHeight ?? null;
    if (h !== drawnH) setDrawnH(h);
  });
  const stack = stackIn(env, hex);
  if (stack.length === 0) return null;
  const levels = [...new Set(stack.map((e) => levelOfPiece(e.piece)))].sort((a, b) => b - a);
  const total = stack.reduce((n, e) => n + 1 + e.held.length, 0);
  // A lone vehicle on the map gets the big card: its counter unmarked, and its values read out.
  const vehicles = stack.filter((e) => defOf(env, e.piece).kind === 'vehicle');
  const big = vehicles.length === 1 && vehicles[0]!.piece.loc.kind === 'hex' && !vehicles[0]!.piece.tags['wreck'] ? vehicles[0]!.piece.id : null;
  const W = big ? 340 : 240;
  const H = drawnH ?? 44 + total * 46 + (big ? 300 : 0) + (interactive ? 22 : 0);
  // Just beside the pointer (close enough to slide onto), flipped to stay inside the pane.
  const GAP = 10;
  const left = at.x + GAP + W > bounds.w ? Math.max(4, at.x - GAP - W) : at.x + GAP;
  const top = Math.max(4, Math.min(at.y - 12, bounds.h - H - 4));
  const row = (p: Piece, nested: boolean) => {
    const d = defOf(env, p);
    const flipped = p.tags['broken'] === true || (p.tags['malf'] === true && d.kind !== 'vehicle') || p.tags['wreck'] === true;
    // An enemy's concealed stack (SK4 8.3.2) is one "?" counter, nothing beneath it to list.
    const nat = d.kind === 'unknown' ? ((env.statics as Statics).scenario.sides.find((x) => x.side === p.side)?.nationality ?? d.nationality) : d.nationality;
    const img = d.kind === 'unknown' ? markerImage(`qmark-${nat}`) : counterImage(p.defId, flipped);
    const st = d.kind === 'unknown' ? [{ label: 'concealed stack, cannot be inspected (SK4 8.3.2)' }] : statusOf(env, p);
    const crew = d.kind === 'vehicle' ? crewOf(p) : null;
    if (d.kind === 'vehicle' && p.tags['vca'] !== undefined && !p.tags['wreck']) {
      const vca = SPINE_NAME[Number(p.tags['vca'])] ?? '?';
      const tca = d.turret !== 'NT' && p.tags['ca'] !== undefined && p.tags['ca'] !== p.tags['vca'] ? ` · turret ${SPINE_NAME[Number(p.tags['ca'])]}` : '';
      st.unshift({ label: `faces ${vca}${tca}` });
    }
    const can = !!interactive && interactive.selectable(p);
    const sel = !!interactive && interactive.selected.has(p.id);
    const sheet = p.id === big && d.kind === 'vehicle' ? vehicleSheet(env, p, d) : null;
    const body = sheet ? (
      <>
        <span className="peek-veh">
          {img ? <img className="peek-veh-img" src={img} alt="" width={112} height={112} draggable={false} /> : <span className="noimg" />}
          <span className="peek-name">
            <span className="peek-veh-name">{pieceLabel(env, p)}</span>
            {crew && <CrewPill crew={crew} big />}
            {st.length > 0 && <span className="peek-status">{st.map((x) => x.label).join(' · ')}</span>}
            {st.some((x) => x.marker && markerImage(x.marker)) && (
              <span className="peek-markers">
                {st
                  .filter((x) => x.marker && markerImage(x.marker))
                  .map((x) => (
                    <img key={x.marker} src={markerImage(x.marker!)!} alt={x.label} title={x.label} width={26} height={26} draggable={false} />
                  ))}
              </span>
            )}
          </span>
          {sel && <span className="peek-check">✓</span>}
        </span>
        <span className="peek-sheet">
          {sheet.map(([k, v]) => (
            <span key={k} className="peek-sheet-row">
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </span>
          ))}
        </span>
      </>
    ) : (
      <>
        {img ? <img src={img} alt="" width={36} height={36} draggable={false} /> : <span className="noimg" />}
        <span className="peek-name">
          <span>
            {crew && <CrewPill crew={crew} />}
            {pieceLabel(env, p)}{defOf(env, p).kind === 'gun' ? ` · Gun ${gunIdent(env, p)}` : ''}
          </span>
          {st.length > 0 && <span className="peek-status">{st.map((x) => x.label).join(' · ')}</span>}
        </span>
        {st.some((x) => x.marker) && (
          <span className="peek-markers">
            {st
              .filter((x) => x.marker && markerImage(x.marker))
              .map((x) => (
                <img key={x.marker} src={markerImage(x.marker!)!} alt={x.label} title={x.label} width={26} height={26} draggable={false} />
              ))}
          </span>
        )}
        {sel && <span className="peek-check">✓</span>}
      </>
    );
    const cls = `peek-row ${nested ? 'nested' : ''} ${sheet ? 'big' : ''} side-${p.side}`;
    if (!interactive) return <li key={p.id} className={cls}>{body}</li>;
    return (
      <li key={p.id} className={`${cls} ${can ? 'can' : 'foreign'} ${sel ? 'sel' : ''}`}>
        <button
          type="button"
          onClick={() => can && interactive.onToggle(p.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const pane = (e.currentTarget.closest('.board-pane') as HTMLElement | null)?.getBoundingClientRect();
            interactive.onChitContextMenu(p, { x: e.clientX - (pane?.left ?? 0), y: e.clientY - (pane?.top ?? 0) });
          }}
          title={can ? `${sel ? 'Deselect' : 'Select'} · right-click for actions` : 'Right-click for details'}
        >
          {body}
        </button>
      </li>
    );
  };
  return (
    <div
      ref={card}
      className={`stack-peek ${interactive ? 'interactive' : ''}`}
      style={{ left, top, width: W }}
      onClick={(e) => e.stopPropagation()}
      onPointerEnter={interactive?.onEnter}
      onPointerLeave={interactive?.onLeave}
    >
      <div className="peek-top">
        {placements && <HexArt env={env} hex={hex} placements={placements} rotation={rotation ?? 0} />}
        <div className="peek-top-text">
          <div className="peek-head">
            <b>{hex.replace(/^[a-z]/, '')}</b>
            <span className="peek-markers">
              {locationMarkers(env, hex).map((m, i) => (
                <span key={`${m.marker}-${i}`} className="peek-marker" title={m.label} style={m.tint ? { backgroundColor: m.tint, WebkitMaskImage: `url(${markerImage(m.marker)!})`, maskImage: `url(${markerImage(m.marker)!})`, WebkitMaskSize: '100% 100%', maskSize: '100% 100%' } : undefined}>
                  <img src={markerImage(m.marker)!} alt={m.label} width={26} height={26} draggable={false} style={m.tint ? { mixBlendMode: 'multiply' } : undefined} />
                </span>
              ))}
            </span>
            <span className="muted">{total} counter{total === 1 ? '' : 's'}</span>
          </div>
          <div className="peek-ground">{groundOf(env, hex)}</div>
        </div>
      </div>
      {/* Top down, as on the board: a unit's weapons lie on top of it (SW over Gun), so they read first. */}
      {/* Full ASL: a building hex holding more than one Location is listed by Location, the highest first (ASLRB A2.8). */}
      <ul>
        {levels.length < 2
          ? stack.map((e) => [...[...e.held].reverse().map((h) => row(h, true)), row(e.piece, false)])
          : levels.map((lv) => [
              <li key={`lv${lv}`} className={`peek-loc loc-head ${lv ? 'upper' : 'ground'}`}>
                {lv ? <img src={markerImage(`Lev${lv}`) ?? ''} alt="" width={18} height={18} draggable={false} /> : null}
                {lv ? `Level ${lv}` : 'Ground level'}
              </li>,
              ...stack.filter((e) => levelOfPiece(e.piece) === lv).map((e) => [...[...e.held].reverse().map((h) => row(h, true)), row(e.piece, false)]),
            ])}
      </ul>
      {interactive && stack.some((e) => interactive.selectable(e.piece)) && (
        <div className="peek-hint">click a chit to select · right-click it for actions</div>
      )}
    </div>
  );
}
