import { useEffect, useRef } from 'react';
import { Application, Assets, Color, Container, Graphics, Rectangle, Sprite, Text, Texture, UPDATE_PRIORITY } from 'pixi.js';
import { cubeDistance, cubeNeighbors, type GameState, type HexId, type Piece, type QueryEnv, type SideId } from '@asl/engine';
import { GEO, stunLabel, coveredArc, defOf, gun as gunDef, gunHex, hexOf as hexOfPiece, inCoveredArc, isCaptured, isWeaponDef, isWreck, spineDirections, swHeldBy, tcaOf, vcaOf, vehicle as vehicleDef, type MapHex, type ObjectiveArea, type Statics, acquisitionOf, gunIdents, ordnanceOf, SMOKE58, stackOrder, hexOfLoc, levelOfLoc, locKey } from '@asl/rules';
import { CAVE_GONE, UNKNOWN_DEF_ID, cavesParams, caveLoc, cornerOffset, hexPixel, isCaveLoc, isPillboxLoc, moveState, pillboxCaHexsides, pillboxLoc, shownFireMarker, sideToward, smokeGrenades } from '@asl/rules';
import { playableBounds, playableRect, printedRect, type CropPlacement } from './crop';
import { assetUrl, boardImage, counterImage, cxMarker, loadTurrets, markerImage, splitTurret } from '../game/assets';
import { identColor } from './ident';
import { useTurretArtwork } from '../settings/turretArtwork';
import { printedTankLayers, turretMarkerSprite, STOCK_COLOR } from './printedTankArt';
import { WRECK_PREFIX, wreckTexture } from './wreckArt';
import type { BoardFx } from '../fx/useGameFx';
import type { WeatherFxKind } from '../game/weatherView';
import { smoke58Chits } from '../game/smoke';
import { releaseCaptureSource, setCaptureSource } from './capture';
import { personnelStack } from './stacking';
import { drawInk, drawStroke, type InkStroke } from './ink';

const NO_INK: InkStroke[] = [];
/** A LOS being checked: clear, and blocked from where it is blocked. */
const CHECK_LOS_CLEAR = 0x7cfc00;
const CHECK_LOS_BLOCKED = 0xff4040;

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
  const at = clampedPos(w.x, w.y, w.scale.x, mapW, mapH, screenW, screenH);
  w.position.set(at.x, at.y);
}

function clampedPos(x: number, y: number, scale: number, mapW: number, mapH: number, screenW: number, screenH: number) {
  const axis = (pos: number, size: number, screen: number) => {
    const keep = Math.min(size, screen * 0.4);
    return Math.min(screen - keep, Math.max(keep - size, pos));
  };
  return { x: axis(x, mapW * scale, screenW), y: axis(y, mapH * scale, screenH) };
}

/**
 * Following the action: the map pans to the other side's moves and fire when they happen outside the middle of the
 * pane (`FOLLOW_INSET` of it, at least `FOLLOW_INSET_MIN` px, on each side), easing there over a time that grows with
 * the distance. A new pan waits `FOLLOW_DWELL` ms after the last one began, so a quick run of actions (the computer
 * opponent's) reads as a few calm moves rather than a jitter; only the latest waiting one is taken. Any pan or zoom of
 * the player's own stops it and keeps it off for `FOLLOW_HOLD` ms.
 */
const FOLLOW_INSET = 0.15;
const FOLLOW_INSET_MIN = 60;
const FOLLOW_DWELL = 1500;
const FOLLOW_HOLD = 4000;
const followMs = (dist: number) => Math.min(1400, Math.max(600, 450 + dist * 0.7));
const easeInOut = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;

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
  /** Online play: the hex the other player has selected, ringed in their side's colour. */
  theirSelection?: { hex: HexId; color: number } | null;
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
  /**
   * Full ASL Snap Shot (ASLRB A8.15), while one is previewed or its result shown: the moving `units` are drawn back on the
   * hexside of `hex` they crossed coming from `from`, wearing a SNAP tag, and that hexside is lit.
   */
  snap?: { hex: HexId; from: HexId; units: Set<string> } | null;
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
  /** Preview this vehicle’s turret as the pointer passes over the sector. */
  turretPiece?: string | undefined;
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
  /** Whether the map follows (pans to show) a move or shot by this side; absent, it never does. */
  follow?(side: SideId): boolean;
  /**
   * A counter whose face is about to be animated by a `face` effect keeps its old face (or stays
   * on the board, if eliminated) until that effect plays, so the change lands with its dice.
   */
  holdFace?(piece: string): boolean;
  /** Scenario objectives, drawn under the counters: a star on single hexes, a tinted outline around regions. */
  objectives?: ObjectiveArea[];
  /** Hexes under a side's Control: a small nationality chit sits in the hex centre, under the counters. */
  control?: Record<HexId, SideId>;
  /** Fortified building hexes this viewer may know about (SSR): drawn as a ramparted outline under the counters. */
  fortified?: FortifiedHex[];
  /** Locations on fire (full ASL B25): a ring on the hex, the Flame or Blaze chit and the Blaze's smoke above the stack. */
  fires?: FireHex[];
  /** Hexes rubbled in play (full ASL B24): a grey ring on the hex and the rubble chit. */
  rubble?: RubbleHex[];
  /** Fortification counters the viewer may see (full ASL A12.33, B26–B30), with the draft ones while setting up. */
  fortifications?: FortHex[];
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
  /** Ink drawn on the map (a commentator's), over the counters. */
  ink?: InkStroke[];
  /** While set, a press on the map draws a stroke in this colour and width (screen pixels) instead of panning. */
  pen?: { color: number; width: number } | null;
  /** A stroke finished with the pen: its points in map pixels and its width in map pixels. */
  onInk?(stroke: { color: number; width: number; points: number[] }): void;
  /**
   * A LOS thread being checked (a commentator's), drawn growing from the firer over a moment: green while clear, red from
   * where it is blocked, with a ring pulsing there. A new `key` plays it again.
   */
  checkLos?: { key: number; from: HexId; to: HexId; clear: boolean; blockedAt?: { x: number; y: number } } | null;
  /** A danger map (a commentator's): each hex washed in its colour, over the counters, under any ink. */
  heat?: { hex: HexId; color: number }[] | null;
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
/** A mouse held still this long on a hex opens the wheel too: the way in for a trackpad without a secondary click. */
const LONG_PRESS_MOUSE_MS = 600;
const LONG_PRESS_SLOP = 10;
/** A Gun is a 5/8" counter: 60 px at this scale (SW and personnel are 1/2", 48 px). */
const GUN = 60;
/** How long a redraw waits for new counter art before drawing without it (it draws again when the art lands). */
const PRELOAD_WAIT_MS = 1500;
/** How long (ms) the render loop keeps running after the last change to the picture before it sleeps. */
const WAKE_MS = 300;
/** Frames per second while only the highlight pulse moves on the board. */
const PULSE_FPS = 15;
/** Input on the board pane that can change the picture (a pan, a zoom, a hover drawing arcs or a handle). */
const WAKE_EVENTS = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'pointerleave', 'wheel', 'dragover', 'drop'] as const;
const sizeOf = (d: { kind: string }) => (d.kind === 'gun' || d.kind === 'vehicle' ? GUN : COUNTER);
/** Tint for counters that are done for the phase: clearly darker, still readable. */
const SPENT_TINT = 0x6e6e6e;
/** A broken unit's frame, so even the edge of it showing under the rest of a stack reads as broken. */
const BROKEN_RED = 0xe0504a;
/**
 * A malfunctioned weapon's frame and chip: it may still be repaired (SK1 4.1, SK3; ASLRB A9.72). Amber on a dark
 * ground, since the counters' own colours (the Russian tan, the American olive) would swallow amber alone.
 */
const MALF_AMBER = 0xffb732;
const MALF_DARK = 0x16120a;
/** Status markers (pin, DM, CX, fire…) sit on their unit like real counters, big enough to read. */
const MARKER = 40;
/** Stacks stay compact: each counter a small step up and right, and never further than this. */
const STACK_DX = 4;
const STACK_DY = -4;
/** The pile key suffix of the units of a hex that are in Bypass (drawn on a corner, full ASL). */
const BYPASS_PILE = '#bypass';
/** The pile key suffix of the units drawn on the hexside they crossed, for a Snap Shot (full ASL). */
const SNAP_PILE = '#snap';
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

/** How far a Pillbox counter turns so its printed arrow (lower right, as `ART_FRONT`) points at hex corner `ca` (ASLRB B30.1). */
export function pillboxArtTurn(ca: number): number {
  const o = cornerOffset(ca);
  return Math.atan2(o.x, -o.y) - ART_FRONT;
}

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

function turretMarker(p: Piece) {
  return assetUrl(p.tags['ce'] ? 'markers/tca-ce.svg' : 'markers/tca-bu.svg');
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

/**
 * How many broken units a stack hides under other counters: a red chip at its lower left corner; beside it, an amber
 * one for the malfunctioned weapons it does not show, so the Repair attempt is not forgotten.
 */
function brokenChip(n: number, color = BROKEN_RED, ring = 0xffd0c8, ink = 0xffffff): Container {
  const c = new Container();
  const r = 8;
  c.addChild(new Graphics().circle(1, 2, r).fill({ color: 0x000000, alpha: 0.5 }));
  c.addChild(new Graphics().circle(0, 0, r).fill({ color }).stroke({ color: ring, width: color === BROKEN_RED ? 1.5 : 2 }));
  const tx = new Text({ text: String(n), style: { fontSize: 11, fill: ink, fontWeight: 'bold' } });
  tx.anchor.set(0.5);
  tx.position.set(0, 0.5);
  c.addChild(tx);
  return c;
}

/** A small "HIP" tag on a counter hidden from the enemy, as its owner sees it (full ASL A12.33). */
function hipChip(label = 'HIP'): Container {
  const c = new Container();
  const tx = new Text({ text: label, style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '700', fontSize: 9, letterSpacing: 0.5, fill: 0xffd27f } });
  const w = tx.width + 6;
  const h = tx.height + 2;
  c.addChild(new Graphics().roundRect(COUNTER - w + 2, -4, w, h, 2).fill({ color: 0x14171a, alpha: 0.9 }).stroke({ color: 0xc9a24a, width: 1 }));
  tx.position.set(COUNTER - w + 5, -3);
  c.addChild(tx);
  return c;
}

/** A pillbox's rout tag along the foot of its counter: green for a way in, red when the rout may not go in (ASLRB B30.5). */
export function routChip(label: string, barred: boolean): Container {
  const c = new Container();
  c.label = `rout-chip:${label}`;
  const tx = new Text({ text: label, style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '700', fontSize: 9, letterSpacing: 0.5, fill: 0xffffff } });
  const w = tx.width + 6;
  const h = tx.height + 2;
  c.addChild(new Graphics().roundRect((COUNTER - w) / 2, COUNTER - h + 4, w, h, 2).fill({ color: barred ? 0xc0392b : 0x2e8b57, alpha: 0.95 }).stroke({ color: barred ? 0xf3a59c : 0xa8e6c1, width: 1 }));
  tx.position.set((COUNTER - w) / 2 + 3, COUNTER - h + 5);
  c.addChild(tx);
  return c;
}

