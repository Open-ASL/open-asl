import { useEffect, useRef } from 'react';
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import { cubeDistance, cubeNeighbors, type GameState, type HexId, type Piece, type QueryEnv, type SideId } from '@asl/engine';
import { GEO, coveredArc, defOf, gun as gunDef, gunHex, hexOf as hexOfPiece, inCoveredArc, isCaptured, isWeaponDef, isWreck, spineDirections, swHeldBy, tcaOf, vcaOf, vehicle as vehicleDef, type MapHex, type ObjectiveArea, type Statics, acquisitionOf, gunIdents, ordnanceOf, SMOKE58, stackOrder, hexOfLoc, levelOfLoc, locKey } from '@asl/rules';
import { CAVE_GONE, UNKNOWN_DEF_ID, cavesParams, caveLoc, cornerOffset, hexPixel, isCaveLoc, moveState, shownFireMarker, smokeGrenades } from '@asl/rules';
import { playableBounds, playableRect, printedRect, type CropPlacement } from './crop';
import { boardImage, counterImage, cxMarker, loadTurrets, markerImage, splitTurret } from '../game/assets';
import { identColor } from './ident';
import { WRECK_PREFIX, wreckTexture } from './wreckArt';
import type { BoardFx } from '../fx/useGameFx';
import type { WeatherFxKind } from '../game/weatherView';
import { smoke58Chits } from '../game/smoke';
import { releaseCaptureSource, setCaptureSource } from './capture';

/** dataTransfer type for counters dragged from the setup tray. */
export const DRAG_TYPE = 'application/x-asl-piece';

export type Placement = CropPlacement;

/**
 * Map ↔ view transform. The map is drawn in board pixels; the view turns it by a
 * multiple of 90° (so the scenario's north is up) and shifts it to start at 0,0.
 * Counters are placed at transformed centres so they stay upright.
 */
interface ViewTransform {
  toView(x: number, y: number): { x: number; y: number };
  toMap(x: number, y: number): { x: number; y: number };
  width: number;
  height: number;
  /** Radians for the board art container. */
  angle: number;
  origin: { x: number; y: number };
}

/** Room around the map for the offboard entry hexes. */
const MARGIN = 72;

/**
 * Keep the panned/zoomed map on screen: at least `keep` px of it (or all of it, if smaller) stays inside
 * the pane on each axis, so it can be pushed well aside but never lost.
 */
function clampView(w: Container, mapW: number, mapH: number, screenW: number, screenH: number) {
  const axis = (pos: number, size: number, screen: number) => {
    const keep = Math.min(size, screen * 0.4);
    return Math.min(screen - keep, Math.max(keep - size, pos));
  };
  w.position.set(axis(w.x, mapW * w.scale.x, screenW), axis(w.y, mapH * w.scale.y, screenH));
}

function viewTransform(placements: Placement[], rotation: number): ViewTransform {
  const bounds = playableBounds(placements);
  const x0 = bounds.x0 - MARGIN;
  const x1 = bounds.x1 + MARGIN;
  const y0 = bounds.y0 - MARGIN;
  const y1 = bounds.y1 + MARGIN;
  const w = x1 - x0;
  const h = y1 - y0;
  const r = (((rotation % 360) + 360) % 360) as 0 | 90 | 180 | 270;
  // Rotation is clockwise in screen space (y down), e.g. 270 = a quarter turn counterclockwise.
  const fwd = {
    0: (x: number, y: number) => ({ x: x - x0, y: y - y0 }),
    90: (x: number, y: number) => ({ x: y1 - y, y: x - x0 }),
    180: (x: number, y: number) => ({ x: x1 - x, y: y1 - y }),
    270: (x: number, y: number) => ({ x: y - y0, y: x1 - x }),
  }[r];
  const inv = {
    0: (x: number, y: number) => ({ x: x + x0, y: y + y0 }),
    90: (x: number, y: number) => ({ x: y + x0, y: y1 - x }),
    180: (x: number, y: number) => ({ x: x1 - x, y: y1 - y }),
    270: (x: number, y: number) => ({ x: x1 - y, y: x + y0 }),
  }[r];
  const swap = r === 90 || r === 270;
  return { toView: fwd, toMap: inv, width: swap ? h : w, height: swap ? w : h, angle: (r * Math.PI) / 180, origin: fwd(0, 0) };
}

export interface BoardOverlay {
  selectedHex?: HexId | null;
  /** hex → highlight color */
  highlights?: Map<HexId, number>;
  /** Pieces to emphasise (selected units). */
  selectedPieces?: Set<string>;
  /**
   * LOS threads to draw (a shot under review from the log); `clear: null` = not yet checked (drawn
   * neutral). A blocked thread turns red at `blockedAt` (map pixels) when the LOS data knows the
   * spot, else is red throughout. An end on an upper building level (`fromLevel`/`toLevel`, full ASL)
   * gets one more ring per level.
   */
  los?: { from: HexId; to: HexId; clear: boolean | null; blockedAt?: { x: number; y: number }; fromLevel?: number; toLevel?: number; toVertex?: number }[] | null;
  /**
   * Full ASL: a moving stack in Bypass (ASLRB A4.3): its units are drawn on the corner of `hex` it has reached (`at`), the
   * hexsides it went along there (`sides`, in order) drawn as a path from the hex it came from.
   */
  bypass?: { hex: HexId; sides: number[]; at: number; from?: HexId | null; units: Set<string> } | null;
  /** Units in Bypass: they wear a BYP tag (full ASL). */
  inBypass?: Set<string>;
  /** Units that have declared fire wear this marker (e.g. FirePrep) before the shot resolves. */
  /** A declared attack not yet resolved: each firing unit or SW and the fire marker it will wear. */
  declaredFire?: { units: Map<string, string> };
  /** Units that can no longer act this phase (e.g. finished moving): drawn dimmed. */
  spent?: Set<string>;
  /** Counters the other player has placed but not yet confirmed: drawn translucent. */
  ghost?: Set<string>;
  /** Moving units out on the road in a Woods-Road hex (SK1 1.1.1): they wear a ROAD tag. */
  onRoad?: Set<string>;
  /** Moving units that have attempted Smoke grenades this MPh (once per unit, SK1 3.3): they wear a SMK tag. */
  smokeTried?: Set<string>;
  /** Moving units using Assault Movement (SK1 3.3; no FFNAM against them, 3.3.1): they wear an AM tag, so the defender sees it before firing. */
  assaultMoving?: Set<string>;
  /** Small round handles drawn beside a hex (a moving vehicle's hull and turret turns): clicked on the map. */
  controls?: HexControl[] | null;
  /** Small pills above a hex (the moving stack's MF/MP left), drawn for every viewer; not interactive. */
  badges?: HexBadge[] | null;
  /** Arrows from one hex centre to another (an artillery salvo's drift from its target hex to where it landed). */
  arrows?: { from: HexId; to: HexId }[] | null;
}

export interface HexBadge {
  hex: HexId;
  text: string;
  /** Map pixels to stand above instead of the hex (a stack on a hex corner, in Bypass). */
  at?: { x: number; y: number };
}

export interface HexControl {
  id: string;
  hex: HexId;
  /** Screen angle in degrees clockwise from up (or, for a spine handle, read off the hex grid), and distance from the hex centre in hex heights. */
  angle?: number;
  dist?: number;
  glyph: string;
  /** Hull handles are square key caps in the text colour, turret handles round and brass; each carries its label. */
  tone: 'hull' | 'turret';
  /**
   * A handle on one of the hex's six hexspines (0–5, SK4 3.2.4): it sits at the far end of that
   * hexspine, which is drawn out from the hex corner to it, and its glyph is turned to point along it.
   */
  spine?: number;
  /** The chosen handle of a set: drawn filled. */
  active?: boolean;
  /** Pointing at the handle previews the Covered Arc of its hexspine, in this nationality's colour. */
  arc?: string;
  disabled?: boolean;
  /** Shown beside the handle under the pointer. */
  hint?: string;
  /**
   * A handle on corner `corner` (0–5, `hexCorners.ts`) of the hex itself (Bypass, ASLRB A4.3): a numbered dot kept a
   * screen size big enough for a finger at every zoom, with `tag` beside it and, while pointed at or chosen, `path` (map
   * pixels) drawn as the way it would go.
   */
  corner?: number;
  tag?: string;
  path?: { x: number; y: number }[];
  onClick(): void;
}

interface Props {
  state: GameState;
  statics: Statics;
  placements: Placement[];
  overlay: BoardOverlay;
  /** `ctrl` is Ctrl (or ⌘ on a Mac) held: a ping, not a selection; `at` is the exact point clicked, in map pixels. */
  /** `at`: the map point clicked; `screen`: the same in board-pane pixels (to open the wheel there). */
  onHexClick(hex: HexId, e: { shift: boolean; ctrl: boolean; at: { x: number; y: number }; screen?: { x: number; y: number } }): void;
  /** The hex under the pointer (null when off the map), with the pointer's position in the board pane. */
  /** `dragging`: the pointer carries a counter (setup), so the hex is a drop target, not one to inspect. */
  onHexHover?(hex: HexId | null, at: { x: number; y: number }, dragging?: boolean): void;
  /** Right-click on a hex: open the action wheel there (position in the board pane). */
  onHexContextMenu?(hex: HexId, at: { x: number; y: number }): void;
  /** Virtual offboard hexes to draw beside the map (entry areas). */
  offboard?: MapHex[];
  /** A counter dragged from the setup tray (or across the board) was dropped on a hex. */
  onDropPiece?(hex: HexId, pieceId: string): void;
  /** During setup: the counter that may be dragged off a hex, if any. */
  draggablePiece?(hex: HexId): string | null;
  /** A counter dragged off the board was dropped on the setup tray. */
  onReturnPiece?(pieceId: string): void;
  /** Clockwise view rotation in degrees (multiple of 90) so the scenario's north is up. */
  rotation?: number;
  /** Combat effects to play (tracers, bursts, floating results); each is played once by id. */
  fx?: BoardFx[];
  /** Play movement/effect animations (false = everything snaps). */
  animate?: boolean;
  /**
   * A counter whose face is about to be animated by a `face` effect keeps its old face (or stays
   * on the board, if eliminated) until that effect plays, so the change lands with its dice.
   */
  holdFace?(piece: string): boolean;
  /** Scenario objectives, drawn under the counters: a star on single hexes, a tinted outline around regions. */
  objectives?: ObjectiveArea[];
  /** Hexes under a side's Control: a small nationality chit sits in the hex centre, under the counters. */
  control?: Record<HexId, SideId>;
  /** Hexes of fortified buildings this viewer may know about (SSR): drawn as a ramparted outline under the counters. */
  fortified?: HexId[];
  /** Map hexes out of play (S36: the boards a secret game length leaves out, once revealed): drawn dark. */
  outOfPlay?: HexId[];
  /** Hide every counter and marker so the terrain underneath can be seen. */
  hidePieces?: boolean;
  /** Leave the markers off (status, Motion, CE, Smoke, Acquired Target…) so the counters under them can be read. */
  hideMarkers?: boolean;
  /**
   * The weather drawn over the board pane: falling snow or rain blown along `windAngle` (screen
   * degrees clockwise from up), or a fog/mist wash. Null draws nothing.
   */
  weather?: { kind: WeatherFxKind; windAngle: number } | null;
}

/* ----------------------------------------------------------------------------- weather */

interface Drop {
  x: number;
  y: number;
  /** Flake radius, or rain streak weight. */
  r: number;
  vy: number;
  sway: number;
  phase: number;
  a: number;
}
interface WeatherSim {
  kind: WeatherFxKind;
  drops: Drop[];
  t: number;
}

function spawnDrop(kind: WeatherFxKind, w: number, h: number, anywhere: boolean): Drop {
  const y = anywhere ? Math.random() * h : -10;
  return kind === 'snow'
    ? { x: Math.random() * w, y, r: 1.2 + Math.random() * 1.4, vy: 30 + Math.random() * 40, sway: 8 + Math.random() * 12, phase: Math.random() * Math.PI * 2, a: 0.45 + Math.random() * 0.4 }
    : { x: Math.random() * w, y, r: 1.4 + Math.random() * 1.2, vy: 520 + Math.random() * 240, sway: 0, phase: 0, a: 0.16 + Math.random() * 0.16 };
}

/**
 * One frame of weather over the pane, in screen pixels (it never scales with the map): a few
 * hundred flakes drifting with the wind, thin rain streaks, or a soft wash for fog and mist.
 * Everything is faint enough to read the board through.
 */
function stepWeather(g: Graphics, sim: WeatherSim, wx: { kind: WeatherFxKind; windAngle: number } | null, w: number, h: number, dtMs: number) {
  const kind = wx?.kind ?? null;
  if (kind !== sim.kind) {
    sim.kind = kind;
    sim.drops = [];
  }
  g.clear();
  if (!kind || !wx) return;
  sim.t += dtMs;
  if (kind === 'fog' || kind === 'mist') {
    const base = kind === 'fog' ? 0.16 : 0.09;
    g.rect(0, 0, w, h).fill({ color: 0xdfe6e3, alpha: base + 0.02 * Math.sin(sim.t / 2500) });
    return;
  }
  const th = (wx.windAngle * Math.PI) / 180;
  const windX = Math.sin(th);
  const windY = -Math.cos(th);
  const target = kind === 'snow' ? Math.min(420, Math.max(90, Math.round((w * h) / 7000))) : Math.min(260, Math.max(60, Math.round((w * h) / 12000)));
  while (sim.drops.length < target) sim.drops.push(spawnDrop(kind, w, h, true));
  if (sim.drops.length > target) sim.drops.length = target;
  const s = Math.min(dtMs, 50) / 1000;
  for (const p of sim.drops) {
    if (kind === 'snow') {
      p.x += (windX * 28 + Math.sin(sim.t / 900 + p.phase) * p.sway) * s;
      p.y += (p.vy + windY * 12) * s;
      g.circle(p.x, p.y, p.r).fill({ color: 0xffffff, alpha: p.a });
    } else {
      const vx = windX * 140;
      const vy = p.vy + windY * 60;
      p.x += vx * s;
      p.y += vy * s;
      const n = Math.hypot(vx, vy) || 1;
      const len = p.r * 6;
      g.moveTo(p.x, p.y)
        .lineTo(p.x - (vx / n) * len, p.y - (vy / n) * len)
        .stroke({ color: 0xcfe0f0, width: 1, alpha: p.a });
    }
    if (p.y > h + 12) {
      p.y = -10;
      p.x = Math.random() * w;
    } else if (p.y < -14) p.y = h + 10;
    if (p.x > w + 12) p.x = -10;
    else if (p.x < -12) p.x = w + 10;
  }
}

/** One colour per victory condition, so the areas of one condition read as a set. */
const OBJECTIVE_COLORS = [0xe8322b, 0x2f7cf6, 0xd946ef, 0xff9800];
const STAR = 0xffd23f;

const COUNTER = 48;
/** Touch: how long (ms) a finger rests on a hex to open the action wheel, and how far (px) it may drift meanwhile. */
const LONG_PRESS_MS = 450;
const LONG_PRESS_SLOP = 10;
/** A Gun is a 5/8" counter: 60 px at this scale (SW and personnel are 1/2", 48 px). */
const GUN = 60;
/** How long a redraw waits for new counter art before drawing without it (it draws again when the art lands). */
const PRELOAD_WAIT_MS = 1500;
const sizeOf = (d: { kind: string }) => (d.kind === 'gun' || d.kind === 'vehicle' ? GUN : COUNTER);
/** Tint for counters that are done for the phase: clearly darker, still readable. */
const SPENT_TINT = 0x6e6e6e;
/** A broken unit's frame, so even the edge of it showing under the rest of a stack reads as broken. */
const BROKEN_RED = 0xe0504a;
/** Status markers (pin, DM, CX, fire…) sit on their unit like real counters, big enough to read. */
const MARKER = 40;
/** Stacks stay compact: each counter a small step up and right, and never further than this. */
const STACK_DX = 4;
const STACK_DY = -4;
/** The pile key suffix of the units of a hex that are in Bypass (drawn on a corner, full ASL). */
const BYPASS_PILE = '#bypass';
/** How far the piles of a hex with an upper building level move apart: the upper one up-right, the ground one down-left (full ASL). */
const LEVEL_SHIFT = 12;
/** Extra edge of the Level counter left showing under the pile on it. */
const LEVEL_PEEK = 5;
const STACK_MAX_STEPS = 3;
/**
 * The screen offset of each counter of a hex's stack, bottom first. A counter larger than the one
 * beneath it (a ⅝" Gun on the ½" unit possessing it) takes an extra step, so the unit still shows.
 */
