import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Action, GameState, HexId, Piece, PieceId, QueryEnv, SideId } from '@asl/engine';
import { fixtureActions } from '@asl/content';
import {
  adjacentLocs,
  attackFp,
  buildAttack,
  cavesParams,
  caveLoc,
  isCaveLoc,
  hexOfLoc,
  levelOfLoc,
  locOf,
  moveLoc,
  locationAt,
  locationsOf,
  controlChits,
  controlMatters,
  defOf,
  defaultVca,
  directorIllegal,
  isRofShot,
  fireMarker,
  hideIllegal,
  hiddenUnitsParams,
  entryAfterFireParams,
  compulsoryHidden,
  gameTurns,
  revealedLength,
  inPlay,
  digInParams,
  deployableSquads,
  setupDeployParams,
  squadsDeployed,
  ssrHexAttacks,
  artilleryMissions,
  artilleryImpact,
  artilleryObservers,
  setupAnchorProgress,
  isGoodOrder,
  iftColumn,
  moveState,
  objectiveAreas,
  roadBonusEarned,
  assaultMoving,
  isOrchardRoad,
  isWoodsRoad,
  firstFireTargets,
  acrossSide,
  bypassPlan,
  cornerBetween,
  cornerLabel,
  cornerOffset,
  hexPixel,
  movingInfo,
  pendingRouts,
  planRout,
  defaultPlacement,
  FORTIFY_DECISION,
  fortifiableBuildings,
  fortifiedKnownTo,
  fortifiedParams,
  fortifiedState,
  fortifyIllegal,
  personnelAt,
  personnelInHex,
  piecesToPlace,
  placementHexes,
  entryHexesOf,
  exitHexes,
  exitHexesEver,
  placementIllegal,
  reserveIllegal,
  reserveRuleFor,
  swAssignmentIllegal,
  routEscorts,
  activeRout,
  activeRoutEnds,
  routMfLeft,
  swHeldBy,
  terrainOf,
  unpossessedSwAt,
  chartLabel,
  pendingVariableReinforcements,
  entryOrderDrPending,
  entryOrderDrParams,
  forceChartParams,
  forceChartResult,
  weatherOf,
  withoutSecrets,
  coveredArc,
  gun as gunDef,
  gunIdent,
  vehicle as vehicleDef,
  vehicleIfe,
  turretTurnFor,
  enemyVehicleAt,
  ordnanceDirectorIllegal,
  swDirectorIllegal,
  ordnanceOf,
  pfCap,
  pfCheckDrm,
  pfIllegal,
  pfMaxRange,
  pfUnitIllegal,
  pfUsed,
  AMMO_NAME,
  ammoStatus,
  defaultAmmo,
  gunFirstFireMode,
  gunHeldBy,
  isFixedWeapon,
  isVisibleTo,
  isWeaponDef,
  rofChoices,
  rofDeclineResidual,
  type FireDeclaration,
  type MoveState,
  type FireMode,
  type OrdnanceShot,
  type ScenarioDef,
  type RoutReason,
  type Statics,
  type TargetType,
  type AmmoKind,
} from '@asl/rules';
import { caChangeFor, gunHexOf, shotOptions, spineLabel, spineToward, thPreview } from './game/ordnance';
import { DirectorPicker, GunComposer } from './panels/GunComposer';
import type { SmokeThrow } from '@asl/rules';
import { CONCEAL_RTPH_DECISION, LEADER_PTC_DECISION, ONCE_DR_DECISION, actionIllegal, onceDrRules, ordnanceWeaponIllegal, banzaiSteps, banzaiState, banzaiWindowsPending, concealRtphUnits, concealmentActive, declareIllegal as banzaiIllegal, isJapanese, obConcealment, redactState } from '@asl/rules';
import { BoardView, type BoardOverlay, type HexBadge, type HexControl, type Placement } from './board/BoardView';
import { ActionWheel, action, group, type WheelItem } from './board/ActionWheel';
import { StackPeek, stackIn } from './board/StackPeek';
import { NATION, PHASE_NAME, defLabel, describeEvents, hexLabel, humanize, phaseSections, pieceLabel } from './game/describe';
import { LogText } from './game/LogText';
import { RofChoice, type RofChoiceItem } from './panels/RofChoice';
import { fireLeaders, fireSelectable } from './game/fireSelection';
import { endPhaseWarning, type EndPhaseWarning } from './game/endPhaseGuard';
import { Modal } from './ui/Modal';
import { ErrorBoundary } from './ui/ErrorBoundary';
import type { MapPoint, Session } from './game/session';
import { SetupTray, type TrayGroup } from './panels/SetupTray';
import { useScatterPlanner } from './panels/ScatterPlanner';
import { useEntryGroupsPicker } from './panels/EntryGroupsPicker';
import { useEntryTurnsPicker } from './panels/EntryTurnsPicker';
import { useEntryStretchPicker } from './panels/EntryStretchPicker';
import { useGameLengthPicker } from './panels/GameLengthPicker';
import { StackInspector } from './panels/StackInspector';
import { ConnectionBox } from './panels/ConnectionBox';
import { CloseCombat } from './panels/CloseCombat';
import { BriefingDialog, EDGE_NAME, VictoryPanel, edgeWords, setupRule } from './panels/Briefing';
import { CasualtyLedger, sideTally } from './panels/CasualtyLedger';
import { Hud } from './hud/Hud';
import { PhaseWheel, resetWheel } from './fx/PhaseWheel';
import { DiceLog, DiceTray } from './fx/DiceTray';
import { CalloutBanner, GameOver, YourCall, type AarCue } from './fx/Overlays';
import { DICE_LOG_LIMIT, useGameFx } from './fx/useGameFx';
import { usePresentation } from './game/presentation';
import { playSfx } from './audio/engine';
import { SettingsPanel } from './settings/SettingsPanel';
import { ShortcutsDialog } from './panels/Shortcuts';
import { ChartsDialog } from './panels/Charts';
import { useFxLevel, useWeatherFx, useYourCallStrip } from './fx/settings';
import { northScreenAngle, weatherFxKind, windScreenAngle } from './game/weatherView';
import { CompassRose } from './hud/CompassRose';
import { HudTools } from './deployment';

interface Props {
  scenario: ScenarioDef;
  session: Session;
  /** The match this is; the way the map is turned is remembered per match on this device. */
  matchId?: string;
  /**
   * The key the map's orientation is remembered under in this browser, when it is not the match id: a replay or a
   * watched match (no `matchId`) keeps the viewer's rotation from one visit to the next.
   */
  viewKey?: string;
  /** Back to the lobby. A persisted game stays where it is. */
  onQuit(): void;
  /**
   * Told whether the screen is busy showing something the player should see first: results still
   * being revealed, or the phase wheel turning (a computer opponent waits for it).
   */
  onResolvingChange?(busy: boolean): void;
  /** The Slow pace of a game against the computer: results the player reads (Close Combat) stay up longer. */
  slow?: boolean;
  /** A column between the board and the orders panel, e.g. the table chat rail. */
  aside?: ReactNode;
  /** The after action report's place on the victory screen (see GameOver). */
  aar?: AarCue | null;
  /** Who plays each side, for the top bar (see `seatNames`). */
  players?: Record<string, string>;
}

const VIEW_KEY = (matchId: string) => `asl.view.${matchId}`;

/** Quarter turns the player had the map turned by when this match was last open here. */
function readQuarterTurns(matchId: string | undefined): number {
  if (!matchId) return 0;
  try {
    const n = Number(localStorage.getItem(VIEW_KEY(matchId)));
    return Number.isInteger(n) ? n : 0;
  } catch {
    return 0;
  }
}

const SIDE_KEY = 'asl.sideCollapsed';

/**
 * The orders panel folded away to a strip, for a small screen. Remembered in this browser; the page root carries it
 * as a class, since the panel's width (--side-w) also places things outside the game screen.
 */
function useSideCollapsed(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return localStorage.getItem(SIDE_KEY) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('side-collapsed', on);
    return () => document.documentElement.classList.remove('side-collapsed');
  }, [on]);
  const set = (v: boolean) => {
    setOn(v);
    try {
      localStorage.setItem(SIDE_KEY, v ? '1' : '0');
    } catch {
      /* private mode etc.: not remembered */
    }
  };
  return [on, set];
}

const GREEN = 0x5fd35f;
const RED = 0xe0504a;
const BLUE = 0x5aa0ff;
const AMBER = 0xf0b030;
const VIOLET = 0xb07cf0;
const TEAL = 0x3cc8b4;
/** A router with no building or woods in reach this RtPh has no ROUT END hexes to make for (SK1 3.6). */
const NO_SHELTER = 'No building or woods hex is within reach this Rout Phase, so there is no ROUT END to make for: it may rout to any hex away from the enemy (click an amber hex), and Open Ground in the view of an enemy able to fire means Interdiction.';
/** How long (ms) a hex's Close Combat results stay up at the Slow pace (2.6 s otherwise). */
const CC_LINGER_SLOW = 6500;

const FIRE_MODE: Record<string, FireMode> = { PFPh: 'prep', DFPh: 'final', AFPh: 'advancing' };
/** Moves a stack can still make once its MF are spent only if one of these is legal (a road bonus step, say). */
const MOVE_GOES_ON = new Set(['move.step', 'move.manhandle', 'move.smoke', 'move.recover', 'move.placeDc', 'move.exit']);

/** Ping colours: one per player by seat order, chosen to stand out on any terrain (none is a map colour); the last is a spectator's. */
const PING_COLORS = [0xff2fd6, 0x19e8ff, 0xfff23a];

/** The game screen; a render error anywhere in it shows a notice to try again or reload, not a blank page. */
export function GameScreen(props: Props) {
  return (
    <ErrorBoundary what="the game screen">
      <GameScreenView {...props} />
    </ErrorBoundary>
  );
}