/** A status tab on a vehicle counter: the crew's posture, a state that hampers the vehicle, or a weapon out for good. */
export interface VehicleTab {
  text: string;
  tone: 'ce' | 'bu' | 'bad' | 'out';
}

const TAB_STYLE: Record<VehicleTab['tone'], { fill: number; stroke: number; text: number }> = {
  ce: { fill: 0xf0b030, stroke: 0xffe08a, text: 0x1a1205 },
  bu: { fill: 0x2b3138, stroke: 0x8a96a3, text: 0xdfe6ee },
  bad: { fill: 0xc0392b, stroke: 0xf3a59c, text: 0xffffff },
  out: { fill: 0x1b1b1b, stroke: 0xc0392b, text: 0xf3a59c },
};

/**
 * The status tabs a vehicle wears in place of full-size marker counters, as VASL draws them: the crew's posture when it
 * differs from the vehicle's usual one (an AFV is Buttoned Up, an Open-Topped one Crew Exposed: SK4 3.3.2, 7.13), and each
 * state that hampers it (Bog and Mired SK4 3.3.2; Immobilized 7.2; Low Ammo 7.6; Shock, UK, Stun and Recall 7.10; a
 * malfunctioned or disabled MA or MG 7.10). Motion and the fire markers stay counters.
 */
export function vehicleTabs(env: { state: GameState; statics: Statics }, p: Piece): VehicleTab[] {
  const t = p.tags;
  if (t['vca'] === undefined || t['wreck']) return [];
  const out: VehicleTab[] = [];
  const openTopped = !!vehicleDef(env as QueryEnv, p)?.openTopped;
  if (!!t['ce'] !== openTopped) out.push(t['ce'] ? { text: 'CE', tone: 'ce' } : { text: 'BU', tone: 'bu' });
  if (t['bog'] === 'bogged') out.push({ text: 'BOG', tone: 'bad' });
  if (t['bog'] === 'mired') out.push({ text: 'MIRED', tone: 'bad' });
  if (t['immob']) out.push({ text: 'IMM', tone: 'out' });
  if (t['shock'] === 'shock') out.push({ text: 'SHOCK', tone: 'bad' });
  if (t['shock'] === 'uk') out.push({ text: 'UK', tone: 'bad' });
  if (t['stun'] !== undefined) out.push({ text: stunLabel(p, 'Stun'), tone: 'bad' });
  if (t['recall']) out.push({ text: 'RECALL', tone: 'bad' });
  if (t['lowAmmo']) out.push({ text: 'LOW AMMO', tone: 'bad' });
  if (t['maDisabled']) out.push({ text: 'MA', tone: 'out' });
  else if (t['malf']) out.push({ text: 'MA', tone: 'bad' });
  for (const w of swHeldBy(env.state, p.id)) {
    const d = defOf(env as unknown as QueryEnv, w);
    if (d.kind !== 'sw' || !d.fixed) continue;
    if (w.tags['mgDisabled']) out.push({ text: d.type, tone: 'out' });
    else if (w.tags['malf']) out.push({ text: d.type, tone: 'bad' });
  }
  return out;
}

/**
 * Draw a vehicle's tabs (`vehicleTabs`) in a column on the middle of its counter: the one spot that holds no printed
 * value at any facing (the values run round the edges; the middle is the vehicle's picture) and that no other hex's
 * counters overlap. A red tab is a state that hampers it, a black one with red letters a weapon (or its movement) out
 * for good.
 */
function vehicleTabsBox(tabs: VehicleTab[], size: number, spent: boolean): Container {
  const c = new Container();
  const h = 13;
  const gap = 1;
  // One column for one or two tabs; from three on, two to a row so the block stays clear of the edges.
  const perRow = tabs.length >= 3 ? 2 : 1;
  const rows: VehicleTab[][] = [];
  for (let i = 0; i < tabs.length; i += perRow) rows.push(tabs.slice(i, i + perRow));
  const total = rows.length * (h + gap) - gap;
  let y = size / 2 - total / 2 + (tabs.length === 1 ? size * 0.12 : 0);
  for (const row of rows) {
    const texts = row.map((tab) => new Text({ text: tab.text, style: { fontSize: 9, fill: TAB_STYLE[tab.tone].text, fontWeight: 'bold', letterSpacing: 0.5 } }));
    const widths = texts.map((tx) => Math.max(perRow === 1 ? 24 : 20, Math.ceil(tx.width) + 8));
    let x = size / 2 - (widths.reduce((a, w) => a + w, 0) + gap * (row.length - 1)) / 2;
    row.forEach((tab, k) => {
      const st = TAB_STYLE[tab.tone];
      const w = widths[k]!;
      c.addChild(new Graphics().roundRect(x + 1, y + 2, w, h, 4).fill({ color: 0x000000, alpha: 0.5 }));
      c.addChild(new Graphics().roundRect(x, y, w, h, 4).fill({ color: st.fill }).stroke({ color: st.stroke, width: 1.25 }));
      texts[k]!.anchor.set(0.5);
      texts[k]!.position.set(x + w / 2, y + h / 2 + 0.5);
      c.addChild(texts[k]!);
      x += w + gap;
    });
    y += h + gap;
  }
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
 * outlined in the Gun's nationality colour. No line joins a Gun to its Acquired Target counter: it would show a LOS
 * along it to anyone; selecting either one outlines the other instead (`drawHighlights`).
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
 * Draw the scenario objectives: single hexes, and every hex of an objective made only of building hexes, get a yellow
 * star and outline (VASL style); other regions (an exit edge, a hill, hexes within a range) are tinted in the
 * condition's colour with a solid line around their outer boundary only.
 */
function drawObjectives(g: Graphics, objectives: ObjectiveArea[], placements: Placement[], t: ViewTransform, hexOf: (id: HexId) => MapHex | undefined) {
  const starred = new Set<HexId>();
  for (const o of objectives) {
    const color = OBJECTIVE_COLORS[o.group % OBJECTIVE_COLORS.length]!;
    const hexes = o.hexes.map((id) => hexOf(id)).filter((h): h is MapHex => !!h);
    const centers = hexes.map((h) => hexCenter(h, placements));
    if (o.kind === 'hex' || (hexes.length > 0 && hexes.every((h) => h.buildingId || h.terrain.startsWith('building')))) {
      // A thin outline and a small star tucked under the top of the hex, so the terrain stays readable.
      hexes.forEach((h, i) => {
        if (starred.has(h.id)) return;
        starred.add(h.id);
        const c = centers[i]!;
        g.poly(hexPolygon(c.x, c.y, t)).stroke({ color: STAR, width: 2, alpha: 0.9 });
        g.poly(toViewPoly(starPoints(c.x, c.y - GEO.px.hexHeight * 0.3, GEO.px.hexHeight * 0.13), t)).fill({ color: STAR, alpha: 0.95 }).stroke({ color: 0x3b2a00, width: 1, alpha: 0.9 });
      });
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
const NATION_COLOR: Record<string, number> = { ge: 0x5f87a1, am: 0x727b23, ru: 0x7c510d, br: 0xb8975a, al: 0x6f9c5a, it: 0x6c7a82, ja: 0xe9c22a };
/** Control chit: about a third of a counter's width, as VASL players place them. */
const CONTROL_CHIT = COUNTER / 3;

/**
 * A nationality's emblem, `size` across, centred on (x, y): the marks of the turn chit and briefing (`fx/TurnChit`'s
 * Emblem), drawn on the board. A nationality without one gets a disc in its counter colour.
 */
function drawEmblem(g: Graphics, nat: string, x: number, y: number, size: number) {
  const s = size / 40;
  switch (nat) {
    case 'ge': {
      const cross = [-6, -20, 6, -20, 6, -6, 20, -6, 20, 6, 6, 6, 6, 20, -6, 20, -6, 6, -20, 6, -20, -6, -6, -6].map((v, i) => (i % 2 ? y : x) + v * s);
      g.poly(cross).fill(0xffffff).stroke({ color: 0xffffff, width: 5 * s, join: 'miter' });
      g.poly(cross).fill(0x111111);
      return;
    }
    case 'am':
      g.poly(starPoints(x, y, 21 * s)).fill(0xffffff).stroke({ color: 0x111111, width: 2 * s, join: 'round' });
      return;
    case 'ru':
      g.poly(starPoints(x, y, 21 * s)).fill(0xd22d26).stroke({ color: 0x111111, width: 1.5 * s, join: 'round' });
      return;
    case 'br':
      g.circle(x, y, 21 * s).fill(0x2a4b9b).stroke({ color: 0x111111, width: 1.5 * s });
      g.circle(x, y, 14 * s).fill(0xffffff);
      g.circle(x, y, 7 * s).fill(0xd22d26);
      return;
    case 'it':
      for (const dx of [-12, 0, 12]) {
        g.rect(x + (dx - 2.5) * s, y - 20 * s, 5 * s, 40 * s).fill(0x4a3a48).stroke({ color: 0x111111, width: s });
        g.poly([2.5, 4, 8.5, 0, 7.5, 9, 2.5, 10].map((v, i) => (i % 2 ? y + v * s : x + (dx + v) * s))).fill(0x4a3a48).stroke({ color: 0x111111, width: s });
      }
      return;
    case 'ja':
      g.circle(x, y, 19 * s).fill(0xc8102e).stroke({ color: 0x111111, width: 1.5 * s });
      return;
    default:
      g.circle(x, y, 18 * s).fill(NATION_COLOR[nat] ?? 0x888888).stroke({ color: 0xf2e8c8, width: 1.5 * s, alpha: 0.9 });
  }
}

/**
 * Control chits: the controlling nationality's emblem in the centre of each Controlled hex, drawn under the counters
 * so an occupied hex still shows who holds it.
 */
function drawControl(g: Graphics, control: Record<HexId, SideId>, statics: Statics, hexOf: (id: HexId) => MapHex | undefined, center: (h: MapHex) => { x: number; y: number }) {
  g.clear();
  for (const [hex, side] of Object.entries(control)) {
    const h = hexOf(hex as HexId);
    if (!h) continue;
    const nat = statics.scenario.sides.find((x) => x.side === side)?.nationality ?? side;
    const c = center(h);
    g.circle(c.x + 1, c.y + 1.5, CONTROL_CHIT * 0.45).fill({ color: 0x000000, alpha: 0.28 });
    drawEmblem(g, nat, c.x, c.y, CONTROL_CHIT);
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

/**
 * A fortified building hex as the board shows it: the rampart outline round the fortified hexes of a building, a
 * badge when its upper level is fortified too (ASLRB B23.912), and a gap with a red broken edge on each Breached
 * hexside (B23.9221). `breached` lists hexsides as `sideToward` numbers them (0 south-east, clockwise).
 */
export interface FortifiedHex {
  hex: HexId;
  /** Level 1 is fortified as well as the ground. */
  upper?: boolean;
  /** Only the upper level is known fortified (never by the rules; kept for a view that shows a level alone). */
  upperOnly?: boolean;
  breached?: number[];
}

/** A Location on fire as the board shows it (ASLRB B25): the Blaze or its Flames, and whether the Blaze's smoke is drawn. */
export interface FireHex {
  loc: string;
  blaze?: boolean;
  /** Flame counters in the Location (none when a Blaze). */
  flames: number;
  hampered?: boolean;
  /** The Blaze's smoke (none in Heavy Winds, B25.63). */
  smoke?: boolean;
}
/** A hex rubbled in play (ASLRB B24): from the ground up, or from level 1 with the ground intact. */
export interface RubbleHex {
  hex: HexId;
  from: number;
  kind: 'stone' | 'wood';
  burning?: boolean;
  /** Trail Breaks through the rubble (ASLRB B24.71): each across two hexsides, drawn as a track through the centre dot. */
  tbs?: [number, number][];
}

/** A fortification counter as the board shows it: its marker, hidden (the owner's view: faint, tagged), a roadblock's hexside and extension, a pillbox's Covered Arc. */
export interface FortHex {
  hex: HexId;
  kind: 'foxhole' | 'trench' | 'ditch' | 'wire' | 'roadblock' | 'pillbox' | 'mines';
  marker: string;
  hidden?: boolean;
  hexside?: number;
  extension?: HexId[];
  ca?: number;
  /** A pillbox holding units the viewer may not inspect (ASLRB B30.7): its counter shows "occupied". */
  occupied?: boolean;
  /** A pillbox a broken unit may make for in the RtPh (ASLRB B30.5): its tag (a ROUT END with its MF, or barred). */
  rout?: { chip: string; barred: boolean };
  /** A minefield's Trail Breaks (ASLRB B28.61, B24.74): each across two hexsides; partial ones across one (to the centre dot). */
  tbs?: [number, number][];
  partial?: number[];
  /** The hexside a Known minefield belt's arrowed end counter points along (ASLRB B28.46), toward the other end. */
  beltArrow?: number;
  label: string;
  /** The card shown when the pointer is on the counter's own mark (a roadblock's bar). */
  tip?: string;
}

const ROADBLOCK_COLOR = 0xf2e8c8;
const PILLBOX_COLOR = 0xff8c00;
/** Roadblocks as a wall bar on their hexside and its extension (ASLRB B29.2); a pillbox's Covered Arc as a wedge over its two CA hexsides (B30.1). */
function drawFortifications(g: Graphics, forts: FortHex[], hexOf: (id: HexId) => MapHex | undefined, t: ViewTransform) {
  for (const f of forts) {
    const h = hexOf(f.hex);
    if (!h) continue;
    const c = hexCenter(h, placementsUnused);
    if (f.kind === 'roadblock' && f.hexside !== undefined) {
      const bar = (hex: MapHex, k: number, dashed: boolean) => {
        const m = hexCenter(hex, placementsUnused);
        const a0 = cornerOffset(k);
        const b0 = cornerOffset(k + 1);
        const a = t.toView(m.x + a0.x, m.y + a0.y);
        const b = t.toView(m.x + b0.x, m.y + b0.y);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0x000000, width: 7, alpha: 0.5 });
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: ROADBLOCK_COLOR, width: 5, alpha: f.hidden ? 0.55 : 0.95 });
        if (dashed) {
          for (let i = 0; i < 6; i += 2) {
            const p = { x: a.x + ((b.x - a.x) * i) / 6, y: a.y + ((b.y - a.y) * i) / 6 };
            const q = { x: a.x + ((b.x - a.x) * (i + 1)) / 6, y: a.y + ((b.y - a.y) * (i + 1)) / 6 };
            g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: 0xc23b2e, width: 2.5, alpha: 0.95 });
          }
        }
      };
      bar(h, f.hexside, true);
      // The extension: a line from the hexside's vertices to the centre dot of the woods/building hexes it reaches into.
      for (const ext of f.extension ?? []) {
        const e = hexOf(ext);
        if (!e) continue;
        const m = hexCenter(e, placementsUnused);
        const a0 = cornerOffset(f.hexside);
        const b0 = cornerOffset(f.hexside + 1);
        const near = [a0, b0].map((o) => ({ x: c.x + o.x, y: c.y + o.y })).sort((p, q) => Math.hypot(p.x - m.x, p.y - m.y) - Math.hypot(q.x - m.x, q.y - m.y))[0]!;
        const a = t.toView(near.x, near.y);
        const b = t.toView(m.x, m.y);
        g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: ROADBLOCK_COLOR, width: 4, alpha: f.hidden ? 0.4 : 0.8 });
      }
    }
    if (f.kind === 'mines') {
      // Trail Breaks through the minefield: full ones hexside to hexside through the centre dot, partial ones to the dot.
      const mid = (k: number) => t.toView(c.x + (cornerOffset(k).x + cornerOffset(k + 1).x) / 2, c.y + (cornerOffset(k).y + cornerOffset(k + 1).y) / 2);
      const o = t.toView(c.x, c.y);
      for (const [k1, k2] of f.tbs ?? []) {
        const a = mid(k1);
        const b = mid(k2);
        g.moveTo(a.x, a.y).lineTo(o.x, o.y).lineTo(b.x, b.y).stroke({ color: 0x000000, width: 7, alpha: 0.45 });
        g.moveTo(a.x, a.y).lineTo(o.x, o.y).lineTo(b.x, b.y).stroke({ color: TB_COLOR, width: 4, alpha: 0.95 });
      }
      for (const k of f.partial ?? []) {
        const a = mid(k);
        g.moveTo(a.x, a.y).lineTo(o.x, o.y).stroke({ color: 0x000000, width: 7, alpha: 0.4 });
        g.moveTo(a.x, a.y).lineTo(o.x, o.y).stroke({ color: TB_COLOR, width: 4, alpha: 0.6 });
        g.circle(o.x, o.y, 4).fill({ color: TB_COLOR, alpha: 0.9 });
      }
      if (f.beltArrow !== undefined) {
        // The arrow of a belt's end counter, from the centre toward the next hex of the belt (B28.46).
        const tip = mid(f.beltArrow);
        g.moveTo(o.x, o.y).lineTo(tip.x, tip.y).stroke({ color: 0xc23b2e, width: 3, alpha: 0.95 });
        g.circle(tip.x, tip.y, 4).fill({ color: 0xc23b2e, alpha: 0.95 });
      }
    }
    if (f.kind === 'pillbox' && f.ca !== undefined) {
      // The wedge: the hex centre to the two CA hexsides (the corners either side of the hexspine the arrow points at).
      const [k0] = pillboxCaHexsides(f.ca);
      const pts = [c, ...[k0, k0 + 1, k0 + 2].map((k) => ({ x: c.x + cornerOffset(k).x, y: c.y + cornerOffset(k).y }))].map((p) => t.toView(p.x, p.y));
      g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color: PILLBOX_COLOR, alpha: f.hidden ? 0.16 : 0.26 });
      const tip = t.toView(c.x + cornerOffset(f.ca).x, c.y + cornerOffset(f.ca).y);
      const o = t.toView(c.x, c.y);
      g.moveTo(o.x, o.y).lineTo(tip.x, tip.y).stroke({ color: PILLBOX_COLOR, width: 2.5, alpha: 0.9 });
    }
  }
}