function stackOffsets(sizes: number[]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = 0;
  let y = 0;
  let steps = 0;
  sizes.forEach((size, i) => {
    if (i > 0) {
      const below = sizes[i - 1]!;
      const bump = size > below ? (size - below) / 2 + 4 : 0;
      const step = steps < STACK_MAX_STEPS ? 1 : 0;
      steps += step;
      x += step * STACK_DX + bump;
      y += step * STACK_DY - bump;
    }
    out.push({ x, y });
  });
  return out;
}

const easeOut = (t: number) => 1 - (1 - t) ** 3;

/** A floating result text: when it appeared and how far newer lines have pushed it up. */
interface FloatText {
  txt: Text;
  /** Baseline it started from (just above its counter). */
  base: number;
  born: number;
  /** Pixels newer lines pushed it up by; `shown` glides toward it. */
  push: number;
  shown: number;
}
const FLOAT_MS = 2000;
const FLOAT_RISE = 70;
/** Where a floating text's baseline will settle at time `now` (its push applied in full). */
const floatY = (l: FloatText, now: number) => l.base - FLOAT_RISE * Math.min(1, (now - l.born) / FLOAT_MS) - l.push;

/**
 * The image a piece shows: its back when broken (units) or malfunctioned (weapons); a wreck shows the vehicle of its
 * wreck side alone, cut out of the chit with a white rim (`wreckTexture`).
 */
const faceOf = (p: Piece, nationality?: string) => {
  if (p.tags['wreck'] === true) {
    const back = counterImage(p.defId, true);
    return back ? `${WRECK_PREFIX}${back}` : null;
  }
  // An enemy's concealed stack (SK4 8.3): the "?" counter of its army is all there is to see.
  if (p.defId === UNKNOWN_DEF_ID) return nationality ? markerImage(`qmark-${nationality}`) : null;
  return counterImage(p.defId, p.tags['broken'] === true || (p.tags['malf'] === true && p.tags['vca'] === undefined));
};

/** A vehicular MG piece: part of its vehicle, never drawn as a counter of its own. */
const isFixedMg = (d: { kind: string; fixed?: boolean }) => d.kind === 'sw' && !!d.fixed;

/**
 * Where a hexspine points, as a clockwise rotation from straight up in map space (0 = north). Spine `k`
 * lies between neighbour directions `k` and `k + 1`; the direction is read off the hex grid itself.
 */
function spineAngle(cube: { q: number; r: number; s: number }, spine: number): number {
  const c = hexPixel(cube);
  const [i, j] = spineDirections(spine);
  const n = cubeNeighbors(cube);
  const a = hexPixel(n[i]!);
  const b = hexPixel(n[j]!);
  const dx = (a.x + b.x) / 2 - c.x;
  const dy = (a.y + b.y) / 2 - c.y;
  return Math.atan2(dx, -dy);
}

/**
 * Where the counter art points, clockwise from the counter's top edge (radians). The CA is set by the
 * depicted vehicle front or gun barrel, not the counter's edges (ASLRB C3.2, D3.11). The art is printed
 * along a hexspine of a counter set square on the board: every vehicle's front and every Gun's barrel
 * points to the lower right (its trails to the upper left).
 */
const ART_FRONT = (150 * Math.PI) / 180;

/** A counter sprite centred in its box, so it can flip and bob about its own middle. */
/**
 * Shows or hides everything drawn for the units, so hiding them leaves the bare terrain: the counters, Control
 * and Covered Arc shading, hex highlights, effects, LOS and move lines, the turn handles and the hex badges
 * (MF left, rout end). Fortified buildings stay: they belong to the terrain.
 */
function showUnitLayers(L: { highlights: Container; control: Container; ca: Container; pieces: Container; fx: Container; top: Container; controls: Container }, on: boolean) {
  for (const c of [L.highlights, L.control, L.ca, L.pieces, L.fx, L.top, L.controls]) c.visible = on;
}

function counterSprite(tex: Texture, size = COUNTER): Sprite {
  const sp = new Sprite(tex);
  sp.anchor.set(0.5);
  sp.position.set(size / 2, size / 2);
  sp.width = size;
  sp.height = size;
  return sp;
}

/** Map-pixel offset to a neighbouring hex centre, in the engine's direction order (N, NE, SE, S, SW, NW). */

/** A small round badge with a Gun's identity letter, in its colour. */
function identBadge(letter: string, x: number, y: number, r = 7): Container {
  const c = new Container();
  const color = identColor(letter);
  c.addChild(new Graphics().circle(x, y, r).fill({ color, alpha: 0.95 }).stroke({ color: 0x1a1a1a, width: 1.2, alpha: 0.9 }));
  const tx = new Text({ text: letter, style: { fontSize: r * 1.3, fill: 0x111111, fontWeight: 'bold' } });
  tx.anchor.set(0.5);
  tx.position.set(x, y + 0.5);
  c.addChild(tx);
  return c;
}

/** A vehicle's CE/BU tab: amber when Crew Exposed, dark steel when Buttoned Up. */
/** A HIP unit, or a weapon a HIP unit holds: drawn faint for its owner (the enemy's view never has it). */
function hipFaint(s: GameState, p: Piece): boolean {
  if (p.tags['hip'] === true) return true;
  return p.loc.kind === 'held' && s.pieces[p.loc.by]?.tags['hip'] === true;
}

/** How many counters lie under a concealed stack's "?": a dark chip at its lower right corner. */
function countChip(n: number): Container {
  const c = new Container();
  const r = 8;
  c.addChild(new Graphics().circle(1, 2, r).fill({ color: 0x000000, alpha: 0.5 }));
  c.addChild(new Graphics().circle(0, 0, r).fill({ color: 0x1d2430, alpha: 0.95 }).stroke({ color: 0xf2e8c8, width: 1.2, alpha: 0.9 }));
  const tx = new Text({ text: String(n), style: { fontSize: 10, fill: 0xf2e8c8, fontWeight: 'bold' } });
  tx.anchor.set(0.5);
  c.addChild(tx);
  return c;
}

/** How many broken units a stack hides under other counters: a red chip at its lower left corner. */
/** The Collapsed Hut marker (SK4 8.2.1): a brown chit, since VASL has no counter for it. */
function collapsedHutChit(): Container {
  const c = new Container();
  const w = 36;
  const h = 36;
  c.addChild(new Graphics().roundRect(-w / 2 + 1, -h / 2 + 2, w, h, 4).fill({ color: 0x000000, alpha: 0.45 }));
  c.addChild(new Graphics().roundRect(-w / 2, -h / 2, w, h, 4).fill({ color: 0x6b4a2b }).stroke({ color: 0xd9c3a3, width: 1.5 }));
  const tx = new Text({ text: 'HUT\nFALLEN', style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '600', fontSize: 9, fill: 0xf3e6d0, align: 'center', letterSpacing: 0.5 } });
  tx.anchor.set(0.5);
  c.addChild(tx);
  return c;
}

function brokenChip(n: number): Container {
  const c = new Container();
  const r = 8;
  c.addChild(new Graphics().circle(1, 2, r).fill({ color: 0x000000, alpha: 0.5 }));
  c.addChild(new Graphics().circle(0, 0, r).fill({ color: BROKEN_RED }).stroke({ color: 0xffd0c8, width: 1.5 }));
  const tx = new Text({ text: String(n), style: { fontSize: 11, fill: 0xffffff, fontWeight: 'bold' } });
  tx.anchor.set(0.5);
  tx.position.set(0, 0.5);
  c.addChild(tx);
  return c;
}

function crewTab(ce: boolean, size: number, spent: boolean): Container {
  const c = new Container();
  const w = 30;
  const h = 16;
  const x = -5;
  const y = size - h + 5;
  c.addChild(new Graphics().roundRect(x + 1, y + 2, w, h, 4).fill({ color: 0x000000, alpha: 0.5 }));
  c.addChild(new Graphics().roundRect(x, y, w, h, 4).fill({ color: ce ? 0xf0b030 : 0x2b3138 }).stroke({ color: ce ? 0xffe08a : 0x8a96a3, width: 1.5 }));
  const tx = new Text({ text: ce ? 'CE' : 'BU', style: { fontSize: 11, fill: ce ? 0x1a1205 : 0xdfe6ee, fontWeight: 'bold', letterSpacing: 1 } });
  tx.anchor.set(0.5);
  tx.position.set(x + w / 2, y + h / 2 + 0.5);
  c.addChild(tx);
  if (spent) c.alpha = 0.8;
  return c;
}

function dashedLine(g: Graphics, ax: number, ay: number, bx: number, by: number, dash = 8, gap = 6) {
  const len = Math.hypot(bx - ax, by - ay);
  if (len < 1) return;
  const ux = (bx - ax) / len;
  const uy = (by - ay) / len;
  for (let d = 0; d < len; d += dash + gap) {
    const e = Math.min(len, d + dash);
    g.moveTo(ax + ux * d, ay + uy * d).lineTo(ax + ux * e, ay + uy * e);
  }
}

/**
 * Draw the Covered Arc (SK4 3.2.4) of each Gun `shown` picks: the map hexes in it out to `reach`
 * hexes (the arc runs on to the map edge; this shows its direction and true shape), tinted and
 * outlined in the Gun's nationality colour. Every Gun's Acquired Target line is drawn regardless: a
 * dashed line in its identity colour from the Gun to the hex its Acquired Target counter lies in.
 */
/** Tint the hexes of one Covered Arc out to `reach` and outline its edge (dashed for a turret's arc, or a preview). */
function drawWedge(g: Graphics, statics: Statics, t: ViewTransform, h: MapHex, spine: number, nat: string, dashed: boolean, reach = 4) {
  const color = NATION_COLOR[nat] ?? 0xffffff;
  const key = (q: number, r: number) => `${q},${r}`;
  const inArc = [...statics.map.hexes()].filter((m) => cubeDistance(h.cube, m.cube) <= reach && inCoveredArc(h.cube, spine, m.cube));
  const drawn = new Set(inArc.map((m) => key(m.cube.q, m.cube.r)));
  // The arc's edge: hexsides whose neighbour is outside it. The hexside facing neighbour
  // direction k (N, NE, SE, S, SW, NW) runs from corner k + 1 to corner k + 2.
  const edges: [number, number, number, number][] = [];
  for (const m of inArc) {
    const mc = hexPixel(m.cube);
    const pts = hexCorners(mc.x, mc.y);
    if (!dashed) g.poly(toViewPoly(pts, t)).fill({ color, alpha: 0.25 });
    cubeNeighbors(m.cube).forEach((n, k) => {
      if (drawn.has(key(n.q, n.r))) return;
      const a = ((k + 1) % 6) * 2;
      const b = ((k + 2) % 6) * 2;
      const v0 = t.toView(pts[a]!, pts[a + 1]!);
      const v1 = t.toView(pts[b]!, pts[b + 1]!);
      edges.push([v0.x, v0.y, v1.x, v1.y]);
    });
  }
  // Stroked after every fill (a fill takes the pending path with it), over a dark halo so the
  // edge reads on any terrain.
  for (const [width, c, alpha] of [[5, 0x111111, 0.55], [2.5, STOCK_COLOR[nat] ?? color, 0.95]] as const) {
    for (const [x0, y0, x1, y1] of edges) {
      if (dashed) dashedLine(g, x0, y0, x1, y1, 7, 5);
      else g.moveTo(x0, y0).lineTo(x1, y1);
    }
    g.stroke({ color: c, width, alpha, cap: 'round' });
  }
}

function drawCoveredArcs(g: Graphics, s: GameState, statics: Statics, hexOf: (id: HexId) => MapHex | undefined, t: ViewTransform, shown: (p: Piece, at: HexId) => boolean, reach = 4) {
  g.clear();
  const env = { state: s, statics };
  const idents = gunIdents(s, env);
  const wedge = (h: MapHex, spine: number, nat: string, dashed: boolean) => drawWedge(g, statics, t, h, spine, nat, dashed, reach);
  for (const p of Object.values(s.pieces)) {
    if (p.loc.kind === 'eliminated') continue;
    const veh = vehicleDef(env as never, p);
    if (!veh && !gunDef(env as never, p)) continue;
    if (veh && isWreck(p)) continue;
    const at = veh ? hexOfPiece(s, p) : gunHex(env as never, p);
    const h = at ? hexOf(at) : undefined;
    if (!at || !h) continue;
    const c = hexPixel(h.cube);
    if (shown(p, at)) {
      const nat = defOf(env as never, p).nationality;
      if (veh) {
        // The hull's arc, and the turret's dashed over it when it points elsewhere (SK4 3.2.4).
        const vca = vcaOf(p);
        const tca = tcaOf(env as never, p);
        wedge(h, vca, nat, false);
        if (veh.turret !== 'NT' && tca !== vca) wedge(h, tca, nat, true);
      } else wedge(h, coveredArc(p), nat, false);
    }
    const a = acquisitionOf(p);
    const ah = a ? hexOf(a.hex) : undefined;
    if (a && ah && a.hex !== at) {
      const d = hexPixel(ah.cube);
      const v0 = t.toView(c.x, c.y);
      const v1 = t.toView(d.x, d.y);
      const ic = identColor(idents.get(p.id) ?? 'A');
      dashedLine(g, v0.x, v0.y, v1.x, v1.y);
      g.stroke({ color: ic, width: 2, alpha: 0.85 });
      g.circle(v1.x, v1.y, 5).fill({ color: ic, alpha: 0.9 });
    }
  }
}

/** A ticker-driven animation: `step(t)` with t in 0..1, then `end()`. */
interface Anim {
  start: number;
  dur: number;
  step(t: number): void;
  end?(): void;
}

/** Map-pixel centre of a hex (the grid's cube already accounts for board position and rotation). */
export const hexCenter = (h: MapHex, _placements: Placement[]): { x: number; y: number } => hexPixel(h.cube);

/** Hex corners in map pixels, starting at the west corner and going clockwise. */
function hexCorners(cx: number, cy: number): number[] {
  const rx = GEO.px.hexWidth * (2 / 3);
  const ry = GEO.px.hexHeight / 2;
  return [cx - rx, cy, cx - rx / 2, cy - ry, cx + rx / 2, cy - ry, cx + rx, cy, cx + rx / 2, cy + ry, cx - rx / 2, cy + ry];
}

function toViewPoly(pts: number[], t: ViewTransform): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) {
    const v = t.toView(pts[i]!, pts[i + 1]!);
    out.push(v.x, v.y);
  }
  return out;
}

function hexPolygon(cx: number, cy: number, t: ViewTransform): number[] {
  return toViewPoly(hexCorners(cx, cy), t);
}

/** A five-pointed star, point up, in map pixels. */
function starPoints(cx: number, cy: number, r: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.42;
    out.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  return out;
}

/**
 * Draw the scenario objectives: single hexes get a yellow star and outline (VASL style); regions
 * are tinted in the condition's colour with a solid line around their outer boundary only.
 */
function drawObjectives(g: Graphics, objectives: ObjectiveArea[], placements: Placement[], t: ViewTransform, hexOf: (id: HexId) => MapHex | undefined) {
  for (const o of objectives) {
    const color = OBJECTIVE_COLORS[o.group % OBJECTIVE_COLORS.length]!;
    const centers = o.hexes.map((id) => hexOf(id)).filter((h): h is MapHex => !!h).map((h) => hexCenter(h, placements));
    if (o.kind === 'hex') {
      // A thin outline and a small star tucked under the top of the hex, so the terrain stays readable.
      for (const c of centers) {
        g.poly(hexPolygon(c.x, c.y, t)).stroke({ color: STAR, width: 2, alpha: 0.9 });
        g.poly(toViewPoly(starPoints(c.x, c.y - GEO.px.hexHeight * 0.3, GEO.px.hexHeight * 0.13), t)).fill({ color: STAR, alpha: 0.95 }).stroke({ color: 0x3b2a00, width: 1, alpha: 0.9 });
      }
      continue;
    }
    for (const c of centers) g.poly(hexPolygon(c.x, c.y, t)).fill({ color, alpha: 0.2 });
    // Outer boundary: a hexside is inner when the hex across it is also in the region.
    const inside = (x: number, y: number) => centers.some((c) => Math.hypot(c.x - x, c.y - y) < 4);
    for (const c of centers) {
      const pts = hexCorners(c.x, c.y);
      for (let i = 0; i < 12; i += 2) {
        const ax = pts[i]!;
        const ay = pts[i + 1]!;
        const bx = pts[(i + 2) % 12]!;
        const by = pts[(i + 3) % 12]!;
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        if (inside(2 * mx - c.x, 2 * my - c.y)) continue;
        const a = t.toView(ax, ay);
        const b = t.toView(bx, by);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color, width: 5, alpha: 0.95 });
      }
    }
  }
}