function GameScreenView({ scenario, session, matchId, viewKey, onQuit, onResolvingChange, slow = false, aside, aar = null, players }: Props) {
  const { engine } = session;
  const [fxLevel, setFxLevel] = useFxLevel();
  // The screen shows the game as far as the dice have been revealed (see usePresentation).
  const present = usePresentation(engine, session.state, session.log, fxLevel === 'off', session.seek);
  const state = present.state;
  const resolving = present.resolving;
  const statics = engine.statics as Statics;
  const env: QueryEnv = useMemo(() => engine.env(state), [engine, state]);
  const realEnv: QueryEnv = useMemo(() => engine.env(session.state), [engine, session.state]);
  const placements: Placement[] = useMemo(
    () =>
      scenario.boards.map((b) => ({
        board: b.board,
        x: Number(b.position.split(',')[0]),
        y: Number(b.position.split(',')[1]),
        ...(b.columns ? { columns: b.columns } : {}),
        ...(b.rows ? { rows: b.rows } : {}),
        ...(b.rotation ? { rotation: b.rotation } : {}),
      })),
    [scenario],
  );
  // Turn the board so the scenario's north is up (the board side the card's north arrow names),
  // plus however many quarter turns the player has added with the map rotate buttons.
  const northUp = { N: 0, E: 270, S: 180, W: 90 }[scenario.compass?.N ?? 'N'];
  const viewId = viewKey ?? matchId;
  const [quarterTurns, setQuarterTurns] = useState(() => readQuarterTurns(viewId));
  useEffect(() => {
    if (!viewId) return;
    try {
      localStorage.setItem(VIEW_KEY(viewId), String(((quarterTurns % 4) + 4) % 4));
    } catch {
      /* private mode etc.: the orientation is simply not remembered */
    }
  }, [viewId, quarterTurns]);
  const rotation = (northUp + quarterTurns * 90 + 360) % 360;
  // Counters hidden to look at the terrain: toggled from the HUD, or held with the T key.
  const [unitsHidden, setUnitsHidden] = useState(false);
  const [peekTerrain, setPeekTerrain] = useState(false);
  // Markers left off the counters (M held, or the HUD toggle), so the counter underneath can be read.
  const [markersHidden, setMarkersHidden] = useState(false);
  const [peekBare, setPeekBare] = useState(false);
  // The dice log: the last rolls, pulled back up over the tray. The briefing: the scenario card, over the board.
  const [diceLog, setDiceLog] = useState(false);
  const [briefing, setBriefing] = useState(false);
  // The casualty ledger: the chits behind a side's CVP total, opened from the HUD tally.
  const [ledger, setLedger] = useState<SideId | null>(null);
  /** The current pass handler, for the P key (null when there is nothing to pass on). */
  const passRef = useRef<(() => void) | null>(null);
  /** While one of our vehicles is moving: Q/E turn the hull, A/D the turret (a hexspine each). */
  const vehicleKeysRef = useRef<((key: string) => boolean) | null>(null);
  const [shortcuts, setShortcuts] = useState(false);
  const [charts, setCharts] = useState(false);
  // Keyboard: [ and ] turn the map a quarter turn; T (held) hides the counters; M (held) hides the markers on them; L toggles the dice log; B the briefing; C the charts; P passes a First Fire opportunity; ? lists these (ignored while typing in a field).
  useEffect(() => {
    const typing = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
      if (e.key === '[') setQuarterTurns((q) => q - 1);
      else if (e.key === ']') setQuarterTurns((q) => q + 1);
      else if (e.key === 't' || e.key === 'T') setPeekTerrain(true);
      else if (e.key === 'm' || e.key === 'M') setPeekBare(true);
      else if (e.key === 'l' || e.key === 'L') setDiceLog((o) => !o);
      else if (e.key === 'b' || e.key === 'B') setBriefing((o) => !o);
      else if (e.key === 'c' || e.key === 'C') setCharts((o) => !o);
      else if ((e.key === 'p' || e.key === 'P') && passRef.current) passRef.current();
      else if (e.key === '?') setShortcuts((o) => !o);
      else if (vehicleKeysRef.current?.(e.key.toLowerCase())) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key === 't' || e.key === 'T') setPeekTerrain(false);
      if (e.key === 'm' || e.key === 'M') setPeekBare(false);
    };
    const onBlur = () => {
      setPeekTerrain(false);
      setPeekBare(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  const [selectedHex, setSelectedHex] = useState<HexId | null>(null);
  const [selected, setSelected] = useState<Set<PieceId>>(new Set());
  const [hoverHex, setHoverHex] = useState<HexId | null>(null);
  // Action wheel (right-click a hex) and the stack peek (linger over a hex).
  /** The action wheel at a hex; `items` replaces the hex's usual entries with a choice to make there (road or woods). */
  const [wheel, setWheel] = useState<{ hex: HexId; at: { x: number; y: number }; items?: WheelItem[]; title?: string } | null>(null);
  /** Where the last wheel opened: the Bypass point picker opens there after a Fire chosen on it. */
  const lastWheelAt = useRef<{ x: number; y: number }>({ x: 420, y: 360 });
  if (wheel) lastWheelAt.current = wheel.at;
  /** Full ASL Bypass (ASLRB A4.3): a corner picked on the map, waiting for the confirm bar (UI option B2). */
  const [bypassPick, setBypassPick] = useState<{ id: string; action: Omit<Action, 'side' | 'decisionId'>; text: string } | null>(null);
  /**
   * Full ASL: Defensive First Fire declared at a stack in Bypass, each firing hex now choosing the point its LOS is
   * traced to (ASLRB A4.34, A6.11; read here as each firing hex choosing its own).
   */
  const [pointPick, setPointPick] = useState<{ decl: FireDeclaration; hexes: HexId[]; i: number; chosen: Record<HexId, [HexId, HexId]>; points: [HexId, HexId][] } | null>(null);
  const [peek, setPeek] = useState<{ hex: HexId; at: { x: number; y: number } } | null>(null);
  /** The wheel can be about a whole hex or one chit in the stack card. */
  const [chitWheel, setChitWheel] = useState<{ piece: PieceId; at: { x: number; y: number } } | null>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  /**
   * Hover bookkeeping for the stack card: it appears after a short linger, and stays while the
   * pointer is on the card itself (or a chit wheel from it is open), so chits can be picked.
   */
  const hover = useRef<{
    hex: HexId | null;
    at: { x: number; y: number };
    show: number | null;
    hide: number | null;
    overCard: boolean;
    pinned: boolean;
    /** A click on the hovered hex was deliberate: no card until the pointer visits another hex. */
    clicked: boolean;
  }>({
    hex: null,
    at: { x: 0, y: 0 },
    show: null,
    hide: null,
    overCard: false,
    pinned: false,
    clicked: false,
  });
  const PEEK_DELAY = 500;
  /**
   * While a stack is moving the card asks for a longer linger: the moved stack slides in under the
   * pointer after each step, and a card that pops up there sits over the next hex to click.
   */
  const PEEK_DELAY_MOVING = 1000;
  /** Time the pointer has to reach the card after leaving the hex. */
  const PEEK_GRACE = 300;
  const onHexHover = (hex: HexId | null, at: { x: number; y: number }, dragging = false) => {
    const h = hover.current;
    h.at = at;
    // Carrying a counter in setup: the hex is where it may land, not one to inspect. No card opens, and one
    // already up goes (a native drag from the tray gets no pointer events, so it would otherwise outlive the drag).
    if (dragging) {
      if (h.show) clearTimeout(h.show);
      if (h.hide) clearTimeout(h.hide);
      h.show = h.hide = null;
      h.hex = hex;
      h.clicked = true;
      setHoverHex(hex);
      if (!h.pinned) setPeek(null);
      return;
    }
    if (hex === h.hex) {
      // After a click the card stays away while the pointer rests, but a fresh linger on the same
      // hex brings it back (to untick units of a stack just selected). Not while a stack moves:
      // the card would sit over the next hex to click.
      if (hex && h.clicked && !ms) {
        if (h.show) clearTimeout(h.show);
        h.show = window.setTimeout(() => {
          h.clicked = false;
          if (!h.overCard && !h.pinned) setPeek({ hex, at: hover.current.at });
        }, PEEK_DELAY);
      }
      return;
    }
    h.hex = hex;
    h.clicked = false;
    setHoverHex(hex);
    if (h.show) clearTimeout(h.show);
    if (h.hide) clearTimeout(h.hide);
    h.show = null;
    h.hide = window.setTimeout(() => {
      if (!h.overCard && !h.pinned) setPeek(null);
    }, PEEK_GRACE);
    if (hex)
      h.show = window.setTimeout(() => {
        if (!h.overCard && !h.pinned && !h.clicked) setPeek({ hex, at: hover.current.at });
      }, ms ? PEEK_DELAY_MOVING : PEEK_DELAY);
  };
  /** A click on the map is deliberate: drop any pending card and keep it away until the pointer moves on. */
  const peekDismiss = () => {
    const h = hover.current;
    h.clicked = true;
    if (h.show) clearTimeout(h.show);
    h.show = null;
    if (!h.overCard && !h.pinned) setPeek(null);
  };
  const cardEnter = () => {
    hover.current.overCard = true;
  };
  const cardLeave = () => {
    hover.current.overCard = false;
    if (!hover.current.pinned) setPeek(null);
  };
  const closeChitWheel = () => {
    setChitWheel(null);
    hover.current.pinned = false;
    if (!hover.current.overCard) setPeek(null);
  };
  // A card that closes under the pointer gets no pointerleave: the pointer is off it all the same.
  useEffect(() => {
    if (!peek || wheel) hover.current.overCard = false;
  }, [peek, wheel]);
  useEffect(
    () => () => {
      if (hover.current.show) clearTimeout(hover.current.show);
      if (hover.current.hide) clearTimeout(hover.current.hide);
    },
    [],
  );
  const [target, setTarget] = useState<HexId | null>(null);
  /** Leaders directing the declared fire, one per firing hex (SK1 3.2). */
  const [directors, setDirectors] = useState<PieceId[]>([]);
  /** Fire has been declared: `selected` is the fire group, marked on the map; the next enemy hex clicked is shot at. */
  const [declared, setDeclared] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lowCrawl, setLowCrawl] = useState(false);
  const [mode, setMode] = useState<'normal' | 'smoke' | 'dc' | 'bffMg'>('normal');
  /**
   * Smoke grenade attempts declared so far for the stack's next MF expenditure, and the unit to throw next: every
   * attempt declared together is one expenditure of the stack (ASLRB A4.2), thrown with the Throw button.
   */
  const [smokePlan, setSmokePlan] = useState<SmokeThrow[]>([]);
  const [smokeNext, setSmokeNext] = useState<PieceId | null>(null);
  useEffect(() => {
    if (mode === 'smoke') return;
    setSmokePlan([]);
    setSmokeNext(null);
  }, [mode]);
  // Esc leaves picking a Smoke or DC target for ordinary moving.
  useEffect(() => {
    if (mode !== 'smoke' && mode !== 'dc') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('normal');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);
  // Vehicular MGs lined up for Bounding First Fire (SK3): the next enemy hex clicked is their target.
  const [bffMgs, setBffMgs] = useState<PieceId[]>([]);
  /** A Gun lined up to fire: which, how (target type) and whether as Intensive Fire; the next enemy hex clicked is shot at. */
  const [gunShot, setGunShot] = useState<{ gun: PieceId; targetType: TargetType; intensive: boolean; ammo?: AmmoKind; backblast?: boolean; director?: PieceId } | null>(null);
  /** A Panzerfaust try lined up (SK4 4.4.2): the unit and what it aims at, waiting for the target hex. */
  const [pfShot, setPfShot] = useState<{ unit: PieceId; targetType: 'VTT' | 'ITT'; backblast?: boolean; director?: PieceId } | null>(null);
  const [weatherFx, setWeatherFx] = useWeatherFx();
  const [callStrip, setCallStrip] = useYourCallStrip();
  /** The phase the player hid the "your call" strip in: it stays hidden until the next one. */
  const [callHiddenIn, setCallHiddenIn] = useState<string | null>(null);
  const [sideCollapsed, setSideCollapsed] = useSideCollapsed();
  const [reviewing, setReviewing] = useState(false);
  /** The Close Combat overlay is up: a game it ends waits for it to clear before the result covers the board. */
  const [ccShown, setCcShown] = useState(false);
  /** ...and is lingering over its results: a computer opponent waits for them to clear. */
  const [ccLingering, setCcLingering] = useState(false);
  const [settings, setSettings] = useState(false);
  useEffect(() => {
    if (error) playSfx('ui.deny');
  }, [error]);
  useEffect(() => {
    resetWheel();
  }, [scenario, engine]);

  const decision = engine.currentDecision(state);
  /** The side whose decision this browser may answer; undefined when it is someone else's move (or we are watching). */
  // While results are still being revealed nobody gives orders: the decision shown may be gone already.
  const owner = !resolving && decision && (session.mySide === undefined || decision.owner === session.mySide) ? decision.owner : undefined;
  const waitingOn = !resolving && decision && !owner ? decision.owner : undefined;
  const legal = useMemo(() => (owner ? engine.legalActions(state, owner) : []), [engine, state, owner]);
  const ms = moveState(env);
  /** The movers that may still throw Smoke grenades this MPh (SK1 3.3: once per unit) and are not in the plan, best Smoke exponent first. */
  const smokeThrowers = (): PieceId[] =>
    (ms?.units ?? [])
      .filter((u) => env.query('unit.smoke', { unit: u }, 0) && !ms!.smokeTriedBy?.includes(u) && !smokePlan.some((t) => t.unit === u))
      .sort((a, b) => env.query('unit.smoke', { unit: b }, 0) - env.query('unit.smoke', { unit: a }, 0));
  /** The mover whose Smoke target the next amber click picks: the player's choice, else the best exponent. */
  const smokeThrower = (): PieceId | undefined => {
    const left = smokeThrowers();
    return smokeNext && left.includes(smokeNext) ? smokeNext : left[0];
  };
  const throwSmoke = (plan: SmokeThrow[]) => {
    setMode('normal');
    run(plan.length === 1 ? { type: 'move.smoke', ...plan[0]! } : { type: 'move.smoke', throws: plan }, true);
  };
  const phase = state.phase;
  /** This phase of this Player Turn, for what the player hid "until the next phase". */
  const phaseKey = `${state.turn}.${state.attacker}.${phase}`;
  const isFireDecision = (decision?.kind === 'phase' && phase in FIRE_MODE) || decision?.kind === 'firstFire';
  const phases = useMemo(() => env.query('turn.phases', {}, [] as string[]), [env]);
  const fx = useGameFx(realEnv, session.log, decision, fxLevel, session.mySide !== undefined ? session.mySide : (decision?.owner ?? null), present, session.seek);
  const showingWheel = !!fx.wheel;
  useEffect(() => onResolvingChange?.(resolving || showingWheel || ccLingering), [resolving, showingWheel, ccLingering, onResolvingChange]);
  /** An engine message made readable (unit names and hexes instead of ids). */
  const plain = (m: string | null | undefined): string | null => (m ? humanize(env, m) : null);
  // Pings (Ctrl+click): rings close in on the hex in the pinger's colour. Online, the seated player's;
  // hotseat, the side whose decision it is, so a recording shows who was pointing.
  const pingColor = (side: string | null | undefined) => {
    const i = side ? scenario.sides.findIndex((s) => s.side === side) : -1;
    return PING_COLORS[i >= 0 && i < PING_COLORS.length - 1 ? i : PING_COLORS.length - 1]!;
  };
  const lastPing = useRef<{ hex: HexId; at: number } | null>(null);
  const pingHex = (hex: HexId, at?: MapPoint) => {
    // A Mac may report Ctrl+click twice (click and context menu): one ping.
    const t = performance.now();
    if (lastPing.current && lastPing.current.hex === hex && t - lastPing.current.at < 300) return;
    lastPing.current = { hex, at: t };
    const side = session.mySide !== undefined ? session.mySide : (decision?.owner ?? state.attacker);
    fx.ping(hex, pingColor(side), at);
    session.sendPing?.(hex, at);
  };
  const seenPing = useRef(0);
  useEffect(() => {
    for (const p of session.pings ?? [])
      if (p.id > seenPing.current) {
        seenPing.current = p.id;
        fx.ping(p.hex as HexId, pingColor(p.side), p.at);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.pings]);
  // Rout Phase: each broken unit of the routing side, whether it must rout and why.
  const routs = useMemo(() => (phase === 'RtPh' && decision?.kind === 'phase' ? pendingRouts(env) : []), [env, phase, decision]);
  const routInfo = (id: PieceId) => routs.find((r) => r.unit === id);
  /** The rout under way: that unit walks on, hex by hex, until it stops or can go no further. */
  const routing = phase === 'RtPh' && decision?.kind === 'phase' ? activeRout(env) : undefined;
  const routReason = (r: RoutReason) =>
    r.kind === 'adjacent'
      ? `adjacent to ${pieceLabel(env, state.pieces[r.enemy])} in ${r.hex.replace(/^[a-z]/, '')}`
      : `in Open Ground in the LOS and range of ${pieceLabel(env, state.pieces[r.enemy])} in ${r.hex.replace(/^[a-z]/, '')}`;
  const endBlocked = decision?.kind === 'phase' ? plain(env.query('phase.endBlocked', {}, null)) : null;

  // ------------------------------------------------------------------ setup (scenario + offboard)
  const placing = owner && (decision?.kind === 'setup' || decision?.kind === 'offboardSetup') ? decision : null;
  const todo = useMemo(() => (placing ? piecesToPlace(env, placing) : []), [placing, env]);
  // Card-style groups for the tray, when the scenario labels its forces (see ScenarioForce.group).
  // Support weapons to set up: held by units being placed. Each is a counter of its own in the
  // tray and goes in a hex with a unit of its group, which then carries it (never unpossessed, SK1 4.0).
  // A vehicle's MGs are part of it (SK4 7.8), not counters to place.
  const swTodo = useMemo(() => todo.flatMap((p) => swHeldBy(state, p.id)).filter((w) => !(defOf(env, w).kind === 'sw' && (defOf(env, w) as { fixed?: boolean }).fixed)), [todo, state, env]);
  /** The scenario group (force index) a counter belongs to; a weapon's is its card carrier's. */
  const forceOf = (p: Piece): number => (p.loc.kind === 'held' ? (state.pieces[p.loc.by]?.tags['force'] as number) : (p.tags['force'] as number));
  /** The tray's counters grouped the way the card groups them (null when the scenario labels no force). */
  const groupTray = (pieces: Piece[]): TrayGroup[] | null => {
    const forces = scenario.forces;
    const byForce = new Map<number, Piece[]>();
    for (const p of pieces) {
      const fi = forceOf(p);
      byForce.set(fi, [...(byForce.get(fi) ?? []), p]);
    }
    if (![...byForce.keys()].some((fi) => forces[fi]?.group)) return null;
    return [...byForce]
      .sort(([a], [b]) => a - b)
      .map(([fi, ps]) => {
        const f = forces[fi]!;
        return { key: String(fi), label: f.group ?? f.id ?? `Group ${fi + 1}`, rule: setupRule(f), pieces: ps };
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trayGroups = useMemo((): TrayGroup[] | null => groupTray([...todo, ...swTodo]), [todo, swTodo, scenario]);
  const [pending, setPending] = useState<Record<PieceId, HexId>>({});
  const [picked, setPicked] = useState<PieceId | null>(null);
  // Which unit carries each placed weapon (SW id → unit), confirmed with the placements.
  const [swAssign, setSwAssign] = useState<Record<PieceId, PieceId>>({});
  // Guns being set up: the Covered Arc chosen for each (hexspine 0–5), which are hidden (HIP),
  // and the Gun (or vehicle) whose six hexspine handles are shown on the map to face it.
  const [pendingCa, setPendingCa] = useState<Record<PieceId, number>>({});
  const [pendingHip, setPendingHip] = useState<Set<PieceId>>(new Set());
  const [caFor, setCaFor] = useState<PieceId | null>(null);
  /** A Banzai Charge being put together (SK4 8.1.8.6): the leader, the units ticked so far, the target hex once clicked. */
  const [banzaiDraft, setBanzaiDraft] = useState<{ leader: PieceId; units: PieceId[]; target: HexId | null } | null>(null);
  /** The charging unit the player will step next (clicking one of its green hexes moves it). */
  const [banzaiUnit, setBanzaiUnit] = useState<PieceId | null>(null);
  /**
   * A facing ring in play (SK4 3.2.4), opened from the wheel's "turn toward…" entries: a vehicle's
   * hull or turret while it moves, or a Gun's Covered Arc change in its fire phase. Each hexspine's
   * sector runs `action` for that spine (null: nothing to do, it points there already).
   */
  /** The side panel's free Delay amount (SK4 3.3.2), typed while a vehicle stands stopped. */
  const [delayMp, setDelayMp] = useState('');
  const [ring, setRing] = useState<{ hex: HexId; piece: PieceId; what: string; current: number; note: string; action(spine: number): Omit<Action, 'side' | 'decisionId'> | null } | null>(null);
  useEffect(() => setRing(null), [decision?.id]);
  // A facing ring wants the hex to itself: no stack card pops up over it while it is shown.
  useEffect(() => {
    if (!caFor && !ring) return;
    const h = hover.current;
    if (h.show) clearTimeout(h.show);
    h.show = null;
    setPeek(null);
  }, [caFor, ring]);
  // Vehicles being set up (SK3): `pendingCa` holds their Vehicle Covered Arc too; which start Crew Exposed.
  const [pendingCe, setPendingCe] = useState<Set<PieceId>>(new Set());
  // Units set up hidden with their weapons where a special rule allows it (S23 SSR 1, `hidden-units`).
  const [pendingHidden, setPendingHidden] = useState<Set<PieceId>>(new Set());
  /** Units set up under an OB concealment counter (SK4 8.3): toggled per stack. */
  const [pendingConcealed, setPendingConcealed] = useState<Set<PieceId>>(new Set());
  // Vehicles dug in at setup where a special rule allows it (S28 SSR 3, `dig-in`).
  const [pendingDugIn, setPendingDugIn] = useState<Set<PieceId>>(new Set());
  useEffect(() => {
    setPending({});
    setPicked(null);
    setSwAssign({});
    setPendingCa({});
    setPendingHip(new Set());
    setPendingHidden(new Set());
    setPendingConcealed(new Set());
    setPendingCe(new Set());
    setPendingDugIn(new Set());
    setCaFor(null);
  }, [placing?.id]);
  // A placement of a counter that is no longer there (a squad deployment undone) is dropped.
  useEffect(() => {
    if (Object.keys(pending).some((id) => !state.pieces[id])) setPending(Object.fromEntries(Object.entries(pending).filter(([id]) => !!state.pieces[id])));
  }, [state.pieces, pending]);
  const isGunPiece = (id: PieceId) => !!state.pieces[id] && !!gunDef(env, state.pieces[id]!);
  const isVehiclePiece = (id: PieceId) => !!state.pieces[id] && !!vehicleDef(env, state.pieces[id]!);
  /**
   * Repair entries for a vehicle's malfunctioned Main Armament and vehicular MGs (SK4 3.1 c): the
   * engine's `vehicle.repair`, not the SW `rally.repair`, which skips fixed weapons. Greyed, with the
   * reason, when the attempt is not allowed now (already tried, Shocked, not the RPh).
   */
  const vehicleRepairItems = (v: Piece): WheelItem[] => {
    const targets: { weapon: 'ma' | PieceId; label: string }[] = [];
    if (v.tags['wreck']) return [];
    if (v.tags['malf']) targets.push({ weapon: 'ma', label: `${pieceLabel(env, v)} MA` });
    for (const w of swHeldBy(state, v.id)) if (w.tags['malf']) targets.push({ weapon: w.id, label: `${pieceLabel(env, v)} ${pieceLabel(env, w)}` });
    return targets.map((t) => {
      const a = { type: 'vehicle.repair', vehicle: v.id, weapon: t.weapon };
      const err = plain(session.check(a));
      return action(t.label, () => run(a, true), { icon: '🔧', disabled: !!err, hint: err ?? 'A dr of 1 repairs it; a 6 disables it for good (SK4 3.1)' });
    });
  };
  /**
   * Vehicles never act as a group (each is set up, moves and fires on its own), so a selection
   * holds one at most: of the vehicles among `ids`, the one in `current` if any, else the top of
   * the pile (the last, as the board draws them).
   */
  const soloVehicles = (ids: PieceId[], current: Set<PieceId> = selected): PieceId[] => {
    const vehicles = ids.filter(isVehiclePiece);
    if (vehicles.length <= 1) return ids;
    const keep = vehicles.find((id) => current.has(id)) ?? vehicles[vehicles.length - 1]!;
    return ids.filter((id) => !isVehiclePiece(id) || id === keep);
  };
  /**
   * Rout Phase: units rout one at a time (SK1 3.6), so picking up a stack selects just its first broken
   * unit (a MMC before a broken leader, so a leader may go with it) and the first Good Order leader who may
   * rout along. The Stack panel still lets the player tick another unit or leader, or untick the leader.
   */
  const routDefaults = (ids: PieceId[]): PieceId[] => {
    if (routing) return ids;
    const isLeader = (u: PieceId) => defOf(env, state.pieces[u]!).kind === 'leader';
    const first = [...ids].sort((a, b) => Number(isLeader(a)) - Number(isLeader(b)))[0];
    if (!first) return [];
    const escort = routEscorts(env, first)[0];
    return escort ? [first, escort] : [first];
  };
  /** The units a click or "Select stack" picks up in a hex: one vehicle at most, and in the RtPh one broken unit with its leader. */
  const stackPick = (ids: PieceId[], current: Set<PieceId> = selected): PieceId[] =>
    decision?.kind === 'phase' && phase === 'RtPh' ? routDefaults(ids) : soloVehicles(ids, current);
  /** The acting side's live vehicles in a hex (on board or waiting offboard), bottom of the pile first. */
  const vehiclesIn = (hex: HexId): Piece[] =>
    Object.values(state.pieces).filter((p) => p.side === owner && (p.loc.kind === 'hex' || p.loc.kind === 'offboard') && p.loc.hex === hex && vehicleDef(env, p) && !p.tags['wreck']);
  /** Of a hex's vehicles, the one the wheel gives orders to: the selected one, else the top of the pile. */
  const chosenVehicle = (vehicles: Piece[]): Piece | undefined => {
    const id = soloVehicles(vehicles.map((v) => v.id)).find(isVehiclePiece);
    return vehicles.find((v) => v.id === id);
  };
  /** Several vehicles in a hex (an offboard pile): a ring to pick which one the wheel works on; the wheel stays open on it. */
  const vehicleChooser = (hex: HexId, vehicles: Piece[]): WheelItem | null => {
    if (vehicles.length < 2) return null;
    const cur = chosenVehicle(vehicles);
    const name = (v: Piece) => pieceLabel(env, v).replace(/^\S+ /, '');
    const entry = (v: Piece) =>
      action(
        name(v),
        () => {
          setSelectedHex(hex);
          setSelected((s) => new Set([...[...s].filter((id) => !isVehiclePiece(id)), v.id]));
        },
        { icon: gunIdent(env, v) || '•', active: cur?.id === v.id, stay: true, hint: `Give orders to this ${vehicleDef(env, v)!.name} (it comes to the top of the pile)` },
      );
    // Top of the pile first. A big pile is split by vehicle type so no ring gets crowded.
    const top = [...vehicles].reverse();
    const types = [...new Set(top.map((v) => v.defId))];
    const entries =
      top.length <= 6 || types.length < 2
        ? top.map(entry)
        : types.map((t) => {
            const of = top.filter((v) => v.defId === t);
            const here = of.find((v) => v.id === cur?.id);
            return group(`${vehicleDef(env, of[0]!)!.name} ×${of.length}${here ? ` (${gunIdent(env, here)})` : ''}`, of.map(entry), { icon: String(of.length) });
          });
    return group(cur ? `Vehicle: ${name(cur)}` : 'Which vehicle…', entries, { icon: '☰', hint: 'Vehicles act one at a time: pick the one to give orders to' });
  };
  /**
   * A vehicle's wheel entry: named only when the hex holds other vehicles of the side (an offboard
   * pile, or two left in a hex at the end of the MPh), since on the map vehicles do not stack.
   */
  const vehicleEntry = (v: Piece, pile: boolean, label: string) => (pile ? `${pieceLabel(env, v).replace(/^\S+ /, '')}: ${label}` : label.charAt(0).toUpperCase() + label.slice(1));
  /** A vehicle's CE/BU switch, in its owner's MPh or APh (ASLRB D5.33). */
  const ceEntry = (v: Piece, pile: boolean): WheelItem => {
    const ceErr = plain(session.check({ type: 'vmove.ce', vehicle: v.id, ce: !v.tags['ce'] }));
    return action(vehicleEntry(v, pile, v.tags['ce'] ? 'Button Up' : 'Go Crew Exposed'), () => run({ type: 'vmove.ce', vehicle: v.id, ce: !v.tags['ce'] }, true), { icon: v.tags['ce'] ? 'BU' : 'CE', disabled: !!ceErr, hint: ceErr ?? 'Once per phase (SK4 7.7)' });
  };
  const gunTodo = swTodo.filter((s) => gunDef(env, s));
  const vehicleTodo = todo.filter((p) => vehicleDef(env, p));
  /** The hex a piece with a Covered Arc to choose stands in: a Gun's carrier's, a vehicle's own. */
  const facingHexOf = (id: PieceId): HexId | undefined => (isVehiclePiece(id) ? pending[id] : swHexes[id]);
  const isSw = (id: PieceId) => swTodo.some((s) => s.id === id);
  /** The hex each placed weapon sits in: its carrier's. */
  const swHexes: Record<PieceId, HexId> = Object.fromEntries(Object.entries(swAssign).flatMap(([s, h]) => (pending[h] ? [[s, pending[h]!]] : [])));
  /** Everything in the tray and where it sits: units in their hexes, weapons with their carriers. */
  const trayTodo = [...todo, ...swTodo];
  const trayPending: Record<PieceId, HexId> = { ...pending, ...swHexes };
  /**
   * The unit in a hex that takes a weapon dropped there: one of the weapon's group, carrying the
   * fewest weapons so far, a squad before a leader. (To hand a leader a weapon while a squad
   * shares its hex, drop the weapon before the squad is placed.)
   */
  const swHolderAt = (swId: PieceId, hex: HexId, assign: Record<PieceId, PieceId> = swAssign): PieceId | null => {
    const sw = state.pieces[swId];
    if (!sw) return null;
    const force = forceOf(sw);
    const load = (id: PieceId) => Object.values(assign).filter((h) => h === id).length;
    const here = todo.filter((p) => hexOfLoc(pending[p.id] ?? '') === hex && p.tags['force'] === force);
    here.sort((a, b) => load(a.id) - load(b.id) || Number(defOf(env, a).kind === 'leader') - Number(defOf(env, b).kind === 'leader'));
    return here[0]?.id ?? null;
  };
  const placeSw = (swId: PieceId, hex: HexId) => {
    if (!placing) return;
    const holder = swHolderAt(swId, hex);
    if (!holder) {
      setError('A weapon must be set up with a unit of its group: place one in that hex first');
      return;
    }
    const next = { ...swAssign, [swId]: holder };
    const err = swAssignmentIllegal(env, placing.owner, todo, next);
    setError(plain(err));
    if (!err) {
      setSwAssign(next);
      setPicked(null);
      // A Gun needs a Covered Arc: handles on its hex's six hexspines offer one.
      if (isGunPiece(swId)) setCaFor(swId);
    }
  };
  const unplaceSw = (swId: PieceId, pick = true) => {
    const { [swId]: _, ...rest } = swAssign;
    setSwAssign(rest);
    setPicked(pick ? swId : null);
    setError(null);
    if (isGunPiece(swId)) {
      const { [swId]: __, ...ca } = pendingCa;
      setPendingCa(ca);
      if (caFor === swId) setCaFor(null);
    }
  };
  /** Point a placed Gun or vehicle at hexspine `spine` of its hex (SK4 3.2.4), and put the handles away. */
  const faceGun = (gunId: PieceId, spine: number) => {
    setPendingCa({ ...pendingCa, [gunId]: spine });
    setCaFor(null);
    setError(null);
  };
  const toggleCe = (id: PieceId) => {
    const next = new Set(pendingCe);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPendingCe(next);
  };
  const toggleDugIn = (id: PieceId) => {
    const next = new Set(pendingDugIn);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPendingDugIn(next);
  };
  const toggleHip = (gunId: PieceId) => {
    const next = new Set(pendingHip);
    if (next.has(gunId)) next.delete(gunId);
    else next.add(gunId);
    setPendingHip(next);
  };
  /** Whether a placed Gun may set up hidden where it stands (SSR and terrain permitting). */
  const hipAllowed = (gunId: PieceId) => !!swHexes[gunId] && env.query('hip.allowed', { gun: gunId, hex: swHexes[gunId]! }, false);
  // The other player's setup as they lay it out (online): shown as it changes, translucent until confirmed.
  const theirPlacing = waitingOn && (decision?.kind === 'setup' || decision?.kind === 'offboardSetup') ? decision : null;
  const theirTodo = useMemo(() => (theirPlacing ? piecesToPlace(env, theirPlacing) : []), [theirPlacing, env]);
  const theirDraft = useMemo((): Record<PieceId, HexId> => {
    const d = session.theirDraft;
    if (!theirPlacing || !d || d.decisionId !== theirPlacing.id) return {};
    const ids = new Set(theirTodo.map((p) => p.id));
    return Object.fromEntries(Object.entries(d.placements).filter(([id, hex]) => ids.has(id) && (statics.map.hex(hex) || statics.map.offboardHex(hex))));
  }, [session.theirDraft, theirPlacing, theirTodo, statics]);
  // Their tray, as ours: units and weapons to place, grouped as the card groups them, each placed counter with its hex.
  const theirSwTodo = useMemo(() => theirTodo.flatMap((p) => swHeldBy(state, p.id)).filter((w) => !(defOf(env, w).kind === 'sw' && (defOf(env, w) as { fixed?: boolean }).fixed)), [theirTodo, state, env]);
  const theirTray = useMemo(() => [...theirTodo, ...theirSwTodo], [theirTodo, theirSwTodo]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const theirTrayGroups = useMemo((): TrayGroup[] | null => groupTray(theirTray), [theirTray, scenario]);
  const theirTrayPending = useMemo((): Record<PieceId, HexId> => {
    const d = session.theirDraft;
    if (!theirPlacing || !d || d.decisionId !== theirPlacing.id) return {};
    const ids = new Set(theirTray.map((p) => p.id));
    return Object.fromEntries(Object.entries(d.placements).filter(([id]) => ids.has(id)));
  }, [session.theirDraft, theirPlacing, theirTray]);
  // Our own setup goes out to the opponent as we place it, and is cleared when the decision is answered.
  useEffect(() => {
    if (!session.publishDraft || session.mySide === undefined) return;
    // Hidden Guns (HIP) and their crews, and units hidden by a special rule, stay out of what the opponent sees.
    // Hidden and concealed placements stay out of the draft the opponent watches: a counter's id names it.
    const hiddenCrews = new Set([...[...pendingHip].map((g) => swAssign[g]).filter(Boolean), ...pendingHidden, ...pendingConcealed]);
    const shownPending = Object.fromEntries(Object.entries(pending).filter(([id]) => !hiddenCrews.has(id)));
    // Placed weapons go too (for the opponent's view of our tray), unless hidden or carried by a hidden unit.
    const shownSw = Object.fromEntries(Object.entries(swHexes).filter(([sw]) => !pendingHip.has(sw) && !hiddenCrews.has(swAssign[sw]!)));
    session.publishDraft(placing ? { decisionId: placing.id, placements: { ...shownPending, ...shownSw } } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing?.id, pending, pendingHip, pendingHidden, pendingConcealed, swAssign]);
  /**
   * Who this screen shows the game to: online, our side; hotseat, whoever is deciding (so a player
   * sees their own hidden Guns while the other does not); a spectator sees only what is revealed.
   */
  const viewer: SideId | null = session.mySide !== undefined ? session.mySide : (decision?.owner ?? null);
  /** The state as it will be once the pending placements are confirmed (drawn on the board), without what the viewer may not see. */
  const shown: GameState = useMemo(() => {
    // The viewer's redacted view: hidden pieces gone, an enemy's concealed stacks as "?" stand-ins, secrets as their modules show them.
    const base = redactState(engine, state, viewer);
    const draft = placing ? pending : theirDraft;
    if (!placing && Object.keys(draft).length === 0) return base;
    const pieces = { ...base.pieces };
    for (const [id, hex] of Object.entries(draft)) {
      const p = pieces[id];
      if (!p) continue;
      // A placement may name an upper building level (full ASL: 'uK4:1').
      pieces[id] = {
        ...p,
        loc: statics.map.hex(hexOfLoc(hex)) ? locationAt(hex) : { kind: 'offboard', edge: p.loc.kind === 'offboard' ? p.loc.edge : undefined, hex },
      };
    }
    // A vehicle wears the facing and CE chosen for it while it is being set up: CE as soon as it is chosen, even while
    // the vehicle keeps its default facing (an offboard entry, say), or the board shows it BU while it will enter CE.
    if (placing)
      for (const v of vehicleTodo) {
        const p = pieces[v.id];
        if (!p) continue;
        const ca = pendingCa[v.id];
        if (ca === undefined && !pendingCe.has(v.id)) continue;
        pieces[v.id] = { ...p, tags: { ...p.tags, ...(ca !== undefined ? { vca: ca, ca } : {}), ...(pendingCe.has(v.id) ? { ce: true } : {}) } };
      }
    // A stack given an OB concealment counter (SK4 8.3) wears its "?" while it is being set up.
    if (placing)
      for (const id of pendingConcealed) {
        const p = pieces[id];
        if (p) pieces[id] = { ...p, tags: { ...p.tags, concealed: true } };
      }
    // Weapons: with the unit they were given to; still in the tray until then (not drawn). A Gun
    // wears the Covered Arc chosen for it, so its wedge shows while it is being set up.
    if (placing)
      for (const s of swTodo)
        pieces[s.id] = {
          ...s,
          loc: swAssign[s.id] ? { kind: 'held', by: swAssign[s.id]! } : { kind: 'offboard', edge: 'setup' },
          ...(pendingCa[s.id] !== undefined ? { tags: { ...s.tags, ca: pendingCa[s.id]! } } : {}),
        };
    return { ...base, pieces };
  }, [placing, pending, swAssign, swTodo, vehicleTodo, pendingCe, pendingConcealed, theirDraft, state, statics, pendingCa, env, viewer]);
  /** The visible state as a query environment, for everything that lists or inspects what is on the board. */
  const shownEnv: QueryEnv = useMemo(() => engine.env(shown), [engine, shown]);
  /** S70's Connection Location (SSR 2): a hidden hex, never drawn; its owner works it from the side panel. */
  const caves = cavesParams(env);
  const connection = caves?.connection ?? null;
  const place = (id: PieceId, hex: HexId) => {
    if (!placing) return;
    if (isSw(id)) {
      placeSw(id, hex);
      return;
    }
    const next = { ...pending, [id]: hex };
    const err = placementIllegal(env, placing.owner, todo, next, true);
    setError(plain(err));
    if (!err) {
      setPending(next);
      setPicked(null);
      // A vehicle faces into the map from an offboard hex (north otherwise) until the player turns it:
      // handles on its hex's six hexspines offer the Vehicle Covered Arc as soon as it is down.
      if (isVehiclePiece(id)) {
        setPendingCa({ ...pendingCa, [id]: defaultVca(env, hex) });
        setCaFor(id);
        // It is the vehicle the wheel and the facing handles work on (one at a time in a pile).
        setSelectedHex(hex);
        setSelected(new Set([id]));
      }
    }
  };
  const unplace = (id: PieceId, pick = true) => {
    if (isSw(id)) {
      unplaceSw(id, pick);
      return;
    }
    const { [id]: _, ...rest } = pending;
    setPending(rest);
    // Its weapons go back to the tray with it.
    setSwAssign(Object.fromEntries(Object.entries(swAssign).filter(([, h]) => h !== id)));
    setPicked(pick ? id : null);
    setError(null);
    if (isVehiclePiece(id)) {
      const { [id]: __, ...ca } = pendingCa;
      setPendingCa(ca);
      if (caFor === id) setCaFor(null);
      setSelected((s) => new Set([...s].filter((x) => x !== id)));
    }
  };
  /** Top placed counter in a hex (the one a drag or click picks up). */
  const placedAt = (hex: HexId) => {
    const here = todo.filter((p) => hexOfLoc(pending[p.id] ?? '') === hex);
    // The selected vehicle sits on top of its pile, as drawn.
    const sel = here.find((p) => selected.has(p.id) && isVehiclePiece(p.id));
    if (sel) return sel.id;
    // Squads above leaders, as drawn.
    here.sort((a, b) => Number(defOf(env, b).kind !== 'leader') - Number(defOf(env, a).kind !== 'leader'));
    return here.length ? here[here.length - 1]!.id : null;
  };
  const autoPlace = () => {
    if (!placing) return;
    const next = defaultPlacement(env, placing.owner, todo, pending);
    if (!next) {
      setError('Cannot fit the remaining units around the ones already placed');
      return;
    }
    setPending(next);
    // Weapons not yet given out go to their card's carriers.
    const assign = { ...Object.fromEntries(swTodo.map((s) => [s.id, (s.loc as { by: PieceId }).by])), ...swAssign };
    setSwAssign(assign);
    // Guns without a Covered Arc yet face the middle of the map (the player can turn them before confirming).
    const hexes = [...statics.map.hexes()];
    const mid = hexes[Math.floor(hexes.length / 2)]?.id;
    const ca = { ...pendingCa };
    for (const v of vehicleTodo) if (ca[v.id] === undefined && next[v.id]) ca[v.id] = defaultVca(env, next[v.id]!);
    for (const g of gunTodo) {
      const at = assign[g.id] ? next[assign[g.id]!] : undefined;
      if (ca[g.id] !== undefined || !at || !mid) continue;
      ca[g.id] = spineToward(env, at, mid) ?? 0;
    }
    setPendingCa(ca);
    setPicked(null);
  };
  // Weapons in the tray, not yet given to a unit, stand nowhere (not with the carrier the card gave them).
  const swWhere = useMemo(() => ({ ...Object.fromEntries(swTodo.map((w) => [w.id, '-'])), ...swAssign }), [swTodo, swAssign]);
  const setupError = placing ? plain(placementIllegal(env, placing.owner, todo, pending, false, swWhere) ?? swAssignmentIllegal(env, placing.owner, todo, swAssign) ?? reserveIllegal(env, placing.owner, todo, pending, swAssign)) : null;
  // A card's deployment hexes with minimums by each (LMA9 SSR 1): how far the placements so far go.
  const anchors = useMemo(() => (placing ? setupAnchorProgress(env, placing.owner, pending, swWhere) : []), [placing, env, pending, swWhere]);
  // A reserve rule (SSR tactical reserve) lets this setup leave units behind to enter later.
  const reserve = useMemo(() => (placing?.kind === 'offboardSetup' ? (todo.map((p) => reserveRuleFor(env, p)).find((r) => r) ?? null) : null), [placing, todo, env]);
  // Every entry edge the card names, and any a reserve rule has since sent units to ('N,E'), as
  // one sorted key: the hex list below is rebuilt only when that set changes, not on every action
  // (BoardView rebuilds its whole canvas when the list it was set up with is replaced).
  const entryEdges = useMemo(() => {
    const edges = new Set(scenario.forces.flatMap((f) => (f.setup.kind === 'enter' ? [f.setup.edge] : [])));
    for (const p of Object.values(state.pieces)) if (typeof p.tags['entryEdge'] === 'string') for (const e of p.tags['entryEdge'].split(',')) edges.add(e);
    return [...edges].sort().join(',');
  }, [scenario, state.pieces]);
  /**
   * The map's exit hexes, whoever may use them and from whatever turn: the offboard hexes beyond them are drawn and
   * clickable, so a stack leaves the map with an ordinary step.
   */
  const exitAreas = useMemo(() => {
    const out = new Set<HexId>();
    for (const side of scenario.sides) for (const h of exitHexesEver(scenario, statics.map, side.side)) out.add(h);
    return [...out].sort().join(',');
  }, [scenario, statics]);
  const offboardShown = useMemo(() => {
    const seen = new Set<string>();
    const exits = new Set(exitAreas.split(',').filter(Boolean));
    const beyondExits = exits.size ? statics.map.offboard('N,E,S,W').filter((o) => statics.map.offboardNeighbors(o.id).onboard.some((h) => exits.has(h))) : [];
    return [
      ...entryEdges
        .split(',')
        .filter(Boolean)
        .flatMap((e) => statics.map.offboard(e)),
      ...beyondExits,
    ].filter((h) => !seen.has(h.id) && !!seen.add(h.id));
  }, [entryEdges, exitAreas, statics]);
  const objectives = useMemo(() => objectiveAreas(scenario, statics.map), [scenario, statics]);
  // Control chits only on the hexes a victory condition turns on, read as it reads them; elsewhere they are clutter.
  const control = useMemo(() => (controlMatters(scenario) ? controlChits(env, scenario) : {}), [env, scenario]);

  const reset = () => {
    setSelected(new Set());
    setTarget(null);
    setDirectors([]);
    setDeclared(false);
    setGunShot(null);
    setPfShot(null);
    setMode('normal');
  };

  const run = (a: Omit<Action, 'side' | 'decisionId'>, keepSelection = false) => {
    if (resolving) return 'Wait for the dice: the last action is still being resolved';
    const err = session.act(a);
    setError(plain(err));
    if (!err && !keepSelection) reset();
    return err;
  };
  /** The latest `run`, for callbacks held by memoised overlays. */
  const runRef = useRef(run);
  runRef.current = run;
  /** The legal next rout step of a unit into `to` (normal, or Low Crawl as chosen for a first step), if any. */
  const routStepTo = (unit: PieceId, to: HexId, crawl = lowCrawl && !routing, woods = false) => {
    const opts = legal.filter((a) => a.type === 'rout.step' && a['unit'] === unit && !!a['lowCrawl'] === crawl && !!a['woods'] === woods);
    const loc = clickLoc(opts.map((a) => a['to'] as string), to, hexOfId(state, unit));
    return opts.find((a) => a['to'] === loc);
  };
  /**
   * The Location a click on `hex` stands for among step targets `tos` (Location ids) of units standing in `from`: the
   * hex itself when it is one; in full ASL, for units upstairs, the same floor of that hex. A level of `from` itself
   * (the stairs) is never a click on the map but a wheel entry (ASLRB B23.4). In the Starter Kit this is `hex`.
   */
  function clickLoc(tos: string[], hex: HexId, from?: HexId | null): string {
    if (tos.includes(hex) || hex === from) return hex;
    return tos.find((t) => hexOfLoc(t) === hex) ?? hex;
  }
  /**
   * Why a broken unit may not take its first rout step into each hex beside it, distinct reasons only. A rout
   * may never shorten the range to a Known enemy unit in LOS, broken or far away (ASLRB A10.51), which can box
   * a unit in with no hex to go to; without the reason the map just stays dark.
   */
  const routRefusals = (unit: PieceId, only?: HexId): string[] => {
    const p = state.pieces[unit];
    if (p?.loc.kind !== 'hex') return [];
    const near = statics.map.neighbors(p.loc.hex).filter((h) => !only || h === only);
    return [...new Set(near.map((to) => plain(session.check({ type: 'rout.step', unit, to }))).filter((m): m is string => !!m))];
  };
  /** Whether the routing unit may end its rout where it stands (a legal building or woods hex, SK1 3.6). */
  const canStopRout = !!routing && legal.some((a) => a.type === 'rout.stop' && a['unit'] === routing.unit);
  /**
   * Walk a routing unit one hex: the first step takes the ticked leaders along (SK1 3.6) and may be a Low
   * Crawl; each hex is chosen by the player, so a route through Open Ground is theirs to take.
   */
  const routStep = (unit: PieceId, to: HexId, leaders: PieceId[] = [], woods = false) => {
    const opt = routStepTo(unit, to, lowCrawl && !routing, woods);
    if (!opt) return `${pieceLabel(env, state.pieces[unit]!)} cannot rout into ${hexLabel(to)}`;
    const escorts = routing ? [] : routEscorts(env, unit).filter((l) => leaders.includes(l));
    const err = run({ ...opt, ...(escorts.length ? { leaders: escorts } : {}) }, true);
    // Low Crawl is chosen per unit: once one has crawled, the next broken unit routs normally unless
    // the player picks Low Crawl again (the wheel entry is a toggle, so a setting left on would flip off).
    if (!err && opt['lowCrawl']) setLowCrawl(false);
    return err;
  };
  useEffect(() => setLowCrawl(false), [phase]);
  // Ending a phase with rallies unrolled, units unmoved or reinforcements still offboard asks first.
  const [endAsk, setEndAsk] = useState<EndPhaseWarning | null>(null);
  useEffect(() => setEndAsk(null), [decision?.id]);
  const endPhase = () => {
    const w = endPhaseWarning(env, legal);
    if (w) {
      playSfx('ui.deny');
      setEndAsk(w);
    } else run({ type: 'endPhase' });
  };
  /** MF a moving unit still has for any step; the road bonus (shown apart) pays only for another road step. */
  const mfLeft = (u: PieceId) => (ms ? (ms.allowance[u] ?? 0) - (ms.spent[u] ?? 0) : 0);
  /**
   * A moving stack that can go nowhere because some of its units are out of MF while the others still have
   * some (SK1 3.3 lets the stack break up): who is spent and who could go on.
   */
  const stuck = useMemo(() => {
    if (!ms || ms.units.length < 2 || legal.some((a) => a.type === 'move.step')) return null;
    const left = Object.fromEntries(ms.units.map((u) => [u, mfLeft(u)]));
    const most = Math.max(...Object.values(left));
    const spent = ms.units.filter((u) => left[u]! < most);
    if (!spent.length) return null;
    return { spent, rest: ms.units.filter((u) => !spent.includes(u)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, legal]);
  const endLabel = phase === 'RPh' || phase === 'RtPh' ? 'Done' : 'End phase';
  /**
   * A moving stack that has spent all its MF, and can do nothing else that costs none, ends its move by
   * itself. It arms when an action is added (a step, a smoke try, or the enemy's Defensive First Fire
   * against it) and is disarmed by an undo, so undoing back to a spent stack leaves it where it stands.
   * Dropping a SW is free but does not hold the move open: the APh allows it too.
   */
  const autoEnd = useRef({ count: session.actionCount, armed: false });
  useEffect(() => {
    const a = autoEnd.current;
    if (session.actionCount !== a.count) a.armed = session.actionCount > a.count;
    a.count = session.actionCount;
    if (!a.armed || !owner) return;
    if (decision?.kind !== 'phase' || phase !== 'MPh' || !ms?.hex || ms.vehicle || ms.units.some((u) => mfLeft(u) > 0) || legal.some((x) => MOVE_GOES_ON.has(x.type)) || !legal.some((x) => x.type === 'move.end')) {
      // Still resolving or another side deciding: wait. Otherwise this stack can act on, so stay out of it.
      if (decision?.kind === 'phase') a.armed = false;
      return;
    }
    // A beat to see the counter land before it is marked as moved.
    const t = window.setTimeout(() => {
      a.armed = false;
      runRef.current({ type: 'move.end' });
    }, 350);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, owner, session.actionCount]);
  /**
   * At a Banzai Impulse's end the DEFENDER may fire at any Banzai hex (SK4 8.1.8.6): a shot at one whose window is still
   * to come first goes to that window (`banzai.window`), then fires once it is open.
   */
  const [afterWindow, setAfterWindow] = useState<{ hex: HexId; gun: boolean } | null>(null);
  const toBanzaiWindow = (hex: HexId, then: 'fire' | 'gun' | null) => {
    const err = run({ type: 'banzai.window', hex }, true);
    if (!err && then) setAfterWindow({ hex, gun: then === 'gun' });
  };
  useEffect(() => {
    if (!afterWindow || resolving) return;
    if (decision?.kind !== 'firstFire' || ms?.hex !== afterWindow.hex) {
      // The window never opened (nobody left who could fire there): nothing to fire.
      if (decision?.kind !== 'firstFire') setAfterWindow(null);
      return;
    }
    const { hex, gun } = afterWindow;
    setAfterWindow(null);
    if (gun) fireGunAt(hex);
    else fireAt(hex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decision?.id, resolving]);
  // An undo (here, or one the opponent allowed online) leaves nothing selected from the position it took back.
  const lastCount = useRef(session.actionCount);
  useEffect(() => {
    if (session.actionCount < lastCount.current) reset();
    lastCount.current = session.actionCount;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.actionCount]);
  /**
   * Decline a First Fire opportunity: on the wheel, the top bar, the side panel and the P key alike. With
   * nothing left to fire at, the same pass keeps a weapon's Rate of Fire (the `rofResidual` decision).
   */
  const canPass = !!owner && (decision?.kind === 'firstFire' || decision?.kind === 'rofResidual');
  const passFirstFire = () => run({ type: 'defPass' });
  passRef.current = canPass ? passFirstFire : null;
  const passLabel = decision?.kind === 'rofResidual' ? 'Keep ROF' : 'Pass';
  const passHint = decision?.kind === 'rofResidual' ? 'Keep the Rate of Fire and let the enemy move on (P)' : 'Hold fire and let them move on (P)';
  /**
   * A mid-phase decision waiting on this player (the enemy's move interrupted for Defensive First Fire, a
   * ROF choice, a Motion facing): a standing cue on the board until it is answered. Players missed the
   * three-second banner and did not know the game was waiting for them to fire or pass.
   */
  const yourCall = useMemo((): { title: string; text: string } | null => {
    if (!owner || !decision || resolving) return null;
    const at = decision.data?.['hex'] ? hexLabel(String(decision.data['hex'])) : '';
    // The Rally Phase is shared: after the attacker's rallies it passes to the defender, in the enemy's turn.
    if (decision.kind === 'phase' && phase === 'RPh' && owner !== state.attacker) {
      const broken = Object.values(state.pieces).some((p) => p.side === owner && p.loc.kind === 'hex' && p.tags['broken'] === true);
      const malf = Object.values(state.pieces).some((p) => p.side === owner && p.loc.kind !== 'eliminated' && p.tags['malf'] === true);
      const todo = [broken ? 'rally your broken units' : '', malf ? 'repair your weapons' : ''].filter(Boolean).join(' and ');
      return { title: 'Rally Phase · your rallies', text: todo ? `Their Rally Phase passes to you: ${todo}, then Done` : 'Their Rally Phase passes to you: nothing to rally, so just Done' };
    }
    switch (decision.kind) {
      case 'firstFire': {
        // A Banzai Impulse's end (SK4 8.1.8.6): one hex's window at a time, any of them first.
        const others = banzaiWindowsPending(env);
        if (banzaiState(env)?.dff)
          return { title: `Banzai Impulse over · ${at}`, text: others.length ? `Fire at the Banzai units here, or at ${others.map(hexLabel).join(', ')} first (right-click it); pass to move on` : 'Fire at the Banzai units here, or pass' };
        return decision.data?.['ending']
          ? { title: `Move over in ${at}`, text: `Their move ends there${ms && assaultMoving(ms) ? ' (Assault Movement: no FFNAM)' : ''}: your last chance to fire at them, or pass` }
          : { title: `Defensive First Fire · ${at}`, text: `Enemy units are moving${ms && assaultMoving(ms) ? ' by Assault Movement (no FFNAM)' : ''}: fire at them now, or pass to let them move on` };
      }
      case 'rofResidual':
        return { title: 'Keep ROF, or leave Residual FP?', text: `Keep the Rate of Fire, or give it up for the Residual FP in ${at}` };
      case 'motionFacing':
        return { title: 'In Motion: face which way?', text: 'Turn the hull and turret, then Done turning' };
      default:
        return null;
    }
  }, [owner, decision, resolving, phase, state.attacker, state.pieces, ms]);
  // Online, the tab title says when the game waits on this player, so a tab switched away from shows it.
  useEffect(() => {
    if (typeof session.mySide !== 'string') return;
    document.title = owner && !resolving ? (yourCall ? '● Your call — Open ASL' : '● Your move — Open ASL') : 'Open ASL';
    return () => {
      document.title = 'Open ASL';
    };
  }, [owner, resolving, yourCall, session.mySide]);
  /**
   * Weapons that kept ROF in Defensive First Fire and may give it up for the attack's Residual FP instead
   * (SK1 3.3.1). Firing them again or passing keeps the ROF; only a decline is an action.
   */
  const rofChoiceUi = useMemo((): RofChoiceItem[] => {
    if (!owner || !decision || decision.owner !== owner || (decision.kind !== 'firstFire' && decision.kind !== 'rofResidual')) return [];
    return rofChoices(env)
      .flatMap((c) =>
        c.pending.map((sw): RofChoiceItem => {
          const p = state.pieces[sw];
          const holder = p?.loc.kind === 'held' ? p.loc.by : sw;
          const canFire =
            decision.kind === 'firstFire' && !!p && defOf(env, p).kind === 'sw' && legal.some((a) => a.type === 'defFire' && (a['decl'] as FireDeclaration).sw.includes(sw));
          return { sw, label: p ? pieceLabel(env, p).replace(/^\S+ /, '') : sw, at: hexOfId(state, holder), target: c.hex, residual: rofDeclineResidual(env, sw)?.residual ?? 0, canFire };
        }),
      )
      .filter((c) => c.residual > 0);
  }, [owner, decision, env, state, legal]);
  /**
   * The vehicle whose hull and turret the owner may turn now, and the actions that do it: the vehicle
   * moving in its MPh (at the MP cost), or a defending vehicle that has just gone into Motion by a Motion
   * Status attempt and may change its facing freely (SK4 3.3.2.1). The on-map handles and the Q/E/A/D keys
   * serve both.
   */
  const turnable = useMemo((): { v: Piece; hex: HexId; moving: boolean; turn(vca: number): Omit<Action, 'side' | 'decisionId'>; turret(tca: number): Omit<Action, 'side' | 'decisionId'>; hullHint: string; turretHint: string } | null => {
    if (!owner || !decision || decision.owner !== owner) return null;
    if (decision.kind === 'phase' && phase === 'MPh' && ms?.vehicle && ms.hex) {
      const v = state.pieces[ms.units[0]!]!;
      return { v, hex: ms.hex, moving: true, turn: (vca) => ({ type: 'vmove.turn', vca }), turret: (tca) => ({ type: 'vmove.turret', tca }), hullHint: '1 MP, 2 and a Bog Check in woods or a building', turretHint: 'free, as far round as you like, once per MP spent' };
    }
    if (decision.kind === 'motionFacing') {
      const v = state.pieces[decision.data?.['vehicle'] as string];
      if (v?.loc.kind === 'hex') return { v, hex: v.loc.hex, moving: false, turn: (vca) => ({ type: 'defMotion.turn', vehicle: v.id, vca }), turret: (tca) => ({ type: 'defMotion.turret', vehicle: v.id, tca }), hullHint: 'free, in Motion; one Bog Check first in woods or a building', turretHint: 'free, in Motion' };
    }
    return null;
  }, [owner, decision, phase, ms, state.pieces]);
  const facingDone = turnable && !turnable.moving ? () => run({ type: 'defMotion.done', vehicle: turnable.v.id }) : null;
  /** Defending vehicles that may make a Motion Status attempt at this expenditure (SK4 3.3.2.1), for the side panel. */
  const motionAttempts = useMemo(() => {
    if (!owner || decision?.kind !== 'firstFire') return [];
    return legal
      .filter((a) => a.type === 'defMotion')
      .map((a) => {
        const v = state.pieces[a['vehicle'] as string]!;
        const mp = env.query('vehicle.motionMp', { vehicle: v.id }, 0);
        return { vehicle: v.id, label: pieceLabel(env, v).replace(/^\S+ /, ''), mp, hint: `dr ≤ ${mp}: the MP/MF the mover has spent in this vehicle's LOS this MPh` };
      });
  }, [owner, decision, legal, state.pieces, env]);
  vehicleKeysRef.current = turnable
    ? (key) => {
        const vca = Number(turnable.v.tags['vca'] ?? 0);
        const tca = Number(turnable.v.tags['ca'] ?? vca);
        const a =
          key === 'q' ? turnable.turn((vca + 5) % 6)
          : key === 'e' ? turnable.turn((vca + 1) % 6)
          : key === 'a' ? turnable.turret((tca + 5) % 6)
          : key === 'd' ? turnable.turret((tca + 1) % 6)
          : key === 's' && turnable.moving ? { type: 'vmove.delay', mp: 1 }
          : null;
        if (!a) return false;
        if (session.check(a) === null) run(a, true);
        return true;
      }
    : null;
  /** Lock in the setup: on the wheel and the top bar alike, enabled once every unit sits in a legal hex. */
  const setupLeft = todo.length - Object.keys(pending).length;
  const swLeft = swTodo.length - Object.keys(swAssign).length;
  const caLeft = gunTodo.filter((g) => swAssign[g.id] && pendingCa[g.id] === undefined).length;
  const gunsField = Object.fromEntries(gunTodo.filter((g) => swAssign[g.id] && pendingCa[g.id] !== undefined).map((g) => [g.id, { ca: pendingCa[g.id]!, ...(pendingHip.has(g.id) ? { hip: true } : {}) }]));
  // A vehicle may dig in only where it sets up on the map and a special rule lets its side do so.
  const digInRule = placing ? digInParams(env, placing.owner) : undefined;
  // Squads a special rule lets the side split into half-squads at setup (LMA7 SSR 3, `setup-deploy`).
  const deployRule = placing ? setupDeployParams(env, placing.owner) : undefined;
  const canDigIn = (id: PieceId) => !!digInRule && !digInRule.defs && placing?.kind === 'setup' && !!pending[id];
  const vehiclesField = Object.fromEntries(vehicleTodo.filter((v) => pending[v.id]).map((v) => [v.id, { vca: pendingCa[v.id] ?? defaultVca(env, pending[v.id]!), ...(pendingCe.has(v.id) ? { ce: true } : {}), ...(pendingDugIn.has(v.id) && canDigIn(v.id) ? { dugIn: true } : {}) }]));
  // Hidden units (SSR): only those still placed where hiding is allowed go into the setup.
  const hiddenRule = hiddenUnitsParams(env);
  // A card that sets whole forces up hidden (LMA4 SSR 2) leaves no choice: the engine hides them as the setup is placed.
  const hiddenByRule = hiddenRule?.forces?.length && placing?.owner === hiddenRule.side ? compulsoryHidden(env, todo.map((p) => p.id), pending) : [];
  const hideable = (id: PieceId) => !!hiddenRule && !hiddenRule.forces?.length && placing?.owner === hiddenRule.side && !!pending[id] && !hideIllegal(env, id, hexOfLoc(pending[id]!), swAssign);
  const hiddenField = [...pendingHidden].filter(hideable).sort();
  // Concealment (SK4 8.3): OB counters, one per stack in Concealment Terrain; the engine conceals unseen units itself.
  const concealmentOn = concealmentActive(env) && !!placing && placing.kind === 'setup';
  const obConceal = concealmentOn ? obConcealment(env, placing!.owner) : { total: 0, used: 0 };
  const concealable = (id: PieceId) => concealmentOn && !!pending[id] && !!statics.map.hex(pending[id]!) && env.query('hex.concealmentTerrain', { hex: pending[id]! }, false) && !isSw(id) && !vehicleTodo.some((v) => v.id === id);
  const concealedField = [...pendingConcealed].filter(concealable).sort();
  const concealedStacks = new Set(concealedField.map((id) => pending[id]!)).size;
  const confirmSetup = placing
    ? {
        label: 'Confirm setup',
        icon: '✔',
        blocked:
          setupError ??
          (reserve ? null : setupLeft > 0 ? `${setupLeft} unit(s) still to place` : swLeft > 0 ? `${swLeft} weapon(s) still to place` : caLeft > 0 ? `${caLeft} Gun(s) still need a Covered Arc: click a segment of the ring around each (face…)` : null),
        ...(reserve && setupLeft > 0 ? { hint: `${setupLeft} unit(s) stay in reserve and enter on Turn ${reserve.turn}` } : {}),
        onClick: () =>
          run({
            type: placing.kind === 'setup' ? 'setup.place' : 'setup.offboard',
            placements: pending,
            ...(Object.keys(swAssign).length ? { sw: swAssign } : {}),
            ...(Object.keys(gunsField).length ? { guns: gunsField } : {}),
            ...(Object.keys(vehiclesField).length ? { vehicles: vehiclesField } : {}),
            ...(hiddenField.length ? { hidden: hiddenField } : {}),
            ...(concealedField.length ? { concealed: concealedField } : {}),
          }),
      }
    : null;

  // ------------------------------------------------------------------ fortified buildings (SSR)
  /** The fortifying side's pre-designation step, when it is this player's to make. */
  const fortifying = owner && decision?.kind === FORTIFY_DECISION ? decision : null;
  const fortMax = fortifying ? Number(fortifying.data?.['count'] ?? 0) : 0;
  const fortifiable = useMemo(() => (fortifying ? fortifiableBuildings(env, fortifying.owner) : []), [fortifying, env]);
  const [fortPicks, setFortPicks] = useState<string[]>([]);
  useEffect(() => setFortPicks([]), [fortifying?.id]);
  /** Every hex of a building, by its id (building ids are the engine's; players see hexes). */
  const buildingHexes = (id: string): HexId[] => [...statics.map.hexes()].filter((h) => h.buildingId === id).map((h) => h.id);
  const buildingLabel = (id: string) => {
    const hs = buildingHexes(id);
    return hs.length > 1 ? `${hexLabel(hs[0]!)} (${hs.length} hexes)` : hexLabel(hs[0] ?? id);
  };
  const toggleFortify = (hex: HexId) => {
    if (!fortifying) return;
    const b = statics.map.hex(hex)?.buildingId;
    if (!b || !fortifiable.includes(b)) {
      setError(b ? 'That building is outside your setup area' : 'Click a building hex');
      return;
    }
    const next = fortPicks.includes(b) ? fortPicks.filter((x) => x !== b) : [...fortPicks, b];
    const err = fortifyIllegal(env, fortifying.owner, next);
    setError(plain(err));
    if (!err) setFortPicks(next);
  };
  const confirmFortify = fortifying
    ? {
        label: fortPicks.length ? `Fortify ${fortPicks.length} building${fortPicks.length === 1 ? '' : 's'}` : 'Fortify none',
        icon: '✔',
        blocked: plain(fortifyIllegal(env, fortifying.owner, fortPicks)),
        onClick: () => run({ type: 'fortify.designate', buildings: fortPicks }),
      }
    : null;
  // Fortified buildings this screen may show: online, the fortifying player's own as well as the
  // revealed ones; a hotseat screen (shared by both players) and a spectator see only revealed
  // ones, so once the choice is made neither hotseat player is shown it until it is revealed.
  const fortState = fortifiedState(env);
  /** The card names the buildings and the choice is public (S16 SSR 2): no secrecy wording, everyone sees the list. */
  const fortOpen = !!fortifiedParams(env)?.open;
  const fortViewer = session.mySide ?? null;
  // Hexes a rule has taken out of play (S36's secret game length, once revealed).
  const outOfPlay = useMemo((): HexId[] => {
    if (!revealedLength(env)?.area) return [];
    return [...(env.statics as Statics).map.hexes()].filter((h) => !inPlay(env, h.id)).map((h) => h.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [env.state.ext['ssr.length']]);
  const fortifiedShown = useMemo((): HexId[] => {
    if (!fortState) return [];
    const out: HexId[] = [];
    for (const h of statics.map.hexes()) if (h.buildingId && fortifiedKnownTo(env, h.id, fortViewer)) out.push(h.id);
    if (fortifying) for (const b of fortPicks) out.push(...buildingHexes(b));
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fortState, fortViewer, env, fortifying, fortPicks]);
  /** The fortifying player's own list, online only (a hotseat screen keeps the secret from both). */
  const secretFortList = fortState && fortState.buildings.length > 0 && (fortOpen || fortViewer === fortState.side) ? fortState : null;

  // ------------------------------------------------------------------ scatter setup and secret entry groups (SSR)
  const scatterUi = useScatterPlanner({ env, decision, owner, viewer: session.mySide ?? null, run, setError, plain });
  const entryUi = useEntryGroupsPicker({ env, decision, owner, viewer: session.mySide ?? null, run, setError, plain });
  const turnsUi = useEntryTurnsPicker({ env, decision, owner, run, plain });
  const lengthUi = useGameLengthPicker({ env, decision, owner, run });
  const stretchUi = useEntryStretchPicker({ env, decision, owner, run, plain });
  /** Their board marks, as one key so the highlight memo recomputes only when they change. */
  const ssrMarks = [...scatterUi.highlights, ...entryUi.highlights, ...stretchUi.highlights].map(([h, r]) => `${h}:${r}`).join(',');

  // ------------------------------------------------------------------ fire composer
  /** The declaration the selected fire group would make against `at`, every selected SW in it. */
  const chosenDecl = (at: HexId): FireDeclaration => {
    const units: PieceId[] = [];
    const sws: PieceId[] = [];
    for (const id of selected) {
      const p = state.pieces[id];
      if (!p) continue;
      // A vehicle among the weapons is its MA firing IFE with its MGs (SK4 7.8).
      if (defOf(env, p).kind === 'sw' || defOf(env, p).kind === 'vehicle') sws.push(id);
      else if (defOf(env, p).kind !== 'leader' && defOf(env, p).kind !== 'gun') units.push(id);
    }
    // A vehicle's CMG/RMG/IFE aimed outside the turret's arc turn it first, paying case 8 (SK4 3.2.4), as a Gun turns to fire.
    const tca = units.length === 0 ? turretTurnFor(env, { sw: sws, target: at }) : undefined;
    return { units, sw: sws, target: at, ...(directors.length ? { directors } : {}), ...(tca !== undefined ? { tca } : {}) };
  };
  /**
   * A half-squad or crew selected together with the weapon it holds fires the weapon, not its own FP (SK1 4.0: it
   * forfeits its own FP to fire a SW). Its own FP leaves the declaration, but only when the group as chosen is
   * illegal and becomes legal so (otherwise two adjacent half-squads with a HMG and a LMG could not form a Fire Group,
   * and a lone one would fire its own FP and leave its HMG out).
   */
  const holdersFiringSw = (decl: FireDeclaration): PieceId[] => {
    if (!owner || decl.sw.length === 0) return [];
    const holders = decl.units.filter((u) => {
      const k = defOf(env, state.pieces[u]!).kind;
      return (k === 'hs' || k === 'crew') && decl.sw.some((w) => { const l = state.pieces[w]?.loc; return l?.kind === 'held' && l.by === u; });
    });
    if (!holders.length) return [];
    const moving = ms ? { moving: firstFireTargets(env, ms) } : {};
    const illegal = (d: FireDeclaration) => plain(env.query('fire.illegal', { decl: d, mode: fireModeFor(d), side: owner, ...moving }, null));
    if (!illegal(decl)) return [];
    const units = decl.units.filter((u) => !holders.includes(u));
    const tca = units.length === 0 ? turretTurnFor(env, { sw: decl.sw, target: decl.target }) : undefined;
    const { tca: _tca, ...base } = decl;
    return illegal({ ...base, units, ...(tca !== undefined ? { tca } : {}) }) ? [] : holders;
  };
  /** The chosen group with its half-squads and crews firing the weapons they hold instead of their own FP (`holdersFiringSw`). */
  const withSwFirers = (decl: FireDeclaration): FireDeclaration => {
    const holders = holdersFiringSw(decl);
    if (!holders.length) return decl;
    const units = decl.units.filter((u) => !holders.includes(u));
    const tca = units.length === 0 ? turretTurnFor(env, { sw: decl.sw, target: decl.target }) : undefined;
    const { tca: _tca, ...base } = decl;
    return { ...base, units, ...(tca !== undefined ? { tca } : {}) };
  };
  /** The declaration the selected fire group makes against `at`: as chosen, its HS/crews firing their SW, less any SW left out (`swLeftOut`). */
  const buildDecl = (at: HexId): FireDeclaration => {
    const decl = withSwFirers(chosenDecl(at));
    const out = swLeftOut(decl);
    if (!out.length) return decl;
    // What is left may need a different turn, or none (the BMG left out of a CMG's turn needs it still; a CMG left out, no turn).
    const sw = decl.sw.filter((id) => !out.some((l) => l.id === id));
    const tca = decl.units.length === 0 ? turretTurnFor(env, { sw, target: at }) : undefined;
    const { tca: _tca, ...base } = decl;
    return { ...base, sw, ...(tca !== undefined ? { tca } : {}) };
  };
  /**
   * The selected SW that cannot fire at this target on their own (a FT out of range, a MMG or HMG
   * whose holder moved before the AFPh, …) and would make the group's shot illegal: they stay out of
   * it, so the rest of the group fires without unticking them (tester request 2026-11-06). Only when
   * leaving them out makes the shot legal; otherwise the group is shown as chosen, with its reason.
   */
  const swLeftOut = (decl: FireDeclaration): { id: PieceId; why: string }[] => {
    if (!owner || decl.sw.length === 0) return [];
    const moving = ms ? { moving: firstFireTargets(env, ms) } : {};
    const illegal = (d: FireDeclaration) => plain(env.query('fire.illegal', { decl: d, mode: fireModeFor(d), side: owner, ...moving }, null));
    if (!illegal(decl)) return [];
    const out = decl.sw.flatMap((id) => {
      const tca = turretTurnFor(env, { sw: [id], target: decl.target });
      const why = illegal({ units: [], sw: [id], target: decl.target, ...(tca !== undefined ? { tca } : {}) });
      return why ? [{ id, why }] : [];
    });
    const restSw = decl.sw.filter((id) => !out.some((l) => l.id === id));
    const restTca = decl.units.length === 0 ? turretTurnFor(env, { sw: restSw, target: decl.target }) : undefined;
    const { tca: _tca, ...base } = decl;
    const rest: FireDeclaration = { ...base, sw: restSw, ...(restTca !== undefined ? { tca: restTca } : {}) };
    if (out.length > 0) return rest.units.length + rest.sw.length > 0 && !illegal(rest) ? out : [];
    // A SW that may fire alone but joins no Fire Group (a FT, SK1 4.2): the group fires without it, and it may fire on its own.
    const why = illegal(decl)!;
    const loner = decl.sw.find((id) => {
      const without = { ...decl, sw: decl.sw.filter((x) => x !== id) };
      return without.units.length + without.sw.length > 0 && !illegal(without);
    });
    return loner ? [{ id: loner, why }] : [];
  };
  const fireModeFor = (decl: FireDeclaration): FireMode =>
    decision?.kind === 'firstFire'
      ? [...decl.units, ...decl.sw].some((id) => state.pieces[id]?.tags['fire'] === 'final')
        ? 'fpf'
        : [...decl.units, ...decl.sw].some((id) => state.pieces[id]?.tags['fire'] === 'first')
          ? 'subsequentFirst'
          : 'first'
      : FIRE_MODE[phase]!;
  /**
   * The marker each firer of a declared group wears until the shot resolves (as the counter would be
   * placed): in Defensive First Fire an unmarked unit takes First Fire, one already marked First Fire
   * (Subsequent First Fire) or Final Fire (FPF) ends Final Fire (SK1 3.3.1).
   */
  const declMarkerOf = (id: PieceId): string | null =>
    decision?.kind === 'firstFire'
      ? state.pieces[id]?.tags['fire'] ? 'Final' : 'First'
      : phase === 'PFPh' ? 'FirePrep' : phase === 'AFPh' ? 'FireAdv' : phase === 'DFPh' ? 'Final' : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fireDecl: FireDeclaration | null = useMemo(() => (isFireDecision && target && selected.size > 0 ? buildDecl(target) : null), [isFireDecision, target, selected, directors, state, env]);

  /** Shoot the declared fire group at `at`: refused (with the reason shown) when the rules do not allow it. */
  const fireAt = (at: HexId, vsVehicle?: PieceId) => {
    if (!owner || !decision) return;
    const decl: FireDeclaration = { ...buildDecl(at), ...(vsVehicle ? { vsVehicle } : {}) };
    if (decl.units.length + decl.sw.length === 0) {
      setError('No units in the fire group');
      return;
    }
    const illegal = plain(env.query('fire.illegal', { decl, mode: fireModeFor(decl), side: owner, ...(ms ? { moving: firstFireTargets(env, ms) } : {}) }, null));
    if (illegal) {
      setTarget(at);
      setError(illegal);
      return;
    }
    // Full ASL: fire at a stack in Bypass. The fire is declared; now each firing hex picks the point its LOS is traced to,
    // the hex centre or a corner of a hexside the targets went along (ASLRB A4.34). No LOS is told before (A6.11).
    if (decision.kind === 'firstFire') {
      const points = env.query('fire.targetPoints', { target: decl.target }, []);
      if (points.length) {
        const hexes = [...new Set([...decl.units, ...decl.sw].map((id) => hexOfId(state, id)).filter((h): h is HexId => !!h))].sort();
        // After the wheel the Fire came from has closed (it closes once its entry has run).
        setTimeout(() => askPoint({ decl, hexes, i: 0, chosen: {}, points }), 0);
        return;
      }
    }
    run(decision.kind === 'firstFire' ? { type: 'defFire', decl } : { type: 'fire', decl });
  };

  /** Declare fire with these units (and SW), optionally directed by a leader there: they are marked and wait for a target. */
  const declareFire = (hex: HexId, ids: PieceId[], leader: PieceId | '') => {
    setSelectedHex(hex);
    setSelected(new Set(ids));
    setDirectors(leader ? [leader] : []);
    setTarget(null);
    setDeclared(true);
    setError(null);
  };

  // ---------------------------------------------------------------- Gun fire (SK2 ordnance)
  const gunMode = (): FireMode =>
    decision?.kind === 'firstFire' && gunShot
      ? gunFirstFireMode(env, { weapon: gunShot.gun, target: ms?.hex ?? '', targetType: gunShot.targetType })
      : phase === 'MPh' && ms?.vehicle
        ? 'bounding'
        : FIRE_MODE[phase]!;
  /** The shot the lined-up Gun would take at `at` (turning first when the target is outside its arc). */
  const buildShot = (at: HexId): OrdnanceShot | null => {
    if (!gunShot) return null;
    const ca = caChangeFor(env, gunShot.gun, at);
    return {
      weapon: gunShot.gun,
      target: at,
      targetType: gunShot.targetType,
      ...(ca !== null ? { ca } : {}),
      ...(gunShot.intensive ? { intensive: true } : {}),
      ...(gunShot.ammo ? { ammo: gunShot.ammo } : {}),
      ...(gunShot.backblast !== undefined ? { backblast: gunShot.backblast } : {}),
      ...(gunShot.director ? { director: gunShot.director } : {}),
    };
  };
  /** Leaders beside a lined-up weapon who might modify its To Hit DR (ordnance SW, or a Gun a special rule names). */
  const gunLeaders = useMemo(() => {
    if (!gunShot || !owner) return [];
    const hex = gunHexOf(env, gunShot.gun);
    if (!hex) return [];
    return personnelAt(env, hex, owner)
      .filter((p) => defOf(env, p).kind === 'leader')
      .map((l) => ({ id: l.id, label: pieceLabel(env, l).replace(/^\S+ /, ''), why: plain(ordnanceDirectorIllegal(env, gunShot.gun, l.id, owner, gunShot.targetType)) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gunShot, owner, env]);
  /** The ammunition a lined-up Gun shot announces (its default when none is), for the panel. */
  const gunAmmoInfo = (gs: { gun: PieceId; targetType: TargetType; ammo?: AmmoKind }): { ammo: string | null; depletion?: number } => {
    const g = state.pieces[gs.gun];
    const d = g ? ordnanceOf(env, g) : null;
    if (!g || !d || gs.targetType === 'IFE') return { ammo: null };
    const kind = gs.ammo ?? defaultAmmo(env, g, d);
    const dep = ammoStatus(env, g, d, kind).depletion;
    return { ammo: AMMO_NAME[kind], ...(dep !== undefined ? { depletion: dep } : {}) };
  };
  /** Line up a Gun: it is marked as firing and waits for a target. */
  const declareGun = (gunId: PieceId, targetType: TargetType, intensive = false, ammo?: AmmoKind, backblast?: boolean) => {
    setSelectedHex(gunHexOf(env, gunId));
    setSelected(new Set([gunId]));
    setDirectors([]);
    setGunShot({ gun: gunId, targetType, intensive, ...(ammo ? { ammo } : {}), ...(backblast !== undefined ? { backblast } : {}) });
    setTarget(null);
    setDeclared(true);
    setError(null);
  };
  const fireGunAt = (at: HexId) => {
    if (!owner || !decision || !gunShot) return;
    const shot = buildShot(at);
    if (!shot) return;
    const bounding = gunMode() === 'bounding';
    const illegal = plain(env.query('ordnance.illegal', { shot, mode: gunMode(), side: owner, ...(ms && !bounding ? { moving: firstFireTargets(env, ms) } : {}) }, null));
    if (illegal) {
      setTarget(at);
      setError(illegal);
      return;
    }
    if (bounding) {
      // Bounding First Fire (SK4 3.3.2.2): the moving vehicle's shot; the move goes on afterwards.
      run({ type: 'vmove.bff', shot }, true);
      setGunShot(null);
      setDeclared(false);
      setTarget(null);
      return;
    }
    run(decision.kind === 'firstFire' ? { type: 'defFire.ordnance', shot } : { type: 'fire.ordnance', shot });
  };
  const gunPreview = useMemo(() => {
    if (!gunShot || !owner || !target) return null;
    const shot = buildShot(target);
    return shot ? thPreview(env, shot, gunMode(), owner, gunMode() === 'bounding' || !ms ? undefined : firstFireTargets(env, ms)) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gunShot, owner, target, env, state, ms, decision, phase]);
  /** Everyone standing in a hex (units and vehicles; held weapons excluded). */
  const unitsHereOf = (hex: HexId): Piece[] => Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex && !isWeaponDef(defOf(env, p)));
  /** A vehicle's MGs that could still fire: its fixed-mount MG pieces without a fire marker or malfunction. */
  const vehicleMgsReady = (v: Piece): Piece[] => swHeldBy(state, v.id).filter((w) => (defOf(env, w) as { kind: string; fixed?: boolean }).fixed && !w.tags['fire'] && !w.tags['malf'] && !w.tags['mgDisabled']);
  const mgLabel = (mgs: Piece[]) => mgs.map((w) => `${(defOf(env, w) as { type: string }).type} ${(defOf(env, w) as { fp: number }).fp}`).join(' + ');
  /** Guns of the acting side in a hex, manned and able to fire now (the wheel offers each its target types). */
  const gunsFireable = (hex: HexId): Piece[] =>
    owner
      ? [
          ...personnelInHex(env, hex, owner)
            .flatMap((u) => swHeldBy(state, u.id))
            .filter((w) => ordnanceOf(env, w) && !w.tags['malf']),
          // A vehicle's Main Armament fires like a Gun (SK3).
          ...Object.values(state.pieces).filter((p) => p.side === owner && p.loc.kind === 'hex' && p.loc.hex === hex && vehicleDef(env, p) && !p.tags['wreck'] && !p.tags['malf'] && !p.tags['maDisabled'] && ordnanceOf(env, p)),
        ]
      : [];

  const firePreview = useMemo(() => {
    if (!fireDecl || !owner) return null;
    const fmode = fireModeFor(fireDecl);
    const illegal = plain(env.query('fire.illegal', { decl: fireDecl, mode: fmode, side: owner, ...(ms ? { moving: firstFireTargets(env, ms) } : {}) }, null));
    if (fireDecl.units.length + fireDecl.sw.length === 0) return { illegal: 'Select firing units or SW', fp: 0, column: null, drm: 0, parts: [] as string[] };
    try {
      // The LOS (and so any hindrance along it) is only checked once the shot is declared, so the
      // preview shows the DRM without it.
      const attack = { ...buildAttack(env, fireDecl, fmode, owner, ms ? firstFireTargets(env, ms) : undefined, ms ? movingInfo(env, ms) : undefined), hindrance: 0 };
      const fp = attackFp(env, attack);
      // A secret DRM (an unrevealed fortified building) is never previewed: see `discloseDrm`.
      const drm = withoutSecrets(env.explain('fire.drm', { attack }, 0));
      return {
        illegal,
        fp,
        column: iftColumn(env, fp),
        drm: drm.value,
        parts: [...drm.trace.filter((t) => !t.suppressedBy && t.label).map((t) => t.label!), 'LOS and hindrances are checked when you fire'],
        leftOut: [
          ...holdersFiringSw(chosenDecl(fireDecl.target)).map((u) => `${pieceLabel(env, state.pieces[u])} fires its weapon, not its own FP (SK1 4.0)`),
          ...swLeftOut(withSwFirers(chosenDecl(fireDecl.target))).map((l) => `Left out: ${l.why}`),
        ],
      };
    } catch (e) {
      return { illegal: illegal ?? plain((e as Error).message), fp: 0, column: null, drm: 0, parts: [] };
    }
  }, [fireDecl, owner, decision, phase, env, state, ms]);

  // ------------------------------------------------------------------ highlights
  /**
   * The rout being shown: the unit under way, else the selected broken units that may start one. Its
   * legal ends (SK1 3.6, the nearest building or woods hexes) are lit on the board, so a step sideways
   * reads as a step towards them, and the hex readout says why a neighbouring hex is barred.
   */
  const routShown = useMemo(() => {
    if (phase !== 'RtPh' || !owner) return null;
    // Under way, the ends it can still reach: a step that brings an enemy into view may close the first ones
    // (ASLRB A10.51 re-figures the destination, so an old ROUT END must not stay lit).
    if (routing) return { unit: routing.unit, ends: activeRoutEnds(env) };
    const units = [...selected].filter((u) => legal.some((a) => a.type === 'rout.step' && a['unit'] === u));
    if (!units.length) return null;
    // Each unit with a building or woods in reach marks its ends; one without (it may go anywhere away from the
    // enemy, SK1 3.6) leaves the others' ends on the map. `ends` is null only when none of them has any.
    const ends = new Set<HexId>();
    for (const u of units) {
      const plan = planRout(env, u);
      if (plan.sheltered) for (const h of plan.destinations) ends.add(h);
    }
    return { unit: units[0]!, ends: ends.size ? ends : null };
  }, [phase, owner, routing, selected, legal, env]);
  const routHover = useMemo(() => {
    if (!routShown || !hoverHex) return null;
    const at = hexOfId(state, routShown.unit);
    const end = routShown.ends?.has(hoverHex) ? 'the rout may end here' : null;
    if (!at || hoverHex === at || !statics.map.neighbors(at).includes(hoverHex)) return end ? { text: end, barred: false } : null;
    const step = { type: 'rout.step', unit: routShown.unit, to: hoverHex, ...(lowCrawl && !routing ? { lowCrawl: true } : {}) };
    const err = session.check(step);
    if (!err || !session.check({ ...step, woods: true })) return end ? { text: end, barred: false } : null;
    const text = plain(err) ?? err;
    const ends = [...(routShown.ends ?? [])].map((h) => h.replace(/^[a-z]/, '')).sort();
    return { text: ends.length && /nearest legal/.test(text) ? `${text} (${ends.join(', ')})` : text, barred: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routShown, hoverHex, state, lowCrawl, routing, session, env]);
  /**
   * MPh: why the moving stack may not step into the neighbouring hex under the pointer (a stack
   * under Assault Movement may be offered one hex of six, and the player needs to see why).
   */
  const moveHover = useMemo(() => {
    if (phase !== 'MPh' || !ms?.hex || !hoverHex || decision?.kind !== 'phase' || !owner || decision.owner !== owner) return null;
    if (!statics.map.neighbors(ms.hex).includes(hoverHex)) return null;
    const err = session.check({ type: 'move.step', to: hoverHex });
    if (!err || !session.check({ type: 'move.step', to: hoverHex, woods: true })) return null;
    return plain(err) ?? err;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ms, hoverHex, decision, owner, session, env]);

  // Off-board artillery (SSR): each side's mission on its way and the salvo that landed this Player Turn, for the map.
  const obaShown = useMemo(
    () =>
      scenario.sides
        .map((s) => ({ side: s.side, missions: artilleryMissions(env, s.side), impact: artilleryImpact(env, s.side) }))
        .filter((x) => x.missions !== null),
    [env, scenario],
  );
  /** A corner of a hex in map pixels (Bypass). */
  function cornerAt(hex: HexId, k: number) {
    const h = statics.map.hex(hex)!;
    const c = hexPixel(h.cube);
    const o = cornerOffset(k);
    return { x: c.x + o.x, y: c.y + o.y };
  }
  /** "R3" for "uR3". */
  const short = (h: HexId) => h.replace(/^[a-z]+/, '');
  /** The hex across hexside `k` of `hex`. */
  const acrossSideOf = (hex: HexId, k: number) => acrossSide(statics.map, hex, k) ?? '?';

  // Bypass corners (full ASL; UI options A3 and B2): every corner the stack may bypass to is a numbered handle on the map,
  // with its MF and, under the pointer, the way it goes and what it costs. A tap picks it; the confirm bar commits.
  const bypassControls: HexControl[] = useMemo(() => {
    const out: HexControl[] = [];
    // Defensive First Fire at a stack in Bypass: the corners the firing hex may choose are numbered on the map too.
    if (pointPick) {
      const hex = hexOfLoc(pointPick.decl.target);
      pointPick.points.forEach((pt, j) => {
        const k = cornerBetween(statics.map, hex, pt[0], pt[1]);
        if (k === null) return;
        out.push({ id: `pt-${j}`, hex, corner: k, glyph: String(j + 1), tone: 'turret', hint: `Trace ${short(pointPick.hexes[pointPick.i]!)}'s LOS to the ${cornerLabel(statics.map, hex, k)} corner`, onClick: () => choosePoint(pt) });
      });
      return out;
    }
    if (!ms?.hex || !owner || decision?.kind !== 'phase' || decision.owner !== owner || phase !== 'MPh' || mode !== 'normal') return out;
    const best = new Map<string, { a: Omit<Action, 'side' | 'decisionId'>; to: HexId; via: HexId[]; cost: number; at: number; sides: number[] }>();
    for (const a of legal) {
      if (a.type !== 'move.step' || !a['bypass']) continue;
      const to = a['to'] as HexId;
      const via = a['bypass'] as HexId[];
      const p = bypassPlan(env, ms, to, via);
      if (typeof p === 'string') continue;
      const key = `${to}|${p.pos.at}`;
      const cur = best.get(key);
      if (!cur || p.cost < cur.cost || (p.cost === cur.cost && via.length < cur.via.length)) best.set(key, { a: { type: 'move.step', to, bypass: via }, to, via, cost: p.cost, at: p.pos.at, sides: p.pos.sides.slice(-via.length) });
    }
    const left = Math.min(...ms.units.map((u) => (ms.allowance[u] ?? 0) - (ms.spent[u] ?? 0)));
    const numbered = new Map<HexId, number>();
    for (const b of [...best.values()].sort((x, y) => (x.to < y.to ? -1 : x.to > y.to ? 1 : x.at - y.at))) {
      const n = (numbered.get(b.to) ?? 0) + 1;
      numbered.set(b.to, n);
      // The way: from the stack's spot (a hex centre, or its corner) round the corners passed.
      const corners = [b.at];
      for (const k of [...b.sides].reverse()) {
        const cur = corners[0]!;
        corners.unshift(k === (cur + 5) % 6 ? k : (k + 1) % 6);
      }
      const startPt = ms.bypass ? cornerAt(ms.bypass.hex, ms.bypass.at) : hexPixel(statics.map.hex(ms.hex)!.cube);
      const path = [startPt, ...corners.map((k) => cornerAt(b.to, k))];
      const further = ms.bypass?.hex === b.to;
      const along = b.via.map((nb) => `${short(b.to)}-${short(nb)}`).join(', ');
      const text = `${further ? 'On round' : 'Bypass'} ${short(b.to)} along ${along} to the ${cornerLabel(statics.map, b.to, b.at)} corner · ${b.cost} MF (${left - b.cost} left)`;
      const id = `byp-${b.to}-${b.at}`;
      out.push({
        id,
        hex: b.to,
        corner: b.at,
        glyph: String(n),
        tone: 'turret',
        tag: `${further ? '+' : ''}${b.cost} MF`,
        path,
        active: bypassPick?.id === id,
        hint: `${text}. No obstacle TEM there; FFMO where the enemy sees an Open Ground corner. The stack may not end its move in Bypass (ASLRB A4.32)`,
        onClick: () => setBypassPick({ id, action: b.a, text }),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, legal, env, owner, decision, phase, mode, bypassPick, pointPick]);
  // A picked corner is forgotten once anything moves; Escape forgets it too.
  useEffect(() => setBypassPick(null), [ms]);
  useEffect(() => {
    if (!bypassPick && !pointPick) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setBypassPick(null);
      setPointPick(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [bypassPick, pointPick]);

  /** Ask firing hex `i` of a Defensive First Fire at a stack in Bypass for the point its LOS is traced to (A4.34). */
  function askPoint(p: { decl: FireDeclaration; hexes: HexId[]; i: number; chosen: Record<HexId, [HexId, HexId]>; points: [HexId, HexId][] }) {
    setPointPick(p);
    const hex = hexOfLoc(p.decl.target);
    const from = p.hexes[p.i]!;
    setWheel({
      hex: p.decl.target,
      at: lastWheelAt.current,
      title: `${short(from)} traces to`,
      items: [
        action('Hex centre', () => choosePoint(null, p), { icon: '◎', hint: 'The centre dot: blocked unless the LOS crosses a hexside the stack bypassed to reach it (ASLRB A4.34)' }),
        ...p.points.map((pt, j) => {
          const k = cornerBetween(statics.map, hex, pt[0], pt[1]);
          return action(`${j + 1} · ${k === null ? '' : cornerLabel(statics.map, hex, k)}`, () => choosePoint(pt, p), {
            icon: String(j + 1),
            hint: `The corner where ${[hex, ...pt].map(short).join(', ')} meet: a corner of a hexside the stack went along (ASLRB A4.34). One LOS check, made when all firing hexes have chosen (A6.11)`,
          });
        }),
      ],
    });
  }
  /** The current firing hex chose `pt` (null: the centre): the next one is asked, or the fire goes. */
  function choosePoint(pt: [HexId, HexId] | null, cur = pointPick) {
    if (!cur) return;
    const from = cur.hexes[cur.i]!;
    const chosen = pt ? { ...cur.chosen, [from]: pt } : cur.chosen;
    setWheel(null);
    if (cur.i + 1 < cur.hexes.length) {
      setTimeout(() => askPoint({ ...cur, i: cur.i + 1, chosen }), 0);
      return;
    }
    setPointPick(null);
    run({ type: 'defFire', decl: { ...cur.decl, ...(Object.keys(chosen).length ? { at: chosen } : {}) } });
  }

  const overlay: BoardOverlay = useMemo(() => {
    const highlights = new Map<HexId, number>();
    // Scatter setup / entry groups (SSR): green = hexes to pick from, amber = chosen, blue = secret or beside a chosen one.
    const SSR_TONE = { pick: GREEN, chosen: AMBER, chosenSecret: BLUE, near: BLUE } as const;
    if (scatterUi.active || entryUi.active || stretchUi.active) {
      for (const [h, r] of [...scatterUi.highlights, ...entryUi.highlights, ...stretchUi.highlights]) highlights.set(h, SSR_TONE[r]);
      return { selectedHex, highlights, selectedPieces: new Set<PieceId>(), los: null };
    }
    for (const [h, r] of [...scatterUi.highlights, ...entryUi.highlights, ...stretchUi.highlights]) highlights.set(h, SSR_TONE[r]);
    if (fortifying) {
      // Green = buildings that may be fortified; amber = the ones chosen so far.
      for (const h of statics.map.hexes()) if (h.buildingId && fortifiable.includes(h.buildingId)) highlights.set(h.id, fortPicks.includes(h.buildingId) ? AMBER : GREEN);
      return { selectedHex, highlights, selectedPieces: new Set<PieceId>(), los: null };
    }
    if (placing) {
      // Deployment hexes with minimums by each (LMA9 SSR 1): a tag over each with its count so far.
      const anchorBadges: HexBadge[] = anchors.map((a) => ({
        hex: a.anchor,
        text: `${a.counts.every((c) => c.have >= c.need) ? '✓' : '⚑'} ${a.counts.map((c) => `${c.label} ${c.have}/${c.need}`).join(' · ')}`,
      }));
      const facingHex = caFor ? facingHexOf(caFor) : undefined;
      if (caFor && facingHex) {
        // A ring around the Gun's or vehicle's hex cut into six segments, one per hexspine: click one to
        // point its Covered Arc along that hexspine (the chosen one is brass; pointing at another previews its arc).
        const p = state.pieces[caFor]!;
        const chosen = pendingCa[caFor] ?? (isVehiclePiece(caFor) ? defaultVca(env, facingHex) : undefined);
        const what = isVehiclePiece(caFor) ? 'Vehicle Covered Arc' : 'Covered Arc';
        const controls: HexControl[] = [0, 1, 2, 3, 4, 5].map((spine) => ({
          id: `face-${spine}`,
          hex: facingHex,
          spine,
          glyph: '▲',
          tone: 'hull',
          active: chosen === spine,
          arc: defOf(env, p).nationality,
          hint: `${what} ${spineLabel(env, facingHex, spine)}`,
          onClick: () => faceGun(caFor, spine),
        }));
        return { controls, selectedHex: facingHex, highlights, selectedPieces: new Set([caFor]), los: null };
      }
      if (picked && isSw(picked)) {
        // Green = hexes holding a placed unit of the weapon's group.
        for (const h of new Set(Object.values(pending))) if (swHolderAt(picked, h)) highlights.set(h, GREEN);
        return { selectedHex, highlights, selectedPieces: selected, los: null, badges: anchorBadges };
      }
      const candidates = picked ? todo.filter((p) => p.id === picked) : todo.filter((p) => !pending[p.id]);
      // Green = where that counter may legally go now (area, per-hex limits, stacking).
      for (const p of candidates)
        for (const h of placementHexes(env, p))
          if (!placementIllegal(env, placing.owner, todo, { ...pending, [p.id]: h }, true)) highlights.set(h, GREEN);
      // Blue = the map hexes a group with a restricted entry ("on or west of J10") may come onto the board by,
      // so its offboard spot is chosen with the way in in view (an offboard hex can touch a hex it may not enter).
      if (placing.kind === 'offboardSetup')
        for (const p of candidates)
          if (p.tags['entryHexes'])
            for (const h of entryHexesOf(env, p)) if (!highlights.has(h)) highlights.set(h, BLUE);
      // The selection (a vehicle picked from a pile) is framed, and so is the counter picked up to move.
      return { selectedHex, highlights, selectedPieces: new Set([...selected, ...(picked ? [picked] : [])]), los: null, badges: anchorBadges };
    }
    // A vehicle that has just gone into Motion (SK3) is marked while it may turn. Hull and turret turn by
    // the hexspine ring (from the action wheel) or Q/E and A/D, as for a moving vehicle.
    const controls: HexControl[] = [];
    if (turnable && !turnable.moving) highlights.set(turnable.hex, BLUE);
    if (ring) {
      // One sector per hexspine, the current one brass.
      const nat = state.pieces[ring.piece] ? defOf(env, state.pieces[ring.piece]!).nationality : undefined;
      for (const spine of [0, 1, 2, 3, 4, 5]) {
        const a = ring.action(spine);
        const err = a ? plain(session.check(a)) : null;
        controls.push({
          id: `face-${spine}`,
          hex: ring.hex,
          spine,
          glyph: '▲',
          tone: 'hull',
          active: ring.current === spine,
          ...(nat ? { arc: nat } : {}),
          disabled: !!err,
          hint: err ?? `${ring.what} ${spineLabel(env, ring.hex, spine)}${a ? ` · ${ring.note}` : ' (as now)'}`,
          onClick: () => {
            if (a) runRef.current(a, true);
            setRing(null);
          },
        });
      }
    }
    // Violet = where the side to move may leave the map (an exit VC or SSR); the green steps drawn below win where they meet.
    if (phase === 'MPh' && owner && decision?.kind === 'phase') for (const h of exitHexes(env, owner) ?? []) highlights.set(h, VIOLET);
    if (ms?.hex) highlights.set(ms.hex, BLUE);
    // A Banzai Charge (SK4 8.1.8.6): the target in red, the charging units' hexes in blue (amber once moved this Impulse),
    // the hexes the unit to step next may enter in green. While it is being declared: the ticked units and the target.
    const bz = banzaiState(env);
    const hexOfUnit = (id: PieceId) => {
      const p = state.pieces[id];
      return p?.loc.kind === 'hex' ? p.loc.hex : null;
    };
    if (bz && phase === 'MPh' && owner === bz.side && decision?.kind === 'phase') {
      for (const u of bz.units) {
        const h = hexOfUnit(u);
        if (h) highlights.set(h, bz.moved.includes(u) ? AMBER : BLUE);
      }
      highlights.set(bz.target, RED);
      const stepper = banzaiUnit && bz.units.includes(banzaiUnit) && !bz.moved.includes(banzaiUnit) ? banzaiUnit : bz.units.find((u) => !bz.moved.includes(u) && banzaiSteps(env, u).length > 0);
      if (stepper) for (const h of banzaiSteps(env, stepper)) highlights.set(h, GREEN);
    } else if (banzaiDraft && phase === 'MPh' && decision?.kind === 'phase') {
      for (const u of banzaiDraft.units) {
        const h = hexOfUnit(u);
        if (h) highlights.set(h, BLUE);
      }
      if (banzaiDraft.target) highlights.set(banzaiDraft.target, RED);
    }
    // The moving stack's MF/MP left, on the map beside it for every player and watcher (not under an open facing ring).
    const badges: HexBadge[] = [];
    // Off-board artillery (SSR): the target of a mission on its way; where the last salvo landed, its drift and blast.
    const arrows: { from: HexId; to: HexId }[] = [];
    for (const o of obaShown) {
      const m = o.missions!;
      if (m.pending) {
        highlights.set(m.pending.target, AMBER);
        badges.push({ hex: m.pending.target, text: `✸ ${m.label}: lands at the start of the AFPh` });
      }
      if (o.impact) {
        for (const h of o.impact.hexes) highlights.set(h, RED);
        if (o.impact.landing && o.impact.landing !== o.impact.target) arrows.push({ from: o.impact.target, to: o.impact.landing });
        badges.push({ hex: o.impact.target, text: `✸ ${m.label} target${o.impact.distance ? ` · drifted ${o.impact.distance}` : ' · on target'}` });
      }
    }
    const movingAt = ms?.hex ?? ms?.off ?? null;
    if (ms && movingAt && ring?.hex !== movingAt) {
      const units = ms.units.filter((u) => state.pieces[u]);
      const left = (u: PieceId) => (ms.allowance[u] ?? 0) - (ms.spent[u] ?? 0);
      const first = units[0];
      if (first) {
        const alike = units.every((u) => left(u) === left(first) && ms.allowance[u] === ms.allowance[first]);
        const text = (ms.vehicle ? `MP ${left(first)}/${ms.allowance[first] ?? 0}` : alike ? `MF ${left(first)}/${ms.allowance[first] ?? 0}` : `MF ${units.map(left).join(' · ')}`) + (ms.bypass ? ' · BYPASS' : '') + (assaultMoving(ms) ? ' · ASSAULT MOVEMENT' : '');
        // Smoke grenades: once per unit per MPh (SK1 3.3), so the stack says who has thrown already.
        const smokers = units.filter((u) => env.query('unit.smoke', { unit: u }, 0) > 0);
        const tried = smokers.filter((u) => ms.smokeTriedBy?.includes(u)).length;
        const smoke = tried === 0 ? '' : tried === smokers.length ? ' · smoke tried' : ` · smoke tried ${tried}/${smokers.length}`;
        badges.push({ hex: movingAt, text: `${text}${!ms.vehicle && roadBonusEarned(ms) ? ' +1 road' : ''}${smoke}`, ...(ms.bypass ? { at: cornerAt(ms.bypass.hex, ms.bypass.at) } : {}) });
      }
    }
    if (routing) highlights.set(hexOfId(state, routing.unit) as HexId, BLUE);
    // Where the rout may end (teal, the next steps drawn below win where they meet), each tagged on the map.
    for (const h of routShown?.ends ?? []) {
      if (h === hexOfId(state, routShown!.unit)) continue;
      highlights.set(h, TEAL);
      badges.push({ hex: h, text: 'rout end' });
    }
    if (phase === 'RtPh' && selected.size === 0 && !routing) {
      for (const r of routs) if (r.must && !r.done) highlights.set(hexOfId(state, r.unit) as HexId, RED);
    }
    // Choosing a Smoke target: only the hexes the grenades can go into (amber) are lit, not the steps, so a
    // click meant as a move is not taken for a throw.
    const smokeAt = mode === 'smoke' && ms?.hex ? smokeThrower() : null;
    if (smokeAt && ms?.hex)
      for (const h of [ms.hex, ...statics.map.neighbors(ms.hex)]) if (!session.check({ type: 'move.smoke', throws: [...smokePlan, { unit: smokeAt, target: h }] })) highlights.set(h, AMBER);
    if (mode === 'smoke') for (const t of smokePlan) badges.push({ hex: t.target, text: `smoke: ${pieceLabel(env, state.pieces[t.unit]).replace(/^\S+ /, '')}` });
    for (const a of legal) {
      // Full ASL: the stairs of the stack's own hex are a wheel entry, not a green hex (ASLRB B23.4).
      // A Bypass is a corner handle, not a green hex; the obstacle a stack in Bypass may enter is green (full ASL).
      if ((a.type === 'move.step' || a.type === 'move.manhandle') && mode !== 'smoke' && !a['bypass'] && (hexOfLoc(a['to'] as string) !== ms?.hex || (ms?.bypass && a['to'] === ms.bypass.hex))) highlights.set(hexOfLoc(a['to'] as string), GREEN);
      // Rally Phase: every hex holding a broken unit that may attempt to rally right now.
      if (a.type === 'rally.selfRally' || a.type === 'rally.rally') {
        const h = hexOfId(state, a['unit'] as string);
        if (h) highlights.set(h, AMBER);
      }
      // Rout: the hexes the unit on its way (or the selected broken units) may step into next.
      if (a.type === 'rout.step' && (routing ? a['unit'] === routing.unit : selected.has(a['unit'] as string))) {
        if (!!a['lowCrawl'] === (lowCrawl && !routing) && hexOfLoc(a['to'] as string) !== hexOfId(state, a['unit'] as string)) highlights.set(hexOfLoc(a['to'] as string), AMBER);
      }
      if (a.type === 'advance') {
        const units = a['units'] as PieceId[];
        if (units.some((u) => selected.has(u)) && hexOfLoc(a['to'] as string) !== hexOfId(state, units[0]!)) highlights.set(hexOfLoc(a['to'] as string), GREEN);
      }
      // Close Combat order: every hex still to be fought.
      if (a.type === 'cc.chooseHex') highlights.set(a['hex'] as HexId, RED);
    }
    if (target) highlights.set(hexOfLoc(target), RED);
    const declaredMarkers = new Map<string, string>();
    if (declared) for (const id of selected) {
      const m = declMarkerOf(id);
      if (m) declaredMarkers.set(id, m);
    }
    const declaredFire = declaredMarkers.size ? { units: declaredMarkers } : undefined;
    // Movement / Advance Phase: units that have finished their move (or advanced) are drawn
    // dimmed, so the stacks still free to act stand out (there is no counter for this in SK1).
    const spent = new Set<PieceId>();
    const doneTag = phase === 'MPh' ? 'moved' : phase === 'APh' ? 'advanced' : null;
    if (doneTag)
      for (const p of Object.values(state.pieces))
        if (p.side === state.attacker && p.tags[doneTag] && !ms?.units.includes(p.id)) spent.add(p.id);
    // No LOS thread before the shot: the thread is only stretched once fire is declared (SK1 3.2),
    // and the tracer effect then shows where it ran.
    const los = null;
    const ghost = new Set(Object.keys(theirDraft));
    // A stack that came along the road into a Woods-Road or Orchard-Road hex is out on the road, for both players to see
    // (SK1/SK4 1.1.1).
    const onRoad = ms?.viaRoad && ms.hex && (isWoodsRoad(env, ms.hex) || isOrchardRoad(env, ms.hex)) ? new Set<PieceId>(ms.units) : null;
    const smokeTried = ms?.smokeTriedBy?.length ? new Set<PieceId>(ms.smokeTriedBy.filter((u) => ms.units.includes(u))) : null;
    // The weapons they carry wear it too, so the tag shows whichever counter tops the pile.
    const amUnits = ms && assaultMoving(ms) ? new Set<PieceId>([...ms.units, ...Object.values(state.pieces).filter((p) => p.loc.kind === 'held' && ms.units.includes(p.loc.by)).map((p) => p.id)]) : null;
    // Full ASL Bypass: the stack on its corner with its path, the costs of what it may do next,
    // the corners it may bypass to, and the points a defender's fire may be traced to.
    const inBypass = ms?.bypass ? new Set<PieceId>([...ms.units, ...Object.keys(ms.stoppedBypass ?? {})]) : null;
    const bypass = ms?.bypass && inBypass ? { hex: ms.bypass.hex, sides: ms.bypass.sides, at: ms.bypass.at, from: ms.from ?? null, units: inBypass } : null;
    if (ms?.bypass && decision?.kind === 'phase' && phase === 'MPh') {
      for (const a of legal) {
        if (a.type !== 'move.step' || a['bypass']) continue;
        const to = a['to'] as string;
        const c = env.query('move.stepCost', { ms, to }, 0);
        badges.push({ hex: hexOfLoc(to), text: to === ms.bypass.hex ? `enter · ${c} MF` : `${c} MF` });
      }
    }
    controls.push(...bypassControls);
    return { controls, badges, ...(arrows.length ? { arrows } : {}), selectedHex, highlights, selectedPieces: selected, los, ...(declaredFire ? { declaredFire } : {}), ...(spent.size ? { spent } : {}), ...(ghost.size ? { ghost } : {}), ...(onRoad ? { onRoad } : {}), ...(smokeTried?.size ? { smokeTried } : {}), ...(amUnits?.size ? { assaultMoving: amUnits } : {}), ...(bypass ? { bypass, inBypass: inBypass! } : {}) };
  }, [ms, legal, selected, lowCrawl, target, selectedHex, isFireDecision, state, env, placing, picked, pending, todo, phase, routs, routing, routShown, theirDraft, fortifying, fortifiable, fortPicks, ssrMarks, caFor, pendingCa, swHexes, ring, owner, decision, session, turnable, mode, anchors, obaShown, banzaiDraft, banzaiUnit, bypassControls, smokePlan, smokeNext]);

  // ------------------------------------------------------------------ board clicks
  const onHexClick = (hex: HexId, e: { shift: boolean; ctrl: boolean; at: MapPoint; screen?: { x: number; y: number } }) => {
    setError(null);
    peekDismiss();
    if (e.ctrl) {
      pingHex(hex, e.at);
      return;
    }
    if (!owner) return;
    // Scatter setup / entry groups (SSR): a click picks a rendezvous or entry hex.
    if (scatterUi.onHexClick(hex) || entryUi.onHexClick(hex) || stretchUi.onHexClick(hex)) return;
    // Fortified buildings (SSR): click a building in the setup area to fortify it, again to undo.
    if (fortifying) {
      toggleFortify(hex);
      return;
    }
    // A facing ring's sectors are clicked on the map; a click on a hex instead puts it away
    // (and, elsewhere than its hex, goes on to do what it would have).
    if (ring) {
      setRing(null);
      if (hex === ring.hex) return;
    }
    // Setup: place the picked counter, or pick a placed one back up.
    if (placing) {
      // Facing handles are clicked on the map; a click on a hex instead puts them away
      // (and, elsewhere than the faced hex, goes on to do what it would have).
      if (caFor) {
        setCaFor(null);
        if (hex === facingHexOf(caFor)) return;
      }
      if (picked) {
        if (trayPending[picked] === hex) setPicked(null);
        else place(picked, hex);
        return;
      }
      // Pick up a placed counter (it stays put until dropped elsewhere).
      const top = placedAt(hex);
      if (top) {
        setPicked(top);
        return;
      }
      setSelectedHex(hex);
      return;
    }
    // Movement: click a highlighted hex to step / place smoke / place DC.
    // A Banzai Charge being declared: the clicked enemy hex is its target.
    if (decision?.kind === 'phase' && phase === 'MPh' && banzaiDraft && owner) {
      if (unitsHereOf(hex).some((p) => p.side !== owner)) setBanzaiDraft({ ...banzaiDraft, target: hex });
      else setError('The target of a Banzai Charge is an enemy unit: click a hex holding one');
      return;
    }
    // A charge under way: a green hex moves the unit to step; a Banzai hex picks which unit steps next.
    const bzClick = banzaiState(env);
    if (decision?.kind === 'phase' && phase === 'MPh' && bzClick && owner === bzClick.side) {
      const stepper = banzaiUnit && bzClick.units.includes(banzaiUnit) && !bzClick.moved.includes(banzaiUnit) ? banzaiUnit : bzClick.units.find((u) => !bzClick.moved.includes(u) && banzaiSteps(env, u).length > 0);
      if (stepper && banzaiSteps(env, stepper).includes(hex)) {
        setBanzaiUnit(null);
        run({ type: 'banzai.step', unit: stepper, to: hex }, true);
        return;
      }
      const here = bzClick.units.filter((u) => state.pieces[u]?.loc.kind === 'hex' && (state.pieces[u]!.loc as { hex?: string }).hex === hex && !bzClick.moved.includes(u));
      if (here.length) {
        setBanzaiUnit(here[0]!);
        setSelectedHex(hex);
        return;
      }
    }
    if (decision?.kind === 'phase' && phase === 'MPh' && ms) {
      // A vehicle lined up for Bounding First Fire shoots at the hex clicked (SK4 3.3.2.2).
      if (gunShot && ms.vehicle) {
        if (hex === ms.hex && !unitsHereOf(hex).some((p) => p.side !== owner)) {
          setTarget(hex);
          return;
        }
        fireGunAt(hex);
        return;
      }
      if (mode === 'bffMg' && ms.vehicle) {
        const illegal = (sw: PieceId[]) => plain(env.query('fire.illegal', { decl: { units: [], sw, target: hex }, mode: 'bounding', side: owner }, null));
        // MGs picked together fire with those that bear on the target (a BMG outside the hull's arc
        // need not stop the CMG): each MG has its own Covered Arc (SK4 7.8).
        const bearing = bffMgs.filter((id) => !illegal([id]));
        const sw = illegal(bffMgs) && bearing.length && !illegal(bearing) ? bearing : bffMgs;
        const decl = { units: [], sw, target: hex };
        const err = illegal(sw);
        if (err) setError(err);
        else {
          run({ type: 'vmove.bffMg', decl }, true);
          setMode('normal');
          setBffMgs([]);
        }
        return;
      }
      if (mode === 'smoke') {
        const unit = smokeThrower();
        const plan = unit ? [...smokePlan, { unit, target: hex }] : smokePlan;
        if (unit && !session.check({ type: 'move.smoke', throws: plan })) {
          // The last unit that may throw: the declaration is complete, so it is thrown at once.
          if (smokeThrowers().length <= 1) throwSmoke(plan);
          else {
            setSmokePlan(plan);
            setSmokeNext(null);
          }
          return;
        }
        // Throws already declared wait for Throw or Cancel; with none, a hex the grenades cannot reach only cancels
        // Smoke and the click counts as usual (a step, say).
        if (smokePlan.length) return;
        setMode('normal');
      }
      if (mode === 'dc') {
        const dc = ms.units.flatMap((u) => swHeldBy(state, u)).find((s) => (defOf(env, s) as { type?: string }).type === 'DC');
        // An enemy AFV in the hex: the DC is placed against it (right-click the hex to place it in the hex instead; SK4 4.3).
        const afv = Object.values(state.pieces).find((p) => p.side !== owner && p.loc.kind === 'hex' && p.loc.hex === hex && vehicleDef(env, p) && !p.tags['wreck']);
        if (dc) run({ type: 'move.placeDc', dc: dc.id, target: hex, ...(afv ? { vehicle: afv.id } : {}) }, true);
        setMode('normal');
        return;
      }
      // S70 caves: a hex with a cave the stack may enter as well as the hill: the wheel asks which.
      if (e.screen && legal.some((a) => a.type === 'move.step' && a['to'] === caveLoc(hex)) && legal.some((a) => a.type === 'move.step' && a['to'] === hex)) {
        setPeek(null);
        setSelectedHex(hex);
        setWheel({ hex, at: e.screen });
        return;
      }
      // Full ASL: from an upper level a click steps along the same floor of that hex (ASLRB B23.25).
      const stepTo = clickLoc(legal.filter((a) => a.type === 'move.step').map((a) => a['to'] as string), hex, ms.hex);
      if (stepTo !== hex && legal.some((a) => a.type === 'move.step' && a['to'] === stepTo)) {
        run({ type: 'move.step', to: stepTo }, true);
        return;
      }
      if (legal.some((a) => a.type === 'move.step' && a['to'] === hex && !a['bypass'])) {
        // Along the road into a Woods-Road hex: the road or its woods (SK1 1.1.1).
        if (askRoadOrWoods(woodsRoadEntry(hex), hex, e.screen)) return;
        // Woods a tracked vehicle may enter at half its MP or with all of them: let the player choose.
        if (woodsEntry(hex) && e.screen) {
          setPeek(null);
          setSelectedHex(hex);
          setWheel({ hex, at: e.screen });
          return;
        }
        run({ type: 'move.step', to: hex }, true);
        return;
      }
      if (legal.some((a) => a.type === 'move.manhandle' && a['to'] === hex)) {
        run({ type: 'move.manhandle', to: hex }, true);
        return;
      }
      // A moving vehicle: clicking a neighbouring hex it cannot drive into turns the hull toward it (1 MP per hexspine).
      if (ms.vehicle && ms.hex && statics.map.neighbors(ms.hex).includes(hex)) {
        const spine = spineToward(env, ms.hex, hex, Number(state.pieces[ms.units[0]!]!.tags['vca'] ?? 0));
        if (spine !== null && session.check({ type: 'vmove.turn', vca: spine }) === null) {
          run({ type: 'vmove.turn', vca: spine }, true);
          return;
        }
      }
      // A hex the stack could step into but may not (stacking limit, MF, enemy units, Bog ...):
      // say why, then carry on to look at the hex as any other click would.
      if (stepTarget(ms, hex)) {
        const why = plain(session.check({ type: 'move.step', to: hex }));
        if (why) setError(why);
      }
    }
    if (decision?.kind === 'phase' && phase === 'RtPh') {
      // A rout under way: every click walks that unit one more hex.
      if (routing) {
        if (routStepTo(routing.unit, hex)) {
          if (askRoadOrWoods(woodsRoadRout(routing.unit, hex), hex, e.screen)) return;
          routStep(routing.unit, hex);
          return;
        }
        const why = routRefusals(routing.unit, hex)[0];
        if (why) {
          setError(`${pieceLabel(env, state.pieces[routing.unit]!)} cannot rout into ${hexLabel(hex)}: ${why}`);
          return;
        }
      } else if (selected.size >= 1) {
        // The selection is the broken units to rout, plus any leaders ticked to rout along (SK1 3.6).
        // Units rout one at a time (SK1 3.6): the first selected unit that can step into the hex sets
        // off (MMC before broken leaders, so a ticked Good Order leader escorts an MMC), and the rest
        // wait until it has finished.
        const units = [...selected].filter((id) => routs.some((r) => r.unit === id && !r.done));
        const isLeader = (u: PieceId) => defOf(env, state.pieces[u]!).kind === 'leader';
        const can = units.filter((u) => routStepTo(u, hex)).sort((a, b) => Number(isLeader(a)) - Number(isLeader(b)));
        if (can.length) {
          const leaders = [...selected].filter((id) => !units.includes(id));
          if (!lowCrawl && askRoadOrWoods(woodsRoadRout(can[0]!, hex, leaders), hex, e.screen)) return;
          routStep(can[0]!, hex, leaders);
          return;
        }
        // Low Crawl is on but the hex is only a normal rout step (a crawl must head for the nearest
        // shelter, SK1 3.6): say so rather than silently selecting the hex, and keep the setting.
        if (lowCrawl && !routing) {
          const walker = units.find((u) => routStepTo(u, hex, false));
          if (walker) {
            setError(plain(session.check({ type: 'rout.step', unit: walker, to: hex, lowCrawl: true })) ?? `${pieceLabel(env, state.pieces[walker]!)} cannot Low Crawl into ${hexLabel(hex)}`);
            return;
          }
        }
        // A hex beside the unit that is not a rout step: say why rather than leave the click unanswered.
        const refused = units.map((u) => ({ u, why: routRefusals(u, hex)[0] })).find((r) => r.why);
        if (refused) {
          setError(`${pieceLabel(env, state.pieces[refused.u]!)} cannot rout into ${hexLabel(hex)}: ${refused.why}`);
          return;
        }
      }
    }
    if (decision?.kind === 'phase' && phase === 'APh' && selected.size > 0) {
      const units = [...selected];
      const advTo = clickLoc(legal.filter((a) => a.type === 'advance').map((a) => a['to'] as string), hex, hexOfId(state, units[0]!));
      const why = plain(session.check({ type: 'advance', units, to: advTo }));
      if (why === null) {
        run({ type: 'advance', units, to: advTo });
        return;
      }
      // An adjacent hex the selection may not advance into (stacking limit, CX ...): say why.
      const from = state.pieces[units[0]!]?.loc;
      const near = from?.kind === 'hex' ? statics.map.neighbors(from.hex) : from?.kind === 'offboard' && from.hex ? statics.map.offboardNeighbors(from.hex).onboard : [];
      if (near.includes(hex)) setError(why);
    }
    // Fire: once declared, clicking a hex with enemy units shoots at it; before that it only previews.
    if (isFireDecision && selected.size > 0) {
      // A Vehicle Target Type shot aims at an enemy vehicle, which is not personnel.
      const enemy = personnelInHex(shownEnv, hex).some((p) => p.side !== owner) || (gunShot?.targetType === 'VTT' && !!enemyVehicleAt(shownEnv, hex, owner!));
      if (enemy) {
        // Full ASL: the target is a Location (ASLRB A2.8). Defensive First Fire aims at the moving stack's; a hex with
        // enemy units on more than one level opens the wheel to pick one (design C1). In the Starter Kit: the hex.
        const firstFireLoc = decision?.kind === 'firstFire' && ms?.hex === hex ? moveLoc(ms) : null;
        const locs = enemyLocsIn(hex);
        if (!firstFireLoc && locs.length > 1) {
          setPeek(null);
          setSelectedHex(hex);
          if (e.screen) setWheel({ hex, at: e.screen });
          else setError('Enemy units on more than one level: right-click the hex to choose which Location');
          return;
        }
        const at = firstFireLoc ?? locs[0] ?? hex;
        if (gunShot) {
          if (declared) fireGunAt(at);
          else setTarget(at);
          return;
        }
        if (declared) fireAt(at);
        else setTarget(at);
        return;
      }
      if (declared) {
        if (gunShot?.targetType === 'VTT' && hex !== gunHexOf(env, gunShot.gun)) setError('No enemy vehicle there to aim at');
        // The fire group is committed: clicking around only looks at hexes. An Area Target Type Gun
        // shot may go at any hex: the click previews it, the panel's Fire button shoots.
        if (gunShot?.targetType === 'ATT') setTarget(hex);
        setSelectedHex(hex);
        return;
      }
    }
    setSelectedHex(hex);
    // Clicking your own stack selects it (shift adds it to the selection), so the orders panel
    // is ready to go; individual units can still be unticked in the Stack panel.
    const mine = selectableAt(hex);
    setSelected((s) => {
      // A pile of vehicles yields one: the one already selected, else the top. A routing stack yields its first broken unit and leader.
      const add = stackPick(mine, s);
      if (!e.shift) return new Set(add);
      return new Set(soloVehicles([...s, ...add], new Set(add)));
    });
    if (!e.shift) setTarget(null);
  };

  /** Whether a hex is one a moving stack would step into from where it stands: a neighbour on board, or an entry hex while offboard. */
  function stepTarget(m: MoveState, hex: HexId): boolean {
    if (m.hex) return statics.map.neighbors(m.hex).includes(hex);
    if (m.off) return statics.map.offboardNeighbors(m.off).onboard.includes(hex);
    const p = state.pieces[m.units[0]!];
    const edge = (p?.loc.kind === 'offboard' && p.loc.edge) || (p?.tags['entryEdge'] as string | undefined);
    return !!edge && statics.map.edge(edge).includes(hex);
  }

  /** The acting side's units in a hex (on board or waiting offboard) that can be given orders now. */
  function selectableAt(hex: HexId): PieceId[] {
    if (!owner) return [];
    const here = Object.values(state.pieces).filter(
      (p) => p.side === owner && (p.loc.kind === 'hex' || p.loc.kind === 'offboard') && p.loc.hex === hex && !isWeaponDef(defOf(env, p)),
    );
    // Movement: only units that may start moving now (not broken, not yet moved, due to enter).
    if (decision?.kind === 'phase' && phase === 'MPh' && !ms) {
      const can = new Set(legal.filter((a) => a.type === 'move.start').flatMap((a) => a['units'] as PieceId[]));
      for (const a of legal) if (a.type === 'vmove.start') can.add(a['vehicle'] as PieceId);
      return here.filter((p) => can.has(p.id)).map((p) => p.id);
    }
    // Advance: only units that can advance somewhere (Good Order, unpinned, not yet advanced ...).
    if (decision?.kind === 'phase' && phase === 'APh') {
      const can = new Set(legal.filter((a) => a.type === 'advance').flatMap((a) => a['units'] as PieceId[]));
      return here.filter((p) => can.has(p.id)).map((p) => p.id);
    }
    // Rout: the broken units that have not routed yet (tick a leader to take him along); only the one on its way while it routs.
    if (decision?.kind === 'phase' && phase === 'RtPh') return here.filter((p) => (routing ? p.id === routing.unit : routs.some((r) => r.unit === p.id && !r.done))).map((p) => p.id);
    // Fire: a unit fires together with the working SW it carries (untick a weapon to hold it back).
    if (isFireDecision) {
      return fireSelectable(env, here, { firstFire: decision?.kind === 'firstFire', phase });
    }
    return here.map((p) => p.id);
  }

  /**
   * A Fully Tracked vehicle moving into woods chooses its cost (SK4 1.1.1, ASLRB B13.42): half its MP
   * with a +3 Bog Check DRM, or all its MP without it. Both entries, with what each costs, when the
   * vehicle has more than half its MP left (with fewer, "all" would cost the same and earn nothing).
   */
  const woodsEntry = (hex: HexId): WheelItem[] | null => {
    if (!ms?.vehicle || !ms.hex || !legal.some((a) => a.type === 'move.step' && a['to'] === hex)) return null;
    const v = state.pieces[ms.units[0]!];
    const vd = v && vehicleDef(env, v);
    if (!v || !vd || !vd.tracked || terrainOf(env, hex).id !== 'woods') return null;
    const left = (ms.allowance[v.id] ?? 0) - (ms.spent[v.id] ?? 0);
    const half = env.query('move.stepCost', { ms, to: hex }, 0);
    if (half !== vd.mp / 2 || left <= vd.mp / 2 || session.check({ type: 'move.step', to: hex, declared: left }) !== null) return null;
    const drm = (halfMp: boolean) => env.query('vehicle.bogDrm', { vehicle: v.id, hex, halfMp }, 0);
    const sign = (n: number) => (n >= 0 ? `+${n}` : String(n));
    return [
      action(`Enter at half MP (${half} MP)`, () => run({ type: 'move.step', to: hex }, true), { icon: '½', hint: `Bog Check ${sign(drm(true))} DRM; ${left - half} MP left after it (SK4 1.1.1)` }),
      action(`Enter with all MP (${left} MP)`, () => run({ type: 'move.step', to: hex, declared: left }, true), { icon: '■', hint: `Bog Check ${sign(drm(false))} DRM; uses every MP it has left (SK4 1.1.1)` }),
    ];
  };

  /**
   * Into a Woods-Road hex along the road, Infantry choose (SK1 1.1.1): the road, at its rate, out in the open
   * to any enemy who does not see the hex through its trees; or the woods, at their rate, under their TEM.
   * An Orchard-Road hex (SK4 1.1.1, ASLRB B14.6) offers the same choice in the MPh, both at one MF: the road, open to
   * FFMO from a firer whose LOS stays on it, or the orchard's non-Open Ground for the road bonus.
   */
  const roadOrWoods = (road: number, woods: number, go: (woods: boolean) => void, routing: boolean, orchard = false): WheelItem[] =>
    orchard
      ? [
          action(`Along the road (${road} MF)`, () => go(false), {
            icon: '═',
            hint: 'Keeps the road bonus. Against Defensive First Fire: -1 FFMO from a firer whose LOS stays on the road in this hex (SK4 1.1.1 Orchard-Road)',
          }),
          action(`Into the orchard (${woods} MF)`, () => go(true), {
            icon: '♣',
            hint: 'Not Open Ground: no FFMO; gives up the road bonus (SK4 1.1.1 Roads, ASLRB B3.43)',
          }),
        ]
      : [
          action(`Along the road (${road} MF)`, () => go(false), {
            icon: '═',
            hint: routing
              ? 'Open to Interdiction here, unless the enemy sees the hex through its trees (SK1 1.1.1, 3.6)'
              : 'Keeps the road bonus. Against Defensive First Fire: no Woods TEM and -1 FFMO, unless the firer sees the hex through its trees (SK1 1.1.1)',
          }),
          action(`Into the woods (${woods} MF)`, () => go(true), {
            icon: '♣',
            hint: routing ? 'Not open to Interdiction here (SK1 1.1.1)' : '+1 Woods TEM against Defensive First Fire; gives up the road bonus (SK1 1.1.1, 3.3)',
          }),
        ];
  /** The road-or-woods choice for the moving stack's step into `hex`, when both are open to it. */
  const woodsRoadEntry = (hex: HexId): WheelItem[] | null => {
    if (!ms || ms.vehicle) return null;
    const steps = legal.filter((a) => a.type === 'move.step' && a['to'] === hex);
    if (!steps.some((a) => !a['woods']) || !steps.some((a) => a['woods'])) return null;
    const cost = (woods: boolean) => env.query('move.stepCost', { ms, to: hex, ...(woods ? { woods } : {}) }, 0);
    return roadOrWoods(cost(false), cost(true), (woods) => run({ type: 'move.step', to: hex, ...(woods ? { woods: true } : {}) }, true), false, isOrchardRoad(env, hex));
  };
  /** The road-or-woods choice for a rout step of `unit` into `hex`, when both are open to it. */
  const woodsRoadRout = (unit: PieceId, hex: HexId, leaders: PieceId[] = []): WheelItem[] | null => {
    if (!routStepTo(unit, hex, false, false) || !routStepTo(unit, hex, false, true)) return null;
    const from = state.pieces[unit]?.loc;
    if (from?.kind !== 'hex') return null;
    const cost = (viaRoad: boolean) => env.query('move.cost', { unit, from: from.hex, to: hex, viaRoad }, 1);
    return roadOrWoods(cost(true), cost(false), (woods) => routStep(unit, hex, leaders, woods), true);
  };
  /** Opens the road-or-woods choice for a click on `hex` when there is one to make; true if it did. */
  const askRoadOrWoods = (items: WheelItem[] | null, hex: HexId, at: { x: number; y: number } | undefined) => {
    if (!items || !at) return false;
    setPeek(null);
    setSelectedHex(hex);
    setWheel({ hex, at, items });
    return true;
  };
  /**
   * What the action wheel offers for a hex: everything the sidebar can do with that stack in the
   * current phase, grouped into categories where a phase has many options.
   */
  /** The Locations of a hex holding enemy units of the acting side, highest first (full ASL: several in a building hex). */
  function enemyLocsIn(hex: HexId): string[] {
    const at = new Set(Object.values(shown.pieces).filter((p) => p.side !== owner && p.loc.kind === 'hex' && p.loc.hex === hex).map((p) => locOf(shown, p)!));
    return [...at].sort((a, b) => levelOfLoc(b) - levelOfLoc(a));
  }
  /** Defensive First Fire at the moving stack: its Location, when it is in `hex` (full ASL: maybe an upper level). */
  const firstFireAt = (hex: HexId): string | null => (decision?.kind === 'firstFire' && ms?.hex === hex ? moveLoc(ms) : null);
  const locName = (l: string) => (isCaveLoc(l) ? `the Cave in ${hexLabel(hexOfLoc(l))}` : l === connection ? 'the Connection Location' : levelOfLoc(l) ? `level ${levelOfLoc(l)}` : 'the ground');
  const enemyNames = (l: string) =>
    Object.values(shown.pieces)
      .filter((p) => p.side !== owner && p.loc.kind === 'hex' && locOf(shown, p) === l && !isWeaponDef(defOf(env, p)))
      .map((p) => pieceLabel(env, p).replace(/^\S+ /, ''))
      .join(', ');
  /**
   * 'Preview attack' at a hex: one entry, or (full ASL, design C1) one per Location holding enemy units, naming them,
   * so the target Location is a deliberate choice (ASLRB A2.8: an attack hits one Location).
   */
  function previewItems(hex: HexId, noFirers: boolean): WheelItem[] {
    const hint = noFirers ? 'Select your firers first' : 'Show FP, column and DRM in the panel first';
    const locs = enemyLocsIn(hex);
    if (locs.length < 2) {
      const at = firstFireAt(hex) ?? locs[0] ?? hex;
      return [action('Preview attack', () => setTarget(at), { icon: '◎', active: target === at, disabled: noFirers, hint })];
    }
    return locs.map((l) => action(`Preview attack · ${locName(l)}: ${enemyNames(l)}`, () => setTarget(l), { icon: '◎', active: target === l, disabled: noFirers, hint }));
  }
  /** Rout steps up or down the stairs of the unit's own hex (full ASL; interim rule until A10.51's rout by Location). */
  function routStairs(unit: PieceId): WheelItem[] {
    const at = hexOfId(state, unit);
    const from = state.pieces[unit] ? levelOfLoc(locOf(state, state.pieces[unit]!) ?? '') : 0;
    // S70 caves: into a cave or the Connection Location (a building for rout, SSR 2).
    const caveRouts = legal
      .filter((a) => a.type === 'rout.step' && a['unit'] === unit && !a['lowCrawl'] && (isCaveLoc(a['to'] as string) || a['to'] === connection))
      .map((a) => action(`Rout into ${locName(a['to'] as string)}`, () => run(a, true), { icon: '◒', hint: a['to'] === connection ? 'Its sole action this phase: the rout ends there (S70 SSR 2)' : 'Into the Cave Location (S70 SSR 2)' }));
    return caveRouts.concat(legal
      .filter((a) => a.type === 'rout.step' && a['unit'] === unit && !a['lowCrawl'] && !a['woods'] && hexOfLoc(a['to'] as string) === at)
      .map((a) => {
        const lv = levelOfLoc(a['to'] as string);
        return action(lv > from ? `Rout up to level ${lv} · 1 MF` : 'Rout down the stairs · 1 MF', () => run(a, true), {
          icon: lv > from ? '▲' : '▼',
          hint: lv > from ? 'End the rout upstairs in this building hex (ASLRB A10.51 EX)' : 'Down to the ground level first; the rout then leaves the hex',
        });
      }));
  }

  /**
   * What the Connection's owner may do from the side panel (the Connection is on no board to click): start a move of
   * the units there (the selected ones, else all), step a stack that is there into a cave, advance or rout into one.
   */
  function connectionActions(): { label: string; run: () => void; hint?: string }[] {
    if (!connection || !owner || decision?.kind !== 'phase') return [];
    const inside = Object.values(state.pieces).filter((p) => p.side === owner && p.loc.kind === 'hex' && p.loc.hex === connection && !isWeaponDef(defOf(env, p))).map((p) => p.id);
    const ticked = inside.filter((id) => selected.has(id));
    const units = ticked.length ? ticked : inside;
    const out: { label: string; run: () => void; hint?: string }[] = [];
    if (phase === 'MPh' && !ms && units.length && session.check({ type: 'move.start', units }) === null)
      out.push({ label: `Move ${units.length > 1 ? `these ${units.length}` : pieceLabel(env, state.pieces[units[0]!])} out…`, run: () => run({ type: 'move.start', units }, true) });
    if (ms?.hex === connection) {
      for (const a of legal.filter((x) => x.type === 'move.step')) out.push({ label: `Into ${locName(a['to'] as string)} · all MF`, run: () => run(a, true), hint: 'They emerge concealed (S70 SSR 2)' });
      if (legal.some((a) => a.type === 'move.end')) out.push({ label: 'End move', run: () => run({ type: 'move.end' }) });
      if (session.check({ type: 'move.cancel' }) === null) out.push({ label: 'Cancel move', run: () => run({ type: 'move.cancel' }), hint: 'No MF spent yet: they may still move later this phase' });
    }
    if (phase === 'APh' && units.length)
      for (const to of adjacentLocs(env, connection)) if (session.check({ type: 'advance', units, to }) === null) out.push({ label: `Advance into ${locName(to)}`, run: () => run({ type: 'advance', units, to }) });
    if (phase === 'RtPh')
      for (const a of legal.filter((x) => x.type === 'rout.step' && inside.includes(x['unit'] as string) && !x['lowCrawl'])) out.push({ label: `Rout ${pieceLabel(env, state.pieces[a['unit'] as string])} into ${locName(a['to'] as string)}`, run: () => run(a, true) });
    return out;
  }

  function wheelItems(hex: HexId): WheelItem[] {
    const items: WheelItem[] = [];
    if (!owner || !decision) return items;
    const own = selectableAt(hex);
    // The units an order applies to: the current selection if it is (partly) in this hex, else the whole stack.
    const chosen = [...selected].filter((id) => own.includes(id));
    const units = chosen.length ? chosen : own;
    const unitsHere = stackIn(shownEnv, hex).map((e) => e.piece);
    const enemyHere = unitsHere.some((p) => p.side !== owner);
    const selectAll = action('Select stack', () => { setSelectedHex(hex); setSelected(new Set(stackPick(own))); }, { icon: '☰', hint: 'Select every unit here' });

    for (const c of [scatterUi.confirm, entryUi.confirm, turnsUi.confirm, lengthUi.confirm, stretchUi.confirm]) {
      if (c) items.push(action(c.label, c.onClick, { icon: c.icon, disabled: !!c.blocked, hint: c.blocked ?? c.hint ?? c.label }));
    }
    if (fortifying && confirmFortify) {
      items.push(action(confirmFortify.label, confirmFortify.onClick, { icon: '✔', disabled: !!confirmFortify.blocked, hint: confirmFortify.blocked ?? (fortOpen ? 'Lock in the fortified building' : 'Lock in the fortified buildings (secret)') }));
    }
    if (placing && confirmSetup) {
      const allPlaced = Object.keys(pending).length === todo.length;
      items.push(
        action(confirmSetup.label, confirmSetup.onClick, {
          icon: '✔',
          disabled: !!confirmSetup.blocked,
          hint: confirmSetup.blocked ?? 'Lock in these positions',
        }),
      );
      items.push(action('Auto-place the rest', autoPlace, { icon: '⚡', disabled: allPlaced, hint: 'Put the remaining units in legal hexes' }));
      // Guns placed here: face them (a ring of hexspines on the map) and hide them where allowed.
      for (const g of gunTodo.filter((x) => swHexes[x.id] === hex)) {
        items.push(
          action(`Face ${pieceLabel(env, g).replace(/^\S+ /, '')} toward…`, () => setCaFor(g.id), {
            icon: '◠',
            hint: pendingCa[g.id] === undefined ? 'The Gun needs a Covered Arc: pick a hexspine on the map' : `Covered Arc: ${spineLabel(env, hex, pendingCa[g.id]!)} · pick a hexspine on the map`,
          }),
        );
        if (hipAllowed(g.id) && !hiddenByRule.some((id) => swAssign[g.id] === id))
          items.push(action(pendingHip.has(g.id) ? 'Set up in the open' : 'Hidden Initial Placement', () => toggleHip(g.id), { icon: '?', active: pendingHip.has(g.id), hint: 'The Gun and its crew stay off the board until they fire, move or are found (SK4 6.4)' }));
      }
      // Full ASL: units placed in a building hex with upper levels may set up on any of them (ASLRB A2.8, B23.42).
      const levels = statics.map.hex(hex) ? locationsOf(env, hex) : [];
      if (levels.length > 1) {
        const placedHere = todo.filter((p) => hexOfLoc(pending[p.id] ?? '') === hex && !isVehiclePiece(p.id));
        const chosenHere = placedHere.filter((p) => selected.has(p.id));
        const movers = chosenHere.length ? chosenHere : placedHere;
        for (const loc of levels) {
          const who = movers.filter((p) => pending[p.id] !== loc);
          if (!who.length) continue;
          const next = { ...pending, ...Object.fromEntries(who.map((p) => [p.id, loc])) };
          const err = plain(placementIllegal(env, placing.owner, todo, next, true));
          const lv = levelOfLoc(loc);
          const cave = isCaveLoc(loc);
          items.push(
            action(cave ? 'Set up in the Cave' : lv ? `Set up at level ${lv}` : levels.some(isCaveLoc) ? 'Set up on the hill' : 'Set up on the ground', () => { setPending(next); setError(null); }, {
              icon: cave ? '◒' : lv ? '▲' : '▼',
              disabled: !!err,
              hint: err ?? `${who.length === 1 ? pieceLabel(env, who[0]) : `These ${who.length} units`} ${cave ? 'in the Cave Location, under the Cave counter (+2 TEM; S70 SSR 2)' : lv ? `on level ${lv} of the building (Level counter, ASLRB B23.421)` : 'on the ground level'}; tick units in the stack card to move only some`,
            }),
          );
        }
      }
      // Units placed here that a special rule lets set up hidden (S23 SSR 1): the stack hides or shows as one.
      const hideHere = todo.filter((p) => hexOfLoc(pending[p.id] ?? '') === hex && hideable(p.id));
      if (hideHere.length) {
        const all = hideHere.every((p) => pendingHidden.has(p.id));
        items.push(
          action(all ? 'Set up in the open' : 'Set up hidden', () => {
            const next = new Set(pendingHidden);
            for (const p of hideHere) {
              if (all) next.delete(p.id);
              else next.add(p.id);
            }
            setPendingHidden(next);
          }, { icon: '?', active: all, hint: `${all ? 'Show' : 'Hide'} ${hideHere.length === 1 ? pieceLabel(env, hideHere[0]) : `these ${hideHere.length} units`} and their weapons: hidden units are placed on the map when they fire or move or an enemy unit enters or tries to enter the hex (${hiddenRule?.rule ?? 'SSR'})` }),
        );
      }
      // Concealment (SK4 8.3): the OB's counters go on stacks set up in Concealment Terrain, one per stack.
      if (concealmentOn) {
        const here = todo.filter((p) => pending[p.id] === hex && !isSw(p.id) && !vehicleTodo.some((v) => v.id === p.id));
        if (here.length) {
          const all = here.every((p) => pendingConcealed.has(p.id));
          const terrainOk = concealable(here[0]!.id);
          const left = obConceal.total - obConceal.used - concealedStacks;
          items.push(
            action(all ? 'Set up in the open' : `Conceal (${Math.max(0, left)} of ${obConceal.total} "?" left)`, () => {
              const next = new Set(pendingConcealed);
              for (const p of here) {
                if (all) next.delete(p.id);
                else next.add(p.id);
              }
              setPendingConcealed(next);
            }, {
              icon: '?',
              active: all,
              disabled: !all && (!terrainOk || left <= 0),
              hint: !terrainOk ? 'Not Concealment Terrain (SK4 8.3): an OB "?" counter may only be placed in jungle, palm trees, kunai, bamboo, huts or buildings' : left <= 0 && !all ? `No "?" counters left: the OB gives ${obConceal.total}` : 'One concealment counter covers this whole stack; units no enemy can see are concealed anyway once both sides have set up',
            }),
          );
        }
      }
      // Vehicles placed here, one at a time (they never act together): point the hull (the turret
      // follows) and choose Crew Exposed or Buttoned Up (SK4 3.2.4, 7.7). A pile of them (offboard)
      // gets the selected one's entries and a ring to switch to another.
      const vehiclesHere = vehicleTodo.filter((x) => pending[x.id] === hex).sort((a, b) => Object.keys(state.pieces).indexOf(a.id) - Object.keys(state.pieces).indexOf(b.id));
      const chooser = vehicleChooser(hex, vehiclesHere);
      if (chooser) items.push(chooser);
      const vehicle = chosenVehicle(vehiclesHere);
      for (const v of vehicle ? [vehicle] : []) {
        const pile = vehiclesHere.length > 1;
        items.push(action(pile ? `Face ${pieceLabel(env, v).replace(/^\S+ /, '')} toward…` : 'Face toward…', () => setCaFor(v.id), { icon: '◠', hint: `Vehicle Covered Arc: ${spineLabel(env, hex, pendingCa[v.id] ?? defaultVca(env, hex))} · pick a hexspine on the map` }));
        items.push(action(vehicleEntry(v, pile, pendingCe.has(v.id) ? 'Button Up' : 'Go Crew Exposed'), () => toggleCe(v.id), { icon: pendingCe.has(v.id) ? 'BU' : 'CE', active: pendingCe.has(v.id), hint: 'CE: the crew sees and fires better (no +1 BU To Hit, road rate ½ MP) but can be hit (+2 DRM); BU: safe from fire except as the AFV is (SK4 7.7)' }));
        if (canDigIn(v.id))
          items.push(action(vehicleEntry(v, pile, pendingDugIn.has(v.id) ? 'not dug in' : 'Dig in'), () => toggleDugIn(v.id), { icon: '⛏', active: pendingDugIn.has(v.id), hint: `A dug-in AFV never moves from its setup hex or changes its VCA; +${digInRule!.thDrm} To Hit against it and any hull hit is a miss (${digInRule!.rule ?? 'SSR'})` }));
      }
    }

    // Concealment (SK4 8.3): the owner may drop a stack's "?" at any time.
    {
      const mine = unitsHere.filter((p) => p.side === owner && p.tags['concealed'] === true && !isWeaponDef(defOf(env, p)));
      if (mine.length && !placing) {
        const err = plain(session.check({ type: 'conceal.drop', units: mine.map((p) => p.id) }));
        items.push(action('Drop concealment', () => run({ type: 'conceal.drop', units: mine.map((p) => p.id) }, true), { icon: '?', disabled: !!err, hint: err ?? 'Reveal these units to the enemy (SK4 8.3: a "?" may be dropped at any time)' }));
      }
    }

    if (decision.kind === 'phase' && phase === 'MPh') {
      // Vehicles here (SK3), one at a time: start one (or carry on in Motion), and CE/BU before it
      // moves. A pile of them (offboard) gets the selected one's entries and a ring to switch to another.
      if (!ms || ms.vehicle) {
        const vehiclesHere = vehiclesIn(hex);
        const chooser = ms ? null : vehicleChooser(hex, vehiclesHere);
        if (chooser) items.push(chooser);
        const vehicle = ms ? vehiclesHere.find((p) => ms.units[0] === p.id) : chosenVehicle(vehiclesHere);
        for (const v of vehicle ? [vehicle] : []) {
          const err = plain(session.check({ type: 'vmove.start', vehicle: v.id }));
          const moving = !!ms && ms.units[0] === v.id;
          const pile = !moving && vehiclesHere.length > 1;
          if (!moving || ms.vehicle?.stopped)
            items.push(
              action(moving ? 'Start again (1 MP)' : vehicleEntry(v, pile, v.tags['motion'] ? 'carry on (in Motion)' : 'start (1 MP)'), () => run({ type: 'vmove.start', vehicle: v.id }, true), {
                icon: '➜',
                disabled: !!err,
                hint: err ?? (v.tags['bog'] ? 'A Bog removal attempt: colored × white dr MP to start; colored 5 Mires, 6 Immobilizes (SK4 7.6)' : vehicleDef(env, v)!.redMp ? 'Red MP: a Mechanical Reliability DR each start (SK4 3.3.2)' : 'Then click a green hex ahead; turn the hull to go elsewhere'),
              }),
            );
          items.push(ceEntry(v, pile));
          // Two friendly vehicles left in one hex at the end of the MPh: the owner flips one to its wreck side (SK4 3.3.2).
          if (!plain(session.check({ type: 'vmove.wreck', vehicle: v.id })))
            items.push(action(vehicleEntry(v, vehiclesHere.length > 1, 'flip to wreck'), () => run({ type: 'vmove.wreck', vehicle: v.id }, true), { icon: '✕', hint: 'Only one vehicle per side may end the MPh in a hex: move one on, or wreck one (SK4 3.3.2)' }));
        }
      }
      if (ms?.vehicle) {
        const woods = woodsEntry(hex);
        if (woods) items.push(...woods);
        const v = state.pieces[ms.units[0]!]!;
        const vd = vehicleDef(env, v)!;
        const at = ms.hex ?? ms.off ?? hex;
        if (!ms.vehicle.stopped) {
          const err = plain(session.check({ type: 'vmove.stop' }));
          items.push(action(ms.vehicle.freeStop ? 'Stop (free)' : 'Stop (1 MP)', () => run({ type: 'vmove.stop' }, true), { icon: '■', disabled: !!err, hint: err ?? 'A stopped vehicle may Delay, and starts again for 1 MP' }));
        } else {
          // Delay (SK4 3.3.2): any number of MP in one go, with one Defensive First Fire window for the lot.
          const err = plain(session.check({ type: 'vmove.delay', mp: 1 }));
          const left = mfLeft(v.id);
          const delayHint = 'Spend MP standing still: one Defensive First Fire chance for the whole Delay; the MP count toward the Bounding First Fire DRM (SK4 3.3.2.2). S delays 1 MP; the side panel takes any number.';
          if (err) items.push(action('Delay…', () => {}, { icon: '⏱', disabled: true, hint: err }));
          else
            items.push(
              group(
                'Delay…',
                [
                  ...[1, 2, 3, 5, 10].filter((n) => n < left).map((n) => action(`${n} MP`, () => run({ type: 'vmove.delay', mp: n }, true), { hint: `Delay ${n} MP here (${left - n} left)` })),
                  action(`All ${left} MP`, () => run({ type: 'vmove.delay', mp: left }, true), { hint: 'Delay the rest of the MP here; then end the move' }),
                ],
                { icon: '⏱', hint: delayHint },
              ),
            );
        }
        // Hull and turret facing: a ring of hexspines around the vehicle to click (SK4 3.2.4).
        const vca = Number(v.tags['vca'] ?? 0);
        const tca = Number(v.tags['ca'] ?? vca);
        items.push(
          action(
            'Turn hull toward…',
            () => setRing({ hex: at, piece: v.id, what: 'Vehicle Covered Arc', current: vca, note: '1 MP per hexspine (2 and a Bog Check in woods or a building)', action: (spine) => (spine === vca ? null : { type: 'vmove.turn', vca: spine }) }),
            { icon: '◠', hint: `VCA: ${spineLabel(env, at, vca)} · pick a hexspine on the map` },
          ),
        );
        if (vd.turret !== 'NT')
          items.push(
            action(
              'Point turret toward…',
              () => setRing({ hex: at, piece: v.id, what: 'Turret Covered Arc', current: tca, note: 'free with each MP expenditure', action: (spine) => (spine === tca ? null : { type: 'vmove.turret', tca: spine }) }),
              { icon: '◎', hint: `TCA: ${spineLabel(env, at, tca)} · pick a hexspine on the map` },
            ),
          );
        // Bounding First Fire (SK4 3.3.2.2), one entry: the MA's shots (then click the target hex) and the MGs together.
        const bff: WheelItem[] = [];
        if (ms.hex && vd.ma && !v.tags['malf'] && !v.tags['maDisabled']) {
          const opts = shotOptions(env, v.id, 'bounding').filter((o) => o.type !== 'ATT' && o.type !== 'IFE');
          const bffErr = v.tags['bff'] && !v.tags['bffRof'] ? 'The MA fired Bounding First Fire and lost ROF' : v.tags['bff'] && (ms.vehicle.sinceBff ?? 0) === 0 ? 'Spend another MP before firing again' : null;
          const ma = `${vd.ma.caliber}${vd.ma.barrel ?? ''}`;
          if (bffErr) bff.push(action(ma, () => {}, { disabled: true, hint: bffErr }));
          else bff.push(...opts.map((o) => action(`${ma} · ${o.label}`, () => declareGun(v.id, o.type, false, o.ammo), { hint: o.hint, disabled: !o.available })));
        }
        if (ms.hex && vd.smoke?.length) {
          const disp = vd.smoke[0]!;
          const smErr = plain(session.check({ type: 'vmove.smoke', ...(disp.kind === 'sM' ? { target: ms.hex } : {}) }));
          items.push(action(`Smoke dispenser (${disp.kind}${disp.n})`, () => run({ type: 'vmove.smoke' }, true), { icon: '☁', disabled: !!smErr && disp.kind !== 'sM', hint: smErr ?? `DR ≤ ${disp.n} (+1 BU) places Dispersed Smoke (+2) in this hex for 1 MP; a miss costs nothing (SK4 7.5)` }));
        }
        if (ms.hex) {
          const mgs = vehicleMgsReady(v);
          const hint = 'Half FP in the MPh (a quarter while not stopped); then click the target hex. Firing the MGs forfeits the Advancing Fire Phase.';
          if (mode === 'bffMg') bff.push(action('Cancel MG fire', () => { setMode('normal'); setBffMgs([]); }, { active: true, hint }));
          else if (mgs.length) {
            const pick = (ws: Piece[]) => () => { setMode('bffMg'); setBffMgs(ws.map((w) => w.id)); };
            bff.push(action(`MGs (${mgLabel(mgs)})…`, pick(mgs), { hint: mgs.length > 1 ? `${hint} Any MG whose arc misses the target stays silent.` : hint }));
            // Or one MG on its own (the BMG through the hull's arc, the CMG through the turret's).
            if (mgs.length > 1) bff.push(...mgs.map((w) => action(`${mgLabel([w])} only…`, pick([w]), { hint })));
          }
        }
        if (bff.length)
          items.push(
            group('Bounding First Fire…', bff, {
              icon: '✦',
              hint: `Fire while moving: the MA at +${vd.turret === 'NT' ? 5 : 4} to +${vd.turret === 'NT' ? 7 : 6} by MP spent in the target's LOS (stop first or the lower die counts twice); the MGs at half FP, a quarter while not stopped`,
            }),
          );
        const exits = legal.filter((a) => a.type === 'move.exit' && ms.units.includes(a['unit'] as string));
        if (exits.length) items.push(group('Exit the map', exits.map((a) => action(pieceLabel(env, state.pieces[a['unit'] as string]), () => run(a))), { icon: '⇥', hint: 'Leave the map' }));
        const endErr = plain(session.check({ type: 'vmove.end' }));
        items.push(action(ms.vehicle.stopped ? 'End move (stopped)' : 'End move (in Motion)', () => run({ type: 'vmove.end' }), { icon: '■', disabled: !!endErr, hint: endErr ?? (ms.vehicle.stopped ? 'MP left are spent here as Delay' : 'A vehicle that does not stop stays in Motion') }));
      } else if (!ms) {
        // A Japanese leader may lead a Banzai Charge (SK4 8.1.8.6): the panel takes the target and the units.
        if (!banzaiState(env) && !banzaiDraft) {
          const leaders = own.filter((id) => {
            const p = state.pieces[id]!;
            return defOf(env, p).kind === 'leader' && isJapanese(env, p) && p.tags['broken'] !== true && p.tags['pinned'] !== true && p.tags['moved'] === undefined && p.tags['banzai'] === undefined;
          });
          for (const l of leaders) {
            const mates = own.filter((id) => {
              const p = state.pieces[id]!;
              return isJapanese(env, p) && !isVehiclePiece(id) && !isWeaponDef(defOf(env, p)) && p.tags['broken'] !== true && p.tags['pinned'] !== true && p.tags['moved'] === undefined && p.tags['banzai'] === undefined;
            });
            items.push(
              action(`Banzai Charge (${pieceLabel(env, state.pieces[l]).replace(/^\S+ /, '')})`, () => setBanzaiDraft({ leader: l, units: mates, target: null }), {
                icon: '!',
                hint: 'Lead a chain of adjacent Good Order units at an enemy within 8 hexes in LOS: 8 MF, +1 morale, no pins, one hex per Impulse, straight at the target (SK4 8.1.8.6)',
              }),
            );
          }
        }
        // S71 SSR 2: a Japanese unit with a DC may charge an AFV alone, then attack it in CC (CCV 5, -3).
        const dcCharges = legal.filter((a) => a.type === 'banzai.declare' && a['vehicle'] && own.includes(a['leader'] as string));
        if (dcCharges.length)
          items.push(
            group(
              'DC charge at…',
              dcCharges.map((a) => {
                const v = state.pieces[a['vehicle'] as string]!;
                return action(`${pieceLabel(env, state.pieces[a['leader'] as string]).replace(/^\S+ /, '')} → ${pieceLabel(env, v).replace(/^\S+ /, '')} in ${hexLabel(a['target'] as string)}`, () => run(a), {
                  hint: 'A lone Banzai Charge at the AFV; unbroken in its hex after Defensive First Fire, a CC attack on it with a CCV of 5 and -3 DRM, the DC used up (SSR 2)',
                });
              }),
              { icon: '!', hint: 'A lone Banzai Charge at an enemy AFV by a unit possessing a DC (SSR 2)' },
            ),
          );
        // Infantry movement only: vehicles start with their own entries above (SK4 3.3.2).
        const units = chosen.length ? chosen.filter((id) => !isVehiclePiece(id)) : own.filter((id) => !isVehiclePiece(id));
        if (units.length) {
          const start = (dt: boolean, as: boolean) => run({ type: 'move.start', units, doubleTime: dt, assault: as }, true);
          // A Gun in the stack is pushed, not carried: manhandling (SK4 6.5).
          const guns = units.flatMap((u) => swHeldBy(state, u)).filter((w) => gunDef(env, w));
          for (const g of guns) {
            const err = plain(session.check({ type: 'move.start', units, manhandle: g.id }));
            items.push(
              action(`Manhandle ${pieceLabel(env, g).replace(/^\S+ /, '')}${units.length > 1 ? ` (${units.length})` : ''}`, () => run({ type: 'move.start', units, manhandle: g.id }, true), {
                icon: '⚙',
                disabled: !!err,
                hint: err ?? `Push the Gun hex by hex: double MF, a DR against M${gunDef(env, g)!.m} each hex; Hazardous Movement`,
              }),
            );
          }
          // A stack an SSR halts (S64 SSR 3: `unit.actionIllegal`) gets its reason on the greyed entries.
          const haltedMove = plain(actionIllegal(env, units));
          const moveErr = (guns.length ? plain(session.check({ type: 'move.start', units })) : null) ?? haltedMove;
          items.push(action(`Move${units.length > 1 ? ` (${units.length})` : ''}`, () => start(false, false), { icon: '➜', disabled: !!moveErr, ...(moveErr ? { hint: moveErr } : {}) }));
          // No Double Time while CX, wounded, or in the MPh that took the CX counter off (SK1 3.3).
          const dtErr = plain(session.check({ type: 'move.start', units, doubleTime: true }));
          items.push(
            group('Move as…', [
              action('Double Time (CX)', () => start(true, false), { disabled: !!haltedMove || (!!dtErr && !moveErr), hint: haltedMove ?? (dtErr && !moveErr ? dtErr : 'Extra MF; the units become CX') }),
              action('Assault Move', () => start(false, true), { disabled: !!haltedMove, hint: haltedMove ?? 'One hex only; no Defensive First Fire bonus against it' }),
            ], { icon: '⚑' }),
          );
          if (own.length > 1) items.push(selectAll);
        } else {
          // Units here that may not start because of a Gun they hold and cannot push: Move greyed with the reason, next to
          // the Drop that frees them (SK4 4.0: dropped before expending MF, the Gun was never possessed this phase).
          const stuck = Object.values(state.pieces).filter((p) => p.side === owner && p.loc.kind === 'hex' && p.loc.hex === hex && !p.tags['moved'] && !isVehiclePiece(p.id) && swHeldBy(state, p.id).some((w) => gunDef(env, w)));
          const why = stuck.length ? plain(session.check({ type: 'move.start', units: stuck.map((p) => p.id) })) : null;
          if (why) items.push(action('Move', () => {}, { icon: '➜', disabled: true, hint: why }));
        }
      } else {
        const movers = ms.units.map((u) => state.pieces[u]!);
        // SK1 3.3: the stack may break up. Ticked units in the stack card pick who stops and who goes on.
        const ticked = ms.units.filter((u) => selected.has(u));
        const names = (ids: PieceId[]) => ids.map((u) => pieceLabel(env, state.pieces[u])).join(', ');
        // Another stack of ours here: it can start only once the moving one has finished (one stack moves at a time).
        const idle = own.filter((id) => !ms.units.includes(id) && !isVehiclePiece(id) && !state.pieces[id]!.tags['moved']);
        const elsewhere = ms.hex !== hex;
        const there = ms.hex ? ` in ${hexLabel(ms.hex)}` : '';
        if (elsewhere && idle.length) {
          items.push(action('Move', () => {}, { icon: '➜', disabled: true, hint: `${names(ms.units)}${there} ${ms.units.length > 1 ? 'are' : 'is'} still moving: end that move first` }));
          items.push(action(`End move${there}`, () => run({ type: 'move.end' }), { icon: '■', hint: `${names(ms.units)} stop; then this stack can move` }));
        } else if (ticked.length && ticked.length < ms.units.length) {
          const rest = ms.units.filter((u) => !ticked.includes(u));
          items.push(action(`Stop ${names(ticked)} here`, () => run({ type: 'move.stopUnits', units: ticked }), { icon: '■', hint: `The rest (${names(rest)}) keep moving` }));
          items.push(action(`Go on with ${names(ticked)} only`, () => run({ type: 'move.stopUnits', units: rest }), { icon: '➜', hint: `${names(rest)} stop here` }));
          items.push(action('End move (whole stack)', () => run({ type: 'move.end' }), { icon: '■' }));
        } else {
          items.push(action('End move', () => run({ type: 'move.end' }), { icon: '■' }));
          if (ms.units.length > 1)
            items.push(
              group('Stop here…', ms.units.map((u) => action(pieceLabel(env, state.pieces[u]), () => run({ type: 'move.stopUnits', units: [u] }))), {
                icon: '■',
                hint: 'Leave one unit in this hex; the rest keep moving',
              }),
            );
        }
        // Until the stack spends MF it has not moved: the choice can be taken back (offered only while it can).
        if (session.check({ type: 'move.cancel' }) === null)
          items.push(action(`Cancel move${elsewhere ? there : ''}`, () => run({ type: 'move.cancel' }), { icon: '↶', hint: `No MF spent yet: ${names(ms.units)} may still move later this phase` }));
        // Full ASL: up or down the stairs of this building hex for one MF (ASLRB B23.4), a new Location where the
        // defender may fire at the stack (A8.12).
        if (!elsewhere && ms.hex)
          for (const a of legal.filter((x) => x.type === 'move.step' && hexOfLoc(x['to'] as string) === ms.hex)) {
            const to = a['to'] as string;
            const up = levelOfLoc(to) > (ms.level ?? 0);
            const cost = env.query('move.stepCost', { ms, to }, 1);
            items.push(
              action(levelOfLoc(to) ? `Level ${levelOfLoc(to)} · ${cost} MF` : `Ground · ${cost} MF`, () => run({ type: 'move.step', to }, true), {
                icon: up ? '▲' : '▼',
                hint: `${up ? 'Up' : 'Down'} the stairs of ${hexLabel(ms.hex)} (ASLRB B23.4); the defender may fire at the stack there`,
              }),
            );
          }
        // S70 caves (SSR 2): into a cave from a ground-level hex beside it (the wheel on the cave hex offers the hill too);
        // from a cave into the Connection Location, the unit's sole action (all MF).
        for (const a of legal.filter((x) => x.type === 'move.step' && ((isCaveLoc(x['to'] as string) && hexOfLoc(x['to'] as string) === hex && hex !== ms.hex) || (!elsewhere && x['to'] === connection)))) {
          const to = a['to'] as string;
          const cost = env.query('move.stepCost', { ms, to }, 1);
          items.push(action(`Into ${locName(to)} · ${to === connection ? 'all MF' : `${cost} MF`}`, () => run({ type: 'move.step', to }, true), { icon: '◒', hint: to === connection ? 'Out of sight, secretly recorded; entering it is the unit’s sole action this phase (S70 SSR 2)' : 'Under the Cave counter: +2 TEM, no LOS to the hills (S70 SSR 2)' }));
          if (isCaveLoc(to) && legal.some((x) => x.type === 'move.step' && x['to'] === hex)) items.push(action(`Onto the hill · ${env.query('move.stepCost', { ms, to: hex }, 1)} MF`, () => run({ type: 'move.step', to: hex }, true), { icon: '▲', hint: `Into ${hexLabel(hex)} itself, above the Cave` }));
        }
        const exits = legal.filter((a) => a.type === 'move.exit' && ms.units.includes(a['unit'] as string) && hexOfId(state, a['unit'] as string) === hex);
        if (exits.length)
          items.push(group('Exit the map', exits.map((a) => action(pieceLabel(env, state.pieces[a['unit'] as string]), () => run(a))), { icon: '⇥', hint: 'Leave the map for exit VP' }));
        if (movers.some((p) => defOf(env, p).kind !== 'leader')) {
          // Shown, but greyed out once every mover with a Smoke exponent has tried (SK1 3.3: once per unit per MPh).
          // Not offered at all to a stack without a Smoke exponent (a half-squad, most leaders, some squads).
          const smokers = movers.filter((p) => env.query('unit.smoke', { unit: p.id }, 0));
          const thrower = smokeThrower();
          const smokeErr = smokers.every((p) => ms.smokeTriedBy?.includes(p.id)) ? `Smoke already attempted by ${smokers.length > 1 ? 'every unit' : 'this unit'} this MPh` : null;
          if (smokers.length)
            items.push(
              action('Smoke…', () => setMode(mode === 'smoke' ? 'normal' : 'smoke'), {
                icon: '☁',
                active: mode === 'smoke',
                disabled: !!smokeErr,
                hint:
                  smokeErr ??
                  `${thrower ? `${pieceLabel(env, state.pieces[thrower])} throws (Smoke exponent ${env.query('unit.smoke', { unit: thrower }, 0)})` : 'Grenades'}: 1 MF into this hex or 2 MF next to it, spent by the whole moving stack, which may then be fired on. Then click an amber hex${smokers.length > 1 ? '; other units may throw for the same MF (ASLRB A4.2)' : ''}`,
              }),
            );
        }
        if (movers.flatMap((u) => swHeldBy(state, u.id)).some((s) => (defOf(env, s) as { type?: string }).type === 'DC'))
          items.push(action('Place DC…', () => setMode(mode === 'dc' ? 'normal' : 'dc'), { icon: '✸', active: mode === 'dc', hint: 'Then click the target hex (an enemy AFV there is the target: a PAATC first, SK4 4.3)' }));
        if (ms.hex) {
          // Recovery (and so capture of an enemy weapon, SK1 5.5 / ASLRB A21.1) by a moving unit of the player's choosing
          // (ticking a mover here means leaving it behind, so there is no shortcut by selection).
          const rec = recoverMenu('move.recover', unpossessedSwAt(env, ms.hex), ms.units.map((u) => state.pieces[u]!).filter(Boolean));
          if (rec) items.push(rec);
        }
      }
    }

    if (decision.kind === 'phase' && phase === 'RPh') {
      const idsHere = new Set(unitsHere.map((p) => p.id));
      // A leader with several broken units here rallies them all at once; single attempts stay on each counter's menu.
      const allBy = legal.filter((a) => a.type === 'rally.rallyAll' && idsHere.has(a['leader'] as string));
      const leadersAll = new Set(allBy.map((a) => a['leader'] as string));
      const rallies = legal.filter(
        (a) =>
          (a.type === 'rally.selfRally' || (a.type === 'rally.rally' && !leadersAll.has(a['leader'] as string))) &&
          idsHere.has(a['unit'] as string),
      );
      const rallyItems = [
        ...allBy.map((a) => action(`${pieceLabel(env, state.pieces[a['leader'] as string])} rallies all`, () => run(a))),
        ...rallies.map((a) =>
          action(
            a.type === 'rally.selfRally'
              ? `Self-rally ${pieceLabel(env, state.pieces[a['unit'] as string])}`
              : `${pieceLabel(env, state.pieces[a['leader'] as string])} rallies ${pieceLabel(env, state.pieces[a['unit'] as string])}`,
            () => run(a),
          ),
        ),
      ];
      if (rallyItems.length === 1) items.push({ ...rallyItems[0]!, icon: '♥' } as WheelItem);
      else if (rallyItems.length > 1) items.push(group('Rally', rallyItems, { icon: '♥' }));
      // Recovery by the unit the player picks (Good Order, not yet acted this RPh; a MMC for a Gun), or the one unit ticked here.
      const holders = unitsHere.filter((p) => p.side === owner && !isWeaponDef(defOf(env, p)));
      const ticked = holders.filter((p) => selected.has(p.id));
      const rec = recoverMenu('rally.recover', unpossessedSwAt(env, hex), holders, ticked.length === 1 ? ticked[0] : undefined);
      if (rec) items.push(rec);
      // U.S. Marine Corps (SK4 8.4): a 7-6-8 deploys by NTC; two 3-4-8 with a leader recombine.
      for (const a of legal.filter((x) => x.type === 'rally.deploy' && idsHere.has(x['unit'] as string)))
        items.push(action(`Deploy ${pieceLabel(env, state.pieces[a['unit'] as string]).replace(/^\S+ /, '')} (NTC)`, () => run(a), { icon: '⇉', hint: 'Pass a Normal Task Check to split the squad into two 3-4-8 half-squads: its sole Rally Phase action (SK4 8.4)' }));
      for (const a of legal.filter((x) => x.type === 'rally.recombine' && (x['units'] as string[]).every((u) => idsHere.has(u))))
        items.push(action(`Recombine into a 7-6-8 (${pieceLabel(env, state.pieces[a['leader'] as string]).replace(/^\S+ /, '')})`, () => run(a), { icon: '⇇', hint: 'Two Good Order 3-4-8 half-squads with a Good Order leader become a 7-6-8: their sole Rally Phase action (SK4 8.4.1)' }));
      const deployHere = unitsHere.filter((p) => p.side === owner && p.defId === 'am.768');
      if (deployHere.length && !legal.some((x) => x.type === 'rally.deploy' && idsHere.has(x['unit'] as string))) {
        const why = plain(session.check({ type: 'rally.deploy', unit: deployHere[0]!.id }));
        if (why && !/Only in the/.test(why)) items.push(action('Deploy (NTC)', () => {}, { icon: '⇉', disabled: true, hint: why }));
      }
    }

    if (isFireDecision) {
      const inGroup = own.some((id) => selected.has(id));
      // Another Banzai hex whose Impulse-end window is still to come (SK4 8.1.8.6): fire there first.
      const banzaiNext = decision.kind === 'firstFire' && banzaiWindowsPending(env).includes(hex);
      if (banzaiNext && declared && !pfShot) {
        items.push(action('Fire at this hex', () => toBanzaiWindow(hex, gunShot ? 'gun' : 'fire'), { icon: '✦', hint: `Banzai Impulse over: the defender may fire at any Banzai hex (SK4 8.1.8.6). ${hexLabel(ms?.hex ?? '')} comes up again after this one` }));
      } else if (banzaiNext && !declared) {
        items.push(action('Fire at this Banzai hex now', () => toBanzaiWindow(hex, null), { icon: '✦', hint: `Turn to this Banzai hex first, then pick the firers; ${hexLabel(ms?.hex ?? '')} comes up again after it (SK4 8.1.8.6)` }));
        items.push(...previewItems(hex, selected.size === 0));
      } else if (enemyHere && declared && pfShot) {
        const pf = { ...pfShot, target: hex };
        const why = plain(pfIllegal(env, owner!, pf, decision.kind === 'firstFire' ? 'first' : FIRE_MODE[phase]!, decision.kind === 'firstFire' ? ms?.units : undefined));
        const { drm, notes } = pfCheckDrm(env, pfShot.unit, pfShot.targetType === 'VTT');
        items.push(
          action('Fire Panzerfaust at this hex', () => { run(decision.kind === 'firstFire' ? { type: 'defFire.pf', pf } : { type: 'fire.pf', pf }); setPfShot(null); setDeclared(false); }, {
            icon: '✦',
            disabled: !!why,
            hint: why ?? `PF check dr ≤ 3${drm ? ` (${notes.join(', ')})` : ''}: then To Hit ${[10, 8, 6, 4].slice(0, pfMaxRange(env) + 1).map((th, r) => `${th} at ${r}`).join(', ')}; HEAT To Kill 31, or 16 FP on one unit in a building; an original 6 pins`,
          }),
        );
        items.push(action('Cancel Panzerfaust', () => { setPfShot(null); setDeclared(false); setSelected(new Set()); }, { icon: '✕' }));
      } else if ((enemyHere || gunShot?.targetType === 'ATT') && declared && gunShot) {
        const turn = caChangeFor(env, gunShot.gun, hex);
        items.push(action(turn !== null ? 'Turn the Gun and fire at this hex' : 'Fire at this hex', () => fireGunAt(hex), { icon: '✦', hint: turn !== null ? 'The target is outside the Covered Arc: the Gun turns first (To Hit DRM)' : 'Roll To Hit against this hex' }));
        items.push(action('Preview shot', () => setTarget(hex), { icon: '◎', active: target === hex, hint: 'Show the To Hit number and DRM in the panel first' }));
      } else if (enemyHere && declared) {
        // Full ASL: a hex with enemy units on more than one level is fired at one Location at a time (ASLRB A2.8, A7.3).
        const enemyLocs = enemyLocsIn(hex);
        if (enemyLocs.length < 2) items.push(action('Fire at this hex', () => fireAt(firstFireAt(hex) ?? enemyLocs[0] ?? hex), { icon: '✦', hint: 'Resolve the declared fire against this hex' }));
        else for (const l of enemyLocs) items.push(action(`Fire at ${locName(l)}: ${enemyNames(l)}`, () => fireAt(l), { icon: '✦', hint: `Resolve the declared fire against ${hexLabel(l)} only` }));
        const loneFt = fireDecl && fireDecl.units.length === 0 && fireDecl.sw.length === 1 && (defOf(env, state.pieces[fireDecl.sw[0]!]!) as { type?: string }).type === 'FT';
        if (loneFt)
          for (const v of unitsHere.filter((p) => p.side !== owner && vehicleDef(env, p) && !p.tags['wreck']))
            items.push(action(`Flamethrower at ${pieceLabel(env, v).replace(/^\S+ /, '')}`, () => fireAt(hex, v.id), { icon: '🔥', hint: 'Predesignate the AFV: a To Kill roll on the HE & Flame table (TK 8, ½ at 2 hexes, +1 CE, +2 Open-Topped), armor ignored (SK4 4.2)' }));
        items.push(...previewItems(hex, false));
      } else if (enemyHere) {
        items.push(...previewItems(hex, selected.size === 0));
      }
      // German Infantry here that may try a Panzerfaust (SK4 4.4.2): pick what it aims at, then the target hex.
      if (!declared && owner && pfCap(env, owner) !== null) {
        const pfMode = decision.kind === 'firstFire' ? 'first' : FIRE_MODE[phase];
        for (const u of unitsHere.filter((p) => p.side === owner && !vehicleDef(env, p) && ['squad', 'hs', 'crew', 'leader'].includes(defOf(env, p).kind) && defOf(env, p).nationality === 'ge')) {
          const why = pfMode ? plain(pfUnitIllegal(env, owner, u.id, pfMode)) : 'Not a fire phase';
          const uname = pieceLabel(env, u).replace(/^\S+ /, '');
          const inBuilding = !!statics.map.hex(hex)?.buildingId;
          const line = (targetType: 'VTT' | 'ITT', backblast?: boolean) => () => {
            setSelectedHex(hex);
            setSelected(new Set([u.id]));
            setPfShot({ unit: u.id, targetType, ...(backblast !== undefined ? { backblast } : {}) });
            setTarget(null);
            setDeclared(true);
            setError(null);
          };
          const opts = [
            ...(inBuilding
              ? [action('At a vehicle · +2 To Hit (no Backblast)', line('VTT', false)), action('At a vehicle · take the Backblast', line('VTT', true))]
              : [action('At a vehicle', line('VTT'))]),
            ...(inBuilding
              ? [action('At Infantry in a building or a Gun · +2 To Hit', line('ITT', false)), action('At Infantry in a building or a Gun · Backblast', line('ITT', true))]
              : [action('At Infantry in a building or a Gun', line('ITT'))]),
          ];
          const left = (pfCap(env, owner) ?? 0) - pfUsed(env, owner);
          if (why) items.push(action(`Panzerfaust: ${uname}`, () => {}, { icon: '✦', disabled: true, hint: why }));
          else items.push(group(`Panzerfaust: ${uname}…`, opts, { icon: '✦', hint: `${left} PF shot${left === 1 ? '' : 's'} left this scenario; a PF check dr ≤ 3 first (SK4 4.4.2), then pick the target hex` }));
        }
      }
      // Guns here that can shoot: each by target type, and as Intensive Fire once it has lost ROF.
      if (!declared)
        for (const g of gunsFireable(hex)) {
          const name = pieceLabel(env, g).replace(/^\S+ /, '');
          // Every Target Type × ammunition the counter allows; the ones the Gun cannot use now say why.
          const fired = !!g.tags['fire'];
          const mode = decision.kind === 'firstFire' ? gunFirstFireMode(env, { weapon: g.id, target: ms?.hex ?? '', targetType: 'ITT' }) : FIRE_MODE[phase]!;
          const opts = shotOptions(env, g.id, mode).map((t) =>
            action(t.label, () => declareGun(g.id, t.type, fired && t.type !== 'IFE', t.ammo, t.backblast), { hint: t.hint, ...(t.available ? {} : { disabled: true }) }),
          );
          // A single way to fire (a light Mortar's HE on the Area Target Type) needs no menu of one: the entry fires it.
          const fireMenu = (label: string, choices: WheelItem[], hint: string): WheelItem => {
            const only = choices.length === 1 ? choices[0]! : null;
            return only?.kind === 'action' ? { ...only, label: `${label} · ${only.label}`, icon: '✦', hint: only.hint ?? hint } : group(`${label}…`, choices, { icon: '✦', hint });
          };
          // A weapon that cannot fire at all now (a Mortar or Gun that moved, in the AFPh; malfunctioned; its crew broken):
          // the entry is greyed with the reason, rather than leading through the shot to a refusal.
          const cannot = owner ? plain(ordnanceWeaponIllegal(env, g.id, mode, owner)) : null;
          // Intensive Fire is a Gun's or vehicle's (SK4 3.2.4); a SW that has fired (BAZ, PSK, PIAT, ATR, Light Mortar) is
          // done for the phase, and its holder's own FP is offered by the stack's Fire (SK4 4.4 LATW To Hit Example).
          const holder = g.loc.kind === 'held' ? state.pieces[g.loc.by] : undefined;
          const ownFp = holder && !fireMarker(holder) && !holder.tags['ownFpForfeit'] ? 'the unit holding it may still fire its own FP' : 'the unit holding it has fired its own FP this phase too';
          const swDone = fired && !!ordnanceOf(env, g)?.light ? `The ${name} has fired this phase (a SW cannot use Intensive Fire); ${ownFp}` : null;
          if (cannot || swDone) items.push(action(`Fire ${name}`, () => {}, { icon: '✦', disabled: true, hint: (cannot ?? swDone)! }));
          else if (fired && !g.tags['intensive'] && decision.kind !== 'firstFire' && phase !== 'AFPh')
            items.push(fireMenu(`Intensive Fire: ${name}`, opts.filter((o) => !/IFE/.test(o.label)), 'One more shot after losing ROF: +2 To Hit, B# -2 (SK4 3.2.4)'));
          else if (fired && decision.kind === 'firstFire')
            items.push(fireMenu(`${name} again (Intensive)`, opts.filter((o) => !/IFE/.test(o.label)), 'A Gun marked First Fire fires again only as Intensive Fire (SK4 3.3.3)'));
          else if (!fired) items.push(fireMenu(`Fire ${name}`, opts, 'Choose how the Gun fires, then pick the target'));
        }
      // Infantry sharing the moving vehicle's hex: CC Reaction Fire (SK4 3.3.4).
      if (decision.kind === 'firstFire' && ms?.vehicle && ms.hex === hex)
        for (const u of unitsHere.filter((p) => p.side === owner && !vehicleDef(env, p) && ['squad', 'hs', 'crew', 'leader'].includes(defOf(env, p).kind))) {
          const err = plain(session.check({ type: 'reactionFire', unit: u.id }));
          const uname = pieceLabel(env, u).replace(/^\S+ /, '');
          const marker = u.tags['fire'] as string | undefined;
          const d = defOf(env, u);
          const ccv = d.kind === 'squad' ? 5 : d.kind === 'crew' ? 4 : d.kind === 'hs' ? 3 : 2;
          items.push(
            action(`${uname}: CC Reaction Fire${marker ? ` (${marker === 'first' ? 'Subsequent First Fire' : 'Final Protective Fire'})` : ''}`, () => run({ type: 'reactionFire', unit: u.id }), {
              icon: '⚔',
              disabled: !!err,
              hint: err ?? `${d.kind === 'leader' ? '' : 'PAATC first (DR ≤ morale), then '}CCV ${ccv}${marker ? ' −1 (already fired)' : ''}: DR < CCV destroys the vehicle, = Immobilizes; +2 while it is Non-Stopped, −1 if CE${marker === 'final' ? '; FPF: a NMC on the DR' : ''}`,
            }),
          );
        }
      // Defending vehicles (SK4 3.3.2.1, 7.5): a Motion attempt instead of firing, or a smoke dispenser.
      if (decision.kind === 'firstFire')
        for (const v of unitsHere.filter((p) => p.side === owner && vehicleDef(env, p) && !p.tags['wreck'])) {
          const pile = unitsHere.filter((p) => p.side === owner && vehicleDef(env, p) && !p.tags['wreck']).length > 1;
          const mErr = plain(session.check({ type: 'defMotion', vehicle: v.id }));
          const mpSeen = env.query('vehicle.motionMp', { vehicle: v.id }, 0);
          items.push(action(vehicleEntry(v, pile, 'Motion attempt'), () => run({ type: 'defMotion', vehicle: v.id }), { icon: '➜', disabled: !!mErr, hint: mErr ?? `dr ≤ ${mpSeen} (the MP/MF the mover has spent in this vehicle's LOS); success puts it in Motion${v.tags['motion'] ? '' : ' (no fire marker needed)'} and it may then change its VCA/TCA freely` }));
          const vd = vehicleDef(env, v)!;
          if (vd.smoke?.length && vd.smoke[0]!.kind !== 'sM') {
            const sErr = plain(session.check({ type: 'defSmoke', vehicle: v.id }));
            items.push(action(vehicleEntry(v, pile, `smoke dispenser (${vd.smoke[0]!.kind}${vd.smoke[0]!.n})`), () => run({ type: 'defSmoke', vehicle: v.id }), { icon: '☁', disabled: !!sErr, hint: sErr ?? 'Dispersed Smoke in its own hex on a DR ≤ its number (+1 BU); not a weapon, it may still fire' }));
          }
        }
      // A vehicle's machine guns fire together, on the IFT (SK4 7.8).
      if (!declared)
        for (const v of unitsHere.filter((p) => p.side === owner && vehicleDef(env, p) && !p.tags['wreck'])) {
          const mgs = vehicleMgsReady(v);
          if (!mgs.length) continue;
          const pile = unitsHere.filter((p) => p.side === owner && vehicleDef(env, p) && !p.tags['wreck']).length > 1;
          const err = plain(env.query('fire.illegal', { decl: { units: [], sw: mgs.map((w) => w.id), target: hex }, mode: decision.kind === 'firstFire' ? 'first' : FIRE_MODE[phase]!, side: owner }, null));
          // The vehicle's own hex stands in for a target here: only what stops the MGs at any target greys the entry out
          // (it read "Cannot fire into own hex", which disabled the entry for every vehicle).
          const arcErr = err && !/Covered Arc|Unknown target|own hex/.test(err) ? err : null;
          items.push(action(vehicleEntry(v, pile, `fire MGs (${mgLabel(mgs)})`), () => declareFire(hex, mgs.map((w) => w.id), ''), { icon: '✦', disabled: !!arcErr, hint: arcErr ?? 'BMG through the hull arc, CMG through the turret arc, AAMG only CE; then pick the target' }));
          // The MA's IFE adds to the MGs' FP in one attack; at one target they must fire together (SK4 7.8).
          const ife = vehicleIfe(env, v);
          if (ife && !v.tags['fire'] && !v.tags['malf'] && !v.tags['maDisabled']) {
            const ma = vehicleDef(env, v)!.ma!;
            const all = [v.id, ...mgs.map((w) => w.id)];
            const ifeErr = plain(env.query('fire.illegal', { decl: { units: [], sw: all, target: hex }, mode: decision.kind === 'firstFire' ? 'first' : FIRE_MODE[phase]!, side: owner }, null));
            const ifeArcErr = ifeErr && !/Covered Arc|Unknown target|outside|own hex/.test(ifeErr) ? ifeErr : null;
            items.push(
              action(vehicleEntry(v, pile, `fire MA IFE + MGs (${ma.caliber}${ma.barrel ?? ''} IFE ${ife.ife} + ${mgLabel(mgs)})`), () => declareFire(hex, all, ''), {
                icon: '✦',
                disabled: !!ifeArcErr,
                hint: ifeArcErr ?? 'One attack on the IFT with the FP added together; the target must lie in the Covered Arc of the MA and every MG. Then pick the target',
              }),
            );
          }
          if (mgs.length > 1)
            items.push(group(vehicleEntry(v, pile, 'fire one MG…'), mgs.map((w) => action(mgLabel([w]), () => declareFire(hex, [w.id], ''))), { icon: '✦' }));
        }
      if (own.length && !declared) {
        // Declare fire with the units here (the ticked ones, or the whole stack), led by a leader or not.
        const label = `Fire${units.length < own.length ? ` (${units.length})` : ''}`;
        const leaders = fireLeaders(env, leadersHere(hex), units, own);
        const halted = plain(actionIllegal(env, units));
        if (halted) items.push(action(label, () => {}, { icon: '✦', disabled: true, hint: halted }));
        else if (leaders.length)
          items.push(
            group(label, [action('No leader', () => declareFire(hex, units, '')), ...leaders.map((l) => directBy(l, units, () => declareFire(hex, units, l.id)))], {
              icon: '✦',
              hint: 'Mark these units as firing, then pick the target',
            }),
          );
        else items.push(action(label, () => declareFire(hex, units, ''), { icon: '✦', hint: 'Mark these units as firing, then pick the target' }));
      }
      // A FT never combines with another attack nor forms a Fire Group, and no leader directs it (SK1 4.2): it has its
      // own entry that fires it alone, whatever else is ticked. The stack's Fire leaves it out (`swLeftOut`).
      if (!declared) {
        const fts = Object.values(state.pieces).filter((p) => p.loc.kind === 'held' && own.includes(p.loc.by) && (defOf(env, p) as { type?: string }).type === 'FT');
        for (const ft of fts) {
          const holder = state.pieces[(ft.loc as { by: PieceId }).by]!;
          const why = holder.tags['pinned'] === true ? 'A pinned unit cannot fire a FT (SK1 4.2)' : plain(actionIllegal(env, [holder.id]));
          items.push(
            action(fts.length > 1 ? `Fire flamethrower (${pieceLabel(env, holder).replace(/^\S+ /, '')})` : 'Fire flamethrower', () => declareFire(hex, [ft.id], ''), {
              icon: '🔥',
              disabled: !!why,
              hint: why ?? 'The FT fires alone, with no Fire Group and no leader (SK1 4.2): pick the target, 24 FP at 1 hex or 12 at 2',
            }),
          );
        }
      }
      if (own.length && declared && !inGroup) {
        const add = () => setSelected((s) => new Set([...s, ...own]));
        const leaders = directors.length ? leadersHere(hex) : [];
        // A directed Fire Group needs a directing leader in every hex (SK1 3.2): adding a stack
        // means naming its leader too, or giving up the direction.
        if (leaders.length)
          items.push(
            group(
              'Add to fire group',
              [
                ...leaders.map((l) =>
                  directBy(l, [...selected, ...own], () => {
                    add();
                    setDirectors((d) => [...d, l.id]);
                  }),
                ),
                action('No leader (undirected)', () => {
                  add();
                  setDirectors([]);
                }),
              ],
              { icon: '＋', hint: 'Fire together with the declared units (adjacent hexes only)' },
            ),
          );
        else
          items.push(
            action('Add to fire group', add, {
              icon: '＋',
              hint: directors.length ? 'No leader here: a directed fire group needs one in every hex' : 'Fire together with the declared units (adjacent hexes only)',
            }),
          );
      } else if (own.length && inGroup) {
        items.push(action('Cancel fire', () => { setDeclared(false); setTarget(null); setGunShot(null); }, { icon: '✕', hint: 'Take the fire marker back off' }));
      }
      if (gunShot && gunHexOf(env, gunShot.gun) === hex) items.push(action('Cancel Gun shot', () => { setDeclared(false); setTarget(null); setGunShot(null); setSelected(new Set()); }, { icon: '✕' }));
      // A Gun that will not fire may turn to a new Covered Arc at the end of its own fire phase (SK4 3.2.4): doing so ends
      // its fire and its crew's this phase. To turn and shoot, the player picks the target through Fire (case 8 DRM).
      if (decision.kind === 'phase' && !declared)
        for (const g of gunsFireable(hex).filter((w) => gunDef(env, w))) {
          const why = plain(env.query('gun.canChangeCa', { gun: g.id }, null));
          const label = `Turn ${pieceLabel(env, g).replace(/^\S+ /, '')} toward…`;
          if (why) items.push(action(label, () => {}, { icon: '◠', disabled: true, hint: why }));
          else
            items.push(
              action(
                label,
                () => setRing({ hex, piece: g.id, what: 'Covered Arc', current: coveredArc(g), note: 'without firing: ends the Gun and crew\'s fire this phase, and they cannot move this Player Turn', action: (spine) => (spine === coveredArc(g) ? null : { type: 'gun.changeCa', gun: g.id, ca: spine }) }),
                { icon: '◠', hint: `Covered Arc: ${spineLabel(env, hex, coveredArc(g))} · turn without firing: the Gun and crew are done firing this phase. To turn and fire, use Fire and pick the target (+DRM for the turn)` },
              ),
            );
        }
      if (canPass) items.push(action(passLabel, passFirstFire, { icon: '—', hint: passHint }));
    }
    if (decision.kind === 'motionFacing' && turnable && hex === turnable.hex) {
      // Free turns in Motion (SK4 3.3.2.1): a ring of hexspines around the vehicle to click.
      const tv = turnable.v;
      const vca = Number(tv.tags['vca'] ?? 0);
      const tca = Number(tv.tags['ca'] ?? vca);
      items.push(action('Turn hull toward…', () => setRing({ hex, piece: tv.id, what: 'Vehicle Covered Arc', current: vca, note: turnable.hullHint, action: (spine) => (spine === vca ? null : turnable.turn(spine)) }), { icon: '◠', hint: `VCA: ${spineLabel(env, hex, vca)} · pick a hexspine on the map (Q/E)` }));
      if (vehicleDef(env, tv)!.turret !== 'NT')
        items.push(action('Point turret toward…', () => setRing({ hex, piece: tv.id, what: 'Turret Covered Arc', current: tca, note: turnable.turretHint, action: (spine) => (spine === tca ? null : turnable.turret(spine)) }), { icon: '◎', hint: `TCA: ${spineLabel(env, hex, tca)} · pick a hexspine on the map (A/D)` }));
    }
    if (facingDone) items.push(action('Done turning', facingDone, { icon: '✓', hint: 'Keep this facing and go back to Defensive First Fire' }));

    if (decision.kind === 'phase' && phase === 'RtPh' && routing) {
      // A rout under way: the next hexes it may enter, and stopping where it is when that is legal.
      // The next hexes are clicked on the map (amber), never picked from a list.
      if (canStopRout) items.push(action('Stop here', () => run({ type: 'rout.stop', unit: routing.unit }), { icon: '⌂', hint: 'End the rout in this building or woods hex' }));
      items.push(...routStairs(routing.unit));
    } else if (decision.kind === 'phase' && phase === 'RtPh') {
      const broken = unitsHere.filter((p) => p.side === owner && p.tags['broken']);
      for (const b of broken) {
        const r = routInfo(b.id);
        if (r?.done) continue;
        const stay = action('Stay here', () => run({ type: 'rout.stay', unit: b.id }), {
          icon: '⌂',
          disabled: !!r?.must,
          hint: r?.must && r.reason ? `Must rout: ${routReason(r.reason)}` : 'Does not rout',
        });
        // The rout is walked on the map, hex by hex: the entry selects the unit (with the Good Order
        // leader going along, SK1 3.6, when one is picked), the hexes it may enter light up amber, and a
        // click on one is the first step. Low Crawl is the toggle below.
        const canRout = legal.some((a) => a.type === 'rout.step' && a['unit'] === b.id);
        const escorts = routEscorts(env, b.id);
        const pick = (leaders: PieceId[]) => () => { setSelectedHex(hex); setSelected(new Set([b.id, ...leaders])); };
        const children = [stay];
        if (!canRout) {
          const why = routRefusals(b.id);
          children.push(action('No hex to rout to', () => {}, { icon: '✖', disabled: true, hint: why.length ? why.join('; ') : 'No legal rout this phase' }));
        }
        if (canRout) {
          children.push(...routStairs(b.id));
          children.push(action(escorts.length ? 'Rout alone… click a hex' : 'Rout… click a hex', pick([]), { icon: '➜', hint: 'Select it; the amber hexes are where it may go, click one' }));
          for (const l of escorts)
            children.push(
              action(`Rout with ${pieceLabel(env, state.pieces[l]).replace(/^\S+ /, '')}… click a hex`, pick([l]), {
                icon: '➜',
                hint: 'The leader routs along: his DRM helps the Interdiction MC, but he dies if it fails',
              }),
            );
        }
        items.push(group(`${pieceLabel(env, b).replace(/^\S+ /, '')}${r?.must ? ' (must rout)' : ''}`, children, { icon: '☠', hint: r?.must && r.reason ? `Must rout: ${routReason(r.reason)}` : 'May rout or stay' }));
      }
      // The click-to-rout Low Crawl toggle, only where a broken unit here may Low Crawl now.
      if (broken.some((b) => legal.some((a) => a.type === 'rout.step' && a['unit'] === b.id && a['lowCrawl'])))
        items.push(action('Low Crawl', () => setLowCrawl(!lowCrawl), { icon: '↓', active: lowCrawl, hint: 'Click-to-rout uses Low Crawl' }));
      if (broken.length) items.push({ ...selectAll, label: 'Select to rout', hint: 'Select the first broken unit here and a leader to go with it (SK1 3.6: units rout one at a time)' } as WheelItem);
    }

    if (decision.kind === 'phase' && phase === 'APh' && units.length) {
      // Hexes are picked on the map, never from a list: the entry selects the units, the hexes they may
      // advance into light up green, and a click on one advances them.
      // On the map, or off it from an exit hex (ASLRB A2.6: units leave the map "using normal MPh/APh capabilities").
      const offboard = statics.map.offboard('N,E,S,W').filter((o) => statics.map.offboardNeighbors(o.id).onboard.includes(hex)).map((o) => o.id);
      const targets = [...statics.map.neighbors(hex), ...offboard].filter((to) => session.check({ type: 'advance', units, to }) === null);
      if (targets.length)
        items.push(action('Advance… click a hex', () => { setSelectedHex(hex); setSelected(new Set(units)); }, { icon: '➜', hint: `Select these units; the green hexes are where they may advance, click one${targets.some((t) => offboard.includes(t)) ? ' (the green hex beyond the map edge exits them)' : ''}` }));
      // Full ASL: up or down the stairs of this hex, one Location (ASLRB A4.7, B23.422).
      const at = state.pieces[units[0]!] ? locOf(state, state.pieces[units[0]!]!) : null;
      for (const to of statics.map.hex(hex) ? locationsOf(env, hex) : []) {
        if (!at || to === at) continue;
        const why = plain(session.check({ type: 'advance', units, to }));
        if (why === 'Advance is one hex') continue;
        const up = levelOfLoc(to) > levelOfLoc(at);
        items.push(action(up ? `Advance up to level ${levelOfLoc(to)}` : 'Advance down to the ground', () => run({ type: 'advance', units, to }), { icon: up ? '▲' : '▼', disabled: !!why, hint: why ?? 'Up or down the stairs of this hex: an advance of one Location (ASLRB A4.7, B23.422)' }));
      }
      // S70 caves: into an adjacent cave, or between a cave and the Connection Location (SSR 2).
      for (const to of at ? adjacentLocs(env, at).filter((l) => isCaveLoc(l) || l === connection) : []) {
        const why = plain(session.check({ type: 'advance', units, to }));
        items.push(action(`Advance into ${locName(to)}`, () => run({ type: 'advance', units, to }), { icon: '◒', disabled: !!why, hint: why ?? (to === connection ? 'Out of sight, secretly recorded (S70 SSR 2)' : 'Under the Cave counter: +2 TEM (S70 SSR 2)') }));
      }
      if (own.length > 1) items.push(selectAll);
    }
    if (decision.kind === 'phase' && phase === 'APh') {
      // A vehicle may still Button Up or go CE in the APh (SK4 3.7, ASLRB D5.33).
      const vehiclesHere = vehiclesIn(hex).filter((v) => v.loc.kind === 'hex');
      const chooser = vehicleChooser(hex, vehiclesHere);
      if (chooser) items.push(chooser);
      const v = chosenVehicle(vehiclesHere);
      if (v) items.push(ceEntry(v, vehiclesHere.length > 1));
    }

    // The Close Combat itself (arranging leaders, declaring, the dice) happens in the overlay.
    if (decision.kind === 'ccHex') {
      const here = legal.find((x) => x['hex'] === hex);
      if (here) items.push(action('Begin Close Combat', () => run(here), { icon: '⚔', hint: 'Fight this hex now; the others follow' }));
    }

    // Items carried by our units here: pass, drop, repair — each only as the rules allow.
    const carried = unitsHere.filter((p) => p.side === owner).flatMap((u) => swHeldBy(state, u.id)).filter((sw) => !isFixedWeapon(env, sw));
    if (carried.length) {
      const pass = carried.map((sw) => passItem(sw, unitsHere)).filter((x): x is WheelItem => x !== null);
      if (pass.length) items.push(group('Pass item…', pass, { icon: '⇄', hint: 'Transfer a SW to another unit here (RPh/APh)' }));
      const drops = carried.filter((sw) => session.check({ type: 'move.drop', sw: sw.id }) === null);
      if (drops.length) items.push(group('Drop…', drops.map((sw) => action(pieceLabel(env, sw), () => run({ type: 'move.drop', sw: sw.id }, true))), { icon: '⤓' }));
      // A weapon that entered disassembled (S66 SSR 2): its MMC puts it together in the PFPh/DFPh, as a SW use.
      for (const sw of carried.filter((w) => w.tags['disassembled'] === true)) {
        const err = plain(session.check({ type: 'sw.assemble', sw: sw.id }));
        items.push(action(`Assemble ${pieceLabel(env, sw).replace(/^\S+ /, '')}`, () => run({ type: 'sw.assemble', sw: sw.id }, true), { icon: '⚙', disabled: !!err, hint: err ?? 'Flip it to its functioning side: a use of a SW this phase; it fires from the next fire phase' }));
      }
      const destroys = carried.filter((sw) => session.check({ type: 'sw.destroy', sw: sw.id }) === null);
      if (destroys.length)
        items.push(
          group('Destroy…', destroys.map((sw) => action(pieceLabel(env, sw), () => run({ type: 'sw.destroy', sw: sw.id }, true))), {
            icon: '✖',
            hint: 'Wreck a SW or Gun so the enemy cannot use it; counts as using a weapon (SK1 4.0; Guns as SW, SK4 1.2.6)',
          }),
        );
    }
    // Repairs: SW carried by our units here, and our vehicles' MA and MGs (SK4 3.1 c).
    const swRepairs = carried
      .filter((sw) => sw.tags['malf'])
      .map((sw) => {
        const err = plain(session.check({ type: 'rally.repair', unit: (sw.loc as { by: string }).by, sw: sw.id }));
        return action(pieceLabel(env, sw), () => run({ type: 'rally.repair', unit: (sw.loc as { by: string }).by, sw: sw.id }, true), { disabled: !!err, hint: err ?? undefined });
      });
    const vehicleRepairs = unitsHere.filter((p) => p.side === owner && isVehiclePiece(p.id)).flatMap(vehicleRepairItems);
    const repairs = [...swRepairs, ...vehicleRepairs];
    if (repairs.length) items.push(group('Repair…', repairs, { icon: '🔧' }));

    // Attacks a card gives the side against a hex (S35: a Sniper in the Russian DFPh, a Stuka in the German one).
    if (decision.kind === 'phase')
      for (const s of ssrHexAttacks(env, owner)) {
        const a = { type: s.type, hex };
        if (session.check(a) === null) items.push(action(s.label, () => run(a, true), { icon: '✸', hint: s.hint }));
      }
    // Off-board artillery (SSR): at the start of the PFPh, a leader with a LOS to the hex calls a fire mission on it.
    const oba = decision.kind === 'phase' && phase === 'PFPh' ? artilleryMissions(env, owner) : null;
    if (oba) {
      const spotters = artilleryObservers(env, owner, hex);
      const label = `Call ${oba.label} fire (${oba.left} left)`;
      const hint = `Contact on a dr ≤ ${scenario.ssr.find((r) => r.module === 'offboard-artillery' && (r.params as { side?: string } | undefined)?.side === owner)?.params?.['contact'] ?? '?'}; the salvo lands at the start of the AFPh, perhaps off target. The observer is marked Prep Fire.`;
      const call = (observer: PieceId) => run({ type: 'ssr.oba', hex, observer }, true);
      if (spotters.length === 1) items.push(action(`${label}: ${pieceLabel(env, spotters[0]!)} observes`, () => call(spotters[0]!.id), { icon: '✸', hint }));
      else if (spotters.length > 1) items.push(group(label, spotters.map((l) => action(`${pieceLabel(env, l)} observes`, () => call(l.id), { hint })), { icon: '✸', hint }));
    }
    return items;
  }

  /** "Pass <sw> to…": the units here the rules let it go to; null when none can take it now. */
  function passItem(sw: Piece, unitsHere: Piece[]): WheelItem | null {
    const holder = sw.loc.kind === 'held' ? sw.loc.by : null;
    const options = unitsHere
      .filter((u) => u.side === owner && u.id !== holder && !isWeaponDef(defOf(env, u)))
      .map((u) => ({ u, err: plain(session.check({ type: 'rally.transfer', sw: sw.id, to: u.id })) }));
    const ok = options.filter((o) => o.err === null);
    const label = `${pieceLabel(env, sw)}${holder ? ` (${pieceLabel(env, state.pieces[holder]).replace(/^\S+ /, '')})` : ''}`;
    if (ok.length === 0) return null;
    return group(label, ok.map((o) => action(`to ${pieceLabel(env, o.u).replace(/^\S+ /, '')}`, () => run({ type: 'rally.transfer', sw: sw.id, to: o.u.id }, true))));
  }

  /** The wheel for one chit in the stack card. */
  function chitItems(p: Piece): WheelItem[] {
    const items: WheelItem[] = [];
    if (!owner) return items;
    const hex = p.loc.kind === 'hex' || p.loc.kind === 'offboard' ? p.loc.hex : p.loc.kind === 'held' ? hexOfId(state, p.loc.by) : undefined;
    const unitsHere = hex ? stackIn(shownEnv, hex).map((e) => e.piece) : [];
    const mine = p.side === owner;
    const d = defOf(env, p);
    if (mine) items.push(action(selected.has(p.id) ? 'Deselect' : 'Select', () => togglePiece(p.id), { icon: selected.has(p.id) ? '☐' : '☑' }));
    if (mine && isWeaponDef(d) && p.loc.kind === 'held' && !isFixedWeapon(env, p)) {
      const by = p.loc.by;
      const pass = passItem(p, unitsHere);
      if (pass) items.push({ ...pass, label: 'Pass to…', icon: '⇄' });
      const dropErr = plain(session.check({ type: 'move.drop', sw: p.id }));
      items.push(action('Drop', () => run({ type: 'move.drop', sw: p.id }, true), { icon: '⤓', disabled: !!dropErr, hint: dropErr ?? 'Leave it in this hex' }));
      if (phase === 'PFPh' || phase === 'DFPh') {
        const destroyErr = plain(session.check({ type: 'sw.destroy', sw: p.id }));
        items.push(
          action('Destroy', () => run({ type: 'sw.destroy', sw: p.id }, true), {
            icon: '✖',
            disabled: !!destroyErr,
            hint: destroyErr ?? 'Wreck it so the enemy cannot use it; counts as using a weapon (SK1 4.0; Guns as SW, SK4 1.2.6)',
          }),
        );
      }
      if (p.tags['malf']) {
        const err = plain(session.check({ type: 'rally.repair', unit: by, sw: p.id }));
        items.push(action('Repair', () => run({ type: 'rally.repair', unit: by, sw: p.id }, true), { icon: '🔧', disabled: !!err, hint: err ?? undefined }));
      }
    }
    if (mine && !isWeaponDef(d)) {
      const held = swHeldBy(state, p.id);
      const passes = held.map((sw) => passItem(sw, unitsHere)).filter((x): x is WheelItem => x !== null);
      if (passes.length) items.push(group('Pass item…', passes, { icon: '⇄' }));
      if (decision?.kind === 'phase' && phase === 'RPh') {
        const rallies = legal.filter((a) => (a.type === 'rally.selfRally' || a.type === 'rally.rally') && a['unit'] === p.id);
        for (const a of rallies)
          items.push(action(a.type === 'rally.selfRally' ? 'Self-rally' : `Rallied by ${pieceLabel(env, state.pieces[a['leader'] as string]).replace(/^\S+ /, '')}`, () => run(a), { icon: '♥' }));
        if (isVehiclePiece(p.id)) for (const it of vehicleRepairItems(p)) items.push({ ...it, label: it.label.replace(pieceLabel(env, p), 'Repair').trim() });
      }
      if (decision?.kind === 'phase' && phase === 'RtPh' && p.tags['broken']) {
        const r = routInfo(p.id);
        items.push(
          action('Stays (no rout)', () => run({ type: 'rout.stay', unit: p.id }), {
            icon: '⌂',
            disabled: !!r?.must || !!r?.done || !!routing,
            hint: r?.must && r.reason ? `Must rout: ${routReason(r.reason)}` : undefined,
          }),
        );
      }
    }
    return items;
  }

  /**
   * The Recover entry for the loose weapons in a hex. With one unit picked (ticked) it is that unit's try; else each
   * weapon offers every unit of the stack, those the engine refuses greyed out with the reason (a Gun needs a MMC, a
   * unit may have acted already...). No default: the top of the stack is often a leader, not the one to carry it.
   */
  function recoverMenu(type: 'rally.recover' | 'move.recover', loose: Piece[], units: Piece[], picked?: Piece): WheelItem | null {
    const why = (u: Piece, s: Piece) => plain(session.check({ type, unit: u.id, sw: s.id }));
    const name = (p: Piece) => pieceLabel(env, p).replace(/^\S+ /, '');
    const entries = loose.flatMap((s): WheelItem[] => {
      if (!units.some((u) => !why(u, s))) return [];
      if (picked) {
        const no = why(picked, s);
        return [action(pieceLabel(env, s), () => run({ type, unit: picked.id, sw: s.id }, true), { disabled: !!no, hint: no ?? `by ${name(picked)}` })];
      }
      const by = units.map((u) => {
        const no = why(u, s);
        return action(`By ${name(u)}`, () => run({ type, unit: u.id, sw: s.id }, true), { disabled: !!no, hint: no ?? undefined });
      });
      return [units.length === 1 ? { ...by[0]!, label: pieceLabel(env, s) } : group(pieceLabel(env, s), by, { hint: 'Pick the unit to carry it' })];
    });
    return entries.length ? group('Recover', entries, { icon: '⚙' }) : null;
  }

  const togglePiece = (id: PieceId) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else {
        // One vehicle at a time: ticking another vehicle swaps it in.
        if (isVehiclePiece(id)) for (const v of n) if (isVehiclePiece(v)) n.delete(v);
        n.add(id);
      }
      return n;
    });

  const leadersHere = (hex: HexId | null) =>
    hex ? personnelAt(env, hex, owner).filter((p) => defOf(env, p).kind === 'leader') : [];
  /** "Directed by" wheel entry for a leader: greyed out, with the reason, when he cannot direct (SK1 3.2). */
  const directBy = (l: Piece, ids: PieceId[], run: () => void) => {
    const firers = ids.filter((id) => state.pieces[id] && !['leader', 'sw', 'gun'].includes(defOf(env, state.pieces[id]).kind));
    const sws = ids.filter((id) => state.pieces[id] && defOf(env, state.pieces[id]).kind === 'sw');
    const why = directorIllegal(env, l.id, fireModeFor({ units: firers, sw: [], target: '' }), firers, isRofShot(env, { units: firers, sw: sws }));
    return action(`Directed by ${pieceLabel(env, l).replace(/^\S+ /, '')}`, run, why ? { disabled: true, hint: why } : {});
  };

  const sections = useMemo(() => phaseSections(describeEvents(env, present.log, viewer).slice(-200)), [env, present.log, viewer]);
  // The log reads oldest first, like the dice log, and follows the newest line: it stays pinned to the bottom unless
  // the player has scrolled up to read back, and pins again once they scroll down to the end.
  const logRef = useRef<HTMLElement | null>(null);
  const logPinned = useRef(true);
  const logResize = useRef<ResizeObserver | null>(null);
  const pinLog = () => {
    const el = logRef.current;
    if (el && logPinned.current) el.scrollTop = el.scrollHeight;
  };
  useLayoutEffect(pinLog, [sections]);
  // The panel also changes height (the stack card above it grows, a folded panel opens): keep the end in view.
  const attachLog = useCallback((el: HTMLElement | null) => {
    logRef.current = el;
    logResize.current?.disconnect();
    logResize.current = null;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    if (typeof ResizeObserver === 'undefined') return;
    logResize.current = new ResizeObserver(() => {
      if (logPinned.current) el.scrollTop = el.scrollHeight;
    });
    logResize.current.observe(el);
  }, []);
  // A shot picked in the log has its LOS drawn on the map, traced again over the map as it stands
  // (terrain never changes; Smoke or wrecks placed since could differ), red from where it is blocked.
  const [losReview, setLosReview] = useState<number | null>(null);
  const losThreads = useMemo(() => {
    const line = losReview === null ? undefined : sections.flatMap((s) => s.lines).find((l) => l.seq === losReview);
    if (!line?.los) return null;
    const { from, to } = line.los;
    // The ends are Locations (full ASL: an upper level is traced from its height); the map draws them by hex.
    return from.map((loc) => {
      // Fire at a stack in Bypass (full ASL): this firing hex's LOS went to the corner it chose (ASLRB A4.34).
      const pt = line.los!.at?.[hexOfLoc(loc)];
      const vertex = pt ? cornerBetween(statics.map, hexOfLoc(to), pt[0], pt[1]) : null;
      const tr = env.query('los.trace', { from: loc, to, ...(vertex !== null ? { toAt: { vertex } } : {}) }, { clear: true, hindrance: 0, parts: [] });
      const [fromLevel, toLevel] = [levelOfLoc(loc), levelOfLoc(to)];
      return {
        from: hexOfLoc(loc),
        to: hexOfLoc(to),
        ...(vertex !== null ? { toVertex: vertex } : {}),
        clear: tr.clear,
        ...(tr.blockedAt ? { blockedAt: tr.blockedAt } : {}),
        ...(fromLevel ? { fromLevel } : {}),
        ...(toLevel ? { toLevel } : {}),
      };
    });
  }, [losReview, sections, env]);
  const boardOverlay = useMemo(() => (losThreads ? { ...overlay, los: losThreads } : overlay), [overlay, losThreads]);
  const result = state.result;
  const sideName = (s?: string) => (s ? (scenario.sides.find((x) => x.side === s)?.name ?? NATION[s] ?? s) : '');
  // Each side's tally when its victory conditions turn on one (exit VP, or CVP), else nothing.
  const tally = useMemo(() => Object.fromEntries(scenario.sides.map((s) => [s.side, sideTally(env, scenario, s.side)])), [env, scenario]);
  // Panzerfaust shots left, for the sides that have them (public information, SK4 4.4.2).
  const pfLeft = useMemo(
    () =>
      Object.fromEntries(
        scenario.sides.map((s) => {
          const cap = pfCap(env, s.side);
          return [s.side, cap === null ? null : { left: Math.max(0, cap - pfUsed(env, s.side)), cap }];
        }),
      ),
    [env, scenario],
  );
  const weather = useMemo(() => weatherOf(env), [env]);
  const windAngle = windScreenAngle(scenario, weather, rotation);
  const northAngle = northScreenAngle(scenario, rotation);
  // Dev only: the live game for a DevTools-protocol driver (the browser smoke test, screenshot
  // scripts) to read, so it can pick legal moves and targets the way a player would see them.
  if (import.meta.env.DEV) {
    (window as unknown as { aslGame: unknown }).aslGame = {
      state,
      /** The state as drawn: setup placements not yet confirmed are in their hexes. */
      shown,
      env,
      legal,
      owner,
      phase,
      decision,
      /** Results still being revealed: actions are refused until it clears (or `skip()` it). */
      resolving,
      skip: () => fx.skip(),
      /** Ping a hex (at a map point, else its centre) as Ctrl+click would. */
      ping: (hex: HexId, at?: MapPoint) => pingHex(hex, at),
      kindOf: (id: PieceId) => (state.pieces[id] ? defOf(env, state.pieces[id]!).kind : null),
      fireIllegal: (decl: FireDeclaration) => (owner ? plain(env.query('fire.illegal', { decl, mode: fireModeFor(decl), side: owner, ...(ms ? { moving: ms.units } : {}) }, null)) : 'no owner'),
      ordnanceIllegal: (shot: OrdnanceShot) => (owner ? plain(env.query('ordnance.illegal', { shot, mode: decision?.kind === 'firstFire' ? gunFirstFireMode(env, shot) : FIRE_MODE[phase]!, side: owner, ...(ms ? { moving: ms.units } : {}) }, null)) : 'no owner'),
      gunHexOf: (id: PieceId) => gunHexOf(env, id),
      gunHeldBy: (unit: PieceId) => gunHeldBy(env, unit)?.id ?? null,
      /** Why an action would be refused, or null (drivers only). */
      check: (a: Omit<Action, 'side' | 'decisionId'>) => plain(session.check(a)),
      /** Submit an action as the acting side (drivers only). */
      act: (a: Omit<Action, 'side' | 'decisionId'>) => run(a),
      /** Load a dev fixture (`@asl/content` fixtures.ts) into this local game before its first action; the error, or null. */
      loadFixture: (id: string) => {
        if (!session.applyActions) return 'Not a local game';
        if (session.actionCount > 0) return 'The game has already begun';
        try {
          return session.applyActions(fixtureActions(session.engine, session.state, id));
        } catch (e) {
          return (e as Error).message;
        }
      },
    };
  }

  /** What an empty action wheel tells the player to do instead. */
  const wheelEmptyHint = state.result
    ? 'The game is over.'
    : !decision
      ? undefined
      : resolving
        ? 'The last results are still being shown.'
        : !owner
          ? `Waiting for the ${sideName(decision.owner)}.`
          : decision.kind === 'phase'
            ? `When you are finished, ${endLabel} is in the top bar.`
            : 'Answer in the panel on the right.';

  // ------------------------------------------------------------------ render
  return (
    <div className={`game ${aside ? 'with-rail' : ''}`}>
      <div className="board-pane" ref={paneRef}>
        <BoardView
          state={shown}
          statics={statics}
          placements={placements}
          rotation={rotation}
          offboard={offboardShown}
          overlay={boardOverlay}
          onHexClick={onHexClick}
          onHexHover={onHexHover}
          onHexContextMenu={(hex, at) => {
            setPeek(null);
            setSelectedHex(hex);
            setWheel({ hex, at });
          }}
          onDropPiece={(hex, id) => placing && trayTodo.some((p) => p.id === id) && place(id, hex)}
          draggablePiece={(hex) => (placing ? placedAt(hex) : null)}
          onReturnPiece={(id) => pending[id] && unplace(id, false)}
          fx={fx.boardFx}
          animate={fxLevel !== 'off'}
          holdFace={fx.holdsFace}
          objectives={objectives}
          control={control}
          fortified={fortifiedShown}
          outOfPlay={outOfPlay}
          hidePieces={unitsHidden || peekTerrain}
          hideMarkers={markersHidden || peekBare}
          weather={weatherFx && fxLevel !== 'off' ? { kind: weatherFxKind(weather), windAngle } : null}
        />
        <ErrorBoundary what="the top bar" inline>
          <Hud
            length={gameTurns(env)}
            scenario={scenario}
            phases={phases}
            phase={phase}
            turn={state.turn}
            attacker={state.attacker}
            acting={decision?.owner}
            sideName={sideName}
            players={players}
            tally={tally}
            onTally={setLedger}
            pf={pfLeft}
            oba={Object.fromEntries(obaShown.map((o) => [o.side, o.missions]))}
            weather={weather}
            windAngle={windAngle}
            fx={fxLevel}
            onFx={setFxLevel}
            onSettings={() => setSettings(true)}
            onShortcuts={() => setShortcuts(true)}
            onCharts={() => setCharts((o) => !o)}
            onBriefing={() => setBriefing((o) => !o)}
            diceLog={diceLog}
            onToggleDiceLog={() => setDiceLog((o) => !o)}
            unitsHidden={unitsHidden || peekTerrain}
            onToggleUnits={() => setUnitsHidden((h) => !h)}
            markersHidden={markersHidden || peekBare}
            onToggleMarkers={() => setMarkersHidden((h) => !h)}
            onRotate={(dir) => setQuarterTurns((q) => q + dir)}
            tools={
              <HudTools
                game={{
                  ...(matchId ? { matchId } : {}),
                  scenarioId: scenario.id,
                  scenarioTitle: scenario.title,
                  turn: session.state.turn,
                  phase: session.state.phase,
                  actionCount: session.actionCount,
                  ...(session.mySide !== undefined ? { mySide: session.mySide } : {}),
                  ruleset: engine.ruleset.versionHash,
                }}
              />
            }
            endPhase={
              !owner
                ? null
                : decision?.kind === 'phase'
                ? { label: endLabel, blocked: endBlocked, onClick: endPhase, attention: !!yourCall }
                : canPass
                ? { label: passLabel, icon: '—', blocked: null, onClick: passFirstFire, hint: passHint, attention: true }
                : facingDone
                ? { label: 'Done turning', icon: '✓', blocked: null, onClick: facingDone, hint: 'Keep this facing and go back to Defensive First Fire' }
                : scatterUi.confirm ?? entryUi.confirm ?? turnsUi.confirm ?? lengthUi.confirm ?? stretchUi.confirm ?? confirmFortify ?? confirmSetup
            }
          />
        </ErrorBoundary>
        <CompassRose north={northAngle} onRotate={(dir) => setQuarterTurns((q) => q + dir)} />
        {rofChoiceUi.length > 0 && (
          <RofChoice
            choices={rofChoiceUi}
            onDecline={(sw) => run({ type: 'defRofDecline', sw })}
            onFire={(c) => declareFire(c.at, [c.sw], '')}
            onKeep={decision?.kind === 'rofResidual' ? passFirstFire : null}
          />
        )}
        {hoverHex && (
          <div className="hex-readout">
            <b>{hoverHex.replace(/^[a-z]/, '')}</b>
            {statics.map.hex(hoverHex)?.terrain ?? (statics.map.offboardHex(hoverHex) ? 'offboard' : '')}
            {statics.map.hex(hoverHex)?.features.length ? ` · ${statics.map.hex(hoverHex)!.features.join(', ')}` : ''}
            {control[hoverHex] && <span className={`ctl side-${control[hoverHex]}`}> · {sideName(control[hoverHex])} control</span>}
            {routHover && <span className={`rout-why ${routHover.barred ? 'barred' : 'end'}`}>{routHover.text}</span>}
            {moveHover && <span className="rout-why barred">{moveHover}</span>}
          </div>
        )}
        {peek && !unitsHidden && !peekTerrain && !wheel && !caFor && !ring && (
          <StackPeek
            env={shownEnv}
            hex={peek.hex}
            at={peek.at}
            bounds={{ w: paneRef.current?.clientWidth ?? 1e9, h: paneRef.current?.clientHeight ?? 1e9 }}
            placements={placements}
            rotation={rotation}
            interactive={{
              selected,
              selectable: (p) => p.side === owner,
              onToggle: togglePiece,
              onChitContextMenu: (p, at) => {
                hover.current.pinned = true;
                setChitWheel({ piece: p.id, at });
              },
              onEnter: cardEnter,
              onLeave: cardLeave,
            }}
          />
        )}
        {wheel && <ActionWheel at={wheel.at} title={wheel.title ?? wheel.hex.replace(/^[a-z]/, '')} items={wheel.items ?? wheelItems(wheel.hex)} onClose={() => setWheel(null)} emptyHint={wheelEmptyHint} />}
        {bypassPick && (
          <div className="bypass-confirm" role="dialog" aria-label="Confirm Bypass">
            <span>{bypassPick.text}</span>
            <button
              className="primary"
              onClick={() => {
                run(bypassPick.action, true);
                setBypassPick(null);
              }}
            >
              Bypass
            </button>
            <button onClick={() => setBypassPick(null)}>Cancel</button>
          </div>
        )}
        {pointPick && !wheel && (
          <div className="bypass-confirm" role="dialog" aria-label="Choose the point">
            <span>
              {short(pointPick.hexes[pointPick.i]!)}: trace the LOS to the hex centre or a numbered corner (ASLRB A4.34)
            </span>
            <button onClick={() => choosePoint(null)}>Hex centre</button>
            <button onClick={() => setPointPick(null)}>Cancel</button>
          </div>
        )}
        {chitWheel && state.pieces[chitWheel.piece] && (
          <ActionWheel at={chitWheel.at} title={pieceLabel(env, state.pieces[chitWheel.piece]).replace(/^\S+ /, '')} items={chitItems(state.pieces[chitWheel.piece]!)} onClose={closeChitWheel} emptyHint={wheelEmptyHint} />
        )}
        {diceLog ? <DiceLog toasts={fx.history} limit={DICE_LOG_LIMIT} onClose={() => setDiceLog(false)} /> : <DiceTray toasts={fx.toasts} />}
        <CloseCombat
          env={env}
          log={present.log}
          resolving={resolving}
          decision={decision ?? undefined}
          owner={owner}
          waitingOn={waitingOn}
          sideName={sideName}
          run={(a) => runRef.current(a)}
          check={session.check}
          plain={plain}
          animate={fxLevel !== 'off'}
          linger={slow ? CC_LINGER_SLOW : undefined}
          onShown={setCcShown}
          onLinger={setCcLingering}
        />
        {yourCall && owner && (
          <>
            <div className={`board-glow side-${owner}`} aria-hidden="true" />
            {callStrip && callHiddenIn !== phaseKey && (
              <YourCall
                side={owner}
                who={session.mySide === undefined ? sideName(owner) : null}
                title={yourCall.title}
                text={yourCall.text}
                action={
                  canPass
                    ? { label: passLabel, onClick: passFirstFire, hint: passHint }
                    : facingDone
                      ? { label: 'Done turning', onClick: facingDone, hint: 'Keep this facing and go back to Defensive First Fire' }
                      : decision?.kind === 'phase' && !endBlocked
                        ? { label: endLabel, onClick: endPhase, hint: 'Finish your rallies and hand the turn back' }
                        : null
                }
                onDismiss={() => setCallHiddenIn(phaseKey)}
              />
            )}
          </>
        )}
        {fx.callout && <CalloutBanner callout={fx.callout} />}
        {fx.wheel && <PhaseWheel key={fx.wheel.id} cue={fx.wheel} phases={phases} sideName={sideName} level={fxLevel} onDone={fx.dismissWheel} />}
        {result && !reviewing && !ccShown && !resolving && (
          <GameOver winner={result.winner} reason={result.reason === 'concession' && result.winner ? `The ${sideName(state.sides.find((x) => x !== result.winner)!)} concede` : result.reason === 'annihilation' && result.winner ? `The ${sideName(state.sides.find((x) => x !== result.winner)!)} have no units left` : result.reason === 'nothing left to play' ? 'Nothing left on the map can change the result' : result.reason} sideName={sideName} onLobby={onQuit} onReview={() => setReviewing(true)} aar={aar} />
        )}
        {settings && <SettingsPanel fx={fxLevel} onFx={setFxLevel} weatherFx={weatherFx} onWeatherFx={setWeatherFx} callStrip={callStrip} onCallStrip={setCallStrip} onClose={() => setSettings(false)} />}
        {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
        {charts && <ChartsDialog nationalities={scenario.sides.flatMap((s) => s.nationalities ?? [s.nationality])} onClose={() => setCharts(false)} />}
        {endAsk && (
          <Modal title={endAsk.title} kicker={PHASE_NAME[phase] ?? phase} onClose={() => setEndAsk(null)}>
            {endAsk.lines.map((l, i) => (
              <p key={i} className={endAsk.severe && i === 0 ? 'warn' : undefined}>
                {l}
              </p>
            ))}
            <ul className="end-ask-units">
              {endAsk.units.map((id) => {
                const p = state.pieces[id];
                const at = p?.loc.kind === 'hex' ? hexLabel(p.loc.hex) : p?.loc.kind === 'offboard' ? 'off board' : '';
                return (
                  <li key={id}>
                    {pieceLabel(env, p)}
                    {at && <span className="muted"> · {at}</span>}
                  </li>
                );
              })}
            </ul>
            <div className="buttons end">
              <button className="primary" autoFocus onClick={() => setEndAsk(null)}>
                Go back
              </button>
              <button className={endAsk.severe ? 'danger' : 'ghost'} onClick={() => { setEndAsk(null); run({ type: 'endPhase' }); }}>
                {endLabel} anyway
              </button>
            </div>
          </Modal>
        )}
        {briefing && <BriefingDialog scenario={scenario} onClose={() => setBriefing(false)} />}
        {ledger && <CasualtyLedger env={env} scenario={scenario} first={ledger} sideName={sideName} onClose={() => setLedger(null)} />}
      </div>

      {aside}

      <aside className={`side ${sideCollapsed ? 'collapsed' : ''}`}>
        <button className={`side-expand ${owner ? 'attention' : ''}`} onClick={() => setSideCollapsed(false)} title={owner ? 'Show the orders panel: the game waits on you' : 'Show the orders panel'} aria-label="Show the orders panel">
          <span aria-hidden="true">‹</span>
          <span className="side-expand-label">Orders</span>
        </button>
        <div className="side-head">
          <button className="ghost" onClick={onQuit}>← Lobby</button>
          <span className="spacer" />
          {session.mySide === undefined && (
            <button disabled={!session.canUndo} onClick={() => { session.undo(); reset(); }}>Undo</button>
          )}
          {session.askUndo && (
            <button disabled={!session.canUndo} onClick={session.askUndo} title="Ask your opponent to take back your last action">Undo</button>
          )}
          <button className="ghost side-collapse" onClick={() => setSideCollapsed(true)} title="Hide the orders panel to give the map more room" aria-label="Hide the orders panel">
            ›
          </button>
        </div>
        <VictoryPanel scenario={scenario} />

        {result ? (
          <section className="panel result">
            <h2>{result.winner ? `${sideName(result.winner)} win` : 'Draw'}</h2>
            <p className="hint">{result.reason}</p>
          </section>
        ) : resolving ? (
          <section className="panel decision resolving">
            <div className="who">Resolving</div>
            <h2>The dice are rolling</h2>
            <p className="hint">The board follows the rolls as they are revealed. Orders resume once the last one is shown.</p>
            <button className="ghost small" onClick={fx.skip} title="Show the outcome now (the rolls stay in the dice log)">Skip to the outcome ▸</button>
          </section>
        ) : waitingOn ? (
          <section className={`panel decision waiting side-${waitingOn}`}>
            <div className="who">{sideName(waitingOn)} — {session.mySide === null ? 'their orders' : 'waiting for their orders'}</div>
            <h2>{decisionTitle(decision!.kind, phase, fortOpen, decision!.data?.['ending'] === true && !banzaiState(env)?.dff)}</h2>
            {theirPlacing ? (
              <>
                <p className="hint">
                  <b>{Object.keys(theirDraft).length}/{theirTodo.length}</b> placed so far. Their counters appear as they put them down, faded until they confirm.
                </p>
                <div className="composer">
                  <SetupTray
                    env={env}
                    readOnly
                    title="Their units to place"
                    hint="What they still have to put down. A counter they have placed is dimmed and shows its hex."
                    todo={theirTray}
                    groups={theirTrayGroups}
                    pending={theirTrayPending}
                    picked={null}
                    onPick={() => {}}
                    onUnplace={() => {}}
                  />
                </div>
              </>
            ) : (
              <p className="hint">{session.mySide === null ? 'You are watching this match.' : 'The board updates as soon as they act.'}</p>
            )}
          </section>
        ) : (
          decision && (
            <section className={`panel decision side-${decision.owner}`}>
              <div className="who">{sideName(decision.owner)} — your orders</div>
              <h2>{decisionTitle(decision.kind, phase, fortOpen, decision.data?.['ending'] === true && !banzaiState(env)?.dff)}</h2>
              {error && <div className="error">{error}</div>}

              {scatterUi.panel}
              {entryUi.panel}
              {turnsUi.panel}
              {lengthUi.panel}
              {stretchUi.panel}
              {banzaiDraft && decision.kind === 'phase' && phase === 'MPh' && (() => {
                const err = banzaiDraft.target ? plain(banzaiIllegal(env, owner!, banzaiDraft.leader, banzaiDraft.target, banzaiDraft.units)) : 'Click the enemy hex the charge goes for';
                const candidates = Object.values(state.pieces)
                  .filter((p) => p.side === owner && p.loc.kind === 'hex' && isJapanese(env, p) && !isWeaponDef(defOf(env, p)) && !isVehiclePiece(p.id) && p.tags['broken'] !== true && p.tags['pinned'] !== true && p.tags['moved'] === undefined && p.tags['banzai'] === undefined)
                  .sort((a, b) => (a.id < b.id ? -1 : 1));
                const toggle = (id: PieceId) => setBanzaiDraft({ ...banzaiDraft, units: banzaiDraft.units.includes(id) ? banzaiDraft.units.filter((u) => u !== id) : [...banzaiDraft.units, id] });
                return (
                  <div className="composer">
                    <h3>Banzai Charge</h3>
                    <p className="hint">
                      {pieceLabel(env, state.pieces[banzaiDraft.leader])} leads. Target: {banzaiDraft.target ? hexLabel(banzaiDraft.target) : 'click an enemy hex on the map'}. Tick the units that charge: a chain of adjacent, Good Order, unmoved Japanese Infantry (SK4 8.1.8.6).
                    </p>
                    <ul className="pieces">
                      {candidates.map((p) => (
                        <li key={p.id} className="piece">
                          <label>
                            <input type="checkbox" checked={banzaiDraft.units.includes(p.id)} disabled={p.id === banzaiDraft.leader} onChange={() => toggle(p.id)} />
                            {pieceLabel(env, p)} <span className="muted small">{p.loc.kind === 'hex' ? hexLabel(p.loc.hex) : ''}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {err && <p className="hint">{err}</p>}
                    <div className="buttons">
                      <button className="ghost" onClick={() => setBanzaiDraft(null)}>
                        Cancel
                      </button>
                      <button className="primary" disabled={!!err} onClick={() => { const d = banzaiDraft; setBanzaiDraft(null); run({ type: 'banzai.declare', leader: d.leader, target: d.target!, units: d.units }, true); }}>
                        Banzai!
                      </button>
                    </div>
                  </div>
                );
              })()}
              {(() => {
                const bz = banzaiState(env);
                if (!bz || decision.kind !== 'phase' || phase !== 'MPh' || owner !== bz.side) return null;
                const stepper = banzaiUnit && bz.units.includes(banzaiUnit) && !bz.moved.includes(banzaiUnit) ? banzaiUnit : bz.units.find((u) => !bz.moved.includes(u) && banzaiSteps(env, u).length > 0);
                return (
                  <div className="composer">
                    <h3>Banzai Charge — Impulse {bz.impulse}</h3>
                    <p className="hint">
                      Target {hexLabel(bz.target)}. Every unit moves one hex this Impulse (toward the target, into an enemy hex no farther from it, or next to it); then the enemy may fire at each Banzai hex. Click a green hex to move {stepper ? pieceLabel(env, state.pieces[stepper]) : 'the next unit'}, or a Banzai hex to pick another unit.
                    </p>
                    <ul className="pieces">
                      {bz.units.map((u) => {
                        const p = state.pieces[u];
                        if (!p) return null;
                        const moved = bz.moved.includes(u);
                        const endErr = plain(session.check({ type: 'banzai.end', unit: u }));
                        return (
                          <li key={u} className={`piece ${u === stepper ? 'sel' : ''}`}>
                            <label>
                              <input type="radio" name="banzai-unit" checked={u === stepper} disabled={moved} onChange={() => setBanzaiUnit(u)} />
                              {pieceLabel(env, p)} <span className="muted small">{p.loc.kind === 'hex' ? hexLabel(p.loc.hex) : ''} · {bz.spent[u] ?? 0}/{bz.allowance[u] ?? 0} MF{moved ? ' · moved' : ''}</span>
                            </label>
                            {!moved && !endErr && (
                              <button className="ghost small" onClick={() => run({ type: 'banzai.end', unit: u }, true)} title="End this unit's charge next to the target (SK4 8.1.8.6)">
                                End charge here
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })()}
              {decision.kind === ONCE_DR_DECISION &&
                (() => {
                  // A card's once-per-game dr at the start of a phase (S64 SSR 2, 3): make it now, or keep it for a later turn.
                  const index = decision.data?.['index'] as number;
                  const r = scenario.ssr[index];
                  const q = onceDrRules(env).find((x) => x.index === index)?.q;
                  return (
                    <div className="composer">
                      <p className="hint">
                        <b>{q?.rule ?? 'SSR'}</b>: {r?.text}
                      </p>
                      <p className="hint">
                        Game Turn {state.turn}: the dr must be &lt; {state.turn}. It may be made once per game; not making it now keeps it for a later turn.
                      </p>
                      <div className="buttons">
                        <button className="ghost" onClick={() => run({ type: 'onceDr.skip', index })}>
                          Not this turn
                        </button>
                        <button className="primary" onClick={() => run({ type: 'onceDr.roll', index })}>
                          Make the dr
                        </button>
                      </div>
                    </div>
                  );
                })()}
              {decision.kind === LEADER_PTC_DECISION && (
                // A leader's PTC as the side's first action in its RPh (S68 SSR 3).
                <div className="composer">
                  <p className="hint">{scenario.ssr[decision.data?.['index'] as number]?.text}</p>
                  <p className="hint">
                    {pieceLabel(env, state.pieces[decision.data?.['unit'] as string])}: 2d6 +1 against his morale; above it he is pinned for this Player Turn.
                  </p>
                  <div className="buttons">
                    <button className="primary" onClick={() => run({ type: 'leaderPtc.take' })}>
                      Take the 1PTC
                    </button>
                  </div>
                </div>
              )}
              {decision.kind === CONCEAL_RTPH_DECISION && (
                <div className="composer">
                  <p className="hint">
                    Before the enemy rout step: {concealRtphUnits(decision).map((id) => pieceLabel(env, state.pieces[id])).join(', ')} {concealRtphUnits(decision).length === 1 ? 'sees' : 'see'} a broken enemy unit. A concealed unit is ignored in the Rout Phase (SK4 8.3.4): drop the "?" now to be a Known Enemy Unit (DM, forced routs, Interdiction), or keep it.
                  </p>
                  <div className="buttons">
                    <button className="ghost" onClick={() => run({ type: 'conceal.keep' })}>
                      Keep concealment
                    </button>
                    <button className="primary" onClick={() => run({ type: 'conceal.drop', units: concealRtphUnits(decision) })}>
                      Drop the "?"
                    </button>
                  </div>
                </div>
              )}
              {fortifying && (
                <div className="composer fortify">
                  <p className="hint">
                    {scenario.ssr.find((r) => r.module === 'fortified-buildings')?.text}
                  </p>
                  <p className="hint">
                    Click up to <b>{fortMax}</b> green building{fortMax === 1 ? '' : 's'} to fortify {fortMax === 1 ? 'it' : 'them'} (click again to undo), then <b>{confirmFortify?.label}</b> in the top bar.{fortOpen ? ' The card names the choice: the other side sees it.' : ' The choice stays secret until it matters.'}
                  </p>
                  <ul className="setup-rules small">
                    {fortPicks.map((b) => (
                      <li key={b}>
                        Fortified: building {buildingLabel(b)}{' '}
                        <button className="ghost small" title="Undo" onClick={() => setFortPicks(fortPicks.filter((x) => x !== b))}>
                          ×
                        </button>
                      </li>
                    ))}
                    {fortPicks.length === 0 && <li className="muted">No building chosen yet</li>}
                  </ul>
                </div>
              )}

              {placing && (
                <div className="composer">
                  <SetupTray
                    env={env}
                    title="Units to place"
                    hint={
                      placing.kind === 'setup'
                        ? `Drag each counter onto a green hex, or click it and then a hex. A weapon goes in a hex with a unit of its group, which then carries it (a leader alone will). Drag placed counters to move them, or back here to return them.${gunTodo.length ? ' A Gun goes with a crew; once it is down, click a segment of the ring around its hex to set its Covered Arc (or right-click its hex).' : ''}`
                        : `Set up everything entering this turn in the offboard hexes along its entry edge (green). They enter from there in the Movement Phase, into the map hexes the card allows (blue where it names them). A weapon goes in a hex with a unit of its group, which then carries it.${
                            reserve
                              ? ` ${reserve.label ? `${reserve.label}: ` : ''}up to ${reserve.mmc} MMC, ${reserve.smc} SMC and ${reserve.sw} SW may be left here unplaced; they enter on Turn ${reserve.turn} along the ${reserve.edges.map((e) => EDGE_NAME[e] ?? e).join(' or ')} edge.`
                              : ''
                          }`
                    }
                    todo={trayTodo}
                    groups={trayGroups}
                    pending={trayPending}
                    picked={picked}
                    onPick={setPicked}
                    note={(id) => (swAssign[id] ? `with ${pieceLabel(env, state.pieces[swAssign[id]!]).replace(/^\S+ /, '')}` : null)}
                    onUnplace={(id) => unplace(id, false)}
                  />
                  <SetupRules env={env} todo={todo} rulesShownInTray={!!trayGroups} anchors={anchors} />
                  {(deployRule || deployableSquads(env, placing.owner).length > 0) && (placing.kind === 'setup' || placing.kind === 'offboardSetup') && (
                    <div className="setup-deploy">
                      <p className="hint">
                        {deployRule ? (
                          <>
                            {deployRule.rule ?? 'SSR'}: you may split up to <b>{deployRule.squads}</b> squads into two half-squads each while setting up ({squadsDeployed(env, placing.owner)} of {deployRule.squads} split). A squad keeps its hex and weapons in its first half; the second joins the tray. Undo takes a split back.
                          </>
                        ) : (
                          <>SK4 8.4: a Good Order U.S. Marine Corps 7-6-8 may deploy into two 3-4-8 half-squads as it sets up. The squad keeps its hex and weapons in its first half; the second joins the tray. Undo takes a split back.</>
                        )}
                      </p>
                      {deployableSquads(env, placing.owner).length > 0 && (
                        <ul className="setup-rules small">
                          {deployableSquads(env, placing.owner).map((p) => (
                            <li key={p.id}>
                              {pieceLabel(env, p)}
                              {pending[p.id] ? ` in ${hexLabel(pending[p.id]!)}` : ''}{' '}
                              <button className="ghost small" onClick={() => run({ type: 'setup.deploy', unit: p.id }, true)} title="Replace this squad with two half-squads">
                                split into 2 HS
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  {setupError && Object.keys(pending).length === todo.length && <div className="error">{setupError}</div>}
                  {caFor && facingHexOf(caFor) && (
                    <p className="hint">
                      Facing <b>{pieceLabel(env, state.pieces[caFor])}</b> in {hexLabel(facingHexOf(caFor)!)}: click a segment of the ring around its hex to point its Covered Arc along that hexspine (point at one to preview the arc). <a onClick={() => setCaFor(null)}>Later</a>
                    </p>
                  )}
                  {vehicleTodo.filter((v) => pending[v.id]).length > 0 && (
                    <ul className="setup-rules small">
                      {vehicleTodo.filter((v) => pending[v.id]).map((v) => (
                        <li key={v.id}>
                          {pieceLabel(env, v)} in {hexLabel(pending[v.id]!)}: faces {spineLabel(env, pending[v.id]!, pendingCa[v.id] ?? defaultVca(env, pending[v.id]!))}
                          {pendingCe.has(v.id) ? ' · CE' : ' · BU'}
                          {(pendingDugIn.has(v.id) && canDigIn(v.id)) || digInRule?.defs?.includes(v.defId) ? ' · dug in' : ''}{' '}
                          <button className="ghost small" onClick={() => setCaFor(v.id)}>face…</button>{' '}
                          <button className="ghost small" onClick={() => toggleCe(v.id)}>{pendingCe.has(v.id) ? 'make BU' : 'make CE'}</button>
                          {canDigIn(v.id) && (
                            <>
                              {' '}
                              <button className="ghost small" onClick={() => toggleDugIn(v.id)}>{pendingDugIn.has(v.id) ? 'not dug in' : 'dig in'}</button>
                            </>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {gunTodo.filter((g) => swAssign[g.id]).length > 0 && (
                    <ul className="setup-rules small">
                      {gunTodo.filter((g) => swAssign[g.id]).map((g) => (
                        <li key={g.id}>
                          {pieceLabel(env, g)} in {hexLabel(swHexes[g.id]!)}: {pendingCa[g.id] !== undefined ? `Covered Arc ${spineLabel(env, swHexes[g.id]!, pendingCa[g.id]!)}` : <span className="must">needs a Covered Arc</span>}
                          {pendingHip.has(g.id) ? ' · hidden (HIP)' : ''}{' '}
                          <button className="ghost small" onClick={() => setCaFor(g.id)}>face…</button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {hiddenRule && placing.owner === hiddenRule.side && !!hiddenRule.forces?.length && (
                    <p className="hint">
                      {hiddenRule.rule ?? 'SSR'}: {hiddenRule.forces
                        .map((id) => (env.statics as Statics).scenario.forces.find((f) => f.id === id)?.group ?? id)
                        .filter((g, i, all) => all.indexOf(g) === i)
                        .join(', ')}{' '}
                      set up hidden{hiddenRule.inConcealmentTerrain ? ' wherever they are placed in Concealment Terrain (jungle, bamboo, kunai, palm trees, huts), openly elsewhere' : ''}: the engine keeps them and their weapons off the enemy’s map until they fire or move, or an enemy unit enters or tries to enter their hex (or sees them in Open Ground).
                      {hiddenByRule.length > 0 && (
                        <>
                          {' '}Hidden: <b>{hiddenByRule.map((id) => `${pieceLabel(env, state.pieces[id])} (${hexLabel(pending[id]!)})`).join(', ')}</b>.
                        </>
                      )}
                    </p>
                  )}
                  {hiddenRule && placing.owner === hiddenRule.side && !hiddenRule.forces?.length && (
                    <p className="hint">
                      {hiddenRule.rule ?? 'SSR'}: right-click a stack{hiddenRule.notOpenGround ? ' outside Open Ground' : ''} and choose <b>Set up hidden</b> to keep it and its weapons off the map until it fires or moves or an enemy unit finds it.
                      {hiddenField.length > 0 && (
                        <>
                          {' '}Hidden: <b>{hiddenField.map((id) => `${pieceLabel(env, state.pieces[id])} (${hexLabel(pending[id]!)})`).join(', ')}</b>.
                        </>
                      )}
                    </p>
                  )}
                  <p className="hint wheel-hint">
                    <b>{Object.keys(pending).length}/{todo.length}</b> placed · <b>Confirm setup</b> in the top bar once all are down{reserve ? ' (or the rest are kept in reserve)' : ''}, or right-click the map to confirm or auto-place the rest.
                  </p>
                </div>
              )}

              {decision.kind === 'firstFire' && (
                <div className="first-fire">
                  <p className="hint">
                    {banzaiState(env)?.dff
                      ? <>Banzai Impulse over: you may fire at any of the Banzai units (SK4 8.1.8.6), one hex at a time. Now {hexLabel(String(decision.data?.['hex'] ?? ''))}{banzaiWindowsPending(env).length ? <>; to fire at {banzaiWindowsPending(env).map(hexLabel).join(', ')} first, declare your firers and right-click that hex</> : null}. Pass when done here.</>
                      : decision.data?.['ending']
                      ? <>Enemy units have stopped in {hexLabel(String(decision.data?.['hex'] ?? ''))} with movement left: your last chance to fire at them there before another unit moves (SK1 3.3.1). Select your firers (shift-click hexes, tick units), then right-click the stack: <b>Fire!</b> Or pass.</>
                      : <>Enemy units are moving in {hexLabel(String(decision.data?.['hex'] ?? ''))}. Select your firers (shift-click hexes, tick units), then right-click the moving stack: <b>Fire!</b> Or pass and let them move on.</>}
                  </p>
                  {motionAttempts.length > 0 && (
                    <p className="hint">
                      Or a vehicle may try for Motion instead of firing (SK4 3.3.2.1): dr ≤ the MP the mover has spent in its LOS puts it in Motion and lets it change its facing.
                    </p>
                  )}
                  {motionAttempts.map((m) => (
                    <button key={m.vehicle} className="pass-btn" onClick={() => run({ type: 'defMotion', vehicle: m.vehicle })} title={m.hint}>
                      Motion attempt: {m.label} <span aria-hidden="true">➜</span> dr ≤ {m.mp}
                    </button>
                  ))}
                  {rofChoiceUi.length > 0 && (
                    <p className="hint">
                      {rofChoiceUi.map((c) => c.label).join(', ')} kept ROF: fire it again (it stays unmarked), or give the ROF up to leave the attack's Residual FP in {hexLabel(rofChoiceUi[0]!.target)} instead (SK1 3.3.1). Passing keeps it.
                    </p>
                  )}
                  <button className="pass-btn" onClick={passFirstFire} title={passHint}>
                    Pass <span aria-hidden="true">—</span>
                  </button>
                </div>
              )}

              {decision.kind === 'rofResidual' && (
                <div className="first-fire">
                  <p className="hint">
                    {rofChoiceUi.length ? rofChoiceUi.map((c) => c.label).join(', ') : 'Your weapon'} kept its Rate of Fire and there is nothing more to fire at in {hexLabel(String(decision.data?.['hex'] ?? ''))}. Keep the ROF (the weapon stays unmarked and may fire again this phase), or give it up to leave the attack's Residual FP there for the next unit that enters (SK1 3.3.1).
                  </p>
                  <button className="pass-btn" onClick={passFirstFire} title={passHint}>
                    Keep ROF <span aria-hidden="true">—</span>
                  </button>
                </div>
              )}

              {decision.kind === 'motionFacing' && turnable && (
                <div className="first-fire">
                  <p className="hint wheel-hint">
                    {pieceLabel(env, turnable.v)} is in Motion and may now point its hull and turret any way it likes (SK4 3.3.2.1): right-click it to pick a hexspine for each, or use Q/E for the hull and A/D for the turret. {turnable.hullHint.includes('Bog') ? 'In woods or a building the first hull turn takes a Bog Check.' : ''}
                  </p>
                  <button className="pass-btn" onClick={facingDone ?? undefined} title="Keep this facing and go back to Defensive First Fire">
                    Done turning <span aria-hidden="true">✓</span>
                  </button>
                </div>
              )}

              {(isFireDecision || (phase === 'MPh' && !!ms?.vehicle)) && gunShot && (
                <GunComposer
                  gunLabel={pieceLabel(env, state.pieces[gunShot.gun])}
                  mannedBy={state.pieces[gunShot.gun]?.loc.kind === 'held' ? pieceLabel(env, state.pieces[(state.pieces[gunShot.gun]!.loc as { by: PieceId }).by]) : null}
                  targetType={gunShot.targetType}
                  {...gunAmmoInfo(gunShot)}
                  intensive={gunShot.intensive}
                  light={!!(state.pieces[gunShot.gun] && ordnanceOf(env, state.pieces[gunShot.gun]!)?.light)}
                  chOnOriginal2={!!(state.pieces[gunShot.gun] && ordnanceOf(env, state.pieces[gunShot.gun]!)?.latw)}
                  target={target ? hexLabel(target) : null}
                  preview={gunPreview}
                  onCancel={() => { setDeclared(false); setTarget(null); setGunShot(null); setSelected(new Set()); }}
                  {...(gunShot.targetType === 'ATT' && target ? { onFire: () => fireGunAt(target) } : {})}
                  leaders={gunLeaders}
                  {...(gunShot.director ? { director: gunShot.director } : {})}
                  onDirector={(id) => {
                    const { director: _was, ...rest } = gunShot;
                    setGunShot(id ? { ...rest, director: id } : rest);
                  }}
                />
              )}
              {isFireDecision && pfShot && owner && (() => {
                const pfMode = decision.kind === 'firstFire' ? 'first' : FIRE_MODE[phase]!;
                const { drm, notes } = pfCheckDrm(env, pfShot.unit, pfShot.targetType === 'VTT');
                const cap = pfCap(env, owner) ?? 0;
                const left = Math.max(0, cap - pfUsed(env, owner));
                const max = pfMaxRange(env);
                const atHex = target ?? (decision.kind === 'firstFire' ? ms?.hex ?? null : null);
                const why = atHex ? plain(pfIllegal(env, owner, { ...pfShot, target: atHex }, pfMode, decision.kind === 'firstFire' ? ms?.units : undefined)) : null;
                const loc = state.pieces[pfShot.unit]?.loc;
                const inBuilding = loc?.kind === 'hex' && !!statics.map.hex(loc.hex)?.buildingId;
                return (
                  <div className="composer pf-composer">
                    <div className="row">
                      <span>Panzerfaust</span>
                      <b>{pieceLabel(env, state.pieces[pfShot.unit])}</b>
                    </div>
                    <div className="row">
                      <span>Aiming at</span>
                      <b>{pfShot.targetType === 'VTT' ? 'a vehicle (HEAT To Kill 31)' : 'Infantry in a building or a Gun (16 FP on one unit)'}</b>
                    </div>
                    {inBuilding && (
                      <div className="row">
                        <span>From the building</span>
                        <b>{pfShot.backblast ? 'Backblast on the hex (1 FP, colored dr)' : '+2 To Hit, no Backblast'}</b>
                      </div>
                    )}
                    <div className="row">
                      <span>PF check</span>
                      <b>
                        dr{drm ? ` ${drm > 0 ? '+' : ''}${drm}` : ''} ≤ 3
                      </b>
                    </div>
                    {notes.length > 0 && <div className="muted small">{notes.join(' · ')}</div>}
                    <div className="row">
                      <span>To Hit</span>
                      <b>{[10, 8, 6, 4].slice(0, max + 1).map((th, r) => `${th} at ${r}`).join(' · ')}</b>
                    </div>
                    <DirectorPicker
                      leaders={(() => {
                        const at = loc?.kind === 'hex' ? loc.hex : null;
                        if (!at) return [];
                        return personnelAt(env, at, owner)
                          .filter((p) => defOf(env, p).kind === 'leader')
                          .map((l) => ({ id: l.id, label: pieceLabel(env, l).replace(/^\S+ /, ''), why: plain(swDirectorIllegal(env, l.id, owner, at, pfShot.unit)) }));
                      })()}
                      {...(pfShot.director ? { director: pfShot.director } : {})}
                      onDirector={(id) => {
                        const { director: _was, ...rest } = pfShot;
                        setPfShot(id ? { ...rest, director: id } : rest);
                      }}
                    />
                    <div className="row">
                      <span>Shots left</span>
                      <b>
                        {left} of {cap}
                      </b>
                    </div>
                    {atHex && (
                      <div className="row">
                        <span>Target</span>
                        <b>{hexLabel(atHex)}</b>
                      </div>
                    )}
                    {why && <div className="error">{why}</div>}
                    <p className="hint wheel-hint">
                      Right-click {decision.kind === 'firstFire' ? 'the moving stack' : 'the target hex'} and choose <b>Fire Panzerfaust at this hex</b>. The check comes first: ≥ 4 finds no PF (the unit has not fired and no shot is used), an original 6 pins it.
                    </p>
                    <button className="pass-btn" onClick={() => { setPfShot(null); setDeclared(false); setTarget(null); setSelected(new Set()); }}>
                      Cancel Panzerfaust <span aria-hidden="true">✕</span>
                    </button>
                  </div>
                );
              })()}
              {isFireDecision && !gunShot && !pfShot && (
                <div className="composer">
                  {declared ? (
                    <>
                      <div className="row">
                        <span>Firing</span>
                        <b>{[...selected].map((id) => pieceLabel(env, state.pieces[id])).join(', ')}</b>
                      </div>
                      <div className="row">
                        <span>Directed by</span>
                        <b>{directors.length ? directors.map((d) => pieceLabel(env, state.pieces[d])).join(', ') : 'no leader'}</b>
                      </div>
                    </>
                  ) : null}
                  {target && (
                    <div className="row">
                      <span>Target</span>
                      <b>{hexLabel(target)}</b>
                    </div>
                  )}
                  {firePreview && (
                    <div className="preview">
                      <div className="big">
                        {firePreview.fp} FP → <b>{firePreview.column ?? '—'}</b> col · DRM {firePreview.drm >= 0 ? '+' : ''}
                        {firePreview.drm}
                      </div>
                      {firePreview.parts.length > 0 && <div className="muted">{firePreview.parts.join(' · ')}</div>}
                      {'leftOut' in firePreview && firePreview.leftOut?.map((l) => <div key={l} className="muted">{l}</div>)}
                      {firePreview.illegal && <div className="error">{firePreview.illegal}</div>}
                    </div>
                  )}
                  <p className="hint wheel-hint">
                    {declared ? (
                      <>Marked and ready: click {decision.kind === 'firstFire' ? 'the moving stack' : 'the enemy hex'} to shoot. Right-click another of your stacks to add it to the fire group (naming its leader if the fire is directed), or the firing stack to cancel.</>
                    ) : (
                      <>Right-click your stack and choose <b>Fire</b> (directed by a leader if you like), or <b>Fire gun…</b> for a Gun. Untick units in the stack card first to fire with only some of them.{decision.kind === 'firstFire' ? ' Or Pass (top bar or P).' : ''}</>
                    )}
                  </p>
                </div>
              )}

              {decision.kind === 'phase' && phase === 'MPh' && (
                <div className="composer">
                  {!ms ? (
                    <p className="hint wheel-hint">
                      Right-click a stack and choose <b>Move</b>, or <b>Move as…</b> Double Time (CX) or Assault Movement. Tick units in the stack card to move only some of them. Then click the green hexes.{owner && exitHexes(env, owner)?.size ? ' Units leave the map from the violet hexes: move a stack onto one, then click the green hex beyond the map edge to exit the whole stack.' : ''}
                    </p>
                  ) : ms.vehicle ? (
                    <>
                      <div className="row">
                        <span>Moving</span>
                        <b>{pieceLabel(env, state.pieces[ms.units[0]!])}</b>
                      </div>
                      <div className="row">
                        <span>MP left</span>
                        <b>{mfLeft(ms.units[0]!)} of {ms.allowance[ms.units[0]!]}{ms.spent[ms.units[0]!]! > 0 ? ` · ${ms.spent[ms.units[0]!]} spent` : ''}</b>
                      </div>
                      <div className="row">
                        <span>Status</span>
                        <b>
                          {ms.vehicle.stopped ? 'stopped' : ms.vehicle.started ? 'moving' : 'not started'}
                          {state.pieces[ms.units[0]!]!.tags['ce'] ? ' · CE' : ' · BU'}
                          {ms.hex ? ` · VCA ${spineLabel(env, ms.hex, Number(state.pieces[ms.units[0]!]!.tags['vca'] ?? 0))}` : ''}
                          {ms.hex && vehicleDef(env, state.pieces[ms.units[0]!]!)!.turret !== 'NT' && state.pieces[ms.units[0]!]!.tags['ca'] !== state.pieces[ms.units[0]!]!.tags['vca'] ? ` · turret ${spineLabel(env, ms.hex, Number(state.pieces[ms.units[0]!]!.tags['ca']))}` : ''}
                        </b>
                      </div>
                      {ms.vehicle.stopped && owner && decision.owner === owner && !plain(session.check({ type: 'vmove.delay', mp: 1 })) && (() => {
                        // Delay any number of MP in one go (SK4 3.3.2): quick picks, or a typed amount.
                        const left = mfLeft(ms.units[0]!);
                        const typed = Number(delayMp);
                        const ok = Number.isInteger(typed) && typed >= 1 && typed <= left;
                        const go = (mp: number) => {
                          if (!run({ type: 'vmove.delay', mp }, true)) setDelayMp('');
                        };
                        return (
                          <div className="row">
                            <span>Delay</span>
                            <span className="delay-ctl" title="Spend MP standing still: one Defensive First Fire chance for the whole Delay; the MP count toward the Bounding First Fire DRM">
                              {[1, 2, 5, 10].filter((n) => n < left).map((n) => (
                                <button key={n} onClick={() => go(n)}>{n}</button>
                              ))}
                              <button onClick={() => go(left)} title="Delay the rest of the MP here">all {left}</button>
                              <input type="number" min={1} max={left} placeholder="MP" value={delayMp} onChange={(e) => setDelayMp(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && ok) go(typed); }} />
                              <button disabled={!ok} onClick={() => go(typed)}>Go</button>
                            </span>
                          </div>
                        );
                      })()}
                      {mode === 'bffMg' ? (
                        <p className="hint">
                          Bounding First Fire with the MGs: click the target hex. <a onClick={() => { setMode('normal'); setBffMgs([]); }}>Cancel</a>
                        </p>
                      ) : (
                        <p className="hint wheel-hint">
                          Click a green hex ahead to drive on (within the Vehicle Covered Arc). The <b>HULL</b> handles beside the vehicle turn the hull (1 MP per hexspine) and the <b>TURRET</b> ones the turret (free); or click a neighbouring hex outside the arc to turn the hull that way, or press <b>Q</b>/<b>E</b> and <b>A</b>/<b>D</b>. Right-click the vehicle to <b>stop</b>, go <b>CE/BU</b>, fire <b>Bounding First Fire</b> or <b>end the move</b>. Stopped, it may <b>Delay</b> any number of MP in one go (<b>S</b> for 1 MP, or the Delay row above); a vehicle that never stops ends in Motion (SK4 3.3.2).
                        </p>
                      )}
                    </>
                  ) : (
                    <>
                      <div className="row">
                        <span>Moving</span>
                        <b>{ms.units.map((u) => pieceLabel(env, state.pieces[u])).join(', ')}</b>
                      </div>
                      {(ms.assault || ms.doubleTime) && (
                        <div className="row">
                          <span>Mode</span>
                          <b title={ms.assault ? 'SK1 3.3: one hex at most, and the move may not take all of a unit\'s MF; no FFNAM against it' : 'SK1 3.3: +2 MF; the units are CX from the start of the move'}>
                            {ms.assault ? 'Assault Movement (1 hex, 1 MF kept)' : 'Double Time (+2 MF, CX)'}
                          </b>
                        </div>
                      )}
                      <div className="row">
                        <span>MF left</span>
                        <b>
                          {ms.units.length === 1
                            ? mfLeft(ms.units[0]!)
                            : ms.units.map((u) => `${pieceLabel(env, state.pieces[u])}: ${mfLeft(u)}`).join(' · ')}
                          {roadBonusEarned(ms) ? ' (+1 for a road step: every hexside so far is a road, SK1 1.1.1)' : ''}
                        </b>
                      </div>
                      {(() => {
                        // Smoke grenades: one attempt per unit per MPh (SK1 3.3), whatever came of it.
                        const smokers = ms.units.filter((u) => state.pieces[u] && env.query('unit.smoke', { unit: u }, 0) > 0);
                        if (!smokers.length) return null;
                        const tried = smokers.filter((u) => ms.smokeTriedBy?.includes(u));
                        const name = (u: PieceId) => pieceLabel(env, state.pieces[u]).replace(/^\S+ /, '');
                        return (
                          <div className="row">
                            <span>Smoke</span>
                            <b>
                              {tried.length === 0
                                ? 'not tried yet'
                                : tried.length === smokers.length
                                  ? `tried (once per unit per MPh)`
                                  : `tried by ${tried.map(name).join(', ')}; ${smokers.filter((u) => !tried.includes(u)).map(name).join(', ')} may still try`}
                            </b>
                          </div>
                        );
                      })()}
                      {ms.hex && isWoodsRoad(env, ms.hex) && (
                        <div className="row">
                          <span>Woods-Road</span>
                          <b>{ms.viaRoad ? 'On the road: no Woods TEM and -1 FFMO vs a firer not seeing it through the trees' : 'In the woods: +1 Woods TEM'}</b>
                        </div>
                      )}
                      {ms.hex && isOrchardRoad(env, ms.hex) && (
                        <div className="row">
                          <span>Orchard-Road</span>
                          <b>{ms.viaRoad ? 'On the road: -1 FFMO vs a firer whose LOS stays on the road' : 'In the orchard: no FFMO, no road bonus'}</b>
                        </div>
                      )}
                      {ms.bypass &&
                        (() => {
                          const b = ms.bypass;
                          const n = b.sides.length;
                          const cost = n > 2 ? 2 * b.base : b.base;
                          const exits = legal.filter((a) => a.type === 'move.step' && !a['bypass'] && a['to'] !== b.hex).map((a) => short(a['to'] as string));
                          const enter = env.query('move.stepCost', { ms, to: b.hex }, 0);
                          return (
                            <>
                              <div className="row bypass-row">
                                <span>Bypass</span>
                                <b>
                                  {short(b.hex)} · {b.sides.map((k) => `${short(b.hex)}-${short(acrossSideOf(b.hex, k))}`).join(', ')} ({n} hexside{n > 1 ? 's' : ''}) · {cost} MF
                                </b>
                              </div>
                              <div className="row bypass-row">
                                <span>Next in {short(b.hex)}</span>
                                <b>
                                  {n === 1
                                    ? 'a 2nd hexside costs nothing more'
                                    : n === 2
                                      ? `a 3rd hexside doubles ${short(b.hex)}'s Bypass to ${2 * b.base} MF: +${b.base} MF (ASLRB A4.31)`
                                      : 'further hexsides cost nothing more (the doubling is paid)'}
                                </b>
                              </div>
                              <div className="row bypass-row">
                                <span>Must leave</span>
                                <b>
                                  may not end its move in Bypass (ASLRB A4.32): enter {short(b.hex)} ({enter} MF){exits.length ? ` or step to ${exits.join(' or ')}` : ''}
                                </b>
                              </div>
                            </>
                          );
                        })()}
                      {stuck && (
                        <div className="stuck">
                          <span className="muted">
                            {stuck.spent.map((u) => pieceLabel(env, state.pieces[u])).join(', ')} {stuck.spent.length > 1 ? 'have' : 'has'} no MF left for any hex from here.
                          </span>
                          <button onClick={() => run({ type: 'move.stopUnits', units: stuck.spent })}>
                            Leave {stuck.spent.length > 1 ? 'them' : 'it'} here, go on with {stuck.rest.map((u) => pieceLabel(env, state.pieces[u])).join(', ')}
                          </button>
                        </div>
                      )}
                      {(() => {
                        // Leaving the map: one button per unit that may step off here; on an exit hex it may not, why.
                        const exits = legal.filter((a) => a.type === 'move.exit' && ms.units.includes(a['unit'] as string));
                        if (exits.length)
                          return (
                            <div className="row">
                              <span>Exit the map</span>
                              <span className="delay-ctl">
                                {exits.map((a) => (
                                  <button key={a['unit'] as string} onClick={() => run(a)} title="Leave the map here (costs the MF of entering the offboard hex)">
                                    {pieceLabel(env, state.pieces[a['unit'] as string])}
                                  </button>
                                ))}
                              </span>
                            </div>
                          );
                        const err = ms.hex && owner && exitHexes(env, owner)?.has(ms.hex) ? plain(session.check({ type: 'move.exit', unit: ms.units[0]! })) : null;
                        return err ? (
                          <div className="row">
                            <span>Exit the map</span>
                            <span className="muted">{err}</span>
                          </div>
                        ) : null;
                      })()}
                      {ms.manhandle ? (
                        <p className="hint wheel-hint">
                          Manhandling <b>{pieceLabel(env, state.pieces[ms.manhandle.gun])}</b>: click a green hex to push it there (double MF, a DR against M{gunDef(env, state.pieces[ms.manhandle.gun]!)?.m}). Right-click the stack to <b>end its move</b>.
                        </p>
                      ) : mode === 'normal' ? (
                        <p className="hint wheel-hint">Click green hexes to move{owner && exitHexes(env, owner)?.size ? '; from a violet hex the stack can leave the map (Exit the map, above)' : ''}. Right-click the stack to <b>end its move</b>{ms.units.length > 1 ? ', leave some units behind (tick them first)' : ''}, fire Smoke, place a DC, recover a SW or exit the map.</p>
                      ) : mode === 'smoke' ? (
                        (() => {
                          const name = (u: PieceId) => pieceLabel(env, state.pieces[u]).replace(/^\S+ /, '');
                          const next = smokeThrower();
                          const others = smokeThrowers();
                          const cost = smokePlan.some((t) => t.target !== ms.hex) ? 2 : 1;
                          return (
                            <div className="hint smoke-plan">
                              {smokePlan.length > 0 && (
                                <p>
                                  Throwing together, {cost} MF for the whole stack:{' '}
                                  {smokePlan.map((t, i) => (
                                    <span key={t.unit}>
                                      {i ? ' · ' : ''}
                                      {name(t.unit)} → {hexLabel(t.target)}
                                    </span>
                                  ))}
                                  . The defender may fire at the stack once all are rolled.
                                </p>
                              )}
                              {next && (
                                <p>
                                  Click the Smoke target hex (amber) for{' '}
                                  {others.length > 1 ? (
                                    <select value={next} onChange={(e) => setSmokeNext(e.target.value)}>
                                      {others.map((u) => (
                                        <option key={u} value={u}>
                                          {name(u)} (Smoke {env.query('unit.smoke', { unit: u }, 0)})
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <b>{name(next)}</b>
                                  )}
                                  : 1 MF in this hex, 2 MF next to it, for the whole stack.
                                  {smokePlan.length === 0 && others.length > 1 ? ' Other units may then throw for the same MF (ASLRB A4.2).' : ''}
                                  {smokePlan.length === 0 ? ' Any other hex or Esc cancels.' : ''}
                                </p>
                              )}
                              <p>
                                {smokePlan.length > 0 && (
                                  <>
                                    <button type="button" onClick={() => throwSmoke(smokePlan)}>
                                      Throw
                                    </button>{' '}
                                  </>
                                )}
                                <a onClick={() => setMode('normal')}>Cancel</a>
                              </p>
                            </div>
                          );
                        })()
                      ) : (
                        <p className="hint">
                          Click the DC target hex. <a onClick={() => setMode('normal')}>Cancel</a>
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              {decision.kind === 'phase' && phase === 'RPh' && (
                <div className="composer">
                  <p className="hint wheel-hint">Right-click a stack with broken units to rally them, recover weapons or pass items.</p>
                  <ul className="rally-list">
                    {legal
                      .filter((a) => a.type === 'rally.selfRally' || a.type === 'rally.rally')
                      .map((a, i) => (
                        <li key={i}>
                          {a.type === 'rally.selfRally'
                            ? `${pieceLabel(env, state.pieces[a['unit'] as string])} may self-rally`
                            : `${pieceLabel(env, state.pieces[a['leader'] as string])} can rally ${pieceLabel(env, state.pieces[a['unit'] as string])}`}
                        </li>
                      ))}
                  </ul>
                </div>
              )}

              {decision.kind === 'phase' && phase === 'RtPh' && (
                <div className="composer">
                  {routing ? (
                    <>
                      <div className="row">
                        <span>Routing</span>
                        <b>{[routing.unit, ...routing.escort].map((u) => pieceLabel(env, state.pieces[u])).join(', ')}</b>
                      </div>
                      <div className="row">
                        <span>MF left</span>
                        <b>{routMfLeft(env, routing.unit)}</b>
                      </div>
                      <div className="stuck">
                        <span className="muted">
                          {canStopRout
                            ? 'It may end its rout here, or go straight on into another building or woods hex (SK1 3.6).'
                            : !routing.sheltered
                              ? NO_SHELTER
                              : 'It has not reached a building or woods hex it may end in (marked ROUT END): click an amber hex to rout on. Open Ground in the view of an enemy able to fire means Interdiction.'}
                        </span>
                        {canStopRout && <button onClick={() => run({ type: 'rout.stop', unit: routing.unit })}>Stop here</button>}
                      </div>
                    </>
                  ) : routShown && !routShown.ends ? (
                    <p className="hint wheel-hint">{NO_SHELTER}</p>
                  ) : (
                    <p className="hint wheel-hint">
                      Units marked <b className="must">must rout</b> have to go (red on the map). Click a broken unit and then an amber hex to walk it one hex at a time, or right-click its hex. It must make for the nearest building or woods (marked ROUT END): the way there is yours to choose. Point at a hex to see why it is barred.
                    </p>
                  )}
                  <ul className="rout-list">
                    {routs.map((r) => (
                      <li key={r.unit} className={`${r.done ? 'done' : r.must ? 'must' : ''} ${selected.has(r.unit) ? 'sel' : ''}`}>
                        <button className="link" onClick={() => { setSelected(new Set([r.unit])); setSelectedHex(hexOfId(state, r.unit) as HexId); }} disabled={r.done}>
                          {pieceLabel(env, state.pieces[r.unit])} <span className="muted">({hexOfId(state, r.unit)?.replace(/^[a-z]/, '')})</span>
                        </button>
                        <span className="rout-status">
                          {r.done ? 'done' : r.must && r.reason ? `must rout — ${routReason(r.reason)}` : 'may rout'}
                        </span>
                        {!r.done && !routing && selected.has(r.unit) && routEscorts(env, r.unit).length > 0 && (
                          <span className="escorts">
                            {routEscorts(env, r.unit).map((l) => (
                              <label key={l} className="check" title="A Good Order leader may rout with the unit: his DRM helps the Interdiction MC, but he dies if it fails (SK1 3.6)">
                                <input type="checkbox" checked={selected.has(l)} onChange={() => togglePiece(l)} /> {pieceLabel(env, state.pieces[l])} goes along
                              </label>
                            ))}
                          </span>
                        )}
                      </li>
                    ))}
                    {routs.length === 0 && <li className="muted">No broken units</li>}
                  </ul>
                  {!routing && legal.some((a) => a.type === 'rout.step' && a['lowCrawl'] && (selected.size === 0 || selected.has(a['unit'] as string))) && (
                    <label className="check" title="A rout of one hex that takes the whole MF allotment and cannot be Interdicted; it must still head for the nearest building or woods (SK1 3.6)">
                      <input type="checkbox" checked={lowCrawl} onChange={() => setLowCrawl(!lowCrawl)} /> Low Crawl
                      {lowCrawl && <span className="muted"> — clicking an amber hex Low Crawls there</span>}
                    </label>
                  )}
                </div>
              )}

              {decision.kind === 'phase' && phase === 'APh' && (
                <p className="hint wheel-hint">Select units (click them, or right-click the stack and choose <b>Advance…</b>) and click an adjacent green hex.</p>
              )}

              {decision.kind === 'ccHex' && (
                <p className="hint wheel-hint">
                  Right-click a Close Combat hex (red on the map) and choose <b>Begin Close Combat</b>: {legal.filter((a) => a['hex']).map((a) => hexLabel(a['hex'] as string)).join(', ')}. You choose the order.
                </p>
              )}

              {decision.kind === 'ccArrange' && (
                <p className="hint wheel-hint">
                  Before the Close Combat in {hexLabel(String(decision.data?.['hex'] ?? ''))}, you may drag a leader onto one of your squads in the panel: he attacks and defends with the unit he is stacked on.
                </p>
              )}

              {decision.kind === 'ccDeclare' && (
                <p className="hint wheel-hint">
                  Drag your units and their targets into attack groups in the panel, then lock them in. Each unit attacks once and is attacked once (SK1 3.8).
                </p>
              )}

              {decision.kind === 'phase' && (
                <p className="hint end-hint">
                  {endBlocked ? <span className="must">{endBlocked}</span> : <>Press <b>{phase === 'RPh' || phase === 'RtPh' ? 'Done' : 'End phase'}</b> in the top bar.</>}
                </p>
              )}
            </section>
          )
        )}

        <Reinforcements env={env} viewer={session.mySide ?? null} sideName={sideName} />
        {secretFortList && (
          <details className="panel small fortified-list" open>
            <summary>
              <b className={`nat nat-${secretFortList.side}`}>{sideName(secretFortList.side)}</b> fortified building{secretFortList.buildings.length === 1 ? '' : 's'} <span className="muted">{fortOpen ? '(SSR)' : '(secret)'}</span>
            </summary>
            <ul>
              {secretFortList.buildings.map((b) => (
                <li key={b}>
                  Building {buildingLabel(b)}{!fortOpen && <span className="muted">{secretFortList.revealed.includes(b) ? ' · revealed' : ' · hidden'}</span>}
                </li>
              ))}
            </ul>
          </details>
        )}

        {connection && caves && viewer === caves.side && (
          <ConnectionBox
            units={Object.values(shown.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === connection && !isWeaponDef(defOf(env, p))).map((p) => ({ id: p.id, label: pieceLabel(shownEnv, p) }))}
            selected={selectedHex === connection}
            onSelect={() => { setSelectedHex(connection); setSelected(new Set()); }}
            actions={[
              ...(placing && picked && !isSw(picked) ? [{ label: `Set up ${pieceLabel(env, state.pieces[picked])} here`, run: () => place(picked, connection) }] : []),
              ...connectionActions(),
            ]}
          />
        )}
        <StackInspector
          env={shownEnv}
          hex={selectedHex ?? hoverHex}
          selected={selected}
          onToggle={togglePiece}
          actingSide={owner}
          swWithHolder={!isFireDecision}
        />

        <section
          className="panel log"
          ref={attachLog}
          onScroll={(e) => {
            const el = e.currentTarget;
            logPinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          <h3>Log</h3>
          {sections.map((sec) => (
            <section key={sec.head ? `p${sec.head.seq}` : 'pre'} className={`log-sec ${sec.lines.length ? '' : 'empty'}`}>
              {sec.head?.phase ? (
                <h4 className={`log-head side-${sec.head.phase.side}`}>
                  <span className="log-turn">Turn {sec.head.phase.turn}</span>
                  <span className="log-side">{sideName(sec.head.phase.side)}</span>
                  <span className="log-phase-name">{sec.head.phase.name}</span>
                </h4>
              ) : sec.head ? (
                <h4 className="log-head">{sec.head.text}</h4>
              ) : null}
              {sec.lines.length > 0 && (
                <ol>
                  {sec.lines.map((l) => (
                    <li
                      key={l.seq + l.text}
                      className={`log-${l.kind} ${l.opens ? 'opens' : ''} ${l.los ? 'has-los' : ''} ${l.seq === losReview ? 'reviewing' : ''}`}
                      onClick={l.los ? () => setLosReview((r) => (r === l.seq ? null : l.seq)) : undefined}
                      title={l.los ? (l.seq === losReview ? 'Hide the LOS' : 'Show this shot\'s LOS on the map') : undefined}
                    >
                      <LogText text={l.text} />
                      {l.detail && (
                        <div className="muted small">
                          <LogText text={l.detail} />
                        </div>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </section>
      </aside>
    </div>
  );
}

function hexOfId(state: { pieces: Record<string, Piece> }, id: string) {
  const p = state.pieces[id];
  return p?.loc.kind === 'hex' ? p.loc.hex : '';
}

function decisionTitle(kind: string, phase: string, fortifyOpen = false, endingMove = false) {
  switch (kind) {
    case 'firstFire':
      return endingMove ? 'Move over: Defensive First Fire?' : 'Defensive First Fire?';
    case 'rofResidual':
      return 'Keep ROF, or leave Residual FP?';
    case 'concealRtPh':
      return 'Rout Phase: drop concealment?';
    case 'motionFacing':
      return 'In Motion: face which way?';
    case 'setup':
      return 'Scenario setup';
    case 'offboardSetup':
      return 'Set up reinforcements offboard';
    case 'fortify':
      return fortifyOpen ? 'Fortify a building' : 'Fortify buildings (secret)';
    case 'scatterPlan':
      return 'Stacks and rendezvous hexes';
    case 'scatterRoll':
      return 'Scatter the next group';
    case 'entryGroups':
      return 'Entry groups (secret)';
    case 'entryTurns':
      return 'Entry turns (secret)';
    case 'secretLength':
      return 'Game length (secret)';
    case 'entryStretch':
      return 'Where the force enters';
    case 'ccHex':
      return 'Close Combat order';
    case 'ccArrange':
      return 'Arrange leaders for Close Combat';
    case 'ccDeclare':
      return 'Declare Close Combat';
    default:
      return PHASE_NAME[phase] ?? phase;
  }
}


/** "2 on Turn 2, 4 on Turn 3, 6 on Turn 4": the circled entry numbers a provisional force rolls against. */
function provisionalChart(env: QueryEnv, p: Piece): string | null {
  const force = (env.statics as Statics).scenario.forces[p.tags['force'] as number];
  const prov = force?.setup.kind === 'enter' ? force.setup.provisional : undefined;
  if (!prov || typeof prov === 'string' || !('drAtMost' in prov)) return null;
  return Object.entries(prov.drAtMost)
    .map(([turn, dr]) => `${dr} on Turn ${turn}`)
    .join(', ');
}

/** The multiple of the turn a provisional force's entry dr must be under ("less than twice the turn", LMA7 SSR 4). */
function provisionalTimes(env: QueryEnv, p: Piece): number | null {
  const force = (env.statics as Statics).scenario.forces[p.tags['force'] as number];
  const prov = force?.setup.kind === 'enter' ? force.setup.provisional : undefined;
  return prov && typeof prov !== 'string' && 'drBelowTurnTimes' in prov ? prov.drBelowTurnTimes : null;
}

/** Reinforcements still to come (not yet set up offboard, nor exited), by side, turn and edge. */
function Reinforcements({ env, sideName, viewer }: { env: QueryEnv; sideName(s?: string): string; viewer: SideId | null }) {
  const due = Object.values(env.state.pieces)
    .filter((p) => p.loc.kind === 'offboard' && !p.loc.hex && p.loc.edge !== 'exited' && p.tags['entryTurn'] !== undefined)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  // Groups whose turn and edge are a secret (SSR) are only counted, by side.
  const waiting = due.filter((p) => isVisibleTo(env, p, viewer));
  const secret = new Map<string, number>();
  for (const p of due) if (!waiting.includes(p) && !isWeaponDef(defOf(env, p))) secret.set(p.side, (secret.get(p.side) ?? 0) + 1);
  // Reinforcements a dr has still to count out (SSR): shown as a range until the roll.
  const variable = pendingVariableReinforcements(env);
  // An order of battle a chart roll still has to count out (SSR): shown as ranges until the roll.
  const chart = forceChartResult(env) ? null : forceChartParams(env);
  const chartForce = chart ? (env.statics as Statics).scenario.forces.find((f) => f.id === chart.force) : undefined;
  const counters = (env.statics as Statics).counters;
  if (waiting.length === 0 && variable.length === 0 && !chart && secret.size === 0) return null;
  // Groups whose entry turn a dr has still to decide (SSR) are listed apart, the turn unknown.
  const ordered = entryOrderDrPending(env);
  const orderRule = ordered.length ? entryOrderDrParams(env) : null;
  const forceIdOf = (p: Piece) => (env.statics as Statics).scenario.forces[p.tags['force'] as number]?.id;
  const groups = new Map<string, Piece[]>();
  for (const p of waiting) {
    const pending = ordered.includes(forceIdOf(p) ?? '');
    const k = `${pending ? 'dr' : p.tags['entryTurn']}|${p.side}|${p.tags['entryEdge']}${pending ? `|${p.tags['force']}` : ''}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return (
    <section className="panel reinforcements">
      <h3>Reinforcements</h3>
      {[...groups].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, list]) => {
        const [turn, side, edge] = k.split('|');
        const counts = new Map<string, number>();
        for (const p of list) counts.set(pieceLabel(env, p), (counts.get(pieceLabel(env, p)) ?? 0) + 1);
        // Provisional reinforcements wait on a Rally Phase dr (SK1 3.1 a) rather than a fixed turn.
        const roll = list[0]!.tags['entryRoll'];
        const provisional = (roll === 'drBelowTurn' || roll === 'drAtMost' || roll === 'drBelowTurnTimes') && turn === '0';
        const orderTurns = turn === 'dr' && orderRule ? [...new Set(orderRule.outcomes.map((o) => o.turns[forceIdOf(list[0]!) ?? ''] ?? 0))].sort((a, b) => a - b) : null;
        // Due only when a special rule brings it in (LMA5 SSR 4's replacement leader).
        const bySsr = roll === 'ssr' && turn === '0';
        const from = list[0]!.tags['entryFrom'];
        const chart = roll === 'drAtMost' ? provisionalChart(env, list[0]!) : null;
        const times = roll === 'drBelowTurnTimes' ? provisionalTimes(env, list[0]!) : null;
        // Waiting on an event of play (SSR): the turn after the side's first fire attack.
        const afterFire = entryAfterFireParams(env);
        const waitsOnFire = !provisional && turn === '0' && !!afterFire && (env.statics as Statics).scenario.forces[list[0]!.tags['force'] as number]?.id === afterFire.force;
        return (
          <div key={k} className="small row">
            <span
              className="when"
              title={
                bySsr
                  ? 'Enters only when its special rule brings it in (see the briefing)'
                  : orderTurns
                    ? `${orderRule?.rule ?? 'SSR'}: the order of entry dr decides the turn`
                    : provisional
                      ? chart
                        ? `Enters on a dr ≤ ${chart}`
                        : times
                          ? `From Turn ${from}: enters on a dr < ${times} × the current Turn number, rolled in its side's Rally Phase`
                          : `From Turn ${from}: enters on a dr < the current Turn number`
                      : waitsOnFire
                        ? `${afterFire!.rule ?? 'SSR'}: enters on the turn after the first ${sideName(afterFire!.firedBy)} fire attack`
                        : undefined
              }
            >
              {bySsr ? 'SSR' : orderTurns ? `T${orderTurns.join('/')} dr` : provisional ? `T${from}+ dr` : waitsOnFire ? 'after fire' : `T${turn}`}
            </span>
            <span>
              <b className={`nat nat-${side}`}>{sideName(side)}</b> · {edgeWords(edge!) === 'any' ? 'any edge' : `${edgeWords(edge!)} edge`}:{' '}
              <span className="muted">{[...counts].map(([l, n]) => (n > 1 ? `${n}× ${l}` : l)).join(', ')}</span>
            </span>
          </div>
        );
      })}
      {[...secret].map(([side, n]) => (
        <div key={`secret-${side}`} className="small row">
          <span className="when" title="Their turn and edge of entry are secret (SSR)">?</span>
          <span>
            <b className={`nat nat-${side}`}>{sideName(side)}</b> · <span className="muted">{n} unit{n === 1 ? '' : 's'} entering at a secret turn{(env.statics as Statics).scenario.ssr.some((r) => r.module === 'secret-entry-turns') ? '' : ' and place'}</span>
          </span>
        </div>
      ))}
      {chart && (
        <div className="small row">
          <span className="when" title={`${chart.rule ?? 'SSR'}: ${chart.chart ?? 'a chart'} roll once the ${sideName(chart.afterSetupOf)} side has set up decides how many`}>
            {chartForce?.setup.kind === 'enter' ? `T${chartForce.setup.turn} dr` : 'dr'}
          </span>
          <span>
            <b className={`nat nat-${chart.side}`}>{sideName(chart.side)}</b> · {chartForce?.setup.kind === 'enter' ? `${EDGE_NAME[chartForce.setup.edge] ?? chartForce.setup.edge} edge` : 'setup'}:{' '}
            <span className="muted">
              {chart.defs
                .map((d, i) => {
                  const n = chart.rows.map((r) => r.counts[i] ?? 0);
                  const lo = Math.min(...n);
                  const hi = Math.max(...n);
                  return `${lo === hi ? lo : `${lo}–${hi}`}× ${counters[d] ? defLabel(counters[d]!) : d}`;
                })
                .join(', ')}{' '}
              ({chart.rule ?? 'SSR'}: {chart.chart ?? 'chart'})
            </span>
          </span>
        </div>
      )}
      {variable.map((v) => {
        const d = counters[v.def];
        return (
          <div key={`v${v.turn}`} className="small row">
            <span className="when" title={`${v.rule}: a dr before the Rally Phase decides how many (${chartLabel(v.table)})`}>
              T{v.turn} dr
            </span>
            <span>
              <b className={`nat nat-${v.side}`}>{sideName(v.side)}</b> · {v.edge ? `${EDGE_NAME[v.edge] ?? v.edge} edge` : 'enter'}:{' '}
              <span className="muted">
                {v.min === v.max ? v.min : `${v.min}–${v.max}`}× {d ? defLabel(d) : v.def} ({v.rule}: {chartLabel(v.table)})
              </span>
            </span>
          </div>
        );
      })}
    </section>
  );
}

/**
 * The setup restrictions that apply to the units being placed (from the scenario data).
 * When the tray already shows each group's own rule, only the general stacking note remains.
 */
function SetupRules({ env, todo, rulesShownInTray, anchors = [] }: { env: QueryEnv; todo: Piece[]; rulesShownInTray: boolean; anchors?: { anchor: HexId; range: number; counts: { label: string; need: number; have: number }[] }[] }) {
  const sc = (env.statics as Statics).scenario;
  const forces = [...new Set(todo.map((p) => p.tags['force'] as number))].map((i) => sc.forces[i]!);
  const lines = rulesShownInTray ? [] : forces.map((f) => setupRule(f));
  return (
    <ul className="setup-rules small">
      {[...new Set(lines)].map((l) => (
        <li key={l}>{l}</li>
      ))}
      {/* Deployment hexes with minimums by each (LMA9 SSR 1), counted as the counters go down. */}
      {anchors.map((a) => {
        const met = a.counts.every((c) => c.have >= c.need);
        return (
          <li key={a.anchor} className={met ? '' : 'warn'}>
            {met ? '✓' : '⚑'} Within {a.range} hexes of {hexLabel(a.anchor)}: {a.counts.map((c) => `${c.label} ${c.have}/${c.need}`).join(', ')}
          </li>
        );
      })}
      <li className="muted">Stacking: 3 squad-equivalents and 4 leaders per hex</li>
    </ul>
  );
}