const BLAZE_COLOR = 0xe11e14;
const FLAME_COLOR = 0xff8c00;
const RUBBLE_COLOR = 0xb0b0b0;
const TB_COLOR = 0x8b5a2b;
/** Fire and rubble rings: a tinted wash and a thick ring on the hex, so a burning or rubbled hex reads under a stack and from afar. */
function drawFires(g: Graphics, fires: FireHex[], rubble: RubbleHex[], hexOf: (id: HexId) => MapHex | undefined, t: ViewTransform) {
  const ring = (hex: HexId, color: number, fill: number, width: number) => {
    const h = hexOf(hex);
    if (!h) return;
    const c = hexCenter(h, placementsUnused);
    const poly = hexPolygon(c.x, c.y, t);
    g.poly(poly).fill({ color, alpha: fill });
    g.poly(poly).stroke({ color, width, alpha: 0.9 });
  };
  for (const r of rubble) ring(r.hex, RUBBLE_COLOR, r.from === 0 ? 0.28 : 0.12, 5);
  // Trail Breaks: a track from the middle of each of its two hexsides to the centre dot (B24.71).
  for (const r of rubble) {
    const h = hexOf(r.hex);
    if (!h || !r.tbs?.length) continue;
    const c = hexCenter(h, placementsUnused);
    for (const [k1, k2] of r.tbs) {
      const mid = (k: number) => t.toView(c.x + (cornerOffset(k).x + cornerOffset(k + 1).x) / 2, c.y + (cornerOffset(k).y + cornerOffset(k + 1).y) / 2);
      const o = t.toView(c.x, c.y);
      const a = mid(k1);
      const b = mid(k2);
      g.moveTo(a.x, a.y).lineTo(o.x, o.y).lineTo(b.x, b.y).stroke({ color: 0x000000, width: 7, alpha: 0.45 });
      g.moveTo(a.x, a.y).lineTo(o.x, o.y).lineTo(b.x, b.y).stroke({ color: TB_COLOR, width: 4, alpha: 0.95 });
    }
  }
  // A Flame's ring under a Blaze's, when a hex holds both at different levels.
  for (const f of fires.filter((x) => !x.blaze)) ring(hexOfLoc(f.loc), FLAME_COLOR, 0.1, 5);
  for (const f of fires.filter((x) => x.blaze)) ring(hexOfLoc(f.loc), BLAZE_COLOR, 0.18, 6);
}

/** Fortified building hexes: a rampart-coloured wash and a thick double outline around the building. */
const FORT_COLOR = 0x8a3b12;
function drawFortified(g: Graphics, labels: Container, hexes: FortifiedHex[], hexOf: (id: HexId) => MapHex | undefined, t: ViewTransform) {
  g.clear();
  labels.removeChildren();
  const found = hexes.map((f) => ({ f, h: hexOf(f.hex) })).filter((x): x is { f: FortifiedHex; h: MapHex } => !!x.h).map((x) => ({ f: x.f, c: hexCenter(x.h, placementsUnused) }));
  const inside = (x: number, y: number) => found.some(({ c }) => Math.hypot(c.x - x, c.y - y) < 4);
  for (const { c } of found) g.poly(hexPolygon(c.x, c.y, t)).fill({ color: FORT_COLOR, alpha: 0.22 });
  for (const { f, c } of found) {
    const pts = hexCorners(c.x, c.y);
    for (let i = 0; i < 12; i += 2) {
      const ax = pts[i]!;
      const ay = pts[i + 1]!;
      const bx = pts[(i + 2) % 12]!;
      const by = pts[(i + 3) % 12]!;
      // `hexCorners` starts at the west corner; `sideToward` numbers hexsides from the one after the east corner.
      const side = (i / 2 + 3) % 6;
      const a = t.toView(ax, ay);
      const b = t.toView(bx, by);
      if (f.breached?.includes(side)) {
        // A Breach: the rampart is open here; a broken red line marks the gap.
        for (let k = 0; k < 6; k += 2) {
          const p = { x: a.x + ((b.x - a.x) * k) / 6, y: a.y + ((b.y - a.y) * k) / 6 };
          const q = { x: a.x + ((b.x - a.x) * (k + 1)) / 6, y: a.y + ((b.y - a.y) * (k + 1)) / 6 };
          g.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: 0xe0504a, width: 3, alpha: 1 });
        }
        continue;
      }
      if (inside(2 * ((ax + bx) / 2) - c.x, 2 * ((ay + by) / 2) - c.y)) continue;
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xf2e8c8, width: 6, alpha: 0.9 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: FORT_COLOR, width: 3, alpha: 1 });
    }
    if (f.upper || f.upperOnly) {
      // The upper level is fortified too: a small badge at the top of the hex (map pixels: the layer zooms with the board).
      const text = new Text({ text: f.upperOnly ? 'F·1' : 'F·G+1', resolution: 3, style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '700', fontSize: 10, letterSpacing: 0.6, fill: 0xf6ecc8 } });
      const v = t.toView(c.x, c.y - GEO.px.hexHeight * 0.36);
      const w = text.width + 8;
      const h = text.height + 3;
      const box = new Graphics();
      box.roundRect(v.x - w / 2, v.y - h / 2, w, h, 2).fill({ color: FORT_COLOR, alpha: 0.95 }).stroke({ color: 0xf2e8c8, width: 1, alpha: 0.9 });
      text.x = v.x - text.width / 2;
      text.y = v.y - text.height / 2;
      labels.addChild(box, text);
    }
  }
}
/** `hexCenter` no longer reads the placements (positions come from the grid), so any value will do. */
const placementsUnused: Placement[] = [];