/** Counter base colour of each nationality, for the control chits (sampled from the counter art). */
const NATION_COLOR: Record<string, number> = { ge: 0x5f87a1, am: 0x727b23, ru: 0x7c510d, br: 0xb8975a, al: 0x6f9c5a, it: 0x6c7a82 };
/** Stock colours for counters without art. */
const STOCK_COLOR: Record<string, number> = { ge: 0x9ac8e8, ru: 0xc8a050, am: 0x9fbf5f, br: 0xe5cea0, al: 0xbfe3c4, it: 0xd2d6d8 };
/** Control chit: a quarter of a counter's width, as VASL players place them. */
const CONTROL_CHIT = COUNTER / 4;

/**
 * Control chits: a small square in the nationality's counter colour in the centre of each
 * Controlled hex, drawn under the counters so an occupied hex still shows who holds it.
 */
function drawControl(g: Graphics, control: Record<HexId, SideId>, statics: Statics, hexOf: (id: HexId) => MapHex | undefined, center: (h: MapHex) => { x: number; y: number }) {
  g.clear();
  const half = CONTROL_CHIT / 2;
  for (const [hex, side] of Object.entries(control)) {
    const h = hexOf(hex as HexId);
    if (!h) continue;
    const nat = statics.scenario.sides.find((x) => x.side === side)?.nationality ?? side;
    const c = center(h);
    g.roundRect(c.x - half + 1, c.y - half + 1, CONTROL_CHIT, CONTROL_CHIT, 1.5).fill({ color: 0x000000, alpha: 0.4 });
    g.roundRect(c.x - half, c.y - half, CONTROL_CHIT, CONTROL_CHIT, 1.5)
      .fill({ color: NATION_COLOR[nat] ?? 0x888888 })
      .stroke({ color: 0xf2e8c8, width: 1, alpha: 0.9 });
  }
}

/** Hexes out of play: a dark wash over the board art (drawn after the fortified layer is cleared). */
function drawOutOfPlay(g: Graphics, hexes: HexId[], hexOf: (id: HexId) => MapHex | undefined, t: ViewTransform) {
  for (const id of hexes) {
    const h = hexOf(id);
    if (!h) continue;
    const c = hexCenter(h, placementsUnused);
    g.poly(hexPolygon(c.x, c.y, t)).fill({ color: 0x0d0f0b, alpha: 0.72 });
  }
}

/** Fortified building hexes: a rampart-coloured wash and a thick double outline around the building. */
const FORT_COLOR = 0x8a3b12;
function drawFortified(g: Graphics, hexes: HexId[], hexOf: (id: HexId) => MapHex | undefined, t: ViewTransform) {
  g.clear();
  const centers = hexes.map((id) => hexOf(id)).filter((h): h is MapHex => !!h).map((h) => hexCenter(h, placementsUnused));
  const inside = (x: number, y: number) => centers.some((c) => Math.hypot(c.x - x, c.y - y) < 4);
  for (const c of centers) g.poly(hexPolygon(c.x, c.y, t)).fill({ color: FORT_COLOR, alpha: 0.22 });
  for (const c of centers) {
    const pts = hexCorners(c.x, c.y);
    for (let i = 0; i < 12; i += 2) {
      const ax = pts[i]!;
      const ay = pts[i + 1]!;
      const bx = pts[(i + 2) % 12]!;
      const by = pts[(i + 3) % 12]!;
      if (inside(2 * ((ax + bx) / 2) - c.x, 2 * ((ay + by) / 2) - c.y)) continue;
      const a = t.toView(ax, ay);
      const b = t.toView(bx, by);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xf2e8c8, width: 6, alpha: 0.9 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: FORT_COLOR, width: 3, alpha: 1 });
    }
  }
}
/** `hexCenter` no longer reads the placements (positions come from the grid), so any value will do. */
const placementsUnused: Placement[] = [];

/**
 * The MG "Malfunction" / "Disabled" markers a vehicle wears for its vehicular MGs (SK4 7.8): the MG
 * pieces are held by the vehicle and never drawn, so their state shows on the vehicle.
 */
export function vehicleMgMarkers(env: { state: GameState; statics: Statics }, p: Piece): string[] {
  if (p.tags['vca'] === undefined || p.tags['wreck']) return [];
  const out: string[] = [];
  for (const w of swHeldBy(env.state, p.id)) {
    const d = defOf(env as unknown as QueryEnv, w);
    if (d.kind !== 'sw' || !d.fixed) continue;
    if (w.tags['mgDisabled']) out.push(`Dis${d.type}`);
    else if (w.tags['malf']) out.push(`Malf${d.type}`);
  }
  return out;
}

/** Badge markers drawn on a unit for its status tags; `moving` is the vehicle now spending MP, if any. */
function unitMarkers(p: Piece, nationality?: string, moving?: string): string[] {
  const m: string[] = [];
  const t = p.tags;
  // A wreck is debris: the status it had as a vehicle (Immobile, Motion, a malfunctioned MA...) no longer applies.
  if (t['wreck']) return m;
  if (t['pinned']) m.push('pin');
  if (t['dm']) m.push('dm');
  if (t['cx']) m.push(cxMarker(nationality));
  // A unit that fired only its SW wears the SW's marker (SK1 3.2.2), so it still shows once the SW is gone.
  const fire = shownFireMarker(p);
  if (fire === 'prep') m.push('FirePrep');
  if (fire === 'adv') m.push('FireAdv');
  if (fire === 'first') m.push('First');
  if (fire === 'final') m.push('Final');
  if (t['wounds']) m.push('Wound');
  // A hidden (HIP) unit wears no "?": that is concealment's counter. Its owner sees it drawn faint instead (`hipFaint`).
  // SK4 8.3: the owner's concealed units wear their "?" (the enemy sees a bare "?" stand-in instead).
  if (t['concealed'] && nationality && p.defId !== UNKNOWN_DEF_ID) m.push(`qmark-${nationality}`);
  // SK4 8.1.8.6: the Banzai counter for the Player Turn.
  if (t['banzai'] !== undefined) m.push('Banzai');
  // SK3 vehicles (SK4 3.3.2, 7.2, 7.6, 7.7, 7.10).
  if (t['vca'] !== undefined) {
    // No CE counter: the vehicle's CE/BU tab shows its crew status (`crewTab`).
    // The Motion counter comes off when the vehicle starts its MPh: it is marked only before or after its MPh (ASLRB D2.4).
    if (t['motion'] && p.id !== moving) m.push('Motion');
    if (t['bog'] === 'bogged') m.push('Bog');
    if (t['bog'] === 'mired') m.push('Mired');
    if (t['immob']) m.push('Immob');
    if (t['shock'] === 'shock') m.push('Shock');
    if (t['shock'] === 'uk') m.push('UK');
    if (t['stun'] === 'fresh') m.push('Stun');
    if (t['stun'] === 'plus1') m.push('StunPlus1');
    if (t['recall']) m.push('Recall');
    if (t['bff']) m.push('FireBnd');
    if (t['lowAmmo']) m.push('LowAmmo');
    if (t['malf']) m.push('MalfMA');
    if (t['maDisabled']) m.push('DisMA');
  }
  return m;
}

/** Text badges for states without marker art (Intensive Fire, a captured Gun). */
function unitBadges(p: Piece, captured: boolean): string[] {
  const out: string[] = [];
  if (p.tags['intensive']) out.push('IF');
  if (captured) out.push('CAPT');
  if (p.tags['hazardous']) out.push('HAZ');
  // A unit still in its prepared position (SSR: +TEM until it leaves the hex).
  if (p.loc.kind === 'hex' && p.tags['prepared'] === p.loc.hex) out.push('DUG');
  return out;
}