/**
 * The MG "Malfunction" / "Disabled" markers a vehicle wears for its vehicular MGs (SK4 7.8): the MG
 * pieces are held by the vehicle and never drawn, so their state shows on the vehicle.
 */
/**
 * Badge markers drawn on a unit for its status tags, bottom first; `moving` is the vehicle now spending MP, if any.
 */
/** Full ASL: the units engaged in a Clearance Task, its DR at the end of the CCPh (ASLRB B24.7): a TASK badge on each. */
const clearingUnits = (s: { ext: Record<string, unknown> }): Set<string> =>
  new Set(((s.ext['asl.clearance'] as { tasks?: { units: string[]; director?: string }[] } | undefined)?.tasks ?? []).flatMap((t) => [...t.units, ...(t.director ? [t.director] : [])]));

export function unitMarkers(p: Piece, nationality?: string, moving?: string): string[] {
  const m: string[] = [];
  const t = p.tags;
  // A wreck is debris: the status it had as a vehicle (Immobile, Motion, a malfunctioned MA...) no longer applies.
  if (t['wreck']) return m;
  // A hidden (HIP) unit wears no "?": that is concealment's counter. Its owner sees it drawn faint instead (`hipFaint`).
  // SK4 8.3: the owner's concealed units wear their "?" (the enemy sees a bare "?" stand-in instead). It goes on first,
  // directly on the unit, so its status markers (Pin, CX, TI, fire markers...) sit on top of it and stay in view.
  if (t['concealed'] && nationality && p.defId !== UNKNOWN_DEF_ID) m.push(`qmark-${nationality}`);
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
  // Full ASL: TI for the Player Turn and a Labor counter (ASLRB B24.7, B24.8).
  if (t['ti']) m.push('TI');
  if (typeof t['labor'] === 'string') m.push(String(t['labor']).endsWith('@-2') ? 'Labor2' : 'Labor1');
  // SK4 8.1.8.6: the Banzai counter for the Player Turn.
  if (t['banzai'] !== undefined) m.push('Banzai');
  // SK3 vehicles (SK4 3.3.2, 7.2, 7.6, 7.7, 7.10).
  if (t['vca'] !== undefined) {
    // The crew's posture and the states that hamper a vehicle are tabs on its counter (`vehicleTabs`), not counters.
    // The Motion counter comes off when the vehicle starts its MPh: it is marked only before or after its MPh (ASLRB D2.4).
    if (t['motion'] && p.id !== moving) m.push('Motion');
    if (t['bff']) m.push('FireBnd');
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
  follow,
  objectives = [],
  control = {},
  fortified = [],
  fires = [],
  fortifications = [],
  rubble = [],
  outOfPlay = [],
  hidePieces = false,
  hideMarkers = false,
  weather = null,
  holdFace,
  ink = NO_INK,
  pen = null,
  onInk,
  checkLos = null,
  heat = null,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  /** Arrow shown at the pane's edge, pointing at the map, whenever the map is (nearly) out of view. */
  const finder = useRef<HTMLButtonElement>(null);
  const appRef = useRef<Application | null>(null);
  const world = useRef<Container | null>(null);
  const layers = useRef<{ highlights: Graphics; fort: Graphics; fortLabels: Container; control: Graphics; ca: Graphics; pieces: Container; fx: Container; top: Graphics; controls: Container } | null>(null);
  /** The drawn handles' view-space hit circles, and the one under the pointer. */
  const controlHits = useRef<{ c: HexControl; hit(vx: number, vy: number): boolean; dist?(vx: number, vy: number): number }[]>([]);
  const hoverControl = useRef<string | null>(null);
  const anims = useRef<Anim[]>([]);
  /** Restarts the render loop (it stops when nothing on the board moves) and keeps it up for at least `ms`. */
  const wakeRef = useRef<(ms?: number) => void>(() => {});
  /** Starts an animation, waking the render loop if it was asleep (a push from a timer or a late texture). */
  const pushAnim = (a: Anim) => {
    anims.current.push(a);
    wakeRef.current();
  };
  /** Counter slides in flight, by piece, so a redraw can hand them over instead of orphaning them. */
  const slides = useRef(new Map<string, { box: Container; anim: Anim }>());
  /** Last drawn view position of each piece's counter (for movement tweens and elimination ghosts). */
  const lastPos = useRef(new Map<string, { x: number; y: number; url: string | null }>());
  /** Effects already played, by id: ids are handed out when a beat is built, not in the order beats play (a ping can jump the queue). */
  const playedFx = useRef(new Set<number>());
  const animateRef = useRef(animate);
  animateRef.current = animate;
  const followRef = useRef(follow);
  followRef.current = follow;
  /** The camera's pan under way, the action waiting out the dwell, when the last pan began, and until when the player's own pan holds it off. */
  const cam = useRef<{ from: { x: number; y: number }; to: { x: number; y: number }; start: number; dur: number } | null>(null);
  const camPending = useRef<{ x: number; y: number }[] | null>(null);
  const camLast = useRef(0);
  const camHold = useRef(0);
  const weatherRef = useRef(weather);
  weatherRef.current = weather;
  const weatherSim = useRef<WeatherSim>({ kind: null, drops: [], t: 0 });
  /** Dev/test counters: how often the canvas was (re)built and how many effects of each kind have played. */
  const stats = useRef({ builds: 0, frames: 0, fxPlayed: 0, fx: {} as Record<string, number>, follows: [] as number[] });
  const centers = useRef<{ id: HexId; x: number; y: number }[]>([]);
  const xf = useRef<ViewTransform>(viewTransform(placements, rotation));
  /** Hex centre in view coordinates. */
  const center = (h: MapHex) => {
    const c = hexCenter(h, placements);
    return xf.current.toView(c.x, c.y);
  };
  const cb = useRef({ onHexClick, onHexHover, onHexContextMenu, onDropPiece, draggablePiece, onReturnPiece, holdFace, onInk });
  cb.current = { onHexClick, onHexHover, onHexContextMenu, onDropPiece, draggablePiece, onReturnPiece, holdFace, onInk };
  const penRef = useRef(pen);
  penRef.current = pen;
  const inkRef = useRef(ink);
  inkRef.current = ink;
  /** The ink layer and, above it, the stroke being drawn and a LOS being checked. */
  const inkLayers = useRef<{ ink: Graphics; pen: Graphics; los: Graphics; heat: Graphics } | null>(null);
  const heatRef = useRef(heat);
  heatRef.current = heat;
  const redrawHeat = () => {
    const l = inkLayers.current;
    if (!l) return;
    l.heat.clear();
    for (const { hex, color } of heatRef.current ?? []) {
      const h = anyHex(hex);
      if (!h) continue;
      const c = hexCenter(h, placements);
      l.heat.poly(hexPolygon(c.x, c.y, xf.current)).fill({ color, alpha: 0.42 });
    }
  };
  /** The LOS being checked and when its drawing started. */
  const checkLosRef = useRef<{ los: NonNullable<Props['checkLos']>; start: number } | null>(null);
  // A new check (key) grows again from the firer; the same one redrawn keeps its place.
  if ((checkLos?.key ?? null) !== (checkLosRef.current?.los.key ?? null)) checkLosRef.current = checkLos ? { los: checkLos, start: performance.now() } : null;
  else if (checkLos && checkLosRef.current) checkLosRef.current.los = checkLos;
  const redrawInk = () => {
    const l = inkLayers.current;
    if (l) drawInk(l.ink, inkRef.current, xf.current.toView);
  };
  /** The drawn counter of each piece (rebuilt by every redraw), for face flips and burn-aways. */
  const turretViews = useRef(new Map<string, { art: Container; factors?: Sprite | undefined; fitBarrel?: ((angle: number) => void) | undefined; facing: number; hull: number; base: Sprite | null; aligned: Texture | null; turned: Texture | null; cube: MapHex['cube'] }>());
  const faces = useRef(new Map<string, { box: Container; sprite: Sprite | null; size: number }>());
  /** Map or offboard hex by id. */
  // A Location id (full ASL upper level, "uK4:1") stands for its hex.
  const anyHex = (id: HexId) => statics.map.hex(hexOfLoc(id)) ?? statics.map.offboardHex(id);
  const ready = useRef(false);
  /** Floating result texts still on screen, per hex: a new one starts at the counter and pushes these up. */
  const liveTexts = useRef(new Map<string, FloatText[]>());
  const latest = useRef({ state, overlay, control, fortified, outOfPlay, fortifications });
  latest.current = { state, overlay, control, fortified, outOfPlay, fortifications };
  /** The roadblock bar under the pointer, whose card is shown beside it (ASLRB B29.2). */
  const barTip = useRef<{ key: string | null; layer: Container | null }>({ key: null, layer: null });
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
    const controls = latest.current.overlay.controls ?? [];
    const hotSector = controls.find((c) => c.id === hoverControl.current && !c.disabled && c.turretPiece);
    for (const [id, turret] of turretViews.current) {
      const facing = hotSector?.turretPiece === id ? hotSector.spine ?? turret.facing : turret.facing;
      turret.art.rotation = spineAngle(turret.cube, facing) + xf.current.angle;
      turret.art.visible = facing !== turret.hull;
      if (turret.factors) turret.factors.visible = turret.art.visible;
      if (turret.art.visible) turret.fitBarrel?.(turret.art.rotation);
      const face = turret.art.visible ? turret.turned : turret.aligned;
      if (turret.base && face) turret.base.texture = face;
    }
    const tips: Container[] = [];
    for (const c of controls) {
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
      const label = new Text({ text: c.tag ?? (c.tone === 'hull' ? 'HULL' : 'TURRET'), resolution: textRes(), style: { fontFamily: 'Oswald, Impact, sans-serif', fontWeight: '600', fontSize: 8.5 * k, letterSpacing: 0.9 * k, fill: hot ? UI.brassHi : tone } });
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
    let unwake: (() => void) | null = null;
    (async () => {
      await app.init({ resizeTo: host.current!, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: window.devicePixelRatio });
      if (destroyed) {
        app.destroy(true);
        return;
      }
      host.current!.appendChild(app.canvas);
      appRef.current = app;
      if (typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(() => {
          wakeRef.current();
          app.queueResize();
        });
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
      const fortLabels = new Container();
      fortLabels.eventMode = 'none';
      const control = new Graphics();
      const ca = new Graphics();
      const pieces = new Container();
      // Stacks are drawn shortest first (see draw), so a tall pile covers the short ones beside it, as on a real board.
      pieces.sortableChildren = true;
      const fxLayer = new Container();
      const top = new Graphics();
      const controls = new Container();
      const barLayer = new Container();
      barLayer.eventMode = 'none';
      barTip.current = { key: null, layer: barLayer };
      // Ink over everything on the map; never hidden with the counters, and it takes no pointer events.
      const inkLayer = new Graphics();
      const penLayer = new Graphics();
      const losLayer = new Graphics();
      const heatLayer = new Graphics();
      inkLayer.eventMode = penLayer.eventMode = losLayer.eventMode = heatLayer.eventMode = 'none';
      w.addChild(fort, fortLabels, highlights, control, ca, pieces, fxLayer, top, controls, barLayer, heatLayer, inkLayer, losLayer, penLayer);
      layers.current = { highlights, fort, fortLabels, control, ca, pieces, fx: fxLayer, top, controls };
      inkLayers.current = { ink: inkLayer, pen: penLayer, los: losLayer, heat: heatLayer };
      // The danger map stays on the boards' printed area: a half hex at a cropped edge is not washed past the art.
      const heatMask = new Graphics();
      for (const p of placements) {
        const r = playableRect(p);
        const a = xf.current.toView(p.x * GEO.px.width + r.x0, p.y * GEO.px.height + r.y0);
        const b = xf.current.toView(p.x * GEO.px.width + r.x1, p.y * GEO.px.height + r.y1);
        heatMask.rect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y)).fill({ color: 0xffffff });
      }
      w.addChild(heatMask);
      heatLayer.mask = heatMask;
      redrawHeat();
      app.ticker.add(() => drawCheckLos(losLayer));
      redrawInk();
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
        const c = cam.current;
        if (c) {
          const t = Math.min(1, (now - c.start) / c.dur);
          const e = easeInOut(t);
          w.position.set(c.from.x + (c.to.x - c.from.x) * e, c.from.y + (c.to.y - c.from.y) * e);
          if (t >= 1) cam.current = null;
        }
        if (camPending.current && now - camLast.current >= FOLLOW_DWELL) followAction(camPending.current);
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
      // Render on demand: an idle board must cost next to nothing. Pixi renders on its ticker, every frame; the ticker
      // stops once nothing moves (no animation, weather, pulsing highlight or LOS check) and nothing has changed the
      // picture for WAKE_MS, drops to PULSE_FPS while only the highlights pulse, and anything that can change the
      // picture (a redraw, an animation, input, a resize, a font) starts it again at full rate.
      let awakeUntil = performance.now() + WAKE_MS;
      const wake = (ms = WAKE_MS) => {
        awakeUntil = Math.max(awakeUntil, performance.now() + ms);
        app.ticker.maxFPS = 0;
        if (!destroyed) app.ticker.start();
      };
      wakeRef.current = wake;
      app.ticker.add(
        () => {
          stats.current.frames++;
          const moving = anims.current.length > 0 || !!weatherRef.current?.kind || checkLosRef.current !== null || performance.now() <= awakeUntil;
          const pulsing = highlights.visible && highlights.context.instructions.length > 0;
          // The highlight pulse alone is a slow breath (0.2 of alpha over 2 s): a few frames a second draw it as smoothly.
          app.ticker.maxFPS = moving ? 0 : PULSE_FPS;
          if (!moving && !pulsing) app.ticker.stop();
        },
        undefined,
        UPDATE_PRIORITY.UTILITY,
      );
      app.renderer.on('resize', () => wake());
      const pane = host.current!;
      const onInput = () => wake();
      for (const type of WAKE_EVENTS) pane.addEventListener(type, onInput, { capture: true, passive: true });
      window.addEventListener('keydown', onInput, true);
      window.addEventListener('resize', onInput);
      document.fonts?.addEventListener('loadingdone', onInput);
      unwake = () => {
        for (const type of WAKE_EVENTS) pane.removeEventListener(type, onInput, { capture: true });
        window.removeEventListener('keydown', onInput, true);
        window.removeEventListener('resize', onInput);
        document.fonts?.removeEventListener('loadingdone', onInput);
        wakeRef.current = () => {};
      };

      uninstall = installInteraction(app, w);
      setCaptureSource(app);

      // Dev only: hex centre in page pixels, so a DevTools-protocol driver can click hexes
      // when recording the app (screenshots, trailers).
      if (import.meta.env.DEV) {
        (window as unknown as { aslBoard: unknown }).aslBoard = {
          stats: () => ({ ...stats.current, fx: { ...stats.current.fx }, follows: [...stats.current.follows], ink: inkRef.current.length, heat: heatRef.current?.length ?? 0 }),
          /** Whether the render loop runs, and what keeps it running. */
          loop: () => ({
            running: app.ticker.started,
            anims: anims.current.length,
            weather: weatherRef.current?.kind ?? null,
            checkLos: checkLosRef.current !== null,
            highlights: highlights.visible && highlights.context.instructions.length > 0,
          }),
          /** The map's screen offset and zoom; `setView` moves it without the pan limits (to test the off-screen arrow). */
          view: () => ({ x: w.x, y: w.y, scale: w.scale.x }),
          /** How many display objects sit on the stage itself (a dragged counter's ghost is one while it is carried). */
          stageChildren: () => app.stage.children.length,
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
      unwake?.();
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
  }, [state, overlay, control, fortified, fires, rubble, fortifications, outOfPlay]);

  const turretArtwork = useTurretArtwork();
  const turretArtworkRef = useRef(turretArtwork);
  turretArtworkRef.current = turretArtwork;
  const hideMarkersRef = useRef(hideMarkers);
  hideMarkersRef.current = hideMarkers;
  useEffect(() => {
    if (ready.current) void redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hideMarkers, turretArtwork]);

  const hideRef = useRef(hidePieces);
  hideRef.current = hidePieces;
  useEffect(() => {
    redrawInk();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ink]);
  useEffect(() => {
    redrawHeat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heat]);
  useEffect(() => {
    const L = layers.current;
    if (L) showUnitLayers(L, !hidePieces);
  }, [hidePieces]);
  // Any new props may have changed the picture (overlay, ink, highlights, a LOS check): render it.
  useEffect(() => wakeRef.current());

  // Play newly arrived effects (after the redraw, so positions are current).
  useEffect(() => {
    if (!ready.current) return;
    const fresh = fx.filter((f) => !playedFx.current.has(f.id));
    if (fresh.length === 0) return;
    // Only the ids still in the list can come back: forget the rest.
    playedFx.current = new Set(fx.map((f) => f.id));
    // A shot by a side the map follows: the firers and the target are brought into view.
    for (const f of fresh) {
      if (f.kind !== 'tracer' || !f.side || !followRef.current?.(f.side)) continue;
      followAction([...f.from, f.to].map((h) => fxPos(h)).filter((v): v is { x: number; y: number } => !!v));
    }
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
    else pushAnim({ start: performance.now(), dur: delay, step: () => {}, end: fn });
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
    pushAnim({
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
    pushAnim({
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
      pushAnim({
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
        pushAnim({
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
      pushAnim({
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
        pushAnim({
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
    const dead = new Set(latest.current.outOfPlay);
    let best: HexId | null = null;
    let bd = Infinity;
    for (const c of centers.current) {
      const d = ((x - c.x) / GEO.px.hexWidth) ** 2 * 2.25 + ((y - c.y) / GEO.px.hexHeight) ** 2 * 3;
      // A staging hex (`<hex>~`, the offboard ring of a playing area an SSR shrinks) sits on the out-of-play map hex
      // under it, at the same centre: the staging hex is the one in the game there.
      if (d < bd || (d === bd && best !== null && dead.has(best) && c.id === `${best}~`)) {
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
    cam.current = null;
    camPending.current = null;
    w.scale.set(scale);
    w.position.set((app.screen.width - mapW * scale) / 2, (app.screen.height - mapH * scale) / 2);
    drawControls();
  }

  /** Pan to show these view-space points (the action) if they lie outside the middle of the pane: see `FOLLOW_INSET`. */
  function followAction(points: { x: number; y: number }[]) {
    const app = appRef.current;
    const w = world.current;
    if (!app || !w || points.length === 0) return;
    const now = performance.now();
    if (now < camHold.current) return;
    if (now - camLast.current < FOLLOW_DWELL) {
      camPending.current = points;
      wakeRef.current(FOLLOW_DWELL);
      return;
    }
    camPending.current = null;
    const s = w.scale.x;
    const sw = app.screen.width;
    const sh = app.screen.height;
    const pad = COUNTER / 2;
    const x0 = Math.min(...points.map((p) => p.x)) - pad;
    const x1 = Math.max(...points.map((p) => p.x)) + pad;
    const y0 = Math.min(...points.map((p) => p.y)) - pad;
    const y1 = Math.max(...points.map((p) => p.y)) + pad;
    // Judged from where the camera is heading, so a pan under way is not undone by the next step of the same move.
    const at = cam.current?.to ?? { x: w.x, y: w.y };
    const ix = Math.max(FOLLOW_INSET_MIN, sw * FOLLOW_INSET);
    const iy = Math.max(FOLLOW_INSET_MIN, sh * FOLLOW_INSET);
    if (at.x + x0 * s >= ix && at.x + x1 * s <= sw - ix && at.y + y0 * s >= iy && at.y + y1 * s <= sh - iy) return;
    // More than the pane can show (a replay jump, a view turned): nothing to centre on.
    if ((x1 - x0) * s > sw || (y1 - y0) * s > sh) return;
    const to = clampedPos(sw / 2 - ((x0 + x1) / 2) * s, sh / 2 - ((y0 + y1) / 2) * s, s, xf.current.width, xf.current.height, sw, sh);
    const dist = Math.hypot(to.x - w.x, to.y - w.y);
    if (dist < 2) return;
    camLast.current = now;
    stats.current.follows.push(Math.round(now));
    if (!animateRef.current) {
      cam.current = null;
      w.position.set(to.x, to.y);
      wakeRef.current();
      return;
    }
    const dur = followMs(dist);
    cam.current = { from: { x: w.x, y: w.y }, to, start: now, dur };
    wakeRef.current(Math.max(dur, FOLLOW_DWELL) + 50);
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

  /** The LOS being checked, drawn as far as it has grown (0.8 s from the firer to the target), then held. */
  function drawCheckLos(g: Graphics) {
    const c = checkLosRef.current;
    g.clear();
    if (!c) return;
    const a = anyHex(c.los.from);
    const b = anyHex(c.los.to);
    if (!a || !b) return;
    const pa = center(a);
    const pb = center(b);
    const t = Math.min(1, (performance.now() - c.start) / 800);
    const tip = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
    const block = c.los.blockedAt ? xf.current.toView(c.los.blockedAt.x, c.los.blockedAt.y) : null;
    // How far along the thread the block lies (0..1); a blocked thread with no known point is red throughout.
    const len = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
    const at = c.los.clear ? 1 : block ? Math.min(1, Math.hypot(block.x - pa.x, block.y - pa.y) / len) : 0;
    const seg = (from: { x: number; y: number }, to: { x: number; y: number }, color: number) => {
      g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color: 0x000000, width: 9, alpha: 0.45, cap: 'round' });
      g.moveTo(from.x, from.y).lineTo(to.x, to.y).stroke({ color, width: 5, cap: 'round' });
    };
    const mid = { x: pa.x + (pb.x - pa.x) * at, y: pa.y + (pb.y - pa.y) * at };
    if (t <= at) seg(pa, tip, CHECK_LOS_CLEAR);
    else {
      if (at > 0) seg(pa, mid, CHECK_LOS_CLEAR);
      seg(mid, tip, CHECK_LOS_BLOCKED);
    }
    g.circle(pa.x, pa.y, 10).stroke({ color: CHECK_LOS_CLEAR, width: 4 });
    if (t >= 1) g.circle(pb.x, pb.y, 12).stroke({ color: c.los.clear ? CHECK_LOS_CLEAR : CHECK_LOS_BLOCKED, width: 4 });
    if (!c.los.clear && t > at) {
      const pulse = 14 + 6 * Math.sin(performance.now() / 180);
      g.circle(mid.x, mid.y, 7).fill({ color: CHECK_LOS_BLOCKED });
      g.circle(mid.x, mid.y, pulse).stroke({ color: CHECK_LOS_BLOCKED, width: 3, alpha: 0.85 });
    }
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
    /** The player's own pan or zoom: the map stops following the action for a while (`FOLLOW_HOLD`). */
    const holdFollow = () => {
      cam.current = null;
      camPending.current = null;
      camHold.current = performance.now() + FOLLOW_HOLD;
    };
    const zoomAt = (mx: number, my: number, next: number) => {
      holdFollow();
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
    /** The roadblock bar (its hexside, in view space) within a few pixels of the pointer, and the point to show its card at. */
    const barUnder = (vx: number, vy: number): { f: FortHex; x: number; y: number } | null => {
      const tol = 6 / Math.min(1, w.scale.x);
      for (const f of latest.current.fortifications ?? []) {
        if (f.kind !== 'roadblock' || f.hexside === undefined) continue;
        const h = anyHex(f.hex);
        if (!h) continue;
        const m = hexCenter(h, placementsUnused);
        const a = xf.current.toView(m.x + cornerOffset(f.hexside).x, m.y + cornerOffset(f.hexside).y);
        const b = xf.current.toView(m.x + cornerOffset(f.hexside + 1).x, m.y + cornerOffset(f.hexside + 1).y);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const u = Math.max(0, Math.min(1, ((vx - a.x) * dx + (vy - a.y) * dy) / (dx * dx + dy * dy || 1)));
        const px = a.x + u * dx;
        const py = a.y + u * dy;
        if (Math.hypot(vx - px, vy - py) <= tol) return { f, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      return null;
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
    let press: { id: number; x: number; y: number; touch: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
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
    /** Drop a press or drag whose release will never come (a context menu, a lost capture, the window left): its ghost too. */
    const abandonDrag = () => {
      drag?.ghost?.destroy();
      drag = null;
    };
    window.addEventListener('blur', abandonDrag);
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // The browser's long-press menu, from a finger still in its hold: open the wheel now, once.
      if (press && press.touch) {
        longPress();
        return;
      }
      cancelPress();
      // A Mac's Ctrl+click opens a context menu and may never deliver the button's release: no drag survives it.
      abandonDrag();
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
    /** A stroke being drawn with the pen: its points in map pixels, and the pen it was started with. */
    let stroke: { id: number; points: number[]; pen: { color: number; width: number } } | null = null;
    const drawPen = () => {
      const l = inkLayers.current;
      if (!l || !stroke) return;
      l.pen.clear();
      drawStroke(l.pen, { color: stroke.pen.color, width: stroke.pen.width / w.scale.x, points: stroke.points }, xf.current.toView);
    };
    const endStroke = (keep: boolean) => {
      const s = stroke;
      stroke = null;
      inkLayers.current?.pen.clear();
      if (keep && s) cb.current.onInk?.({ color: s.pen.color, width: s.pen.width / w.scale.x, points: s.points.map((v) => Math.round(v * 10) / 10) });
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      cancelPress();
      // The pen: one finger or the mouse draws; a second finger drops the stroke and pinches as usual.
      if (penRef.current && pointers.size === 1 && !e.ctrlKey && !e.metaKey) {
        const at = mapPointUnder(e);
        stroke = { id: e.pointerId, points: [at.x, at.y], pen: penRef.current };
        drawPen();
        return;
      }
      if (stroke) endStroke(false);
      if (e.pointerType !== 'mouse' && pointers.size === 1) press = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: true, timer: setTimeout(longPress, LONG_PRESS_MS) };
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
      // A drag whose release never came (see abandonDrag) must not leave its ghost floating over the board.
      drag?.ghost?.destroy();
      drag = { x: e.clientX, y: e.clientY, wx: w.x, wy: w.y, moved: false, piece, ghost: null };
      // The mouse held still on a hex opens the wheel as a finger does (not on a counter that may be dragged).
      if (e.pointerType === 'mouse' && !piece && h) press = { id: e.pointerId, x: e.clientX, y: e.clientY, touch: false, timer: setTimeout(longPress, LONG_PRESS_MOUSE_MS) };
    });
    canvas.addEventListener('pointermove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const p = pointers.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > LONG_PRESS_SLOP) cancelPress();
      if (stroke?.id === e.pointerId) {
        const at = mapPointUnder(e);
        stroke.points.push(at.x, at.y);
        drawPen();
        return;
      }
      if (pinch) {
        if (!p) return;
        // Zoom by how far the fingers spread, about their midpoint, which drags the map along with it.
        const g = pinchGeometry();
        w.position.set(w.x + g.mx - pinch.mx, w.y + g.my - pinch.my);
        zoomAt(g.mx, g.my, w.scale.x * (g.dist / pinch.dist));
        pinch = g;
        return;
      }
      // The button is up though no release arrived (a Mac context menu swallowed it): the drag is over, not a pan.
      if (drag && e.pointerType === 'mouse' && e.buttons === 0) {
        cancelPress();
        abandonDrag();
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
          holdFollow();
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
      // A roadblock's bar: its own card beside it while the pointer is on it.
      {
        const vx = (e.clientX - rect.left - w.x) / w.scale.x;
        const vy = (e.clientY - rect.top - w.y) / w.scale.y;
        const bar = drag?.moved ? null : barUnder(vx, vy);
        const key = bar ? `${bar.f.hex}:${bar.f.hexside}` : null;
        const bt = barTip.current;
        if (key !== bt.key && bt.layer) {
          bt.key = key;
          bt.layer.removeChildren().forEach((ch) => ch.destroy({ children: true }));
          if (bar?.f.tip) bt.layer.addChild(controlTip(bar.f.tip, bar.x, bar.y, false, 1 / Math.min(1, w.scale.x)));
        }
      }
      canvas.style.cursor = ctl && !ctl.disabled ? 'pointer' : '';
      if ((ctl?.id ?? null) !== hoverControl.current) {
        hoverControl.current = ctl?.id ?? null;
        drawControls();
        drawArcs();
      }
      cb.current.onHexHover?.(hov, { x: e.clientX - rect.left, y: e.clientY - rect.top }, !!(drag?.moved && drag.piece));
    });
    canvas.addEventListener('lostpointercapture', (e) => {
      // After a release the drag is already over; capture lost mid-drag (the page took the pointer) ends it.
      if (pointers.has(e.pointerId) && !pinch) {
        pointers.delete(e.pointerId);
        lifted(e.pointerId);
        abandonDrag();
      }
    });
    canvas.addEventListener('pointercancel', (e) => {
      pointers.delete(e.pointerId);
      lifted(e.pointerId);
      if (stroke?.id === e.pointerId) endStroke(false);
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
      if (stroke?.id === e.pointerId) {
        endStroke(true);
        return;
      }
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
      if (barTip.current.key !== null) {
        barTip.current.key = null;
        barTip.current.layer?.removeChildren().forEach((ch) => ch.destroy({ children: true }));
      }
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
      window.removeEventListener('blur', abandonDrag);
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

  /** Redraws the counters and markers, then renders them (the render loop may be asleep). */
  async function redraw() {
    try {
      await redrawPieces();
    } finally {
      wakeRef.current();
    }
  }

  async function redrawPieces() {
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
    const showTurretArt = turretArtworkRef.current;
    const markersOf = (p: Piece) => (bare ? [] : unitMarkers(p, natOf(p), moving));
    drawControl(L.control, ctl, statics, anyHex, center);
    drawFortified(L.fort, L.fortLabels, fort, anyHex, xf.current);
    drawOutOfPlay(L.fort, dead, anyHex, xf.current);
    drawFires(L.fort, fires, rubble, anyHex, xf.current);
    drawFortifications(L.fort, fortifications, anyHex, xf.current);
    drawArcs();
    const urls: (string | null)[] = [];
    await loadTurrets();
    if (token !== redrawToken.current) return;
    for (const p of Object.values(s.pieces)) {
      if (p.loc.kind === 'eliminated') continue;
      urls.push(counterImage(p.defId, false), counterImage(p.defId, true), faceOf(p, natOf(p)));
      const vehicle = vehicleDef(env as QueryEnv, p);
      if (showTurretArt && vehicle && vehicle.turret !== 'NT' && !isWreck(p)) urls.push(turretMarker(p));
      const split = splitTurret(p.defId);
      if (split) urls.push(split.hull, split.turret);
      for (const m of markersOf(p)) urls.push(markerImage(m));
    }
    for (const m of ['Smk12', 'Smk2', 'Smk2gr', 'Smk3', 'WP1', 'WP2', 'CC', 'Melee', 'RFP01', 'RFP02', 'RFP04', 'RFP06', 'RFP08', 'RFP12', 'acq1wh', 'acq2wh', 'Lev1', 'Lev2', 'Cave', 'CaveOG', 'Blaze', 'Flame', 'Rubble', 'TI', 'Labor1', 'Labor2']) urls.push(markerImage(m));
    for (const f of fortifications) urls.push(markerImage(f.marker));
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
    if (o.theirSelection) {
      const h = anyHex(o.theirSelection.hex);
      if (h) {
        const c = hexCenter(h, placements);
        const poly = hexPolygon(c.x, c.y, xf.current);
        L.highlights.poly(poly).fill({ color: o.theirSelection.color, alpha: 0.14 }).stroke({ color: o.theirSelection.color, width: 7, alpha: 0.3 });
        L.highlights.poly(poly).stroke({ color: o.theirSelection.color, width: 3, alpha: 0.95 });
      }
    }
    if (o.selectedHex) {
      const h = anyHex(o.selectedHex);
      if (h) {
        const c = hexCenter(h, placements);
        L.highlights.poly(hexPolygon(c.x, c.y, xf.current)).stroke({ color: 0xffe066, width: 3 });
      }
    }
    // A Gun (or AFV) and its Acquired Target counter (SK4 6.10): selecting either outlines the other in the Gun's
    // identity colour. No line joins them, which would tell anyone the LOS along it.
    {
      const idents = gunIdents(s, env);
      const outline = (hex: HexId, color: number) => {
        const h = anyHex(hex);
        if (!h) return;
        const c = hexCenter(h, placements);
        const poly = hexPolygon(c.x, c.y, xf.current);
        L.highlights.poly(poly).fill({ color, alpha: 0.18 }).stroke({ color: 0x111111, width: 8, alpha: 0.45 });
        L.highlights.poly(poly).stroke({ color, width: 4, alpha: 1 });
      };
      for (const p of Object.values(s.pieces)) {
        const a = ordnanceOf(env as never, p) ? acquisitionOf(p) : null;
        if (!a || p.loc.kind === 'eliminated') continue;
        const at = vehicleDef(env as never, p) ? hexOfPiece(s, p) : gunHex(env as never, p);
        if (!at || at === a.hex) continue;
        const sel = o.selectedPieces;
        const firerSelected = !!sel?.has(p.id) || (p.loc.kind === 'held' && !!sel?.has(p.loc.by)) || o.selectedHex === at;
        const color = identColor(idents.get(p.id) ?? 'A');
        if (firerSelected) outline(a.hex, color);
        if (o.selectedHex === a.hex) outline(at, color);
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
      if (o.snap && p.loc.kind === 'hex' && p.loc.hex === o.snap.hex && o.snap.units.has(p.id)) at = `${at}${SNAP_PILE}`;
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
    turretViews.current.clear();
    const prev = lastPos.current;
    const nextPos = new Map<string, { x: number; y: number; url: string | null }>();
    const doAnim = animateRef.current;
    /** Where the other side's counters moved from and to this redraw: the map follows them (`followAction`). */
    const moved: { x: number; y: number }[] = [];
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
    // Burning and rubbled Locations show their chits with or without a stack (full ASL B25, B24).
    const fireByLoc = new Map(fires.map((f) => [f.loc, f] as const));
    const rubbleByHex = new Map(rubble.map((r) => [r.hex, r] as const));
    for (const f of fires) if (f.loc.includes(':')) leveledHexes.add(hexOfLoc(f.loc));
    // Fortification counters (full ASL): drawn with or without a stack; a pillbox is a Location of its own, its pile set
    // off from the ground's as an upper level's is (B30.1).
    const fortByHex = new Map<HexId, FortHex[]>();
    for (const f of fortifications) fortByHex.set(f.hex, [...(fortByHex.get(f.hex) ?? []), f]);
    const pillboxes = fortifications.filter((f) => f.kind === 'pillbox');
    for (const f of pillboxes) leveledHexes.add(f.hex);
    for (const k of byHex.keys()) if (isPillboxLoc(k)) leveledHexes.add(hexOfLoc(k));
    const order = [...new Set([...byHex.keys(), ...markedHexes, ...acquired.keys(), ...fireByLoc.keys(), ...rubbleByHex.keys(), ...fortByHex.keys(), ...pillboxes.map((f) => pillboxLoc(f.hex)), ...[...caveHexes].flatMap(([h, gone]) => (gone ? [h] : [caveLoc(h)]))])].sort();
    for (const key of order) {
      const onSide = key.endsWith(SNAP_PILE);
      const onCorner = key.endsWith(BYPASS_PILE) || onSide;
      const hex = onSide ? key.slice(0, -SNAP_PILE.length) : onCorner ? key.slice(0, -BYPASS_PILE.length) : key;
      const h = anyHex(hexOfLoc(hex));
      // A hidden hex (S70's Connection Location) is on no board: its units are listed in the side panel.
      if (!h || statics.map.isHidden?.(h.id)) continue;
      const level = levelOfLoc(hex);
      const inCave = isCaveLoc(hex);
      const inPillbox = isPillboxLoc(hex);
      const pillboxHere = fortByHex.get(h.id)?.find((f) => f.kind === 'pillbox');
      const caveHex = caveHexes.get(h.id) === false;
      const k = onSide && o.snap ? sideToward(statics.map, o.snap.hex, o.snap.from) : null;
      const cornerAt =
        onSide && k !== null
          ? (() => { const m = hexCenter(h, placements); const a = cornerOffset(k); const b = cornerOffset((k + 1) % 6); return xf.current.toView(m.x + (a.x + b.x) / 2, m.y + (a.y + b.y) / 2); })()
          : onCorner && byp && !onSide ? (() => { const m = hexCenter(h, placements); const off = cornerOffset(byp.at); return xf.current.toView(m.x + off.x, m.y + off.y); })() : null;
      const c0 = cornerAt ?? center(h);
      const shift = onCorner || !leveledHexes.has(h.id) ? 0 : caveHex ? (inCave ? -LEVEL_SHIFT : LEVEL_SHIFT) : inPillbox ? LEVEL_SHIFT : level ? LEVEL_SHIFT * level : -LEVEL_SHIFT;
      const c = { x: c0.x + shift, y: c0.y - shift };
      const list = byHex.get(key) ?? [];
      const stack: Piece[] = [];
      // Possession is shown by stacking (ASLRB A4.43, SK4 1.2.4/1.2.6): a SW/Gun belongs to the
      // first unit beneath it, so an unpossessed weapon is the bottom counter of the hex and each
      // unit is followed by the weapons it possesses, Gun first, SW on top. Each side in stacking
      // order (a leader on top of the MMC he is stacked on, SK1 3.8).
      stack.push(...list.filter((p) => isWeaponDef(defOf(env, p))));
      const people = list.filter((p) => !isWeaponDef(defOf(env, p)));
      // A side's vehicle lies under its Infantry (its MGs are part of it, not counters), its "?" under its Known units.
      let personnel = personnelStack(env as never, people, o.selectedPieces);
      // Units beneath a foxhole, trench or Wire counter are drawn under it, the others on top (ASLRB B27.1, B26.4).
      const entrenchment = !onCorner && !inPillbox ? fortByHex.get(h.id)?.find((f) => f.kind === 'foxhole' || f.kind === 'trench' || f.kind === 'ditch' || f.kind === 'wire') : undefined;
      const beneath = (p: Piece) => p.loc.kind === 'hex' && !!p.loc.pos && (!!p.loc.pos.ent || p.loc.pos.wire === 'beneath');
      if (entrenchment) personnel = [...personnel.filter(beneath), ...personnel.filter((p) => !beneath(p))];
      let beneathCount = stack.length;
      for (const p of personnel) {
        if (entrenchment && beneath(p)) beneathCount += 1 + Object.values(s.pieces).filter((x) => x.loc.kind === 'held' && x.loc.by === p.id && !isFixedMg(defOf(env, x))).length;
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
      const chit = level > 0 ? texture(markerImage(`Lev${level}`)) : inPillbox && pillboxHere ? texture(markerImage(pillboxHere.marker)) : null;
      // The counters of the hex other than an entrenchment's or the pillbox's: Wire in a pillbox hex, a minefield, a roadblock.
      const fortChits = onCorner || inPillbox ? [] : (fortByHex.get(h.id) ?? []).filter((f) => f !== entrenchment && f.kind !== 'pillbox');
      // An enemy's "?" sits on as many blank counters as it hides (`blankUnder`): each takes its step in the pile.
      const blankUnder = (p: Piece) => (defOf(env, p).kind === 'unknown' ? ((p.tags['counters'] as number | undefined) ?? 0) : 0);
      const offsets = stackOffsets([...(chit ? [COUNTER] : []), ...stack.flatMap((p) => [...Array<number>(blankUnder(p)).fill(COUNTER), sizeOf(defOf(env, p))]), ...Array<number>(8).fill(COUNTER)]);
      // The Level counter shows a little more of itself than a counter in a pile does, so it reads at a glance.
      if (chit) for (const o of offsets.slice(1)) Object.assign(o, { x: o.x + LEVEL_PEEK, y: o.y - LEVEL_PEEK });
      let i = 0;
      if (chit) {
        const box = new Container();
        box.position.set(c.x - COUNTER / 2 + offsets[0]!.x, c.y - COUNTER / 2 + offsets[0]!.y);
        box.addChild(new Graphics().roundRect(2, 3, COUNTER, COUNTER, 4).fill({ color: 0x000000, alpha: 0.45 }));
        const sp = counterSprite(chit, COUNTER);
        // A Pillbox counter's arrow points at the hexspine that defines its CA (ASLRB B30.1): the art's arrow is printed
        // to the lower right like a vehicle's front, so it turns from there to corner `ca`.
        if (inPillbox && pillboxHere?.ca !== undefined) sp.rotation = pillboxArtTurn(pillboxHere.ca) + xf.current.angle;
        box.addChild(sp);
        if (inPillbox && pillboxHere?.hidden) {
          box.alpha = 0.62;
          box.addChild(hipChip());
        }
        // Occupied, its contents not inspectable (ASLRB B30.7): the stack card says so too.
        if (inPillbox && pillboxHere?.occupied) box.addChild(hipChip('OCCUPIED'));
        // The Rout Phase: a pillbox the router may make for, or one barred to it (B30.5); the readout and wheel say why.
        if (inPillbox && pillboxHere?.rout) box.addChild(routChip(pillboxHere.rout.chip, pillboxHere.rout.barred));
        L.pieces.addChild(box);
        i++;
      }
      /** A fortification counter in the pile (faint and tagged while hidden from the enemy; a roadblock turned to its hexside). */
      const fortCounter = (f: FortHex) => {
        const ft = texture(markerImage(f.marker));
        if (!ft) return;
        const off = offsets[Math.min(i, offsets.length - 1)]!;
        const box = new Container();
        box.position.set(c.x - COUNTER / 2 + off.x, c.y - COUNTER / 2 + off.y);
        box.addChild(new Graphics().roundRect(2, 3, COUNTER, COUNTER, 4).fill({ color: 0x000000, alpha: 0.45 }));
        const sp = counterSprite(ft, COUNTER);
        if (f.kind === 'roadblock' && f.hexside !== undefined) {
          // The art's arrow points down; turn it to the hexside (hexside k's outward normal is 120° + 60k, screen degrees from up).
          sp.rotation = ((60 * f.hexside - 60) * Math.PI) / 180 + xf.current.angle;
        }
        box.addChild(sp);
        if (f.hidden) {
          box.alpha = 0.62;
          box.addChild(hipChip());
        }
        L.pieces.addChild(box);
        i++;
      };
      let drawnUnits = 0;
      let entrenchmentDrawn = false;
      for (const p of stack) {
        if (entrenchment && !entrenchmentDrawn && drawnUnits >= beneathCount) {
          fortCounter(entrenchment);
          entrenchmentDrawn = true;
        }
        drawnUnits++;
        const d = defOf(env, p);
        const size = sizeOf(d);
        // The enemy's "?" stack (SK4 8.3): the counters under it show as a pile of blank counters, as at the table, where
        // the stack's height shows but not what is in it.
        for (let k = 0; k < blankUnder(p); k++) {
          const blank = new Container();
          blank.position.set(c.x - COUNTER / 2 + offsets[i]!.x, c.y - COUNTER / 2 + offsets[i]!.y);
          blank.addChild(new Graphics().roundRect(2, 3, COUNTER, COUNTER, 4).fill({ color: 0x000000, alpha: 0.45 }));
          blank.addChild(new Graphics().roundRect(0, 0, COUNTER, COUNTER, 4).fill({ color: NATION_COLOR[natOf(p)] ?? 0x9a9a8a }).stroke({ color: 0x1a1a1a, width: 1.5, alpha: 0.7 }));
          blank.addChild(new Graphics().roundRect(3, 3, COUNTER - 6, COUNTER - 6, 3).stroke({ color: 0xffffff, width: 1, alpha: 0.18 }));
          L.pieces.addChild(blank);
          i++;
        }
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
        // A wreck keeps the VCA it had when it was destroyed (its wreck side is printed facing the same way).
        const turn = !tex || !hexCube ? 0
          : veh ? spineAngle(hexCube, vcaOf(p)) - ART_FRONT + xf.current.angle
          : d.kind === 'gun' ? spineAngle(hexCube, coveredArc(p)) - ART_FRONT + xf.current.angle
          : 0;
        // Drop shadow: turned with the counter, but still cast down and to the right.
        // A wreck is drawn without its chit and casts its own shadow (`wreckTexture`).
        const shadow = new Graphics().roundRect(-size / 2, -size / 2, size, size, 4).fill({ color: 0x000000, alpha: isWreck(p) ? 0 : 0.45 });
        shadow.position.set(size / 2 + 2, size / 2 + 3);
        shadow.rotation = turn;
        box.addChild(shadow);
        // A turreted vehicle with split HD art: the counter shows the hull, the turret is drawn on top.
        const front = counterImage(p.defId, false);
        const canSplit = veh && !isWreck(p) && veh.turret !== 'NT' && front && tex && tex === texture(front);
        const split = canSplit ? splitTurret(p.defId) : null;
        const hdHull = split && texture(split.hull);
        const hdTurret = split && texture(split.turret);
        const printed = split && hdHull && hdTurret ? { ...split, hull: hdHull }
          : showTurretArt && canSplit ? printedTankLayers(tex, front) : null;
        if (tex) {
          const sp = counterSprite(!showTurretArt && printed ? printed.hull : tex, size);
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
        // Point the turret at its covered arc (SK4 3.2.4).
        if (veh && hexCube && !isWreck(p) && veh.turret !== 'NT') {
          const marker = showTurretArt && printed ? texture(turretMarker(p)) : null;
          const roof = marker ?? (hdHull ? hdTurret : null);
          if (roof) {
            const markerView = marker
              ? turretMarkerSprite(marker, size, !!veh.openTopped, d.nationality, printed && 'roofWidth' in printed ? printed : null, front)
              : null;
            const art = markerView?.art ?? new Sprite(roof);
            const dx = (printed?.x ?? size / 2) - size / 2;
            const dy = (printed?.y ?? size / 2) - size / 2;
            if (!marker) {
              art.anchor.set(0.5);
              art.width = art.height = split!.size;
            }
            if (spent) art.tint = new Color(art.tint).multiply(SPENT_TINT).toNumber();
            art.position.set(size / 2 + dx * Math.cos(turn) - dy * Math.sin(turn), size / 2 + dx * Math.sin(turn) + dy * Math.cos(turn));
            box.addChild(art);
            if (showTurretArt) {
              const factors = marker && printed && 'factors' in printed ? counterSprite(printed.factors, size) : undefined;
              if (factors) {
                factors.rotation = turn;
                if (spent) factors.tint = SPENT_TINT;
                box.addChild(factors);
              }
              turretViews.current.set(p.id, { art, factors,
                fitBarrel: markerView ? angle => markerView.fitBarrel(angle - turn, dx + size / 2, dy + size / 2) : undefined,
                facing: tcaOf(env as QueryEnv, p), hull: vcaOf(p), cube: hexCube,
                base: faces.current.get(p.id)?.sprite ?? null, aligned: tex, turned: printed?.hull ?? tex });
            } else {
              art.rotation = spineAngle(hexCube, tcaOf(env as QueryEnv, p)) + xf.current.angle;
            }
          } else {
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
        }
        if (p.tags['broken'] === true) box.addChild(new Graphics().roundRect(1, 1, size - 2, size - 2, 4).stroke({ color: BROKEN_RED, width: 2.5 }));
        else if (p.tags['malf'] === true && isWeaponDef(d)) box.addChild(new Graphics().roundRect(1.5, 1.5, size - 3, size - 3, 4).stroke({ color: MALF_DARK, width: 4.5 }).roundRect(1.5, 1.5, size - 3, size - 3, 4).stroke({ color: MALF_AMBER, width: 2 }));
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
        // Vehicle posture and impairment tabs sit above the markers (SK4 7.7).
        // The hover card names them all; keep the crew tab clear of the rotating turret.
        if (veh && !bare) {
          const tabs = vehicleTabs(env, p);
          const posture = showTurretArt ? tabs.find(tab => tab.tone === 'ce' || tab.tone === 'bu') : undefined;
          const conditions = tabs.filter(tab => tab !== posture);
          if (posture) {
            const badge = vehicleTabsBox([posture], size, spent);
            // Hang the crew tab from the lower-left edge so the turret remains visible.
            badge.position.set(10 - size / 2, size * 0.38 - 2);
            box.addChild(badge);
          }
          if (conditions.length) box.addChild(vehicleTabsBox(conditions, size, spent));
        }
        // A Gun's identity letter (top left), and text badges for Gun states with no marker art. A
        // vehicle wears its letter only when it is needed: to pair it with its Acquired Target
        // counter, or to tell it from another vehicle in the same hex (an offboard pile).
        if (d.kind === 'gun' || (d.kind === 'vehicle' && !isWreck(p) && (acquisitionOf(p) || personnel.some((q) => q.id !== p.id && vehicleDef(env as never, q) && !isWreck(q))))) {
          const letter = gunIdents(s, env).get(p.id);
          if (letter) box.addChild(identBadge(letter, 9, 9, 8));
        }
        const badges = d.kind === 'gun' ? unitBadges(p, isCaptured(env as never, p)) : [...(o.onRoad?.has(p.id) ? ['ROAD'] : []), ...(o.assaultMoving?.has(p.id) ? ['AM'] : []), ...(o.inBypass?.has(p.id) ? ['BYP'] : []), ...(o.snap?.units.has(p.id) ? ['SNAP'] : []), ...(o.smokeTried?.has(p.id) ? ['SMK'] : []), ...(typeof p.tags['wa'] === 'string' ? ['WA'] : []), ...(clearingUnits(s).has(p.id) ? ['TASK'] : [])];
        badges.forEach((label, k) => {
          const bg = new Graphics().roundRect(size - 26, 2 + k * 14, 24, 12, 3).fill({ color: label === 'CAPT' ? 0xc0392b : label === 'ROAD' ? 0x8a6a2c : label === 'BYP' ? 0xc77d0a : label === 'SNAP' ? 0x2f7fd6 : label === 'SMK' ? 0x5b6670 : label === 'AM' ? 0x1f8a5b : label === 'WA' ? 0x6b5b3e : label === 'TASK' ? 0x7a4bb0 : 0x2a2a2a, alpha: 0.9 });
          const tx = new Text({ text: label, style: { fontSize: 9, fill: 0xffffff, fontWeight: 'bold' } });
          tx.position.set(size - 24, 2 + k * 14);
          box.addChild(bg, tx);
        });
        // Slide from where the counter was last drawn (or is right now, if it was mid-slide).
        const from = inFlight.get(p.id) ?? was;
        // A move to another hex (not a shuffle inside its stack) by a side the map follows.
        if (from && Math.hypot(from.x - x, from.y - y) > COUNTER && followRef.current?.(p.side)) moved.push({ x: from.x + size / 2, y: from.y + size / 2 }, { x: x + size / 2, y: y + size / 2 });
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
          pushAnim(anim);
        }
        nextPos.set(p.id, { x, y, url });
        i++;
      }
      if (entrenchment && !entrenchmentDrawn) fortCounter(entrenchment);
      for (const f of fortChits) fortCounter(f);
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
      // Malfunctioned weapons the stack does not show: a SW under other counters, and a vehicle's MA or MGs (its
      // counter never shows them: the MGs are part of it, and a malfunctioned MA leaves its face as it is).
      const hiddenMalf =
        stack.slice(0, -1).filter((p) => p.tags['malf'] === true && isWeaponDef(defOf(env, p))).length +
        stack.filter((p) => vehicleDef(env as never, p)).reduce((n, v) => n + (v.tags['malf'] === true ? 1 : 0) + Object.values(s.pieces).filter((x) => x.loc.kind === 'held' && x.loc.by === v.id && isFixedMg(defOf(env, x)) && x.tags['malf'] === true).length, 0);
      if (hiddenMalf > 0) {
        const chip = brokenChip(hiddenMalf, MALF_DARK, MALF_AMBER, MALF_AMBER);
        chip.position.set(c.x - COUNTER / 2 - 2 + (hiddenBroken > 0 ? 18 : 0), c.y + COUNTER / 2 - 2);
        L.pieces.addChild(chip);
      }
      // Location markers.
      const locMarkers: string[] = [];
      // One ½" Smoke grenade counter per grenade placed in the hex (SK4 3.3.1; ASLRB A24.2), not the ⅝" Dispersed Smoke.
      for (let i = 0; i < smokeGrenades(markers); i++) locMarkers.push('Smk12');
      for (const c of smoke58Chits(markers)) locMarkers.push(c.marker);
      if (markers['cc']) locMarkers.push('CC');
      if (markers['melee']) locMarkers.push('Melee');
      if (markers[CAVE_GONE] && caveHexes.has(hex)) locMarkers.push('CaveOG');
      const rfp = markers['residualFp'] as number | undefined;
      if (rfp) locMarkers.push(`RFP${String(Math.min(12, rfp)).padStart(2, '0')}`);
      // Rubble under the pile's markers; Fire above everything: a Flame hex's units must not hide the fire, and a Blaze
      // hex holds none for long (ASLRB B25.4). The Blaze's smoke is the dispersed-Smoke marker (B25.2: no counter is placed, the
      // Hindrance follows from the Blaze itself).
      const rb = !onCorner && level === 0 ? rubbleByHex.get(hex) : undefined;
      if (rb) locMarkers.unshift('Rubble');
      const fire = onCorner ? undefined : fireByLoc.get(hex);
      if (fire) {
        if (fire.blaze) locMarkers.push('Blaze');
        else for (let n = 0; n < fire.flames; n++) locMarkers.push('Flame');
        if (fire.blaze && fire.smoke) locMarkers.push('Smk2');
      }
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
    followAction(moved);

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
    // A Snap Shot (full ASL, ASLRB A8.15): the hexside crossed, where the shot is traced.
    if (o.snap) {
      const h = anyHex(o.snap.hex);
      const k = sideToward(statics.map, o.snap.hex, o.snap.from);
      if (h && k !== null) {
        const m = hexCenter(h, placements);
        const pt = (j: number) => { const off = cornerOffset(j); return xf.current.toView(m.x + off.x, m.y + off.y); };
        const [p, q] = [pt(k), pt((k + 1) % 6)];
        L.top.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: 0x2f7fd6, width: 12, alpha: 0.25 });
        L.top.moveTo(p.x, p.y).lineTo(q.x, q.y).stroke({ color: 0x2f7fd6, width: 4, alpha: 0.95, cap: 'round' });
      }
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