export function BoardView({
  state,
  statics,
  placements,
  overlay,
  onHexClick,
  onHexHover,
  onHexContextMenu,
  offboard = [],
  onDropPiece,
  draggablePiece,
  onReturnPiece,
  rotation = 0,
  fx = [],
  animate = true,
  objectives = [],
  control = {},
  fortified = [],
  outOfPlay = [],
  hidePieces = false,
  hideMarkers = false,
  weather = null,
  holdFace,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  /** Arrow shown at the pane's edge, pointing at the map, whenever the map is (nearly) out of view. */
  const finder = useRef<HTMLButtonElement>(null);
  const appRef = useRef<Application | null>(null);
  const world = useRef<Container | null>(null);
  const layers = useRef<{ highlights: Graphics; fort: Graphics; control: Graphics; ca: Graphics; pieces: Container; fx: Container; top: Graphics; controls: Container } | null>(null);
  /** The drawn handles' view-space hit circles, and the one under the pointer. */
  const controlHits = useRef<{ c: HexControl; hit(vx: number, vy: number): boolean; dist?(vx: number, vy: number): number }[]>([]);
  const hoverControl = useRef<string | null>(null);
  const anims = useRef<Anim[]>([]);
  /** Counter slides in flight, by piece, so a redraw can hand them over instead of orphaning them. */
  const slides = useRef(new Map<string, { box: Container; anim: Anim }>());
  /** Last drawn view position of each piece's counter (for movement tweens and elimination ghosts). */
  const lastPos = useRef(new Map<string, { x: number; y: number; url: string | null }>());
  /** Effects already played, by id: ids are handed out when a beat is built, not in the order beats play (a ping can jump the queue). */
  const playedFx = useRef(new Set<number>());
  const animateRef = useRef(animate);
  animateRef.current = animate;
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const weatherSim = useRef<WeatherSim>({ kind: null, drops: [], t: 0 });
  /** Dev/test counters: how often the canvas was (re)built and how many effects of each kind have played. */
  const stats = useRef({ builds: 0, fxPlayed: 0, fx: {} as Record<string, number> });
  const centers = useRef<{ id: HexId; x: number; y: number }[]>([]);
  const xf = useRef<ViewTransform>(viewTransform(placements, rotation));
  /** Hex centre in view coordinates. */
  const center = (h: MapHex) => {
    const c = hexCenter(h, placements);
    return xf.current.toView(c.x, c.y);
  };
  const cb = useRef({ onHexClick, onHexHover, onHexContextMenu, onDropPiece, draggablePiece, onReturnPiece, holdFace });
  cb.current = { onHexClick, onHexHover, onHexContextMenu, onDropPiece, draggablePiece, onReturnPiece, holdFace };
  /** The drawn counter of each piece (rebuilt by every redraw), for face flips and burn-aways. */
  const faces = useRef(new Map<string, { box: Container; sprite: Sprite | null; size: number }>());
  /** Map or offboard hex by id. */
  // A Location id (full ASL upper level, "uK4:1") stands for its hex.
  const anyHex = (id: HexId) => statics.map.hex(hexOfLoc(id)) ?? statics.map.offboardHex(id);
  const ready = useRef(false);
  /** Floating result texts still on screen, per hex: a new one starts at the counter and pushes these up. */
  const liveTexts = useRef(new Map<string, FloatText[]>());
  const latest = useRef({ state, overlay, control, fortified, outOfPlay });
  latest.current = { state, overlay, control, fortified, outOfPlay };
  /** The hex under the pointer: a Gun there shows its Covered Arc. */
  const hoverHex = useRef<HexId | null>(null);
  /** Covered Arcs only for a Gun under the pointer, in the selected hex or among the selected units (or held by one). */
  function drawArcs() {
    const L = layers.current;
    if (!L) return;
    const { state: s, overlay: o } = latest.current;
    drawCoveredArcs(L.ca, s, statics, anyHex, xf.current, (p, at) =>
      at === hoverHex.current || at === o.selectedHex || !!o.selectedPieces?.has(p.id) || (p.loc.kind === 'held' && !!o.selectedPieces?.has(p.loc.by)));
    // A spine handle under the pointer: the Covered Arc it would set, dashed over the current one.
    const hot = o.controls?.find((c) => c.id === hoverControl.current && c.arc && c.spine !== undefined && !c.disabled);
    const h = hot ? anyHex(hot.hex) : undefined;
    if (hot && h) drawWedge(L.ca, statics, xf.current, h, hot.spine!, hot.arc!, true);
  }

  /** Interface palette for on-map controls (the action wheel's: dark gradient, olive line, brass when live). */
  const UI = { ink: 0x0e110e, face: 0x1c211c, faceHi: 0x2c332c, line: 0x4a5443, lineHi: 0x55624a, brass: 0xc9a24a, brassHi: 0xf0cf72, text: 0xece6d2 } as const;

  /**
   * Texture resolution for text drawn on the map at the current zoom. Handle labels and hints are rasterised
   * at their map-space size and then scaled up with the world, so zoomed in they must be drawn at that many
   * more pixels (times the device ratio) or they blur.
   */
  const textRes = () => (window.devicePixelRatio || 1) * Math.max(1, world.current?.scale.x ?? 1);

  /** The hint shown beside a hovered handle, styled like the stack peek: dark card, olive line, brass edge, condensed caps. */
  function controlTip(text: string, x: number, y: number, left: boolean, k: number): Container {
    const tip = new Text({ text: text.toUpperCase(), resolution: textRes(), style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '600', fontSize: 11 * k, letterSpacing: 0.8 * k, fill: UI.text, wordWrap: true, wordWrapWidth: 220 * k } });
    // A hint that would run off the edge of the pane goes on the other side of the handle instead.
    const w = world.current;
    const pane = appRef.current?.screen.width ?? Infinity;
    if (w) {
      const span = (tip.width + 24 * k) * w.scale.x;
      const sx = w.x + x * w.scale.x;
      if (left && sx - span < 0) left = false;
      else if (!left && sx + span > pane) left = true;
    }
    tip.anchor.set(left ? 1 : 0, 0.5);
    tip.position.set(x + (left ? -10 * k : 10 * k), y);
    const bg = new Graphics();
    const bx = tip.x - (left ? tip.width : 0) - 7 * k;
    const by = tip.y - tip.height / 2 - 4 * k;
    bg.roundRect(bx, by, tip.width + 14 * k, tip.height + 8 * k, 3 * k).fill({ color: 0x0a0c0a, alpha: 0.94 }).stroke({ color: UI.lineHi, width: 1 * k });
    bg.rect(left ? bx + tip.width + 14 * k - 3 * k : bx, by, 3 * k, tip.height + 8 * k).fill({ color: UI.brass });
    const c = new Container();
    c.addChild(bg, tip);
    return c;
  }

  /**
   * The on-map handles, rebuilt from the overlay; the hovered one shows its hint. A moving vehicle's
   * hull/turret turns are round buttons beside its hex. Spine handles form a ring around the hex cut
   * into six sectors, each spanning the slice of directions its hexspine's Covered Arc covers (from
   * one bounding neighbour to the other), with a chevron on the hexspine itself: the ring turns and
   * scales with the map, its thickness clamped so it stays usable at any zoom.
   */
  function drawControls() {
    const L = layers.current;
    if (!L) return;
    L.controls.removeChildren().forEach((ch) => ch.destroy({ children: true }));
    controlHits.current = [];
    const scale = world.current?.scale.x ?? 1;
    const R = GEO.px.hexWidth * (2 / 3);
    const tips: Container[] = [];
    for (const c of latest.current.overlay.controls ?? []) {
      const h = anyHex(c.hex);
      if (!h) continue;
      const o = center(h);
      const hot = hoverControl.current === c.id && !c.disabled;
      const g = new Graphics();
      if (c.corner !== undefined) {
        // A Bypass corner (full ASL): a numbered dot on the corner itself, the same size on screen at every zoom; its hit
        // area is a finger wide (22 px round it), the nearest dot winning where two overlap.
        const mp = hexCenter(h, placements);
        const off = cornerOffset(c.corner);
        const p = xf.current.toView(mp.x + off.x, mp.y + off.y);
        const k = 1 / scale;
        if ((hot || c.active) && c.path?.length) {
          const pts = c.path.map((q) => xf.current.toView(q.x, q.y));
          for (let i = 1; i < pts.length; i++) dashedLine(g, pts[i - 1]!.x, pts[i - 1]!.y, pts[i]!.x, pts[i]!.y, 6 * k, 5 * k);
          g.stroke({ color: UI.brassHi, width: 4 * k, alpha: 0.95, cap: 'round' });
        }
        const r = 11 * k;
        g.circle(p.x, p.y, r + 3 * k).fill({ color: 0x000000, alpha: 0.35 });
        g.circle(p.x, p.y, r).fill({ color: c.active ? UI.brass : hot ? UI.faceHi : UI.face, alpha: c.disabled ? 0.5 : 0.95 }).stroke({ color: c.active ? UI.brassHi : hot ? UI.brassHi : 0x46d16a, width: 2.2 * k });
        const t = new Text({ text: c.glyph, resolution: textRes(), style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '700', fontSize: 13 * k, fill: c.active ? UI.ink : UI.text } });
        t.anchor.set(0.5, 0.55);
        t.position.set(p.x, p.y);
        L.controls.addChild(g, t);
        if (c.tag) {
          const tag = new Text({ text: c.tag.toUpperCase(), resolution: textRes(), style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '600', fontSize: 9.5 * k, letterSpacing: 0.6 * k, fill: 0x0d120c } });
          const ux = off.x / Math.hypot(off.x, off.y);
          const uy = off.y / Math.hypot(off.x, off.y);
          tag.anchor.set(0.5, 0.5);
          tag.position.set(p.x + ux * (r + 6 * k + tag.width / 2) , p.y + uy * (r + 10 * k));
          const tb = new Graphics().roundRect(tag.x - tag.width / 2 - 4 * k, tag.y - tag.height / 2 - 1.5 * k, tag.width + 8 * k, tag.height + 3 * k, 3 * k).fill({ color: 0x46d16a, alpha: c.disabled ? 0.5 : 0.95 });
          L.controls.addChild(tb, tag);
        }
        if (hot && c.hint) tips.push(controlTip(c.hint, p.x + r + 4 * k, p.y - 22 * k, p.x > o.x ? false : true, k));
        const reach = Math.max(r + 3 * k, 22 * k);
        controlHits.current.push({ c, hit: (vx, vy) => (vx - p.x) ** 2 + (vy - p.y) ** 2 <= reach ** 2, dist: (vx, vy) => Math.hypot(vx - p.x, vy - p.y) });
        continue;
      }
      if (c.spine !== undefined) {
        // Where the hexspine points on screen (read off the grid, then turned with the view).
        const a = spineAngle(h.cube, c.spine) + xf.current.angle;
        const deg = ((((a * 180) / Math.PI) % 360) + 360) % 360;
        // Ring in map units so it follows the hex; thickness held between 0.45R and 1.1R so it reads zoomed out and does not swamp the hex zoomed in.
        const r0 = R * 1.12;
        const thick = Math.min(1.1 * R, Math.max(0.45 * R, 24 / scale));
        const r1 = r0 + thick;
        const k = thick / 24;
        // Pixi measures angles from +x clockwise (y down); screen angles here run clockwise from up.
        const gap = 1.5 / r0;
        const t0 = a - Math.PI / 2 - Math.PI / 6 + gap;
        const t1 = a - Math.PI / 2 + Math.PI / 6 - gap;
        g.arc(o.x, o.y, r1, t0, t1).arc(o.x, o.y, r0, t1, t0, true).closePath();
        g.fill({ color: c.active ? UI.brass : hot ? UI.faceHi : UI.face, alpha: c.disabled ? 0.45 : c.active ? 0.96 : 0.9 });
        g.stroke({ color: c.active ? UI.brassHi : hot ? UI.brass : UI.line, width: (hot || c.active ? 1.6 : 1) * k, alpha: c.disabled ? 0.4 : 1, join: 'round' });
        // The hexspine itself: a ray from the hex corner through the sector, and a chevron on it pointing the way.
        const ux = Math.sin(a);
        const uy = -Math.cos(a);
        const rayCol = c.active ? UI.brassHi : hot ? UI.brassHi : UI.brass;
        g.moveTo(o.x + ux * R * 0.98, o.y + uy * R * 0.98).lineTo(o.x + ux * (r0 - 2 * k), o.y + uy * (r0 - 2 * k)).stroke({ color: rayCol, width: (hot || c.active ? 2 : 1.2) * k, alpha: c.disabled ? 0.3 : hot || c.active ? 1 : 0.7, cap: 'round' });
        const mid = (r0 + r1) / 2;
        const cs = Math.min(thick * 0.28, 9 * k);
        const px = ux * cs;
        const py = uy * cs;
        const qx = -uy * cs;
        const qy = ux * cs;
        const tipx = o.x + ux * mid + px * 0.6;
        const tipy = o.y + uy * mid + py * 0.6;
        g.moveTo(tipx - px - qx, tipy - py - qy).lineTo(tipx, tipy).lineTo(tipx - px + qx, tipy - py + qy);
        g.stroke({ color: c.active ? UI.ink : hot ? UI.brassHi : UI.text, width: 2.2 * k, alpha: c.disabled ? 0.35 : 1, cap: 'round', join: 'round' });
        L.controls.addChild(g);
        if (hot && c.hint) tips.push(controlTip(c.hint, o.x + ux * (r1 + 2), o.y + uy * (r1 + 2), deg > 180, 1 / Math.min(1, scale)));
        const [lo, hi] = [t0, t1];
        controlHits.current.push({
          c,
          hit: (vx, vy) => {
            const d = Math.hypot(vx - o.x, vy - o.y);
            if (d < r0 - 2 || d > r1 + 2) return false;
            let t = Math.atan2(vy - o.y, vx - o.x);
            while (t < lo - Math.PI) t += 2 * Math.PI;
            while (t > lo + Math.PI) t -= 2 * Math.PI;
            return t >= lo - gap && t <= hi + gap;
          },
        });
        continue;
      }
      // Turn handles: zoomed out they keep their screen size and step out so they clear the counter; zoomed
      // in they stay just outside it (a fixed spot on the map) and grow gently, by the square root of the
      // zoom, so they neither swamp the hex nor get lost beside a big counter. Styled like the action
      // wheel (dark face, olive line, brass when live), each pair told apart three ways: the hull's are square
      // key caps in the ink-on-parchment text colour, the turret's round and brass, and a small caps label
      // sits outside each one.
      const a = ((c.angle ?? 0) * Math.PI) / 180;
      const k = scale >= 1 ? 1 / Math.sqrt(scale) : 1 / scale;
      const dist = (c.dist ?? 0.68) * Math.max(1, 1 / scale);
      const ux = Math.sin(a);
      const uy = -Math.cos(a);
      const x = o.x + ux * dist * GEO.px.hexHeight;
      const y = o.y + uy * dist * GEO.px.hexHeight;
      const r = 11 * k;
      const tone = c.tone === 'hull' ? UI.text : UI.brass;
      const line = c.disabled ? UI.line : hot ? UI.brassHi : tone;
      const face = c.active ? tone : hot ? UI.faceHi : UI.face;
      const alpha = c.disabled ? 0.45 : 1;
      if (c.tone === 'hull') g.roundRect(x - r, y - r, 2 * r, 2 * r, 3.5 * k);
      else g.circle(x, y, r);
      g.fill({ color: face, alpha: c.disabled ? 0.6 : 0.94 }).stroke({ color: line, width: (hot ? 2 : 1.4) * k, alpha });
      const ink = c.active ? UI.ink : hot ? UI.brassHi : tone;
      if (c.glyph === '↻' || c.glyph === '↺') {
        // A turning arrow: three quarters of a circle from the top, round to the side, with a small filled
        // head at that end pointing up into the gap (clockwise: round the right, head on the left).
        const cw = c.glyph === '↻';
        const ra = r * 0.52;
        const s0 = -Math.PI / 2;
        const s1 = cw ? Math.PI : 0;
        g.moveTo(x + Math.cos(s0) * ra, y + Math.sin(s0) * ra).arc(x, y, ra, s0, s1, !cw).stroke({ color: ink, width: 1.8 * k, alpha, cap: 'round' });
        const ex = x + Math.cos(s1) * ra;
        const ey = y + Math.sin(s1) * ra;
        // At either end the arc is travelling straight up: the head is a triangle on that line.
        const hl = 4.5 * k;
        const hw = 3 * k;
        g.poly([ex, ey - hl * 0.55, ex - hw, ey + hl * 0.45, ex + hw, ey + hl * 0.45]).fill({ color: ink, alpha });
        L.controls.addChild(g);
      } else {
        const t = new Text({ text: c.glyph, resolution: textRes(), style: { fontSize: 14 * k, fill: ink, fontWeight: 'bold' } });
        t.anchor.set(0.5, 0.56);
        t.position.set(x, y);
        t.alpha = alpha;
        L.controls.addChild(g, t);
      }
      // The label, just outside the handle along its direction from the hex.
      const label = new Text({ text: c.tone === 'hull' ? 'HULL' : 'TURRET', resolution: textRes(), style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '600', fontSize: 8.5 * k, letterSpacing: 0.9 * k, fill: hot ? UI.brassHi : tone } });
      label.anchor.set(0.5, 0.5);
      const lw = label.width + 8 * k;
      const lh = label.height + 3 * k;
      const off = r + 3 * k + (lw / 2) * Math.abs(ux) + (lh / 2) * Math.abs(uy);
      label.position.set(x + ux * off, y + uy * off);
      label.alpha = alpha;
      const lbg = new Graphics().roundRect(label.x - lw / 2, label.y - lh / 2, lw, lh, 2.5 * k).fill({ color: 0x0a0c0a, alpha: c.disabled ? 0.5 : 0.82 });
      L.controls.addChild(lbg, label);
      const left = (((c.angle ?? 0) % 360) + 360) % 360 > 180;
      if (hot && c.hint) tips.push(controlTip(c.hint, left ? label.x - lw / 2 : label.x + lw / 2, y, left, k));
      const rr = r + 3 * k;
      controlHits.current.push({ c, hit: (vx, vy) => (vx - x) ** 2 + (vy - y) ** 2 <= rr ** 2 || (Math.abs(vx - label.x) <= lw / 2 && Math.abs(vy - label.y) <= lh / 2) });
    }
    // Badges: a pill just above the hex, styled like the handle labels (dark face, brass edge, condensed caps).
    // Zoomed out it keeps its screen size and steps up to clear the counter; zoomed in it sits on a fixed spot.
    for (const b of latest.current.overlay.badges ?? []) {
      const h = anyHex(b.hex);
      if (!h) continue;
      // A badge for a stack on a hex corner (Bypass) stands above that point, not above the hex.
      const o = b.at ? xf.current.toView(b.at.x, b.at.y) : center(h);
      const k = scale >= 1 ? 1 / Math.sqrt(scale) : 1 / scale;
      const t = new Text({ text: b.text.toUpperCase(), resolution: textRes(), style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '600', fontSize: 11 * k, letterSpacing: 0.9 * k, fill: UI.brassHi } });
      t.anchor.set(0.5, 0.5);
      const pw = t.width + 14 * k;
      const ph = t.height + 6 * k;
      // On a corner (a stack in Bypass) the pill goes just under the pile, clear of the hexes' own badges above them.
      const y = b.at ? o.y + (COUNTER / 2) * Math.max(1, 1 / scale) + ph / 2 + 6 * k : o.y - (GEO.px.hexHeight / 2) * Math.max(1, 1 / scale) - ph / 2 - 3 * k;
      t.position.set(o.x, y);
      const bg = new Graphics().roundRect(o.x - pw / 2, y - ph / 2, pw, ph, 3 * k).fill({ color: 0x0a0c0a, alpha: 0.92 }).stroke({ color: UI.lineHi, width: 1 * k });
      bg.rect(o.x - pw / 2, y - ph / 2, 3 * k, ph).fill({ color: UI.brass });
      L.controls.addChild(bg, t);
    }
    // Hints last, over every handle.
    for (const t of tips) L.controls.addChild(t);
  }

  // The map setup by content: a parent handing down fresh arrays of the same placements, offboard
  // hexes or objectives must not rebuild the canvas (that blanks the board and drops every
  // running effect). Only a real change to what is drawn underneath does.
  const setupKey = JSON.stringify({ placements, objectives, offboard: offboard.map((h) => h.id) });
  // One-time Pixi setup.
  useEffect(() => {
    let destroyed = false;
    stats.current.builds++;
    const app = new Application();
    // Pixi's `resizeTo` follows window resizes only. The pane also changes size on its own (the table chat rail opening
    // or closing beside it; closing it would leave the canvas at the narrower width with a black strip beside it), so the canvas follows the pane itself.
    let observer: ResizeObserver | null = null;
    let uninstall: (() => void) | null = null;
    (async () => {
      await app.init({ resizeTo: host.current!, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
      if (destroyed) {
        app.destroy(true);
        return;
      }
      host.current!.appendChild(app.canvas);
      appRef.current = app;
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => app.queueResize());
        observer.observe(host.current!);
      }
      const w = new Container();
      world.current = w;
      app.stage.addChild(w);

      const t = viewTransform(placements, rotation);
      xf.current = t;
      // Positions remembered from a previous view (e.g. before a rotation) are in the old
      // view space; forget them so counters snap into place instead of sliding across the map.
      lastPos.current = new Map();
      const art = new Container();
      art.rotation = t.angle;
      art.position.set(t.origin.x, t.origin.y);
      w.addChild(art);
      for (const p of placements) {
        const url = boardImage(p.board);
        if (!url) continue;
        const tex = await Assets.load<Texture>(url);
        // Board art may be drawn at a multiple of the VASL geometry (the high-resolution boards);
        // crop in the art's own pixels and scale the sprite back onto the 1800×645 board.
        const k = tex.width / GEO.px.width;
        if (k > 1) tex.source.autoGenerateMipmaps = true;
        const src = printedRect(p);
        const crop = new Texture({ source: tex.source, frame: new Rectangle(src.x0 * k, src.y0 * k, (src.x1 - src.x0) * k, (src.y1 - src.y0) * k) });
        const s = new Sprite(crop);
        s.scale.set(1 / k);
        if (p.rotation === 180) {
          // Upside down: the crop's far corner is pinned where the turned board's near corner lands.
          s.anchor.set(1, 1);
          s.rotation = Math.PI;
          const at = playableRect(p);
          s.position.set(p.x * GEO.px.width + at.x0, p.y * GEO.px.height + at.y0);
        } else s.position.set(p.x * GEO.px.width + src.x0, p.y * GEO.px.height + src.y0);
        art.addChild(s);
      }
      // Offboard entry hexes: drawn as dark virtual hexes beside the map edge.
      const offLayer = new Graphics();
      for (const h of offboard) {
        const c = hexCenter(h, placements);
        offLayer.poly(hexPolygon(c.x, c.y, t)).fill({ color: 0x2c3024, alpha: 0.95 }).stroke({ color: 0x7d8466, width: 1.5, alpha: 0.9 });
      }
      w.addChild(offLayer);
      // Hill hexes (SK2): a faint warm wash over every hex the engine holds at level 1 or more, so the
      // Crest Line the rules use (the hex centre's level) can be told from the art's brown edge.
      const hills = new Graphics();
      for (const h of statics.map.hexes()) {
        if (!h.elevation) continue;
        const c = hexCenter(h, placements);
        hills.poly(hexPolygon(c.x, c.y, t)).fill({ color: 0xb8742a, alpha: 0.1 });
      }
      w.addChild(hills);
      const objLayer = new Graphics();
      // A hidden hex (S70's Connection Location) has no place on the boards to tint.
      drawObjectives(objLayer, objectives, placements, t, (id) => (statics.map.isHidden?.(id) ? undefined : anyHex(id)));
      w.addChild(objLayer);
      const highlights = new Graphics();
      const fort = new Graphics();
      const control = new Graphics();
      const ca = new Graphics();
      const pieces = new Container();
      // Stacks are drawn shortest first (see draw), so a tall pile covers the short ones beside it, as on a real board.
      pieces.sortableChildren = true;
      const fxLayer = new Container();
      const top = new Graphics();
      const controls = new Container();
      w.addChild(fort, highlights, control, ca, pieces, fxLayer, top, controls);
      layers.current = { highlights, fort, control, ca, pieces, fx: fxLayer, top, controls };
      showUnitLayers(layers.current, !hideRef.current);
      // Weather over the whole pane, in screen space above the map; it takes no pointer events.
      const weatherLayer = new Graphics();
      weatherLayer.eventMode = 'none';
      app.stage.addChild(weatherLayer);
      // Animation driver: highlight pulse plus any running tweens/effects.
      app.ticker.add(() => {
        const now = performance.now();
        highlights.alpha = 0.8 + 0.2 * Math.sin(now / 350);
        try {
          stepWeather(weatherLayer, weatherSim.current, weatherRef.current, app.screen.width, app.screen.height, app.ticker.deltaMS);
        } catch (err) {
          console.warn('[board] weather dropped after error', err);
          weatherRef.current = null;
        }
        const list = anims.current;
        for (let i = list.length - 1; i >= 0; i--) {
          const a = list[i]!;
          const t = Math.min(1, (now - a.start) / a.dur);
          // One failing animation must not escape: Pixi's ticker does not catch listener
          // errors, and an uncaught one stops its frame loop, freezing the whole board.
          try {
            a.step(t);
            if (t >= 1) a.end?.();
          } catch (err) {
            console.warn('[board] animation dropped after error', err);
            list.splice(i, 1);
            continue;
          }
          if (t >= 1) list.splice(i, 1);
        }
      });
      centers.current = [...statics.map.hexes(), ...offboard].map((h) => ({ id: h.id, ...hexCenter(h, placements) }));

      fitView();
      // The pane can shrink or grow under the map (window resized, panels opened): pull it back in.
      app.renderer.on('resize', () => clampView(w, t.width, t.height, app.screen.width, app.screen.height));
      app.ticker.add(updateFinder);

      uninstall = installInteraction(app, w);
      setCaptureSource(app);

      // Dev only: hex centre in page pixels, so a DevTools-protocol driver can click hexes
      // when recording the app (screenshots, trailers).
      if (import.meta.env.DEV) {
        (window as unknown as { aslBoard: unknown }).aslBoard = {
          stats: () => ({ ...stats.current, fx: { ...stats.current.fx } }),
          /** The map's screen offset and zoom; `setView` moves it without the pan limits (to test the off-screen arrow). */
          view: () => ({ x: w.x, y: w.y, scale: w.scale.x }),
          setView: (x: number, y: number, scale = w.scale.x) => {
            w.scale.set(scale);
            w.position.set(x, y);
          },
          hexToClient: (id: HexId) => {
            const h = anyHex(id);
            if (!h) return null;
            const v = center(h);
            const rect = app.canvas.getBoundingClientRect();
            return { x: rect.left + w.x + v.x * w.scale.x, y: rect.top + w.y + v.y * w.scale.y };
          },
          /** Page position of an on-map handle by its id (a spine sector's middle), so a driver can click it. */
          controlToClient: (id: string) => {
            const c = (latest.current.overlay.controls ?? []).find((x) => x.id === id);
            const h = c ? anyHex(c.hex) : undefined;
            if (!c || !h) return null;
            if (c.corner !== undefined) {
              const m = hexCenter(h, placements);
              const off = cornerOffset(c.corner);
              const v = xf.current.toView(m.x + off.x, m.y + off.y);
              const rect = app.canvas.getBoundingClientRect();
              return { x: rect.left + w.x + v.x * w.scale.x, y: rect.top + w.y + v.y * w.scale.y };
            }
            const o = center(h);
            const scale = w.scale.x;
            const R = GEO.px.hexWidth * (2 / 3);
            let x: number;
            let y: number;
            if (c.spine !== undefined) {
              const a = spineAngle(h.cube, c.spine) + xf.current.angle;
              const mid = R * 1.12 + Math.min(1.1 * R, Math.max(0.45 * R, 24 / scale)) / 2;
              x = o.x + Math.sin(a) * mid;
              y = o.y - Math.cos(a) * mid;
            } else {
              const a = ((c.angle ?? 0) * Math.PI) / 180;
              const k = 1 / Math.min(1, scale);
              x = o.x + Math.sin(a) * (c.dist ?? 0.68) * GEO.px.hexHeight * k;
              y = o.y - Math.cos(a) * (c.dist ?? 0.68) * GEO.px.hexHeight * k;
            }
            const rect = app.canvas.getBoundingClientRect();
            return { x: rect.left + w.x + x * scale, y: rect.top + w.y + y * scale };
          },
        };
      }
      ready.current = true;
      await redraw();
    })();
    return () => {
      destroyed = true;
      observer?.disconnect();
      uninstall?.();
      ready.current = false;
      // A redraw still waiting on textures must not draw on the destroyed layers.
      redrawToken.current++;
      if (appRef.current) {
        releaseCaptureSource(appRef.current);
        appRef.current.destroy(true, { children: true });
        appRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statics, rotation, setupKey]);

  useEffect(() => {
    if (ready.current) void redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, overlay, control, fortified, outOfPlay]);

  const hideMarkersRef = useRef(hideMarkers);
  hideMarkersRef.current = hideMarkers;
  useEffect(() => {
    if (ready.current) void redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideMarkers]);

  const hideRef = useRef(hidePieces);
  hideRef.current = hidePieces;
  useEffect(() => {
    const L = layers.current;
    if (L) showUnitLayers(L, !hidePieces);
  }, [hidePieces]);

  // Play newly arrived effects (after the redraw, so positions are current).
  useEffect(() => {
    if (!ready.current) return;
    const fresh = fx.filter((f) => !playedFx.current.has(f.id));
    if (fresh.length === 0) return;
    // Only the ids still in the list can come back: forget the rest.
    playedFx.current = new Set(fx.map((f) => f.id));
    if (!animateRef.current) return;
    for (const f of fresh) playFx(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, state]);

  /** View position of a hex centre, or of a piece's last drawn counter. */
  function fxPos(hex?: HexId, piece?: string): { x: number; y: number } | null {
    if (hex) {
      const h = anyHex(hex);
      if (h) return center(h);
    }
    if (piece) {
      const p = lastPos.current.get(piece);
      if (p) return { x: p.x + COUNTER / 2, y: p.y + COUNTER / 2 };
    }
    return null;
  }

  function later(delay: number, fn: () => void) {
    if (delay <= 0) fn();
    else anims.current.push({ start: performance.now(), dur: delay, step: () => {}, end: fn });
  }

  /** A counter burning away where it stood (elimination). */
  function burn(tex: Texture, cx: number, cy: number) {
    const L = layers.current;
    if (!L) return;
    const ghost = new Sprite(tex);
    ghost.width = ghost.height = COUNTER;
    ghost.anchor.set(0.5);
    ghost.position.set(cx, cy);
    ghost.tint = 0xff8060;
    L.fx.addChild(ghost);
    anims.current.push({
      start: performance.now(),
      dur: 900,
      step(t) {
        ghost.alpha = 1 - t;
        ghost.scale.set((COUNTER / tex.width) * (1 + 0.5 * t));
        ghost.rotation = 0.3 * t;
      },
      end: () => ghost.destroy(),
    });
  }

  /**
   * The moment a unit's fate lands: its counter flips over to its new face (broken side, the
   * half-squad it was reduced to, a malfunctioned weapon, or back to good order), or burns away.
   */
  function faceChange(piece: string, change: Extract<BoardFx, { kind: 'face' }>['change']) {
    const entry = faces.current.get(piece);
    if (!entry || entry.box.destroyed) return;
    const { box, sprite, size } = entry;
    if (change === 'eliminated') {
      const tex = sprite?.texture ?? null;
      const cx = box.x + size / 2;
      const cy = box.y + size / 2;
      box.destroy({ children: true });
      faces.current.delete(piece);
      lastPos.current.delete(piece);
      if (tex) burn(tex, cx, cy);
      return;
    }
    const pc = latest.current.state.pieces[piece];
    if (!sprite || !pc) return;
    const url = faceOf(pc, pc.defId === UNKNOWN_DEF_ID ? statics.scenario.sides.find((x) => x.side === pc.side)?.nationality : undefined);
    const to = texture(url);
    if (!to) return;
    const bad = change !== 'rallied' && change !== 'repaired';
    let swapped = false;
    let bx = sprite.scale.x;
    let by = sprite.scale.y;
    const cx = sprite.position.x;
    const cy = sprite.position.y;
    anims.current.push({
      start: performance.now(),
      dur: bad ? 700 : 520,
      step(t) {
        // Flip over in the first three quarters: the old face narrows to an edge, the new one opens.
        const f = Math.min(1, t / 0.75);
        if (!swapped && f >= 0.5) {
          sprite.texture = to;
          sprite.width = size;
          sprite.height = size;
          bx = sprite.scale.x;
          by = sprite.scale.y;
          swapped = true;
        }
        const lift = Math.sin(Math.PI * f);
        sprite.scale.set(bx * Math.abs(Math.cos(Math.PI * f)) * (1 + 0.2 * lift), by * (1 + 0.2 * lift));
        // A bad result lands hard: a short shudder once the new face is down.
        const shake = bad && t > 0.75 ? 3 * Math.sin(60 * t) * (1 - t) / 0.25 : 0;
        sprite.position.set(cx + shake, cy - 10 * lift);
      },
      end: () => {
        sprite.texture = to;
        sprite.width = size;
        sprite.height = size;
        sprite.position.set(cx, cy);
        const at = lastPos.current.get(piece);
        if (at) lastPos.current.set(piece, { ...at, url });
      },
    });
  }

  function playFx(f: BoardFx) {
    const L = layers.current;
    if (!L) return;
    stats.current.fxPlayed++;
    stats.current.fx[f.kind] = (stats.current.fx[f.kind] ?? 0) + 1;
    const now = performance.now();
    if (f.kind === 'tracer') {
      const to = fxPos(f.to);
      if (!to) return;
      const froms = f.from.map((h) => fxPos(h)).filter((p): p is { x: number; y: number } => !!p);
      const g = new Graphics();
      L.fx.addChild(g);
      anims.current.push({
        start: now,
        dur: 750,
        step(t) {
          g.clear();
          const reach = Math.min(1, t * 3);
          const fade = t < 0.4 ? 1 : 1 - (t - 0.4) / 0.6;
          for (const a of froms) {
            const x = a.x + (to.x - a.x) * reach;
            const y = a.y + (to.y - a.y) * reach;
            g.moveTo(a.x, a.y).lineTo(x, y).stroke({ color: f.color, width: 7, alpha: 0.25 * fade });
            g.moveTo(a.x, a.y).lineTo(x, y).stroke({ color: 0xfff2c0, width: 2, alpha: 0.95 * fade });
            g.circle(a.x, a.y, 6 + 6 * (1 - reach)).fill({ color: 0xfff2c0, alpha: 0.7 * fade });
          }
        },
        end: () => g.destroy(),
      });
      return;
    }
    if (f.kind === 'burst') {
      const at = fxPos(f.hex);
      if (!at) return;
      later(f.delay, () => {
        const g = new Graphics();
        L.fx.addChild(g);
        anims.current.push({
          start: performance.now(),
          dur: 600,
          step(t) {
            const e = easeOut(t);
            g.clear();
            g.circle(at.x, at.y, 8 + 40 * e).stroke({ color: f.color, width: 4 * (1 - e) + 1, alpha: 1 - e });
            g.circle(at.x, at.y, 6 + 18 * e).fill({ color: 0xfff0d0, alpha: 0.8 * (1 - e) });
          },
          end: () => g.destroy(),
        });
      });
      return;
    }
    if (f.kind === 'ping') {
      // Three rings close in on the pinged point one after another, brightening as they arrive, and a dot
      // marks the spot: small enough to point at a feature inside the hex, whose outline is drawn faintly.
      // A dark halo under each ring keeps it readable on any terrain.
      const h = anyHex(f.hex);
      const at = f.at ? xf.current.toView(f.at.x, f.at.y) : fxPos(f.hex);
      if (!at || !h) return;
      const g = new Graphics();
      L.fx.addChild(g);
      const c = hexCenter(h, placements);
      const poly = hexPolygon(c.x, c.y, xf.current);
      const ring = (r: number, width: number, alpha: number) => {
        g.circle(at.x, at.y, r).stroke({ color: 0x000000, width: width + 2.5, alpha: 0.45 * alpha });
        g.circle(at.x, at.y, r).stroke({ color: f.color, width, alpha });
      };
      anims.current.push({
        start: now,
        dur: 1500,
        step(t) {
          g.clear();
          const fade = t < 0.8 ? 1 : 1 - (t - 0.8) / 0.2;
          g.poly(poly).stroke({ color: 0x000000, width: 4, alpha: 0.35 * fade });
          g.poly(poly).stroke({ color: f.color, width: 1.5, alpha: 0.8 * fade });
          for (let i = 0; i < 3; i++) {
            const u = (t * 1.6 - i * 0.22) / 0.7;
            if (u <= 0 || u >= 1) continue;
            const e = 1 - (1 - u) ** 2;
            ring(6 + 46 * (1 - e), 1.5 + 2.5 * e, 0.35 + 0.65 * e);
          }
          // The dot: lands with the first ring, holds, then goes with the rest.
          const d = Math.min(1, Math.max(0, (t - 0.3) / 0.12));
          if (d > 0) {
            g.circle(at.x, at.y, 5.5 * d).fill({ color: 0x000000, alpha: 0.5 * fade });
            g.circle(at.x, at.y, 4 * d).fill({ color: f.color, alpha: fade });
            g.circle(at.x, at.y, 1.6 * d).fill({ color: 0xffffff, alpha: 0.9 * fade });
          }
        },
        end: () => g.destroy(),
      });
      return;
    }
    if (f.kind === 'face') {
      later(f.delay, () => faceChange(f.piece, f.change));
      return;
    }
    if (f.kind === 'text') {
      const at = fxPos(f.hex, f.piece);
      if (!at) return;
      later(f.delay, () => {
        const txt = new Text({
          text: f.text,
          style: {
            fontFamily: 'Oswald, Impact, sans-serif',
            fontWeight: '700',
            fontSize: f.big ? 32 : 24,
            fill: f.color,
            stroke: { color: 0x000000, width: 5 },
            letterSpacing: 1,
            dropShadow: { color: 0x000000, blur: 4, distance: 2, alpha: 0.8 },
          },
        });
        txt.anchor.set(0.5, 1);
        // Every line starts just above the counter and drifts up at one steady speed, so lines
        // never catch each other up. A line arriving while others still float in this hex pushes
        // them up out of its way (they glide there), so a long volley reads as a rising column
        // whose newest word is always at the counter, not one that climbs ever higher.
        const key = f.hex ?? f.piece ?? '';
        const base = at.y - COUNTER / 2;
        const born = performance.now();
        const line: FloatText = { txt, base, born, push: 0, shown: 0 };
        const alive = (liveTexts.current.get(key) ?? []).filter((l) => !l.txt.destroyed);
        // Lowest first: each must clear the one below it.
        let ceiling = base - txt.height - 2;
        for (const l of [...alive].sort((a, b) => floatY(b, born) - floatY(a, born))) {
          const y = floatY(l, born);
          if (y > ceiling) l.push += y - ceiling;
          ceiling = Math.min(y, ceiling) - l.txt.height - 2;
        }
        liveTexts.current.set(key, [...alive, line]);
        txt.position.set(at.x, base);
        L.fx.addChild(txt);
        anims.current.push({
          start: born,
          dur: FLOAT_MS,
          step(t) {
            line.shown += (line.push - line.shown) * 0.25;
            if (Math.abs(line.push - line.shown) < 0.5) line.shown = line.push;
            txt.position.y = base - FLOAT_RISE * t - line.shown;
            txt.scale.set(t < 0.06 ? 0.6 + (0.4 * t) / 0.06 : 1);
            txt.alpha = t < 0.65 ? 1 : 1 - (t - 0.65) / 0.35;
          },
          end: () => {
            liveTexts.current.set(key, (liveTexts.current.get(key) ?? []).filter((l) => l !== line));
            txt.destroy();
          },
        });
      });
    }
  }

  /** Hex under a view-space point (picking runs in map space, where hexes are axis-aligned). */
  function hexAt(vx: number, vy: number): HexId | null {
    const { x, y } = xf.current.toMap(vx, vy);
    let best: HexId | null = null;
    let bd = Infinity;
    for (const c of centers.current) {
      const d = ((x - c.x) / GEO.px.hexWidth) ** 2 * 2.25 + ((y - c.y) / GEO.px.hexHeight) ** 2 * 3;
      if (d < bd) {
        bd = d;
        best = c.id;
      }
    }
    return bd < 1.2 ? best : null;
  }

  /** Fit the whole map to the pane. */
  function fitView() {
    const app = appRef.current;
    const w = world.current;
    if (!app || !w) return;
    const { width: mapW, height: mapH } = xf.current;
    const scale = Math.min(app.screen.width / mapW, app.screen.height / mapH) * 0.98;
    w.scale.set(scale);
    w.position.set((app.screen.width - mapW * scale) / 2, (app.screen.height - mapH * scale) / 2);
    drawControls();
  }

  /** Show the finder arrow at the pane's edge, aimed at the map's centre, while little or none of the map is in view. */
  function updateFinder() {
    const app = appRef.current;
    const w = world.current;
    const el = finder.current;
    if (!app || !w || !el) return;
    const sw = app.screen.width;
    const sh = app.screen.height;
    const x0 = w.x;
    const y0 = w.y;
    const x1 = x0 + xf.current.width * w.scale.x;
    const y1 = y0 + xf.current.height * w.scale.y;
    const seenX = Math.min(sw, x1) - Math.max(0, x0);
    const seenY = Math.min(sh, y1) - Math.max(0, y0);
    const lost = seenX < Math.min(60, x1 - x0) || seenY < Math.min(60, y1 - y0);
    if (!lost) {
      if (el.style.display !== 'none') el.style.display = 'none';
      return;
    }
    // Where the ray from the pane's centre to the map's centre leaves the pane, inset clear of the
    // edge vignette and (at the top) the HUD strip.
    const cx = sw / 2;
    const cy = sh / 2;
    const dx = (x0 + x1) / 2 - cx;
    const dy = (y0 + y1) / 2 - cy;
    const reachX = Math.max(0, cx - 70);
    const reachY = Math.max(0, cy - (dy < 0 ? 130 : 70));
    const k = Math.min(dx ? reachX / Math.abs(dx) : Infinity, dy ? reachY / Math.abs(dy) : Infinity);
    el.style.display = '';
    el.style.left = `${cx + dx * k}px`;
    el.style.top = `${cy + dy * k}px`;
    el.style.setProperty('--finder-angle', `${Math.atan2(dy, dx)}rad`);
  }

  function installInteraction(app: Application, w: Container) {
    const clamp = () => clampView(w, xf.current.width, xf.current.height, app.screen.width, app.screen.height);
    const canvas = app.canvas;
    // A press either pans the map or, on a setup counter, picks that counter up.
    let drag: { x: number; y: number; wx: number; wy: number; moved: boolean; piece: string | null; ghost: Sprite | null } | null = null;
    /** Every pointer pressed on the canvas (by id), in client pixels: two fingers make a pinch. */
    const pointers = new Map<number, { x: number; y: number }>();
    /** A two-finger pinch in progress: the fingers' last midpoint (pane pixels) and separation. */
    let pinch: { mx: number; my: number; dist: number } | null = null;
    /** Zoom to `next` about the pane point (mx, my), which stays over the same spot of the map. */
    const zoomAt = (mx: number, my: number, next: number) => {
      const old = w.scale.x;
      next = Math.min(4, Math.max(0.25, next));
      w.position.set(mx - ((mx - w.x) / old) * next, my - ((my - w.y) / old) * next);
      w.scale.set(next);
      clamp();
      drawControls();
    };
    const pinchGeometry = () => {
      const [a, b] = [...pointers.values()] as [{ x: number; y: number }, { x: number; y: number }];
      const rect = canvas.getBoundingClientRect();
      return { mx: (a.x + b.x) / 2 - rect.left, my: (a.y + b.y) / 2 - rect.top, dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
    };
    /** A finger lifted (or lost) out of a pinch: the one still down pans from where it is, and its lift is no tap. */
    const endPinch = () => {
      if (pointers.size >= 2) {
        pinch = pinchGeometry();
        return;
      }
      pinch = null;
      const rest = [...pointers.values()][0];
      drag = rest ? { x: rest.x, y: rest.y, wx: w.x, wy: w.y, moved: true, piece: null, ghost: null } : null;
    };
    type At = Pick<MouseEvent, 'clientX' | 'clientY'>;
    const hexUnder = (e: At) => {
      const rect = canvas.getBoundingClientRect();
      return hexAt((e.clientX - rect.left - w.x) / w.scale.x, (e.clientY - rect.top - w.y) / w.scale.y);
    };
    /** The point under the pointer in map pixels (zoom and turn undone), so a ping lands on the same spot on every screen. */
    const mapPointUnder = (e: At) => {
      const rect = canvas.getBoundingClientRect();
      return xf.current.toMap((e.clientX - rect.left - w.x) / w.scale.x, (e.clientY - rect.top - w.y) / w.scale.y);
    };
    /** The on-map handle under the pointer, if any. */
    const controlUnder = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const vx = (e.clientX - rect.left - w.x) / w.scale.x;
      const vy = (e.clientY - rect.top - w.y) / w.scale.y;
      if (hideRef.current) return null;
      // Corner handles may overlap zoomed out: the nearest one under the pointer wins.
      const under = controlHits.current.filter((h) => h.hit(vx, vy));
      if (under.length > 1 && under.every((h) => h.dist)) return under.reduce((a, b) => (b.dist!(vx, vy) < a.dist!(vx, vy) ? b : a)).c;
      return under[0]?.c ?? null;
    };
    // Touch screens have no right button: pressing and holding a hex opens the action wheel. The browser's own
    // long-press menu (Android sends a contextmenu, at about the same moment) is swallowed while that finger stays
    // down and just after it lifts, so the wheel neither opens twice nor closes itself under the finger.
    let press: { id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let held: number | null = null;
    let swallowUntil = 0;
    const cancelPress = () => {
      if (press) clearTimeout(press.timer);
      press = null;
    };
    const longPress = () => {
      const p = press;
      cancelPress();
      if (!p || pinch) return;
      held = p.id;
      drag?.ghost?.destroy();
      drag = null;
      const h = hexUnder({ clientX: p.x, clientY: p.y });
      if (!h) return;
      navigator.vibrate?.(12);
      const rect = canvas.getBoundingClientRect();
      cb.current.onHexContextMenu?.(h, { x: p.x - rect.left, y: p.y - rect.top });
    };
    const lifted = (id: number) => {
      if (press?.id === id) cancelPress();
      if (held === id) {
        held = null;
        swallowUntil = performance.now() + 600;
      }
    };
    const swallow = (e: Event) => {
      if (held === null && performance.now() > swallowUntil) return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('contextmenu', swallow, true);
    window.addEventListener('click', swallow, true);
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // The browser's long-press menu, from a finger still in its hold: open the wheel now, once.
      if (press) {
        longPress();
        return;
      }
      const h = hexUnder(e);
      if (!h) return;
      // A Mac turns Ctrl+click into a context menu: that is a ping, not the wheel.
      if (e.ctrlKey && e.button !== 2) {
        cb.current.onHexClick(h, { shift: false, ctrl: true, at: mapPointUnder(e) });
        return;
      }
      const rect = canvas.getBoundingClientRect();
      cb.current.onHexContextMenu?.(h, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      cancelPress();
      if (e.pointerType !== 'mouse' && pointers.size === 1) press = { id: e.pointerId, x: e.clientX, y: e.clientY, timer: setTimeout(longPress, LONG_PRESS_MS) };
      if (pointers.size === 2) {
        // A second finger turns a press or pan into a pinch; a counter being carried is put back.
        drag?.ghost?.destroy();
        drag = null;
        pinch = pinchGeometry();
        return;
      }
      if (pinch) return;
      const h = hexUnder(e);
      const piece = h ? (cb.current.draggablePiece?.(h) ?? null) : null;
      drag = { x: e.clientX, y: e.clientY, wx: w.x, wy: w.y, moved: false, piece, ghost: null };
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const p = pointers.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) cancelPress();
      if (pinch) {
        if (!p) return;
        // Zoom by how far the fingers spread, about their midpoint, which drags the map along with it.
        const g = pinchGeometry();
        w.position.set(w.x + g.mx - pinch.mx, w.y + g.my - pinch.my);
        zoomAt(g.mx, g.my, w.scale.x * (g.dist / pinch.dist));
        pinch = g;
        return;
      }
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved && drag.piece) {
          if (!drag.ghost) {
            const p = latest.current.state.pieces[drag.piece];
            const tex = p ? texture(counterImage(p.defId, false)) : null;
            drag.ghost = tex ? new Sprite(tex) : null;
            if (drag.ghost) {
              drag.ghost.alpha = 0.85;
              drag.ghost.anchor.set(0.5);
              app.stage.addChild(drag.ghost);
            }
          }
          if (drag.ghost) {
            drag.ghost.width = drag.ghost.height = COUNTER * w.scale.x;
            drag.ghost.position.set(e.clientX - rect.left, e.clientY - rect.top);
          }
        } else if (drag.moved) {
          w.position.set(drag.wx + dx, drag.wy + dy);
          clamp();
        }
      }
      const hov = hexUnder(e);
      if (hov !== hoverHex.current) {
        hoverHex.current = hov;
        drawArcs();
      }
      const ctl = drag?.moved ? null : controlUnder(e);
      canvas.style.cursor = ctl && !ctl.disabled ? 'pointer' : '';
      if ((ctl?.id ?? null) !== hoverControl.current) {
        hoverControl.current = ctl?.id ?? null;
        drawControls();
        drawArcs();
      }
      cb.current.onHexHover?.(hov, { x: e.clientX - rect.left, y: e.clientY - rect.top }, !!(drag?.moved && drag.piece));
    });
    canvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      lifted(e.pointerId);
      if (pinch) {
        endPinch();
        return;
      }
      drag?.ghost?.destroy();
      drag = null;
    });
    canvas.addEventListener('pointerup', (e) => {
      pointers.delete(e.pointerId);
      lifted(e.pointerId);
      if (pinch) {
        endPinch();
        return;
      }
      if (e.button !== 0 || !drag) return;
      if (drag?.ghost) drag.ghost.destroy();
      if (drag && drag.moved && drag.piece) {
        // Dropped on the tray → back to the tray; on a hex → move there.
        const over = document.elementFromPoint(e.clientX, e.clientY);
        if (over?.closest('[data-setup-tray]')) cb.current.onReturnPiece?.(drag.piece);
        else {
          const h = hexUnder(e);
          if (h) cb.current.onDropPiece?.(h, drag.piece);
        }
      } else if (drag && !drag.moved) {
        const ctl = controlUnder(e);
        if (ctl) {
          if (!ctl.disabled) ctl.onClick();
        } else {
          const h = hexUnder(e);
          if (h) {
            const rect = canvas.getBoundingClientRect();
            cb.current.onHexClick(h, { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, at: mapPointUnder(e), screen: { x: e.clientX - rect.left, y: e.clientY - rect.top } });
          }
        }
      }
      drag = null;
    });
    canvas.addEventListener('pointerleave', () => {
      if (hoverHex.current !== null) {
        hoverHex.current = null;
        drawArcs();
      }
      if (hoverControl.current !== null) {
        hoverControl.current = null;
        canvas.style.cursor = '';
        drawControls();
        drawArcs();
      }
      cb.current.onHexHover?.(null, { x: 0, y: 0 });
    });
    // Counters dragged from the setup tray.
    canvas.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(DRAG_TYPE)) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      cb.current.onHexHover?.(hexAt((e.clientX - rect.left - w.x) / w.scale.x, (e.clientY - rect.top - w.y) / w.scale.y), { x: e.clientX - rect.left, y: e.clientY - rect.top }, true);
    });
    // A native drag gets no pointerleave: leaving the board (or dropping back on the tray) is the end of the hover.
    canvas.addEventListener('dragleave', () => cb.current.onHexHover?.(null, { x: 0, y: 0 }, true));
    canvas.addEventListener('drop', (e) => {
      const id = e.dataTransfer?.getData(DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const h = hexAt((e.clientX - rect.left - w.x) / w.scale.x, (e.clientY - rect.top - w.y) / w.scale.y);
      if (h) cb.current.onDropPiece?.(h, id);
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        // A trackpad pinch arrives as a ctrl+wheel stream of small pixel deltas: zoom smoothly by them,
        // capped so a ctrl+wheel notch on a mouse (a 100px delta in Chrome) is only a modest step.
        const smooth = e.ctrlKey && e.deltaMode === 0;
        const factor = smooth ? Math.min(1.25, Math.max(0.8, Math.exp(-e.deltaY * 0.01))) : e.deltaY < 0 ? 1.12 : 1 / 1.12;
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, w.scale.x * factor);
      },
      { passive: false },
    );
    return () => {
      cancelPress();
      window.removeEventListener('contextmenu', swallow, true);
      window.removeEventListener('click', swallow, true);
    };
  }

  const textures = useRef(new Map<string, Texture | null>());
  /** Loads in flight, and loads that failed: tried again after a pause, never given up on as "no art". */
  const loading = useRef(new Map<string, Promise<void>>());
  const failed = useRef(new Map<string, { tries: number; retryAt: number }>());
  const redrawToken = useRef(0);

  function texture(url: string | null): Texture | null {
    return url ? (textures.current.get(url) ?? null) : null;
  }

  function load(u: string): Promise<void> {
    const inFlight = loading.current.get(u);
    if (inFlight) return inFlight;
    const p = (async () => {
      try {
        if (u.startsWith(WRECK_PREFIX)) {
          textures.current.set(u, await wreckTexture(u.slice(WRECK_PREFIX.length)));
          return;
        }
        const tex = await Assets.load<Texture>(u);
        // HD counter art (384–480 px) is drawn at 48–60 map px: mipmaps keep it clean zoomed out.
        if (tex.width > 2 * GUN) tex.source.autoGenerateMipmaps = true;
        textures.current.set(u, tex);
        failed.current.delete(u);
      } catch (e) {
        // A dropped or slow request must not leave a counter without its art for the rest of the game: try again
        // later (Pixi caches the failed promise, so drop it first) and redraw once it arrives.
        const tries = (failed.current.get(u)?.tries ?? 0) + 1;
        failed.current.set(u, { tries, retryAt: performance.now() + Math.min(30_000, 1000 * 2 ** tries) });
        console.warn(`Board art failed to load (attempt ${tries}): ${u}`, e);
        void Assets.unload(u).catch(() => {});
        window.setTimeout(() => void redraw(), Math.min(30_000, 1000 * 2 ** tries) + 50);
      } finally {
        loading.current.delete(u);
      }
    })();
    loading.current.set(u, p);
    return p;
  }

  /**
   * Load every texture the current state needs (once each). The board waits a moment for new art, then draws
   * with what it has, so a slow image never holds back the game; it draws again as soon as the rest arrives.
   */
  async function preload(urls: (string | null)[]) {
    const now = performance.now();
    const missing = [...new Set(urls.filter((u): u is string => !!u && !textures.current.has(u) && (failed.current.get(u)?.retryAt ?? 0) <= now))];
    if (missing.length === 0) return;
    // Only new requests are waited for: one an earlier draw is still waiting on redraws when it lands.
    const fresh = missing.filter((u) => !loading.current.has(u));
    const all = Promise.all(missing.map(load));
    const waited = fresh.length > 0 && (await Promise.race([Promise.all(fresh.map(load)).then(() => true), new Promise<boolean>((r) => window.setTimeout(() => r(false), PRELOAD_WAIT_MS))]));
    if (!waited || fresh.length < missing.length) void all.then(() => redraw());
  }

  async function redraw() {
    const L = layers.current;
    if (!L) return;
    const token = ++redrawToken.current;
    const { state: s, overlay: o, control: ctl, fortified: fort, outOfPlay: dead } = latest.current;
    const env = { state: s, statics };
    // A "?" stand-in has no nationality of its own: it wears its side's.
    const natOf = (p: Piece) => {
      const d = defOf(env, p);
      return d.kind === 'unknown' ? (statics.scenario.sides.find((x) => x.side === p.side)?.nationality ?? d.nationality) : d.nationality;
    };
    const moving = moveState(env as unknown as QueryEnv)?.units[0];
    const bare = hideMarkersRef.current;
    const markersOf = (p: Piece) => (bare ? [] : [...unitMarkers(p, natOf(p), moving), ...vehicleMgMarkers(env, p)]);
    drawControl(L.control, ctl, statics, anyHex, center);
    drawFortified(L.fort, fort, anyHex, xf.current);
    drawOutOfPlay(L.fort, dead, anyHex, xf.current);
    drawArcs();
    const urls: (string | null)[] = [];
    await loadTurrets();
    if (token !== redrawToken.current) return;
    for (const p of Object.values(s.pieces)) {
      if (p.loc.kind === 'eliminated') continue;
      urls.push(counterImage(p.defId, false), counterImage(p.defId, true), faceOf(p, natOf(p)));
      const split = splitTurret(p.defId);
      if (split) urls.push(split.hull, split.turret);
      for (const m of markersOf(p)) urls.push(markerImage(m));
    }
    for (const m of ['Smk2', 'Smk3', 'WP1', 'WP2', 'CC', 'Melee', 'RFP01', 'RFP02', 'RFP04', 'RFP06', 'RFP08', 'RFP12', 'acq1wh', 'acq2wh', 'Lev1', 'Lev2', 'Cave', 'CaveOG']) urls.push(markerImage(m));
    if (o.declaredFire) for (const m of new Set(o.declaredFire.units.values())) urls.push(markerImage(m));
    await preload(urls);
    if (token !== redrawToken.current) return;

    // Highlights.
    L.highlights.clear();
    for (const [hex, color] of o.highlights ?? []) {
      const h = anyHex(hex);
      if (!h) continue;
      const c = hexCenter(h, placements);
      const poly = hexPolygon(c.x, c.y, xf.current);
      L.highlights.poly(poly).fill({ color, alpha: 0.26 }).stroke({ color, width: 5, alpha: 0.25 });
      L.highlights.poly(poly).stroke({ color, width: 2, alpha: 0.95 });
    }
    if (o.selectedHex) {
      const h = anyHex(o.selectedHex);
      if (h) {
        const c = hexCenter(h, placements);
        L.highlights.poly(hexPolygon(c.x, c.y, xf.current)).stroke({ color: 0xffe066, width: 3 });
      }
    }

    // Pieces, grouped by Location (ASLRB A2.8): one pile per hex in the Starter Kit. In full ASL a building hex may
    // hold a pile per level: the upper one stands on its Level counter (B23.421), up and to the right, and the ground
    // pile moves down and to the left to make room.
    const byHex = new Map<string, Piece[]>();
    // Full ASL Bypass: the moving units in Bypass are their own pile, on the corner of the hex they have reached.
    const byp = o.bypass;
    for (const p of Object.values(s.pieces)) {
      let at = p.loc.kind === 'hex' ? locKey(p.loc) : p.loc.kind === 'offboard' ? p.loc.hex : undefined;
      if (!at) continue;
      if (byp && p.loc.kind === 'hex' && at === byp.hex && byp.units.has(p.id)) at = `${at}${BYPASS_PILE}`;
      byHex.set(at, [...(byHex.get(at) ?? []), p]);
    }
    const leveledHexes = new Set([...byHex.keys()].filter((k) => k.includes(':')).map(hexOfLoc));
    // S70 caves: a standing cave is its own pile down and to the left, under its Cave counter ("place units IN a Cave
    // Location under the Cave counter"), the hill hex's pile up and to the right; a cave eliminated shows the counter's
    // Open Ground side with the hex's pile.
    const caves = cavesParams(env as never);
    const caveHexes = new Map((caves?.caves ?? []).map((h) => [h, s.hexMarkers[h]?.[CAVE_GONE] === true] as const));
    for (const [h, gone] of caveHexes) if (!gone) leveledHexes.add(h);
    // Counters still sliding: note where they are on screen so the new slide carries on from
    // there, and retire their tweens before the containers go away (a tween touching a
    // destroyed container throws inside the ticker, which would stop rendering for good).
    const inFlight = new Map<string, { x: number; y: number }>();
    for (const [id, sl] of slides.current) {
      if (!sl.box.destroyed) inFlight.set(id, { x: sl.box.x, y: sl.box.y });
      const k = anims.current.indexOf(sl.anim);
      if (k >= 0) anims.current.splice(k, 1);
    }
    slides.current.clear();
    L.pieces.removeChildren().forEach((c) => c.destroy());
    faces.current = new Map();
    const prev = lastPos.current;
    const nextPos = new Map<string, { x: number; y: number; url: string | null }>();
    const doAnim = animateRef.current;
    // Hex markers (Smoke, Melee, Residual FP) belong to the hex, so empty hexes are drawn too; so do
    // the Acquired Target counters Guns have placed (SK4 6.10: on the target, where they wait for it).
    const markedHexes = Object.entries(s.hexMarkers)
      .filter(([, m]) => m['smoke'] || m[SMOKE58.kind] || m['cc'] || m['melee'] || m['residualFp'] || m['collapsedHut'])
      .map(([hex]) => hex as HexId);
    for (const k of markedHexes) if (k.includes(':')) leveledHexes.add(hexOfLoc(k));
    // One counter per Gun (several Guns may acquire the same target), each tagged with its Gun's letter.
    const idents = gunIdents(s, env);
    const acquired = new Map<HexId, { level: number; area: boolean; letter: string }[]>();
    for (const p of Object.values(s.pieces).sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (!ordnanceOf(env as never, p)) continue;
      const a = acquisitionOf(p);
      if (!a) continue;
      const list = acquired.get(a.hex) ?? [];
      list.push({ level: a.level, area: a.type === 'ATT', letter: idents.get(p.id) ?? '' });
      acquired.set(a.hex, list);
    }
    const order = [...new Set([...byHex.keys(), ...markedHexes, ...acquired.keys(), ...[...caveHexes].flatMap(([h, gone]) => (gone ? [h] : [caveLoc(h)]))])].sort();
    for (const key of order) {
      const onCorner = key.endsWith(BYPASS_PILE);
      const hex = onCorner ? key.slice(0, -BYPASS_PILE.length) : key;
      const h = anyHex(hexOfLoc(hex));
      // A hidden hex (S70's Connection Location) is on no board: its units are listed in the side panel.
      if (!h || statics.map.isHidden?.(h.id)) continue;
      const level = levelOfLoc(hex);
      const inCave = isCaveLoc(hex);
      const caveHex = caveHexes.get(h.id) === false;
      const cornerAt = onCorner && byp ? (() => { const m = hexCenter(h, placements); const off = cornerOffset(byp.at); return xf.current.toView(m.x + off.x, m.y + off.y); })() : null;
      const c0 = cornerAt ?? center(h);
      const shift = onCorner || !leveledHexes.has(h.id) ? 0 : caveHex ? (inCave ? -LEVEL_SHIFT : LEVEL_SHIFT) : level ? LEVEL_SHIFT * level : -LEVEL_SHIFT;
      const c = { x: c0.x + shift, y: c0.y - shift };
      const list = byHex.get(key) ?? [];
      const stack: Piece[] = [];
      // Possession is shown by stacking (ASLRB A4.43, SK4 1.2.4/1.2.6): a SW/Gun belongs to the
      // first unit beneath it, so an unpossessed weapon is the bottom counter of the hex and each
      // unit is followed by the weapons it possesses, Gun first, SW on top. Each side in stacking
      // order (a leader on top of the MMC he is stacked on, SK1 3.8).
      stack.push(...list.filter((p) => isWeaponDef(defOf(env, p))));
      const people = list.filter((p) => !isWeaponDef(defOf(env, p)));
      // A side's vehicle (the big counter) lies under its Infantry; its MGs are part of it, not counters.
      const personnel = [...new Set(people.map((p) => p.side))]
        .sort()
        .flatMap((side) => {
          const mine = people.filter((p) => p.side === side);
          // Vehicles only pile up offboard (or wrecked): the selected one rises to the top of the pile.
          const vehicles = mine.filter((p) => vehicleDef(env as never, p)).sort((a, b) => Number(!!o.selectedPieces?.has(a.id)) - Number(!!o.selectedPieces?.has(b.id)));
          return [...vehicles, ...stackOrder(env as never, mine.filter((p) => !vehicleDef(env as never, p)))];
        });
      for (const p of personnel) {
        const held = Object.values(s.pieces).filter((x) => x.loc.kind === 'held' && x.loc.by === p.id && !isFixedMg(defOf(env, x)));
        stack.push(p);
        stack.push(...held.filter((x) => defOf(env, x).kind === 'gun'));
        stack.push(...held.filter((x) => defOf(env, x).kind !== 'gun'));
      }
      // A unit's status markers (and those of the weapons it fired) go on top of the weapons it
      // possesses, i.e. on the last counter of the unit's group, so they are not hidden under them.
      const markersFor = new Map<string, string[]>();
      for (const p of personnel) {
        const held = stack.filter((x) => x.loc.kind === 'held' && x.loc.by === p.id);
        // A vehicle's MGs fire with it: their markers go on the vehicle.
        const mgs = Object.values(s.pieces).filter((x) => x.loc.kind === 'held' && x.loc.by === p.id && isFixedMg(defOf(env, x)));
        const df = o.declaredFire;
        // The marker it is about to wear replaces the fire marker it has now (First → Final for SFF).
        const pending = df && !bare ? [p.id, ...held.map((h) => h.id)].map((id) => df.units.get(id)).find(Boolean) : undefined;
        const declared = pending ? [pending] : [];
        const FIRE = ['FirePrep', 'FireAdv', 'First', 'Final'];
        const current = [...markersOf(p), ...held.flatMap((h) => markersOf(h)), ...mgs.flatMap((h) => markersOf(h))].filter((m) => !pending || !FIRE.includes(m));
        const all = [...new Set([...current, ...declared])];
        // The markers go on the top counter of the unit's group: its last weapon, else the unit itself.
        if (held.length === 0) markersFor.set(p.id, all);
        else {
          markersFor.set(p.id, []);
          held.forEach((h, k) => markersFor.set(h.id, k === held.length - 1 ? all : []));
        }
      }
      // Hex markers stay with the hex's own pile (a pile in Bypass has none of its own).
      const markers = onCorner ? {} : (s.hexMarkers[hex] ?? {});
      const first = L.pieces.children.length;
      // Hex-level markers and Acquired Target counters follow the stack at the usual step; an upper level's pile
      // starts on its Level counter (full ASL).
      const chit = level > 0 ? texture(markerImage(`Lev${level}`)) : null;
      const offsets = stackOffsets([...(chit ? [COUNTER] : []), ...stack.map((p) => sizeOf(defOf(env, p))), ...Array<number>(8).fill(COUNTER)]);
      // The Level counter shows a little more of itself than a counter in a pile does, so it reads at a glance.
      if (chit) for (const o of offsets.slice(1)) Object.assign(o, { x: o.x + LEVEL_PEEK, y: o.y - LEVEL_PEEK });
      let i = 0;
      if (chit) {
        const box = new Container();
        box.position.set(c.x - COUNTER / 2 + offsets[0]!.x, c.y - COUNTER / 2 + offsets[0]!.y);
        box.addChild(new Graphics().roundRect(2, 3, COUNTER, COUNTER, 4).fill({ color: 0x000000, alpha: 0.45 }));
        box.addChild(counterSprite(chit, COUNTER));
        L.pieces.addChild(box);
        i++;
      }
      for (const p of stack) {
        const d = defOf(env, p);
        const size = sizeOf(d);
        const was = prev.get(p.id);
        // A face change that is about to be animated keeps the old face until its effect plays.
        const newUrl = faceOf(p, natOf(p));
        const url = doAnim && was && was.url !== newUrl && cb.current.holdFace?.(p.id) ? was.url : newUrl;
        const tex = texture(url);
        const x = c.x - size / 2 + offsets[i]!.x;
        const y = c.y - size / 2 + offsets[i]!.y;
        const spent = !!o.spent?.has(p.id);
        // Each counter (with its badges) lives in its own container so it can slide between hexes.
        const box = new Container();
        box.position.set(x, y);
        if (o.ghost?.has(p.id)) box.alpha = 0.55;
        // Hidden Initial Placement (SK4 6.4, 8.1.8.5): the enemy never sees the unit or its weapons; its owner sees them faint.
        if (hipFaint(s, p)) box.alpha = 0.45;
        L.pieces.addChild(box);
        const veh = d.kind === 'vehicle' ? d : null;
        const hexCube = h.cube;
        // A vehicle's pictured front points along its Vehicle Covered Arc, a Gun's barrel along its CA (SK4 3.2.4, ASLRB C3.2).
        const turn = !tex || !hexCube ? 0
          : veh && !isWreck(p) ? spineAngle(hexCube, vcaOf(p)) - ART_FRONT + xf.current.angle
          : d.kind === 'gun' ? spineAngle(hexCube, coveredArc(p)) - ART_FRONT + xf.current.angle
          : 0;
        // Drop shadow: turned with the counter, but still cast down and to the right.
        // A wreck is drawn without its chit and casts its own shadow (`wreckTexture`).
        const shadow = new Graphics().roundRect(-size / 2, -size / 2, size, size, 4).fill({ color: 0x000000, alpha: isWreck(p) ? 0 : 0.45 });
        shadow.position.set(size / 2 + 2, size / 2 + 3);
        shadow.rotation = turn;
        box.addChild(shadow);
        // A turreted vehicle with split HD art: the counter shows the hull, the turret is drawn on top.
        const split = veh && !isWreck(p) && veh.turret !== 'NT' && tex === texture(counterImage(p.defId, false)) ? splitTurret(p.defId) : null;
        const hullTex = split ? texture(split.hull) : null;
        const turretTex = split ? texture(split.turret) : null;
        if (tex) {
          const sp = counterSprite(hullTex && turretTex ? hullTex : tex, size);
          if (spent) sp.tint = SPENT_TINT;
          sp.rotation = turn;
          box.addChild(sp);
          faces.current.set(p.id, { box, sprite: sp, size });
        } else if (url) {
          // Its art is still on its way: a faint blank chit holds the place (never a made-up counter face).
          faces.current.set(p.id, { box, sprite: null, size });
          box.addChild(new Graphics().roundRect(0, 0, size, size, 4).fill({ color: STOCK_COLOR[d.nationality] ?? 0xe5e2d0, alpha: 0.35 }).stroke({ color: 0xffffff, width: 1, alpha: 0.4 }));
        } else {
          faces.current.set(p.id, { box, sprite: null, size });
          const g = new Graphics().roundRect(0, 0, size, size, 4).fill(STOCK_COLOR[d.nationality] ?? 0xe5e2d0);
          if (spent) g.tint = SPENT_TINT;
          box.addChild(g);
          const t = new Text({ text: d.kind === 'sw' ? d.type : d.kind === 'gun' ? `${d.caliber}${d.barrel ?? ''} ${d.type}` : d.kind === 'vehicle' ? d.name : d.kind === 'unknown' ? '?' : (p.defId.split('.')[1] ?? p.defId), style: { fontSize: 11, fill: 0x111111 } });
          t.position.set(4, 16);
          box.addChild(t);
        }
        // A turreted vehicle's barrel points at its Turret Covered Arc (SK4 3.2.4): drawn over the counter
        // in the nationality's colour, so hull and turret facings read at a glance.
        if (split && hullTex && turretTex && hexCube) {
          // The turret turns about its pivot to the TCA; the pivot itself turns with the hull.
          const ang = spineAngle(hexCube, tcaOf(env as never, p)) + xf.current.angle;
          const dx = split.x - size / 2;
          const dy = split.y - size / 2;
          const ts = new Sprite(turretTex);
          ts.anchor.set(0.5);
          ts.width = split.size;
          ts.height = split.size;
          ts.position.set(size / 2 + dx * Math.cos(turn) - dy * Math.sin(turn), size / 2 + dx * Math.sin(turn) + dy * Math.cos(turn));
          ts.rotation = ang;
          if (spent) ts.tint = SPENT_TINT;
          box.addChild(ts);
        } else if (veh && hexCube && !isWreck(p) && veh.turret !== 'NT') {
          const ang = spineAngle(hexCube, tcaOf(env as never, p)) + xf.current.angle;
          const cx = size / 2;
          const cy = size / 2;
          const len = size * 0.58;
          const ex = cx + Math.sin(ang) * len;
          const ey = cy - Math.cos(ang) * len;
          const tg = new Graphics();
          tg.moveTo(cx, cy).lineTo(ex, ey).stroke({ color: 0x111111, width: 7, alpha: 0.7, cap: 'round' });
          tg.moveTo(cx, cy).lineTo(ex, ey).stroke({ color: STOCK_COLOR[d.nationality] ?? 0xffffff, width: 3.5, alpha: 0.95, cap: 'round' });
          tg.circle(cx, cy, 6).fill({ color: STOCK_COLOR[d.nationality] ?? 0xffffff, alpha: 0.95 }).stroke({ color: 0x111111, width: 1.5, alpha: 0.8 });
          if (spent) tg.tint = SPENT_TINT;
          box.addChild(tg);
        }
        if (p.tags['broken'] === true) box.addChild(new Graphics().roundRect(1, 1, size - 2, size - 2, 4).stroke({ color: BROKEN_RED, width: 2.5 }));
        // The enemy's "?" says how many counters are under it, as the stack's height would at the table (SK4 8.3).
        const under = d.kind === 'unknown' ? (p.tags['counters'] as number | undefined) : undefined;
        if (under) {
          const chip = countChip(under);
          chip.position.set(size - 3, size - 3);
          box.addChild(chip);
        }
        if (o.selectedPieces?.has(p.id)) {
          // Turned with the counter: a vehicle or Gun is drawn facing its Covered Arc.
          const sel = new Graphics().roundRect(-size / 2 - 1, -size / 2 - 1, size + 2, size + 2, 5).stroke({ color: 0xffe066, width: 3 });
          sel.position.set(size / 2, size / 2);
          sel.rotation = turn;
          box.addChild(sel);
        }
        // Status markers sit on the unit, each a touch further up so their edges show; the
        // stack itself does not spread out for them (the hover card lists everything).
        let b = 0;
        for (const m of markersFor.get(p.id) ?? markersOf(p)) {
          const mt = texture(markerImage(m));
          if (!mt) continue;
          b++;
          const ms = new Sprite(mt);
          ms.width = MARKER;
          ms.height = MARKER;
          if (spent) ms.tint = SPENT_TINT;
          ms.position.set((size - MARKER) / 2 + b * 2, (size - MARKER) / 2 - b * 2);
          box.addChild(new Graphics().roundRect(ms.x + 2, ms.y + 3, MARKER, MARKER, 3).fill({ color: 0x000000, alpha: 0.4 }));
          box.addChild(ms);
        }
        // The crew's posture (SK4 3.3.2) as a tab hanging off the counter's bottom-left corner, drawn
        // over the markers and clear of where the stack steps up-right, so CE/BU reads under any pile.
        if (veh && !bare && !isWreck(p) && p.tags['vca'] !== undefined) box.addChild(crewTab(!!p.tags['ce'], size, spent));
        // A Gun's identity letter (top left), and text badges for Gun states with no marker art. A
        // vehicle wears its letter only when it is needed: to pair it with its Acquired Target
        // counter, or to tell it from another vehicle in the same hex (an offboard pile).
        if (d.kind === 'gun' || (d.kind === 'vehicle' && !isWreck(p) && (acquisitionOf(p) || personnel.some((q) => q.id !== p.id && vehicleDef(env as never, q) && !isWreck(q))))) {
          const letter = gunIdents(s, env).get(p.id);
          if (letter) box.addChild(identBadge(letter, 9, 9, 8));
        }
        const badges = d.kind === 'gun' ? unitBadges(p, isCaptured(env as never, p)) : [...(o.onRoad?.has(p.id) ? ['ROAD'] : []), ...(o.assaultMoving?.has(p.id) ? ['AM'] : []), ...(o.inBypass?.has(p.id) ? ['BYP'] : []), ...(o.smokeTried?.has(p.id) ? ['SMK'] : [])];
        badges.forEach((label, k) => {
          const bg = new Graphics().roundRect(size - 26, 2 + k * 14, 24, 12, 3).fill({ color: label === 'CAPT' ? 0xc0392b : label === 'ROAD' ? 0x8a6a2c : label === 'BYP' ? 0xc77d0a : label === 'SMK' ? 0x5b6670 : label === 'AM' ? 0x1f8a5b : 0x2a2a2a, alpha: 0.9 });
          const tx = new Text({ text: label, style: { fontSize: 9, fill: 0xffffff, fontWeight: 'bold' } });
          tx.position.set(size - 24, 2 + k * 14);
          box.addChild(bg, tx);
        });
        // Slide from where the counter was last drawn (or is right now, if it was mid-slide).
        const from = inFlight.get(p.id) ?? was;
        if (doAnim && from && (Math.abs(from.x - x) > 1 || Math.abs(from.y - y) > 1)) {
          const far = Math.hypot(from.x - x, from.y - y) > COUNTER;
          box.position.set(from.x, from.y);
          const anim: Anim = {
            start: performance.now(),
            dur: far ? 320 : 180,
            step(t) {
              const e = easeOut(t);
              box.position.set(from.x + (x - from.x) * e, from.y + (y - from.y) * e);
              if (far) box.scale.set(1 + 0.18 * Math.sin(Math.PI * t));
            },
            end: () => {
              box.position.set(x, y);
              box.scale.set(1);
              slides.current.delete(p.id);
            },
          };
          slides.current.set(p.id, { box, anim });
          anims.current.push(anim);
        }
        nextPos.set(p.id, { x, y, url });
        i++;
      }
      // The Cave counter on top of the units in the cave (S70 SSR 2).
      if (inCave) {
        const ct = texture(markerImage('Cave'));
        if (ct) {
          const off = offsets[Math.min(i, offsets.length - 1)]!;
          const box = new Container();
          box.position.set(c.x - COUNTER / 2 + off.x, c.y - COUNTER / 2 + off.y);
          box.addChild(new Graphics().roundRect(2, 3, COUNTER, COUNTER, 4).fill({ color: 0x000000, alpha: 0.45 }));
          box.addChild(counterSprite(ct, COUNTER));
          L.pieces.addChild(box);
          i++;
        }
      }
      // Broken units under other counters show only an edge: the stack says how many there are.
      const hiddenBroken = stack.slice(0, -1).filter((p) => p.tags['broken'] === true).length;
      if (hiddenBroken > 0) {
        const chip = brokenChip(hiddenBroken);
        chip.position.set(c.x - COUNTER / 2 - 2, c.y + COUNTER / 2 - 2);
        L.pieces.addChild(chip);
      }
      // Location markers.
      const locMarkers: string[] = [];
      // One chit per Smoke grenade counter placed in the hex (ASLRB A24.2).
      for (let i = 0; i < smokeGrenades(markers); i++) locMarkers.push('Smk2');
      for (const c of smoke58Chits(markers)) locMarkers.push(c.marker);
      if (markers['cc']) locMarkers.push('CC');
      if (markers['melee']) locMarkers.push('Melee');
      if (markers[CAVE_GONE] && caveHexes.has(hex)) locMarkers.push('CaveOG');
      const rfp = markers['residualFp'] as number | undefined;
      if (rfp) locMarkers.push(`RFP${String(Math.min(12, rfp)).padStart(2, '0')}`);
      for (const m of bare ? [] : locMarkers) {
        const mt = texture(markerImage(m));
        if (!mt) continue;
        const ms = new Sprite(mt);
        ms.width = 36;
        ms.height = 36;
        ms.alpha = 0.95;
        const off = offsets[Math.min(i, offsets.length - 1)]!;
        ms.position.set(c.x - 18 + off.x, c.y - 18 + off.y);
        L.pieces.addChild(ms);
        i++;
      }
      // A Collapsed Hut (SK4 8.2.1): no VASL counter for it, so a small chit says so.
      if (!bare && markers['collapsedHut']) {
        const chit = collapsedHutChit();
        const off = offsets[Math.min(i, offsets.length - 1)]!;
        chit.position.set(c.x + off.x, c.y + off.y);
        L.pieces.addChild(chit);
        i++;
      }
      // Acquired Target counters, one per Gun, with the Gun's letter in its colour (the ⅝" Area one is bigger, SK4 6.11).
      for (const a of bare ? [] : acquired.get(hex) ?? []) {
        const mt = texture(markerImage(a.level === 2 ? 'acq2wh' : 'acq1wh'));
        if (!mt) continue;
        const sz = a.area ? 44 : 36;
        const box = new Container();
        const ms = new Sprite(mt);
        ms.width = sz;
        ms.height = sz;
        ms.alpha = 0.95;
        // The counter itself wears the Gun's colour: stacked counters hide each other's badge.
        if (a.letter) ms.tint = identColor(a.letter);
        box.addChild(ms);
        if (a.letter) box.addChild(identBadge(a.letter, sz - 6, 6));
        const off = offsets[Math.min(i, offsets.length - 1)]!;
        box.position.set(c.x - sz / 2 + off.x, c.y - sz / 2 + off.y);
        L.pieces.addChild(box);
        i++;
      }
      // The hex's height: a taller stack stands over its shorter neighbours, which it overlaps as it steps up-right.
      for (const ch of L.pieces.children.slice(first)) ch.zIndex = i;
    }

    // Counters that vanished since the last draw: eliminated ones burn away where they stood,
    // or stay on the board until the effect that burns them plays with their dice.
    for (const [id, was] of prev) {
      if (nextPos.has(id)) continue;
      const pc = s.pieces[id];
      if (!doAnim || !pc || pc.loc.kind !== 'eliminated') continue;
      const tex = texture(was.url);
      if (!tex) continue;
      if (cb.current.holdFace?.(id)) {
        const box = new Container();
        box.position.set(was.x, was.y);
        // Over every stack, as it was drawn last before stacks were sorted by height.
        box.zIndex = Number.MAX_SAFE_INTEGER;
        L.pieces.addChild(box);
        const size = pc ? sizeOf(defOf({ statics }, pc)) : COUNTER;
        box.addChild(new Graphics().roundRect(2, 3, size, size, 4).fill({ color: 0x000000, alpha: 0.45 }));
        const sp = counterSprite(tex, size);
        box.addChild(sp);
        faces.current.set(id, { box, sprite: sp, size });
        nextPos.set(id, was);
        continue;
      }
      burn(tex, was.x + COUNTER / 2, was.y + COUNTER / 2);
    }
    lastPos.current = nextPos;

    // LOS threads: green where the thread sees, red from the pixel where it is blocked.
    L.top.clear();
    const LOS_CLEAR = 0x7cfc00;
    const LOS_BLOCKED = 0xff4040;
    const LOS_UNKNOWN = 0xffd166;
    const seg = (p: { x: number; y: number }, q: { x: number; y: number }, col: number) => {
      L.top.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: col, width: 6, alpha: 0.25 });
      L.top.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: col, width: 2 });
    };
    for (const t of o.los ?? []) {
      const a = statics.map.hex(t.from);
      const b2 = statics.map.hex(t.to);
      if (!a || !b2) continue;
      const pa = center(a);
      // A LOS traced to a hex corner (fire at a stack in Bypass, ASLRB A4.34) ends there.
      const pb = t.toVertex !== undefined ? (() => { const m = hexCenter(b2, placements); const off = cornerOffset(t.toVertex!); return xf.current.toView(m.x + off.x, m.y + off.y); })() : center(b2);
      if (t.clear === null) seg(pa, pb, LOS_UNKNOWN);
      else if (t.clear) seg(pa, pb, LOS_CLEAR);
      else if (t.blockedAt) {
        const pm = xf.current.toView(t.blockedAt.x, t.blockedAt.y);
        seg(pa, pm, LOS_CLEAR);
        seg(pm, pb, LOS_BLOCKED);
        L.top.circle(pm.x, pm.y, 4).fill({ color: LOS_BLOCKED });
        L.top.circle(pm.x, pm.y, 9).stroke({ color: LOS_BLOCKED, width: 2, alpha: 0.8 });
      } else seg(pa, pb, LOS_BLOCKED);
      L.top.circle(pa.x, pa.y, 5).stroke({ color: t.clear === false ? LOS_BLOCKED : LOS_CLEAR, width: 2 });
      L.top.circle(pb.x, pb.y, 6).stroke({ color: t.clear === null ? LOS_UNKNOWN : t.clear ? LOS_CLEAR : LOS_BLOCKED, width: 2 });
      // An end on an upper level: a ring per level around its circle (the thread is traced from that height).
      for (let i = 1; i <= (t.fromLevel ?? 0); i++) L.top.circle(pa.x, pa.y, 5 + 5 * i).stroke({ color: t.clear === false ? LOS_BLOCKED : LOS_CLEAR, width: 2 });
      for (let i = 1; i <= (t.toLevel ?? 0); i++) L.top.circle(pb.x, pb.y, 6 + 5 * i).stroke({ color: t.clear === null ? LOS_UNKNOWN : t.clear ? LOS_CLEAR : LOS_BLOCKED, width: 2 });
    }
    // A stack in Bypass (full ASL): its way round the hex, from the hex it came from along the hexsides it went along.
    if (o.bypass) {
      const b = o.bypass;
      const h = anyHex(b.hex);
      if (h) {
        const m = hexCenter(h, placements);
        const pt = (k: number) => { const off = cornerOffset(k); return xf.current.toView(m.x + off.x, m.y + off.y); };
        // The corners passed, back from the one reached: a hexside k joins corners k and k + 1.
        const corners = [b.at];
        for (const k of [...b.sides].reverse()) {
          const cur = corners[0]!;
          corners.unshift(k === (cur + 5) % 6 ? k : (k + 1) % 6);
        }
        const BYPASS_PATH = 0xffb22e;
        const from = b.from ? anyHex(b.from) : undefined;
        if (from) {
          const p0 = center(from);
          const p1 = pt(corners[0]!);
          dashedLine(L.top, p0.x, p0.y, p1.x, p1.y, 7, 6);
          L.top.stroke({ color: BYPASS_PATH, width: 3, alpha: 0.85 });
        }
        for (let i = 1; i < corners.length; i++) {
          const p = pt(corners[i - 1]!);
          const q = pt(corners[i]!);
          L.top.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: BYPASS_PATH, width: 9, alpha: 0.25 });
          L.top.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: BYPASS_PATH, width: 4, alpha: 0.95, cap: 'round' });
        }
      }
    }
    // Arrows (an artillery salvo's drift): a shaft from hex centre to hex centre and a head at the far end.
    const ARROW = 0xff7a3c;
    for (const a of o.arrows ?? []) {
      const ha = statics.map.hex(a.from);
      const hb = statics.map.hex(a.to);
      if (!ha || !hb) continue;
      const pa = center(ha);
      const pb = center(hb);
      const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
      const head = 16;
      const tip = { x: pb.x - Math.cos(ang) * 10, y: pb.y - Math.sin(ang) * 10 };
      L.top.moveTo(pa.x, pa.y).lineTo(tip.x, tip.y).stroke({ color: ARROW, width: 8, alpha: 0.25 });
      L.top.moveTo(pa.x, pa.y).lineTo(tip.x, tip.y).stroke({ color: ARROW, width: 3 });
      L.top
        .poly([tip.x, tip.y, tip.x - head * Math.cos(ang - 0.45), tip.y - head * Math.sin(ang - 0.45), tip.x - head * Math.cos(ang + 0.45), tip.y - head * Math.sin(ang + 0.45)])
        .fill({ color: ARROW });
      L.top.circle(pa.x, pa.y, 6).stroke({ color: ARROW, width: 2 });
    }
    drawControls();
  }

  return (
    <div ref={host} className="board-host">
      <button ref={finder} type="button" className="board-finder" style={{ display: 'none' }} title="The map is off screen: click to bring it back" onClick={fitView}>
        <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden>
          <path d="M4 12h13M12 6l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    </div>
  );
}

