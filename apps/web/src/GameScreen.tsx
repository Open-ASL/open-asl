import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Action, GameState, HexId, Piece, PieceId, QueryEnv, SideId } from '@asl/engine';
import { fixtureActions } from '@asl/content';
import {
  adjacentLocs,
  overstackEntryMf,
  scenarioRuleset,
  sideToward,
  attackFp,
  buildAttack,
  cavesParams,
  caveLoc,
  isCaveLoc,
  hexOfLoc,
  levelOfLoc,
  locOf,
  moveLoc,
  BLAZE_ESCAPE_DECISION,
  blazeAt,
  burnable,
  clearanceDrm,
  clearers,
  EC_NAME,
  ecState,
  escapeDestinations,
  fireAt as fireRecordAt,
  fireNumbers,
  fireView,
  flamesAt,
  kindleIllegal,
  kindlers,
  kindlingDrm,
  rubbleView,
  trailBreaksAt,
  fortState as fortificationsState,
  beltHexes,
  type MineBelt,
  partialTbsAt,
  WIND_NAME,
  windOf,
  locationAt,
  locationsOf,
  controlChits,
  controlMatters,
  defOf,
  defaultVca,
  directorIllegal,
  isRofShot,
  fireMarker,
  finalFireMarker,
  hideIllegal,
  hiddenUnitsParams,
  entryAfterFireParams,
  compulsoryHidden,
  gameTurns,
  revealedLength,
  inPlay,
  digInParams,
  deployableSquads,
  deployQuota,
  DEPLOYED_FROM,
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
  firstFireTargetsAt,
  acrossSide,
  sideHex,
  bypassPlan,
  cornerBetween,
  cornerLabel,
  cornerOffset,
  hexPixel,
  movingInfo,
  pendingRouts,
  ROUT_BAR_TEXT,
  planRout,
  defaultPlacement,
  defaultSwAssignment,
  weaponDropIllegal,
  FORTIFY_DECISION,
  fortifiableBuildings,
  fortifiableLocations,
  fortifiedKnownTo,
  fortifiedParams,
  fortifiedState,
  fortifiedView,
  fortifyIllegal,
  breachIllegal,
  BREACH_SIDE_DECISION,
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
  smokeDispenser,
  vehicleEntryTerrain,
  vehicleIfe,
  turretTurnFor,
  hullTurnFor,
  ordnanceDirectorIllegal,
  swDirectorIllegal,
  ordnanceOf,
  mgAsOrdnance,
  shotWeaponOf,
  pfCap,
  pfCheckDrm,
  pfCheckNeedText,
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
  snapWhyNot,
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
import { caChangeFor, directedShotOptions, gunHexOf, pillboxArcLabel, pillboxCaToward, shotOptions, spineLabel, spineToward, thPreview } from './game/ordnance';
import { screenViewer } from './game/visibility';
import { advanceTos, clickLoc } from './game/clickLoc';
import { DirectorPicker, GunComposer } from './panels/GunComposer';
import type { SmokeThrow } from '@asl/rules';
import { maBffRefusal, maRmgRefusal, vehicleMgUnavailable, entrenchDrm, entrenchHexIllegal, entrenchers, entrenchmentKnownTo, entrenchmentMf, entrenchmentName, entrenchmentRoom, isEntrenched, smc, stackEntrenchment, mineStepChoices, mineTbThrough, removeMinesIllegal, sideToward as mineSideToward, lastMineAttacks } from '@asl/rules';
import { WIRE_DROP_DECISION, HD_CHOICE_DECISION, hullDownLabel, shotHullDown, WA_RPH_DECISION, CLEARANCE_RULE, clearanceSideFor, defaultTbHexsides, roadblockBetween, clearanceCandidates, clearanceTargets, clearanceUnitIllegal, hasWa, lastWireExit, roadblockObstacles, stackWire, taskDrm, wallSidesOf, type ClearanceKind, type WireExitResult } from '@asl/rules';
import { enemyVehicleAt, shotContext } from '@asl/rules';
import { ACQ_CHOICE_DECISION, CONCEAL_RTPH_DECISION, backblastFrom, mmc, squadEquivalents, LEADER_PTC_DECISION, ONCE_DR_DECISION, actionIllegal, onceDrRules, ordnanceWeaponIllegal, banzaiSteps, banzaiState, banzaiWindowsPending, concealRtphUnits, concealmentActive, declareIllegal as banzaiIllegal, dcChargeOptions, isJapanese, obConcealment, redactState } from '@asl/rules';
import { counterTerrainIllegal, defaultFortPlacement, fortArea, fortCounters, fortKindName, fortPlaceIllegal, fortPools, fortSetupIllegal, fortificationView, fortificationsParams, hipIllegal, isPillboxLoc, roadblockExtension, type FortPlacement } from '@asl/rules';
import { MANDATORY_TPBF, OVR_EVADE, OVR_PLACE } from '@asl/rules';
import { dashEntry, dashTargets, evadeEntries, lateDoubleTimeEntries, minimumMoveNote, ovrStep, shortName as moveShortName, tpbfPanel } from './game/movementEntries';
import { advanceNote, overstackBadges, overstackStepNote, vehicleTargets } from './game/overstacking';
import { ccStateOf, isGroundLoc, arcSpine, bunkerTrenches, inPillboxCa, pillboxCcUnits, pillboxKnownToSide, pillboxLoc, pillboxMf, possiblePillbox } from '@asl/rules';
import { BoardView, type BoardOverlay, type FireHex, type FortHex, type FortifiedHex, type HexBadge, type HexControl, type Placement, type RubbleHex } from './board/BoardView';
import { ActionWheel, action, group, type WheelItem } from './board/ActionWheel';
import { StackPeek, hasPeek, stackIn } from './board/StackPeek';
import { NATION, PHASE_NAME, defLabel, describeEvents, hexNamer, humanize, phaseSections, pieceLabel } from './game/describe';
import { targetOwnDrms } from './game/targetDrm';
import { LogSections } from './game/LogEntries';
import { pillboxRoutMarks } from './game/pillboxRout';
import { RofChoice, type RofChoiceItem } from './panels/RofChoice';
import { dcPlacement as dcPlacementOf, dcTargets as dcTargetsOf } from './game/dcTargets';
import { bffWheelKind } from './game/bffWheel';
import { setupHip } from './game/gunHip';
import { dmChoices, type DmChoice } from './game/dmChoice';
import { wreckChoices } from './game/wreckChoice';
import { SMOKE_DISPENSER_MPH_ONLY, turnAndFireHint, turnWithoutFiringLabel } from './game/vehicleEntries';
import { offboardShown as offboardHexesShown, offboardStepKey } from './game/offboard';
import { caveFireTarget } from './game/caveFire';
import { ftAfvTargets } from './game/ftTarget';
import { passRefusal } from './game/passRefusal';
import { recoverRefusal } from './game/recoverRefusal';
import { routWaitHint } from './game/routWait';
import { groupRallyRefusals, rallyRefusals } from './game/rallyRefusal';
import { appearMix, appearWords } from './game/appear';
import { moverHex, turnSpineToward } from './game/vehicleTurn';
import { staleFire, weaponHolder } from './game/staleFire';
import { keepsTicks } from './game/stackClick';
import { addToGroupBlocked, aimsAt, beyondRange, blindFireOffered, fireLeaders, fireSelectable, swCarriers, withinRange } from './game/fireSelection';
import { endPhaseWarning, type EndPhaseWarning } from './game/endPhaseGuard';
import { Modal } from './ui/Modal';
import { deployEntries, type DeployEntry, type DeployOption } from './game/deployEntries';
import { ErrorBoundary } from './ui/ErrorBoundary';
import type { MapPoint, Session } from './game/session';
import type { InkStroke } from './board/ink';
import { SetupTray, type TrayGroup } from './panels/SetupTray';
import { FortTray, fortMarker, type FortSpec } from './panels/FortTray';
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
import { gameOverText } from './game/gameOver';
import { banzaiCandidates, toggleBanzaiHex } from './game/banzaiDraft';
import type { MatchAwards } from '@asl/platform';
import { DICE_LOG_LIMIT, useGameFx } from './fx/useGameFx';
import { usePresentation } from './game/presentation';
import { playSfx } from './audio/engine';
import { SettingsPanel } from './settings/SettingsPanel';
import { ShortcutsDialog } from './panels/Shortcuts';
import { ChartsDialog } from './panels/Charts';
import { useFollowAction, useFxLevel, useStackCard, useWeatherFx, useYourCallStrip } from './fx/settings';
import { hexsideScreenAngle, northScreenAngle, weatherFxKind, windScreenAngle } from './game/weatherView';
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
  /** What the match did for this player's decorations, once the server has scored it. */
  awards?: MatchAwards | null;
  /** Who plays each side, for the top bar (see `seatNames`). */
  players?: Record<string, string>;
  /** More settings for this screen, shown at the foot of the Settings dialog (a commentator's switch). */
  settingsExtra?: ReactNode;
  /** A commentator's board: their tools on the map (see superSpectator/). */
  ss?: SsScreen;
}

/** What a commentator's board adds to the screen. */
export interface SsScreen {
  /** Ink on the map. */
  ink: InkStroke[];
  /** The pen, while drawing: a press on the map draws instead of panning. */
  pen: { color: number; width: number } | null;
  onInk(stroke: { color: number; width: number; points: number[] }): void;
  /** A click on a hex for a commentator's tool: 'ping' pings it, true means the tool took it, false lets the screen have it. */
  onHexClick(hex: HexId, e: { shift: boolean; at: MapPoint }): boolean | 'ping';
  /** Shown over the board pane: the LIVE / REWOUND / VIRTUAL banner and the card of the check being looked at. */
  banner: ReactNode;
  /** Hexes a check lights (firers, target), by colour. */
  marks: Map<HexId, number>;
  /** The LOS thread of a check, drawn growing from its firer. */
  checkLos: { key: number; from: HexId; to: HexId; clear: boolean; blockedAt?: { x: number; y: number } } | null;
  /** Tints the board pane's frame: red for a virtual board, amber for a rewound one. */
  status: 'live' | 'rewound' | 'virtual';
  /** The virtual board's Move tool: the counter a press on a hex picks up (its stack goes with it), and where it is dropped. */
  drag?: { piece(hex: HexId): string | null; drop(hex: HexId, piece: string): void };
  /** The danger map: each hex's colour (drawn over the counters). */
  heat?: { hex: HexId; color: number }[] | null;
  /** The hex under the pointer (the danger map's readout). */
  onHover?(hex: HexId | null): void;
  /** Counters or markers left off, from the commentators' controls. */
  hideUnits: boolean;
  hideMarkers: boolean;
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
/** How long (ms) a hex's Close Combat results stay up at the Slow pace (7 s otherwise; Close dismisses them sooner). */
const CC_LINGER_SLOW = 11000;

const FIRE_MODE: Record<string, FireMode> = { PFPh: 'prep', DFPh: 'final', AFPh: 'advancing' };
/** Moves a stack can still make once its MF are spent only if one of these is legal (a road bonus step, say). */
const MOVE_GOES_ON = new Set(['move.step', 'move.manhandle', 'move.smoke', 'move.recover', 'move.placeDc', 'move.breach', 'move.exit']);

/** Ping colours: one per player by seat order, chosen to stand out on any terrain (none is a map colour); the last is a spectator's. */
const PING_COLORS = [0xff2fd6, 0x19e8ff, 0xfff23a];

/** The game screen; a render error anywhere in it shows a notice to try again or reload, not a blank page. */
/** What a side forfeits by confirming its setup with counters unplaced (the `fortifications` special rule): one line per pool. */
function fortLeftovers(left: ReturnType<typeof fortPools>): string[] {
  const out: string[] = [];
  if (left.foxholes > 0) out.push(`${left.foxholes} squad${left.foxholes === 1 ? '' : 's'} of foxhole capacity`);
  if (left.trenches > 0) out.push(`${left.trenches} trench counter${left.trenches === 1 ? '' : 's'}`);
  if (left.ditch > 0) out.push(`${left.ditch} A-T Ditch counter${left.ditch === 1 ? '' : 's'}`);
  if (left.wire > 0) out.push(`${left.wire} Wire counter${left.wire === 1 ? '' : 's'}`);
  if (left.roadblocks > 0) out.push(`${left.roadblocks} roadblock${left.roadblocks === 1 ? '' : 's'}`);
  if (left.pillboxes.length > 0) out.push(`${left.pillboxes.length} pillbox${left.pillboxes.length === 1 ? '' : 'es'}`);
  if (left.factors > 0) out.push(`${left.factors} A-P minefield factor${left.factors === 1 ? '' : 's'}${left.factors < 6 ? (left.at && left.factors >= 3 ? ' (enough for A-T mines only)' : ' (too few for a minefield)') : ''}`);
  if (left.known > 0) out.push(`${left.known} Known minefield factor${left.known === 1 ? '' : 's'}${left.known < 6 ? ' (too few for a minefield)' : ''}`);
  if (left.dummies > 0) out.push(`${left.dummies} Dummy Minefield counter${left.dummies === 1 ? '' : 's'}`);
  return out;
}

export function GameScreen(props: Props) {
  return (
    <ErrorBoundary what="the game screen">
      <GameScreenView {...props} />
    </ErrorBoundary>
  );
}

function VehicleEntryMp({ hexLabel, destinations, left, check, enter }: {
  hexLabel(hex: HexId): string;
  destinations: ReadonlyMap<HexId, number>;
  left: number;
  check: Session['check'];
  enter: Session['act'];
}) {
  const [to, setTo] = useState<HexId>('');
  const [mp, setMp] = useState('');
  const minimum = destinations.get(to);
  const total = Number(mp);
  const step = minimum !== undefined && total > minimum && total <= left && Number.isInteger((total - minimum) * 2)
    ? { type: 'move.step' as const, to, declared: total }
    : null;
  const refusal = step ? check(step) : null;

  return (
    <form className="row" onSubmit={(e) => {
      e.preventDefault();
      if (step && !refusal && !enter(step)) setMp('');
    }}>
      <span>Enter hex</span>
      <span className="mp-ctl" title="Declare the total MP for entering the hex without stopping (SK4 3.3.2)">
        <select aria-label="Destination hex" value={minimum === undefined ? '' : to} onChange={(e) => {
          setTo(e.target.value);
          setMp('');
        }}>
          <option value="">Choose hex</option>
          {[...destinations].map(([hex, cost]) => <option key={hex} value={hex}>{hexLabel(hex)} (min. {cost} MP)</option>)}
        </select>
        <input aria-label="Total entry MP" type="number" min={minimum === undefined ? undefined : minimum + 0.5} max={left} step={0.5} placeholder="MP" disabled={minimum === undefined} value={mp} onChange={(e) => setMp(e.target.value)} />
        <button type="submit" disabled={!step || !!refusal} title={refusal ?? undefined}>Enter</button>
      </span>
    </form>
  );
}

function GameScreenView({ scenario, session, matchId, viewKey, onQuit, onResolvingChange, slow = false, aside, aar = null, awards = null, players, settingsExtra, ss }: Props) {
  const { engine } = session;
  const [fxLevel, setFxLevel] = useFxLevel();
  // The screen shows the game as far as the dice have been revealed (see usePresentation).
  const present = usePresentation(engine, session.state, session.log, fxLevel === 'off', session.seek);
  const state = present.state;
  const resolving = present.resolving;
  const statics = engine.statics as Statics;
  const env: QueryEnv = useMemo(() => engine.env(state), [engine, state]);
  // Hexes as players name them: with their board letter on a map of several boards (two boards may both have an M4).
  const hexLabel = hexNamer(env);
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
  /** Closes the stack card when one is up; true when it did (Esc). */
  const closePeekRef = useRef<(() => boolean) | null>(null);
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
      else if (e.key === 'Escape' && closePeekRef.current?.()) e.preventDefault();
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
  /**
   * Full ASL Snap Shot (ASLRB A8.15): the declared fire is previewed as a Snap Shot at the hexside the moving stack crossed
   * (`snapAim`); `snapShown` keeps the stack drawn on that hexside while the shot's result is on screen, until the next action.
   */
  const [snapAim, setSnapAim] = useState(false);
  const [snapShown, setSnapShown] = useState<{ hex: HexId; from: HexId; units: PieceId[] } | null>(null);
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
    /** The card was closed (its ✕, Esc): not even a fresh linger brings it back until the pointer visits another hex. */
    closed: boolean;
  }>({
    hex: null,
    at: { x: 0, y: 0 },
    show: null,
    hide: null,
    overCard: false,
    pinned: false,
    clicked: false,
    closed: false,
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
    ss?.onHover?.(hex);
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
      if (hex && h.clicked && !h.closed && !ms) {
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
    h.closed = false;
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
  /** Close the stack card (its ✕, or Esc), pointer on it or not: it stays away until the pointer moves to another hex. */
  const closePeek = () => {
    const h = hover.current;
    h.clicked = true;
    h.closed = true;
    h.overCard = false;
    h.pinned = false;
    if (h.show) clearTimeout(h.show);
    h.show = null;
    setChitWheel(null);
    setPeek(null);
  };
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
  const [mode, setMode] = useState<'normal' | 'smoke' | 'dc' | 'bffMg' | 'dash'>('normal');
  /** A Kindling attempt being composed (full ASL B25.11): the Location, the MMC attempting, and a SMC attempting alone. */
  const [kindle, setKindle] = useState<{ loc: string; picks: string[]; self: string | null } | null>(null);
  /** A Flame clearance being composed (full ASL B24.72): the Location and the units joining the one DR. */
  const [douse, setDouse] = useState<{ loc: string; picks: string[]; flame?: number } | null>(null);
  // Full ASL Deployment (ASLRB A1.31): the weapons the second half-squad takes, asked before the NTC when the squad has two or more.
  const [deploySplit, setDeploySplit] = useState<{ unit: string; leader: string; second: string[] } | null>(null);
  // Full ASL: the Clearance Task being composed (ASLRB B24.73, B24.76): the counter, its Location and the units ticked.
  const [clearing, setClearing] = useState<{ kind: ClearanceKind; counter: string; loc: string; picks: string[]; hexsides?: [number, number] } | null>(null);
  // An Entrenching Attempt being composed (ASLRB B27.11): the Location, the MMC ticked, the directing leader.
  const [entrench, setEntrench] = useState<{ loc: string; picks: string[]; director: string | null } | null>(null);
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
    if (mode !== 'smoke' && mode !== 'dc' && mode !== 'dash') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode('normal');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);
  // Vehicular MGs lined up for Bounding First Fire (SK3): the next enemy hex clicked is their target.
  const [bffMgs, setBffMgs] = useState<PieceId[]>([]);
  /** A Gun lined up to fire: which, how (target type) and whether as Intensive Fire; the next enemy hex clicked is shot at. */
  const [gunShot, setGunShot] = useState<{ gun: PieceId; holder: PieceId | null; targetType: TargetType; intensive: boolean; ammo?: AmmoKind; backblast?: boolean; director?: PieceId; targetUnit?: PieceId } | null>(null);
  /** A Panzerfaust try lined up (SK4 4.4.2): the unit and what it aims at, waiting for the target hex. */
  const [pfShot, setPfShot] = useState<{ unit: PieceId; targetType: 'VTT' | 'ITT'; backblast?: boolean; director?: PieceId } | null>(null);
  const [weatherFx, setWeatherFx] = useWeatherFx();
  const [callStrip, setCallStrip] = useYourCallStrip();
  const [stackCard, setStackCard] = useStackCard();
  const [followAction, setFollowAction] = useFollowAction();
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
  const dcPlacement = (target: string) => dcPlacementOf(env, owner, target);
  /**
   * Full ASL: what the CC of the current hex is across a pillbox (ASLRB B30.6): the units inside against those outside, with
   * no Melee; or a pillbox whose units are screened by a friendly unit outside and take no part.
   */
  const pillboxCcNote = (): string | null => {
    const hex = ccStateOf(env)?.hex;
    if (!fullAslRules || !hex || !isGroundLoc(hex)) return null;
    const pb = pillboxKnownToSide(env, hex, owner ?? null);
    if (!pb) return null;
    const across = state.sides.some((side) => pillboxCcUnits(env, hex, side).length > 0);
    if (across) return 'Pillbox units vs units outside: CC across the pillbox, no Melee: the units outside may leave, those inside may only advance out (ASLRB B30.6).';
    const inside = Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex && p.loc.sub === 'pb');
    const screen = inside.length ? Object.values(state.pieces).find((p) => p.loc.kind === 'hex' && p.loc.hex === hex && !p.loc.sub && !p.loc.level && p.side === inside[0]!.side && !isWeaponDef(defOf(env, p))) : undefined;
    return screen ? `The units in the pillbox take no part: screened by ${pieceLabel(env, screen)} outside (ASLRB B30.6).` : null;
  };
  /** The unit of the moving stack carrying a DC, if any. */
  const dcPlacementPlacer = (): PieceId | undefined => {
    const dc = ms?.units.flatMap((u) => swHeldBy(state, u)).find((s) => (defOf(env, s) as { type?: string }).type === 'DC');
    return dc && dc.loc.kind === 'held' ? dc.loc.by : undefined;
  };
  const dcTargets = () => dcTargetsOf(env, owner, (a) => session.check(a), fullAslRules);
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
    fx.ping(hex, session.pingColor ?? pingColor(side), at);
    session.sendPing?.(hex, at);
  };
  const seenPing = useRef(0);
  useEffect(() => {
    for (const p of session.pings ?? [])
      if (p.id > seenPing.current) {
        seenPing.current = p.id;
        fx.ping(p.hex as HexId, p.color ?? pingColor(p.side), p.at);
      }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.pings]);
  // Online play: the hex this player has selected goes to the opponent, who sees it ringed in this side's colour while they
  // wait. Every hex, a hidden unit's too: holding some back would itself point them out, so a selection proves nothing
  // (and a player may bluff). Nothing before play starts, where a click shows where units go, hidden ones included, or
  // which buildings are secretly fortified (ASLRB B23.911: "secretly recorded prior to the start of play").
  const setupDecision = decision?.kind === 'setup' || decision?.kind === 'offboardSetup' || state.phase === 'setup';
  // A hex selected before play (the last unit placed, a building looked at) stays selected into play: only a selection
  // made since play began is shared, or the first ring would point at a setup choice.
  const [selectedInPlay, setSelectedInPlay] = useState(false);
  useEffect(() => setSelectedInPlay(state.phase !== 'setup'), [selectedHex]); // eslint-disable-line react-hooks/exhaustive-deps
  const focusShown = session.mySide && !setupDecision && selectedInPlay ? selectedHex : null;
  useEffect(() => {
    session.sendFocus?.(focusShown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusShown]);
  const theirFocus = session.theirFocus && !setupDecision ? { hex: session.theirFocus.hex as HexId, color: pingColor(session.theirFocus.side) } : null;
  // Rout Phase: each broken unit of the routing side, whether it must rout and why.
  const routs = useMemo(() => (phase === 'RtPh' && decision?.kind === 'phase' ? pendingRouts(env) : []), [env, phase, decision]);
  const routInfo = (id: PieceId) => routs.find((r) => r.unit === id);
  /** The rout under way: that unit walks on, hex by hex, until it stops or can go no further. */
  const routing = phase === 'RtPh' && decision?.kind === 'phase' ? activeRout(env) : undefined;
  const routReason = (r: RoutReason) =>
    r.kind === 'adjacent'
      ? `adjacent to ${pieceLabel(env, state.pieces[r.enemy])} in ${hexLabel(r.hex)}`
      : `in Open Ground in the LOS and range of ${pieceLabel(env, state.pieces[r.enemy])} in ${hexLabel(r.hex)}`;
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
        return { key: String(fi), label: f.group ?? f.id ?? `Group ${fi + 1}`, rule: setupRule(f, scenario), pieces: ps };
      });
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const trayGroups = useMemo((): TrayGroup[] | null => groupTray([...todo, ...swTodo]), [todo, swTodo, scenario]);
  const [pending, setPending] = useState<Record<PieceId, HexId>>({});
  const [picked, setPicked] = useState<PieceId | null>(null);
  // Which unit carries each placed weapon (SW id → unit), confirmed with the placements.
  const [swAssign, setSwAssign] = useState<Record<PieceId, PieceId>>({});
  // Guns being set up: the Covered Arc chosen for each (hexspine 0–5), which were put in the open rather than
  // hidden (HIP), and the Gun (or vehicle) whose six hexspine handles are shown on the map to face it.
  const [pendingCa, setPendingCa] = useState<Record<PieceId, number>>({});
  const [openGuns, setOpenGuns] = useState<Set<PieceId>>(new Set());
  const [caFor, setCaFor] = useState<PieceId | null>(null);
  /** The ring open on `caFor` points a turreted vehicle's turret, not its hull (setup, SK4 3.2.4: TCA and VCA may differ). */
  const [caTurret, setCaTurret] = useState(false);
  // A ring put away (Later, a choice made) leaves turret mode with it, so the next ring opened points the hull.
  useEffect(() => {
    if (!caFor) setCaTurret(false);
  }, [caFor]);
  /** Turret Covered Arcs chosen at setup, where they differ from the hull's (SK4 3.3.2). */
  const [pendingTca, setPendingTca] = useState<Record<PieceId, number>>({});
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
  /**
   * The hexspine ring on the map. `then` makes it the first of two picks: the spine chosen opens the next ring instead of
   * acting (the end-of-phase hull and turret turn, taken together).
   */
  type Ring = { hex: HexId; piece: PieceId; what: string; current: number; turret?: boolean; note: string; action(spine: number): Omit<Action, 'side' | 'decisionId'> | null; then?: (spine: number) => Ring };
  const [ring, setRing] = useState<Ring | null>(null);
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
  // Fortification counters (full ASL A12.33, B26–B30; the `fortifications` special rule): the counters put down in this
  // draft, the tray tile in hand, the placed counter (by index) whose hexside or Covered Arc ring is open on the map,
  // the units to set up beneath their hex's foxhole/trench/Wire, and the forfeit question before the counters are sent.
  const [pendingForts, setPendingForts] = useState<FortPlacement[]>([]);
  const [pickedFort, setPickedFort] = useState<FortSpec | null>(null);
  const [fortRingFor, setFortRingFor] = useState<number | null>(null);
  const [pendingBeneath, setPendingBeneath] = useState<Set<PieceId>>(new Set());
  /** Known minefield belts laid in this draft (ASLRB B28.46), and the belt tool: its first hex, then (off a Hex Grain) the zigzag to choose. */
  const [pendingBelts, setPendingBelts] = useState<MineBelt[]>([]);
  const [beltTool, setBeltTool] = useState<{ from?: HexId; to?: HexId } | null>(null);
  const [fortConfirm, setFortConfirm] = useState<string[] | null>(null);
  /** The unit setup to send once the counters have been accepted (one Confirm sends both). */
  const afterFort = useRef<Omit<Action, 'side' | 'decisionId'> | null>(null);
  useEffect(() => {
    setPending({});
    setPendingForts([]);
    setPendingBelts([]);
    setBeltTool(null);
    setPickedFort(null);
    setFortRingFor(null);
    setPendingBeneath(new Set());
    setFortConfirm(null);
    afterFort.current = null;
    setPicked(null);
    setSwAssign({});
    setPendingCa({});
    setOpenGuns(new Set());
    setPendingHidden(new Set());
    setPendingConcealed(new Set());
    setPendingCe(new Set());
    setPendingDugIn(new Set());
    setCaFor(null);
    // The counters to set up are listed in the orders panel: a panel folded away earlier would hide them.
    if (placing) setSideCollapsed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing?.id]);
  /** The fortification counters this setup places (the `fortifications` special rule), and whether they are already with the engine. */
  const fortRule = placing?.kind === 'setup' ? fortificationsParams(env, placing.owner) : null;
  const fortLocked = !!placing && !!fortRule && fortCounters(env).some((c) => c.side === placing.owner);
  const fortDraft = useMemo(() => (fortRule && !fortLocked ? pendingForts : []), [fortRule, fortLocked, pendingForts]);
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
    // The card's constraints bind the weapon where it now stands (a Gun beside a building), as they bind a unit placed.
    const err = weaponDropIllegal(env, placing.owner, todo, pending, swAssign, swId, holder);
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
  /** Point a vehicle's turret at hexspine `spine` at setup: its Turret Covered Arc may differ from the hull's (SK4 3.3.2). */
  const pointTurret = (id: PieceId, spine: number) => {
    setPendingTca({ ...pendingTca, [id]: spine });
    setCaFor(null);
    setCaTurret(false);
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
    const next = new Set(openGuns);
    if (next.has(gunId)) next.delete(gunId);
    else next.add(gunId);
    setOpenGuns(next);
  };
  /** Whether a placed Gun may set up hidden where it stands (SSR and terrain permitting). */
  const hipAllowed = (gunId: PieceId) => !!swHexes[gunId] && env.query('hip.allowed', { gun: gunId, hex: swHexes[gunId]! }, false);
  const pendingHip = setupHip(env, gunTodo.map((g) => g.id), swHexes, openGuns);
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
    // Whatever may set up hidden or concealed where it stands stays out of the draft the opponent watches, chosen or
    // not: a unit placed first and hidden a moment later would already have been seen there, and a counter's id names
    // it. So: HIP-capable Guns (SK4 6.4) with their crews, units a special rule hides or lets hide (S23 SSR 1, the
    // Japanese 10%), and units in Concealment Terrain (SK4 8.3).
    const hipGuns = new Set([...pendingHip, ...gunTodo.filter((g) => hipAllowed(g.id)).map((g) => g.id)]);
    const secret = new Set([
      ...[...hipGuns].map((g) => swAssign[g]).filter((u): u is PieceId => !!u),
      ...pendingHidden,
      ...pendingConcealed,
      ...hiddenByRule,
      ...Object.keys(pending).filter((id) => hideable(id) || concealable(id)),
    ]);
    const shownPending = Object.fromEntries(Object.entries(pending).filter(([id]) => !secret.has(id)));
    // Placed weapons go too (for the opponent's view of our tray), unless hidden or carried by a unit kept back.
    const shownSw = Object.fromEntries(Object.entries(swHexes).filter(([sw]) => !hipGuns.has(sw) && !secret.has(swAssign[sw]!)));
    session.publishDraft(placing ? { decisionId: placing.id, placements: { ...shownPending, ...shownSw } } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placing?.id, pending, openGuns, pendingHidden, pendingConcealed, swAssign, swHexes]);
  /** Who this screen shows the game to (`screenViewer`): 'all' shows everything, hidden units included. */
  const seenBy = screenViewer(session, decision?.owner, !!state.result);
  const seeAll = seenBy === 'all';
  const viewer: SideId | null = seeAll ? null : seenBy;
  /** The state as it will be once the pending placements are confirmed (drawn on the board), without what the viewer may not see. */
  const shown: GameState = useMemo(() => {
    // The viewer's redacted view: hidden pieces gone, an enemy's concealed stacks as "?" stand-ins, secrets as their modules show them.
    const base = seeAll ? state : redactState(engine, state, viewer);
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
        const tca = pendingTca[v.id];
        if (ca === undefined && tca === undefined && !pendingCe.has(v.id)) continue;
        pieces[v.id] = { ...p, tags: { ...p.tags, ...(ca !== undefined ? { vca: ca, ca } : {}), ...(tca !== undefined ? { ca: tca } : {}), ...(pendingCe.has(v.id) ? { ce: true } : {}) } };
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
    // Fortification counters put down in this draft stand on the board as placed ones would, and the units chosen to
    // set up beneath their hex's counter take that position (full ASL B27.1, B26.4).
    let ext = base.ext;
    if (placing && fortDraft.length) {
      const prev = (base.ext['asl.fortifications'] as { counters: unknown[] } | undefined) ?? { counters: [] };
      ext = { ...base.ext, 'asl.fortifications': { ...prev, counters: [...prev.counters, ...fortDraft.map((c, i) => ({ ...c, id: `${placing.owner}.draft${i + 1}`, side: placing.owner }))], ...(pendingBelts.length ? { belts: pendingBelts.map((b) => ({ ...b, side: placing.owner })) } : {}) } };
    }
    if (placing && pendingBeneath.size) {
      const ent = new Set(['foxhole', 'trench', 'ditch']);
      const drafts = (ext['asl.fortifications'] as { counters: { hex: string; kind: string; side: string }[] } | undefined)?.counters ?? [];
      for (const id of pendingBeneath) {
        const p = pieces[id];
        if (!p || p.loc.kind !== 'hex' || p.loc.sub) continue;
        const here = drafts.filter((c) => c.hex === (p.loc as { hex: string }).hex && c.side === placing.owner);
        const e = here.find((c) => ent.has(c.kind));
        const w = here.find((c) => c.kind === 'wire');
        if (!e && !w) continue;
        pieces[id] = { ...p, loc: { ...p.loc, pos: { ...(e ? { ent: e.kind as 'foxhole' } : {}), ...(w ? { wire: 'beneath' as const } : {}) } } };
      }
    }
    return { ...base, pieces, ext };
  }, [placing, pending, swAssign, swTodo, vehicleTodo, pendingCe, pendingConcealed, theirDraft, state, statics, pendingCa, pendingTca, env, viewer, seeAll, fortDraft, pendingBeneath, pendingBelts]);
  /** The visible state as a query environment, for everything that lists or inspects what is on the board. */
  const shownEnv: QueryEnv = useMemo(() => engine.env(shown), [engine, shown]);
  /** The stack card is drawn: it is up, nothing hides it (T held, counters hidden, a wheel or facing ring) and the hex has something to list. */
  const peekDrawn = !!peek && stackCard && !unitsHidden && !peekTerrain && !wheel && !caFor && !ring && hasPeek(shownEnv, peek.hex);
  // Esc closes the card while it is up (the keyboard handler above is installed once, so it reads this ref).
  closePeekRef.current = peekDrawn ? () => (closePeek(), true) : null;
  // A card that closes or is hidden under the pointer gets no pointerleave: the pointer is off it all the same,
  // or the card, drawn again where it was, would stay up once the pointer has moved on.
  useEffect(() => {
    if (!peekDrawn) hover.current.overCard = false;
  }, [peekDrawn]);
  // A chit wheel whose counter is gone (eliminated by the opponent online, or taken back) is not drawn and gets no
  // onClose: close it here, or the card it came from stays pinned.
  useEffect(() => {
    if (chitWheel && !state.pieces[chitWheel.piece]) closeChitWheel();
  }, [chitWheel, state]);
  /** The fortification counters this viewer may see, draft ones included, for the board and the wheel (full ASL A12.33). */
  const fortHexes = useMemo((): FortHex[] => {
    if (statics.scenario.ruleset !== 'full-asl') return [];
    // The arrowed end counters of Known minefield belts (B28.46), each pointing along its belt.
    const belts = fortificationsState(shownEnv)?.belts ?? [];
    const beltArrowOf = (hex: HexId): { beltArrow?: number } => {
      for (const b of belts) {
        const path = beltHexes(shownEnv, b);
        if (!path || path.length < 2) continue;
        if (hex === b.from) return { beltArrow: sideToward(statics.map, hex, path[1]!) ?? 0 };
        if (hex === b.to) return { beltArrow: sideToward(statics.map, hex, path[path.length - 2]!) ?? 0 };
      }
      return {};
    };
    return fortificationView(shownEnv, viewer).map((c) => ({
      hex: c.hex,
      kind: c.kind,
      marker: fortMarker(c),
      ...(c.hidden && !c.revealed ? { hidden: true } : {}),
      ...(c.hexside !== undefined ? { hexside: c.hexside, extension: roadblockExtension(shownEnv, c) } : {}),
      ...(c.ca !== undefined ? { ca: c.ca } : {}),
      // A pillbox whose contents the viewer may not inspect, holding units (ASLRB B30.7).
      ...(c.kind === 'pillbox' && c.occupied ? { occupied: true } : {}),
      ...(c.kind === 'mines' && trailBreaksAt(shownEnv, c.hex).length ? { tbs: trailBreaksAt(shownEnv, c.hex) } : {}),
      ...(c.kind === 'mines' && partialTbsAt(shownEnv, c.hex).length ? { partial: partialTbsAt(shownEnv, c.hex).map((p) => p.side) } : {}),
      ...(c.kind === 'mines' ? beltArrowOf(c.hex) : {}),
      label: fortKindName(c),
      // The card the roadblock's bar shows under the pointer (ASLRB B29.2–B29.5).
      ...(c.kind === 'roadblock' && c.hexside !== undefined
        ? (() => {
            const o = roadblockObstacles(shownEnv).find((x) => x.id === c.id);
            const where = o ? `${hexLabel(o.a)}–${hexLabel(o.b)}` : hexLabel(c.hex);
            return { tip: `Roadblock ${where}${c.hidden && !c.revealed ? ' (hidden)' : ''}: a stone wall across the hexside. Half-Level LOS obstacle; +2 TEM in either hex (Wall Advantage); Infantry +1 MF to cross; no vehicle crosses; removed by Clearance, a DC Placed through it, or an HE KIA (ASLRB B29.2–B29.5)` };
          })()
        : {}),
    }));
  }, [shownEnv, viewer, statics]);
  /** The counters of this player's own side in a hex, the draft's included (the wheel's entries while setting up). */
  const fortificationsHereOf = (hex: HexId) => (placing ? fortificationView(shownEnv, placing.owner).filter((c) => c.hex === hex && c.side === placing.owner) : []);
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
    const err = placementIllegal(shownEnv, placing.owner, todo, next, true);
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
      const { [id]: ___, ...tca } = pendingTca;
      setPendingTca(tca);
      if (caFor === id) setCaFor(null);
      setSelected((s) => new Set([...s].filter((x) => x !== id)));
    }
  };
  /** Put the fortification counter in hand down in `hex` (full ASL A12.33, B26–B30): hidden where the rule allows, a roadblock on the first road hexside, a pillbox facing the middle of the map, both then offered their ring. */
  const placeFort = (spec: FortSpec, hex: HexId) => {
    if (!placing || !fortRule || fortLocked) return;
    const side = placing.owner;
    const c: FortPlacement = { ...spec, hex, hidden: !(spec.kind === 'mines' && spec.mines?.known) };
    if (c.kind === 'roadblock') {
      const k = [0, 1, 2, 3, 4, 5].find((side) => !counterTerrainIllegal(env, { ...c, hexside: side }));
      if (k === undefined) {
        setError(plain(counterTerrainIllegal(env, { ...c, hexside: 0 })));
        return;
      }
      c.hexside = k;
    }
    if (c.kind === 'pillbox') {
      const hexes = [...statics.map.hexes()];
      const mid = hexes[Math.floor(hexes.length / 2)]?.id;
      c.ca = mid ? pillboxCaToward(env, hex, mid) : 0;
    }
    // A-T mines on a paved road are placed in full view (B28.53).
    if (c.kind === 'mines' && hipIllegal(env, c)) c.hidden = !c.hidden;
    const err = fortPlaceIllegal(env, side, [...pendingForts, c], pendingBelts);
    setError(plain(err));
    if (err) return;
    setPendingForts([...pendingForts, c]);
    setPickedFort(null);
    setFortRingFor(c.kind === 'roadblock' || c.kind === 'pillbox' ? pendingForts.length : null);
    setSelectedHex(hex);
  };
  const unplaceFort = (i: number) => {
    // A belt hex taken back takes its whole belt with it (B28.46: every hex between the arrows is part of it).
    const belt = pendingForts[i]?.belt;
    if (belt) {
      setPendingForts(pendingForts.filter((c) => c.belt !== belt));
      setPendingBelts(pendingBelts.filter((b) => b.id !== belt));
      setFortRingFor(null);
      setError(null);
      return;
    }
    setPendingForts(pendingForts.filter((_, k) => k !== i));
    if (fortRingFor === i) setFortRingFor(null);
    setError(null);
  };
  const changeFort = (i: number, patch: Partial<FortPlacement>) => {
    const next = pendingForts.map((c, k) => (k === i ? { ...c, ...patch } : c));
    const err = placing ? fortPlaceIllegal(env, placing.owner, next, pendingBelts) : null;
    setError(plain(err));
    if (!err) setPendingForts(next);
  };
  /**
   * Lay a Known minefield belt from `from` to `to` (ASLRB B28.46): every hex between, inclusive, becomes a Known minefield
   * record, unmined until a strength is chosen in the tray's strip; a Known minefield already placed there joins the belt.
   */
  const layBelt = (from: HexId, to: HexId, grain: MineBelt['grain']) => {
    if (!placing) return;
    const path = beltHexes(env, { from, to, grain });
    if (!path) {
      setError(`${hexLabel(from)} and ${hexLabel(to)} are not along one ${grain === 'hex' ? 'Hex Grain' : 'Alternate Hex Grain'} (ASLRB B28.46)`);
      return;
    }
    const id = `belt${pendingBelts.length + 1}`;
    const belts = [...pendingBelts, { id, from, to, grain }];
    const forts = pendingForts.map((c) => (c.kind === 'mines' && c.mines?.known && path.includes(c.hex) && !c.belt ? { ...c, belt: id } : c));
    for (const h of path) if (!forts.some((c) => c.kind === 'mines' && c.hex === h)) forts.push({ kind: 'mines', hex: h, hidden: false, mines: { known: true, dummy: true }, belt: id });
    const err = fortPlaceIllegal(env, placing.owner, forts, belts);
    setError(plain(err));
    if (err) return;
    setPendingForts(forts);
    setPendingBelts(belts);
    setBeltTool(null);
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
  /**
   * The placed counters of a hex in the order clicks pick them: the unit a drag takes first, then the
   * other units, then the weapons they carry, so a weapon can be picked up and moved on its own.
   */
  const pickOrderAt = (hex: HexId): PieceId[] => {
    const top = placedAt(hex);
    const units = todo.filter((p) => hexOfLoc(pending[p.id] ?? '') === hex).map((p) => p.id);
    const weapons = swTodo.filter((w) => hexOfLoc(swHexes[w.id] ?? '') === hex).map((w) => w.id);
    return [...(top ? [top] : []), ...units.filter((id) => id !== top), ...weapons];
  };
  const autoPlace = () => {
    if (!placing) return;
    if (fortRule && !fortLocked && pendingForts.length === 0) setPendingForts(defaultFortPlacement(env, placing.owner));
    // Weapons not yet given out go to their card's carriers (or, where the player swapped them, to the unit left without one),
    // and the units are placed with the weapons where they will stand.
    const assign = defaultSwAssignment(env, todo, swAssign);
    const next = defaultPlacement(env, placing.owner, todo, pending, assign);
    if (!next) {
      const why = placementIllegal(env, placing.owner, todo, pending, true, assign);
      setError(why ? `Cannot auto-place the rest: ${plain(why)}` : 'Cannot fit the remaining units around the ones already placed');
      return;
    }
    setPending(next);
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
  const setupError = placing ? plain(placementIllegal(shownEnv, placing.owner, todo, pending, false, swWhere) ?? swAssignmentIllegal(env, placing.owner, todo, swAssign) ?? reserveIllegal(env, placing.owner, todo, pending, swAssign)) : null;
  // A card's deployment hexes with minimums by each (LMA9 SSR 1): how far the placements so far go.
  const anchors = useMemo(() => (placing ? setupAnchorProgress(env, placing.owner, pending, swWhere) : []), [placing, env, pending, swWhere]);
  // A reserve rule (SSR tactical reserve) lets this setup leave units behind to enter later.
  // Reinforcements set up on the map hexes their card names rather than offboard (ASLRB A2.51): the panel says so.
  const appearing = placing?.kind === 'offboardSetup' ? appearMix(todo) : 'none';
  const reserve = useMemo(() => (placing?.kind === 'offboardSetup' ? (todo.map((p) => reserveRuleFor(env, p)).find((r) => r) ?? null) : null), [placing, todo, env]);
  // Every entry edge the card names, and any a reserve rule has since sent units to ('N,E'), as
  // one sorted key: the hex list below is rebuilt only when that set changes, not on every action
  // (BoardView rebuilds its whole canvas when the list it was set up with is replaced).
  const entryEdges = useMemo(() => {
    // A force that appears on map hexes (ASLRB A2.51) enters by no edge: none is drawn for it.
    const edges = new Set(scenario.forces.flatMap((f) => (f.setup.kind === 'enter' && !f.setup.appear ? [f.setup.edge] : [])));
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
  // Offboard hexes a step may enter now (a Recalled AFV at its friendly board edge, SK4 7.10).
  const offboardSteps = useMemo(() => offboardStepKey(legal, statics.map), [legal, statics]);
  const offboardShown = useMemo(() => offboardHexesShown(statics.map, entryEdges, exitAreas, offboardSteps), [entryEdges, exitAreas, offboardSteps, statics]);
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
    setSnapAim(false);
  };

  const run = (a: Omit<Action, 'side' | 'decisionId'>, keepSelection = false) => {
    if (resolving) return 'Wait for the dice: the last action is still being resolved';
    setSnapShown(null);
    const err = session.act(a);
    setError(plain(err));
    if (!err && !keepSelection) reset();
    return err;
  };
  /** The latest `run`, for callbacks held by memoised overlays. */
  const runRef = useRef(run);
  runRef.current = run;
  /** Full ASL: the roadblock hexside the moving stack has just crossed into its hex (ASLRB B29.4), named for the prompt. */
  const roadblockCrossed = (): string | null => {
    if (!fullAslRules || !ms?.hex || !ms.from || ms.hexesEntered === 0) return null;
    const last = ms.trail?.[ms.trail.length - 1];
    if (!last || last.hex !== ms.hex || last.mp !== ms.mfHere) return null;
    return roadblockBetween(env, ms.from, ms.hex) ? `${hexLabel(ms.from)}–${hexLabel(ms.hex)}` : null;
  };
  /** The Wire Exit drs for a prompt: each unit's dr, the MF it paid and where it ended (ASLRB B26.4). */
  const wireDrText = (drs: WireExitResult[]) =>
    drs.map((r) => `${pieceLabel(env, state.pieces[r.unit]).replace(/^\S+ /, '')} rolled ${r.dr}: ${r.outcome === 'beneath' ? `beneath the Wire (${r.mf} MF)` : `hung up on top (${r.mf} MF)`}`).join('; ');
  /** The legal next rout step of a unit into `to` (normal, or Low Crawl as chosen for a first step), if any. */
  const routStepTo = (unit: PieceId, to: HexId, crawl = lowCrawl && !routing, woods = false) => {
    const opts = legal.filter((a) => a.type === 'rout.step' && a['unit'] === unit && !!a['lowCrawl'] === crawl && !!a['woods'] === woods);
    const loc = clickLoc(opts.map((a) => a['to'] as string), to, hexOfId(state, unit));
    return opts.find((a) => a['to'] === loc);
  };
  /**
   * Why a broken unit may not take its first rout step into each hex beside it, distinct reasons only. A rout
   * may never shorten the range to a Known enemy unit in LOS, broken or far away (ASLRB A10.51), which can box
   * a unit in with no hex to go to; without the reason the map just stays dark.
   */
  const routRefusals = (unit: PieceId, only?: HexId): string[] => {
    const p = state.pieces[unit];
    if (p?.loc.kind !== 'hex') return [];
    // The off-board hex beyond an edge hex too: the rules say why it may not be entered (ASLRB A2.6).
    const offEdge = only && statics.map.offboardHex(only) && statics.map.offboardNeighbors(only).onboard.includes(p.loc.hex) ? [only] : [];
    const near = [...statics.map.neighbors(p.loc.hex), ...offEdge].filter((h) => !only || h === only);
    return [...new Set(near.map((to) => plain(session.check({ type: 'rout.step', unit, to }))).filter((m): m is string => !!m))];
  };
  /** Whether the routing unit may end its rout where it stands (a legal building or woods hex, SK1 3.6). */
  const canStopRout = !!routing && legal.some((a) => a.type === 'rout.stop' && a['unit'] === routing.unit);
  /**
   * A rout standing in a building or woods hex it may not end in: the engine's reason, naming the hex it must reach
   * (SK1 3.6: the nearest one in MF, unless that one may be ignored), so the hex is not taken for anything but shelter.
   */
  const routStopWhy = (() => {
    if (!routing || canStopRout) return null;
    const at = hexOfId(state, routing.unit);
    return at && terrainOf(env, at).routShelter ? plain(session.check({ type: 'rout.stop', unit: routing.unit })) : null;
  })();
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
  // Fire lined up on a weapon or unit the game has since taken away (destroyed, dropped, passed, eliminated by
  // enemy fire) is dropped, so the panel and the map clicks never aim a weapon nobody possesses.
  useEffect(() => {
    const fix = staleFire(env, { selected, declared, gunShot, pfShot });
    if (!fix) return;
    setSelected(fix.selected);
    if (fix.declared !== declared) setDeclared(fix.declared);
    if (fix.clearGunShot) setGunShot(null);
    if (fix.clearPfShot) setPfShot(null);
    if (fix.clearGunShot || fix.clearPfShot || fix.declared !== declared) setTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  // Ending a phase with rallies unrolled, units unmoved or reinforcements still offboard asks first.
  const [endAsk, setEndAsk] = useState<EndPhaseWarning | null>(null);
  useEffect(() => setEndAsk(null), [decision?.id]);
  /** A wheel entry for one DM choice (SK1 3.1 g). */
  const dmItem = (c: DmChoice): WheelItem =>
    action(c.label, () => run({ type: c.kind === 'keep' ? 'rally.dmKeep' : 'rally.dmRemove', unit: c.unit }), {
      icon: c.kind === 'keep' ? '⚑' : '⚐',
      disabled: !!c.why,
      hint: plain(c.why) ?? c.hint,
    });
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
          : (() => {
              // Full ASL: a MF spent within the hex to go beneath or climb out of its entrenchment (ASLRB B27.4, A8.12).
              const se = ms && statics.scenario.ruleset === 'full-asl' ? stackEntrenchment(env, ms) : null;
              // The stack's latest expenditure was in its own hex: nothing entered this move yet, or a second trail entry for the hex.
              const trail = ms?.trail ?? [];
              const inPlace = !!ms?.hex && trail.length > 0 && trail[trail.length - 1]!.hex === ms.hex && (ms.hexesEntered === 0 || trail.filter((t) => t.hex === ms.hex).length >= 2);
              const drs = statics.scenario.ruleset === 'full-asl' ? lastWireExit(env) : null;
              if (drs) return { title: `Defensive First Fire · ${at}`, text: `Wire Exit dr: ${wireDrText(drs)}. Fire at them now, or pass (ASLRB B26.4)` };
              if (se && inPlace) {
                const name = entrenchmentName(se.counter);
                return { title: `Defensive First Fire · ${at}`, text: se.beneath ? `Enemy units are going beneath the ${name} (+2 TEM, no FFMO once there): fire at them now, or pass` : `Enemy units are climbing out of the ${name} (no TEM on top, FFMO in Open Ground): fire at them now, or pass` };
              }
              return { title: `Defensive First Fire · ${at}`, text: `Enemy units are moving${ms && assaultMoving(ms) ? ' by Assault Movement (no FFNAM)' : ''}${se?.beneath ? ` beneath the ${entrenchmentName(se.counter)} (+2 TEM)` : ''}: fire at them now, or pass to let them move on` };
            })()
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
          return { sw, label: p ? pieceLabel(env, p).replace(/^\S+ /, '') : sw, at: hexOfId(state, holder), target: c.hex, targetName: hexLabel(c.hex), residual: rofDeclineResidual(env, sw)?.residual ?? 0, canFire };
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
    // A vehicle waiting offboard to enter turns there too, from its offboard hex (SK4 3.3, 3.3.2).
    const at = moverHex(ms);
    if (decision.kind === 'phase' && phase === 'MPh' && ms?.vehicle && at) {
      const v = state.pieces[ms.units[0]!]!;
      return { v, hex: at, moving: true, turn: (vca) => ({ type: 'vmove.turn', vca }), turret: (tca) => ({ type: 'vmove.turret', tca }), hullHint: '1 MP, 2 and a Bog Check in woods or a building', turretHint: 'free, as far round as you like, once per MP spent' };
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
  // Full ASL: a Gun set up in a pillbox takes its Covered Arc, with no choice (ASLRB B30.1): no facing ring for it.
  const pillboxCaOf = (gunId: PieceId): number | undefined => {
    const by = swAssign[gunId];
    const loc = by ? pending[by] : undefined;
    const pb = loc && isPillboxLoc(loc) ? fortificationsHereOf(hexOfLoc(loc)).find((c) => c.kind === 'pillbox') : undefined;
    return pb?.ca !== undefined ? arcSpine(pb.ca) : undefined;
  };
  const caLeft = gunTodo.filter((g) => swAssign[g.id] && pendingCa[g.id] === undefined && pillboxCaOf(g.id) === undefined).length;
  const gunsField = Object.fromEntries(gunTodo.filter((g) => swAssign[g.id] && (pendingCa[g.id] !== undefined || pillboxCaOf(g.id) !== undefined)).map((g) => [g.id, { ca: pillboxCaOf(g.id) ?? pendingCa[g.id]!, ...(pendingHip.has(g.id) ? { hip: true } : {}) }]));
  // A vehicle may dig in only where it sets up on the map and a special rule lets its side do so.
  const digInRule = placing ? digInParams(env, placing.owner) : undefined;
  // Squads a special rule lets the side split into half-squads at setup (LMA7 SSR 3, `setup-deploy`).
  const deployRule = placing ? setupDeployParams(env, placing.owner) : undefined;
  // Full ASL A2.9: the group's 10% (FRU), with the squads still to place; a nationality that may not Deploy gets its reason.
  const aslSetupQuota = useMemo(() => {
    if (!placing || statics.scenario.ruleset !== 'full-asl') return null;
    const squads = todo.filter((p) => defOf(env, p).kind === 'squad');
    const any = squads[0] ?? todo.find((p) => p.tags[DEPLOYED_FROM] !== undefined);
    const quota = any ? deployQuota(env, placing.owner, any.id) : null;
    return quota ? { quota, squads } : null;
  }, [placing, todo, env, statics]);
  const canDigIn = (id: PieceId) => !!digInRule && !digInRule.defs && placing?.kind === 'setup' && !!pending[id];
  const vehiclesField = Object.fromEntries(vehicleTodo.filter((v) => pending[v.id]).map((v) => [v.id, { vca: pendingCa[v.id] ?? defaultVca(env, pending[v.id]!), ...(pendingTca[v.id] !== undefined && vehicleDef(env, v)?.turret !== 'NT' ? { tca: pendingTca[v.id] } : {}), ...(pendingCe.has(v.id) ? { ce: true } : {}), ...(pendingDugIn.has(v.id) && canDigIn(v.id) ? { dugIn: true } : {}) }]));
  // Hidden units (SSR): only those still placed where hiding is allowed go into the setup.
  const hiddenRule = hiddenUnitsParams(env);
  // A card that sets whole forces up hidden (LMA4 SSR 2) leaves no choice: the engine hides them as the setup is placed.
  const hiddenByRule = hiddenRule?.forces?.length && placing?.owner === hiddenRule.side ? compulsoryHidden(env, todo.map((p) => p.id), pending) : [];
  const hideable = (id: PieceId) => !!hiddenRule && !hiddenRule.forces?.length && placing?.owner === hiddenRule.side && !!pending[id] && !hideIllegal(env, id, hexOfLoc(pending[id]!), swAssign);
  const hiddenField = [...pendingHidden].filter(hideable).sort();
  /** Squad equivalents of MMC hidden so far, against a hidden-units quota (SK4 8.1.8.5). */
  const hiddenSe = squadEquivalents(env, hiddenField.map((id) => state.pieces[id]!).filter((p) => p && mmc(env, p)));
  // Concealment (SK4 8.3): OB counters, one per stack in Concealment Terrain; the engine conceals unseen units itself.
  const concealmentOn = concealmentActive(env) && !!placing && placing.kind === 'setup';
  const obConceal = concealmentOn ? obConcealment(env, placing!.owner) : { total: 0, used: 0 };
  const concealable = (id: PieceId) => concealmentOn && !!pending[id] && !!statics.map.hex(pending[id]!) && env.query('hex.concealmentTerrain', { hex: pending[id]! }, false) && !isSw(id) && !vehicleTodo.some((v) => v.id === id);
  const concealedField = [...pendingConcealed].filter(concealable).sort();
  const concealedStacks = new Set(concealedField.map((id) => pending[id]!)).size;
  // Units beneath their hex's foxhole, trench or Wire (full ASL B27.1, B26.4): only those still placed where a counter of theirs is.
  const beneathField = [...pendingBeneath].filter((id) => pending[id] && !isPillboxLoc(pending[id]!) && fortificationsHereOf(hexOfLoc(pending[id]!)).some((c) => c.kind !== 'mines' && c.kind !== 'roadblock' && c.kind !== 'pillbox')).sort();
  const fortLeftOver = fortRule && !fortLocked ? fortLeftovers(fortPools(env, placing!.owner, pendingForts)) : [];
  const fortBlocked = fortRule && !fortLocked ? plain(fortPlaceIllegal(env, placing!.owner, pendingForts, pendingBelts)) : null;
  const setupAction = placing
    ? {
        type: placing.kind === 'setup' ? 'setup.place' : 'setup.offboard',
        placements: pending,
        ...(Object.keys(swAssign).length ? { sw: swAssign } : {}),
        ...(Object.keys(gunsField).length ? { guns: gunsField } : {}),
        ...(Object.keys(vehiclesField).length ? { vehicles: vehiclesField } : {}),
        ...(hiddenField.length ? { hidden: hiddenField } : {}),
        ...(concealedField.length ? { concealed: concealedField } : {}),
        ...(beneathField.length ? { beneath: beneathField } : {}),
      }
    : null;
  /** One Confirm: the counters go first (`fort.place`), the units follow once they are accepted. */
  const sendSetup = () => {
    if (!placing || !setupAction) return;
    if (fortRule && !fortLocked) {
      afterFort.current = setupAction;
      const err = run({ type: 'fort.place', counters: pendingForts, ...(pendingBelts.length ? { belts: pendingBelts } : {}) }, true);
      if (err) afterFort.current = null;
      return;
    }
    run(setupAction);
  };
  useEffect(() => {
    if (fortLocked && afterFort.current) {
      const a = afterFort.current;
      afterFort.current = null;
      run(a);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fortLocked]);
  const confirmSetup = placing
    ? {
        label: 'Confirm setup',
        icon: '✔',
        blocked:
          setupError ??
          fortBlocked ??
          (reserve ? null : setupLeft > 0 ? `${setupLeft} unit(s) still to place` : swLeft > 0 ? `${swLeft} weapon(s) still to place` : caLeft > 0 ? `${caLeft} Gun(s) still need a Covered Arc: click a segment of the ring around each (face…)` : null),
        ...(reserve && setupLeft > 0 ? { hint: `${setupLeft} unit(s) stay in reserve and enter on Turn ${reserve.turn}` } : {}),
        onClick: () => (fortLeftOver.length ? setFortConfirm(fortLeftOver) : sendSetup()),
      }
    : null;

  // ------------------------------------------------------------------ fortified buildings (SSR)
  /** The fortifying side's pre-designation step, when it is this player's to make. */
  const fortifying = owner && decision?.kind === FORTIFY_DECISION ? decision : null;
  const fortMax = fortifying ? Number(fortifying.data?.['count'] ?? 0) : 0;
  /** Designation by Location (ASLRB B23.911): picks are Locations and clicks cycle a hex's levels; else whole buildings. */
  const fortByLoc = fortifying?.data?.['unit'] === 'location';
  const fortExact = fortByLoc && fortifying?.data?.['exact'] === true;
  const fortifiable = useMemo(() => (fortifying ? (fortByLoc ? fortifiableLocations(env, fortifying.owner) : fortifiableBuildings(env, fortifying.owner)) : []), [fortifying, fortByLoc, env]);
  const [fortPicks, setFortPicks] = useState<string[]>([]);
  useEffect(() => setFortPicks([]), [fortifying?.id]);
  /** Every hex of a building, by its id (building ids are the engine's; players see hexes). */
  const buildingHexes = (id: string): HexId[] => [...statics.map.hexes()].filter((h) => h.buildingId === id).map((h) => h.id);
  const buildingLabel = (id: string) => {
    const hs = buildingHexes(id);
    return hs.length > 1 ? `${hexLabel(hs[0]!)} (${hs.length} hexes)` : hexLabel(hs[0] ?? id);
  };
  const fortLocLabel = (loc: string) => `${hexLabel(hexOfLoc(loc))} ${levelOfLoc(loc) ? `level ${levelOfLoc(loc)}` : 'ground'}`;
  const fortPicksArg = (picks: string[]) => (fortByLoc ? { locations: picks } : { buildings: picks });
  const toggleFortify = (hex: HexId) => {
    if (!fortifying) return;
    const b = statics.map.hex(hex)?.buildingId;
    if (fortByLoc) {
      // Each click on a building hex cycles: nothing → the ground → the ground and level 1 → nothing (B23.912: the ground first).
      const levels = fortifiable.filter((l) => hexOfLoc(l) === hex).sort((a, c) => levelOfLoc(a) - levelOfLoc(c));
      if (!b || levels.length === 0) {
        setError(b ? 'That building is outside your setup area' : 'Click a building hex');
        return;
      }
      const have = levels.filter((l) => fortPicks.includes(l)).length;
      const want = have >= levels.length ? 0 : have + 1;
      const next = [...fortPicks.filter((l) => hexOfLoc(l) !== hex), ...levels.slice(0, want)];
      const err = fortifyIllegal(env, fortifying.owner, fortPicksArg(next));
      // Over the count: say so, and leave the picks as they were.
      setError(err && /At most/.test(err) ? plain(err) : null);
      if (!err || !/At most/.test(err)) setFortPicks(next);
      return;
    }
    if (!b || !fortifiable.includes(b)) {
      setError(b ? 'That building is outside your setup area' : 'Click a building hex');
      return;
    }
    const next = fortPicks.includes(b) ? fortPicks.filter((x) => x !== b) : [...fortPicks, b];
    const err = fortifyIllegal(env, fortifying.owner, fortPicksArg(next));
    setError(plain(err));
    if (!err) setFortPicks(next);
  };
  const confirmFortify = fortifying
    ? {
        // The designation comes before any unit is placed (a pre-designation, ASLRB B23.911): the button says what follows.
        label: `${fortPicks.length ? `Fortify ${fortPicks.length} ${fortByLoc ? 'Location' : 'building'}${fortPicks.length === 1 ? '' : 's'}` : 'Fortify none'}, then set up units`,
        icon: '✔',
        blocked: plain(fortifyIllegal(env, fortifying.owner, fortPicksArg(fortPicks))),
        onClick: () => run({ type: 'fortify.designate', ...fortPicksArg(fortPicks) }),
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
  /** Full ASL Fire and rubble (B25, B24): every record is public, so the board and the peek card show them all. */
  const fullAslRules = statics.scenario.ruleset === 'full-asl';
  const fireHexes = useMemo((): FireHex[] => {
    if (!fullAslRules) return [];
    const heavy = windOf(env).force === 'heavy';
    return fireView(env).map((f) => ({ loc: f.loc, ...(f.blaze ? { blaze: true, smoke: !heavy } : {}), flames: f.flames.length, ...(f.flames.some((x) => x.hampered) ? { hampered: true } : {}) }));
  }, [env, fullAslRules]);
  const rubbleHexes = useMemo((): RubbleHex[] => (fullAslRules ? rubbleView(env).map((r) => ({ hex: r.hex, from: r.from, kind: r.kind, ...(r.burning ? { burning: true } : {}), ...(trailBreaksAt(env, r.hex).length ? { tbs: trailBreaksAt(env, r.hex) } : {}) })) : []), [env, fullAslRules]);
  /** The full ASL wind and EC for the HUD (B25.5, B25.63–B25.65); null under the Starter Kit, which has neither. */
  const aslWind = useMemo(() => {
    if (!fullAslRules) return null;
    const w = windOf(env);
    const ec = ecState(env);
    return { force: w.force, dir: w.dir, gusts: !!w.gusts, gustDir: w.gustDir, ec: ec ? { name: EC_NAME[ec.ec], drm: ec.drm } : null };
  }, [env, fullAslRules]);
  /** The fortified Locations this viewer may know of, with their Breaches, and the picks being made. */
  const fortifiedLocs = useMemo((): { loc: string; breached: HexId[] }[] => {
    if (!fortState) return [];
    const out = fortState.locations
      ? fortifiedView(env, fortViewer)
      : [...statics.map.hexes()].filter((h) => h.buildingId && fortifiedKnownTo(env, h.id, fortViewer)).flatMap((h) => locationsOf(env, h.id).map((loc) => ({ loc, breached: [] })));
    if (fortifying) for (const pick of fortPicks) for (const loc of fortByLoc ? [pick] : buildingHexes(pick)) if (!out.some((x) => x.loc === loc)) out.push({ loc, breached: [] });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fortState, fortViewer, env, fortifying, fortPicks, fortByLoc]);
  const fortifiedShown = useMemo((): FortifiedHex[] => {
    const byHex = new Map<HexId, FortifiedHex>();
    for (const { loc, breached } of fortifiedLocs) {
      const hex = hexOfLoc(loc);
      const f = byHex.get(hex) ?? { hex };
      if (levelOfLoc(loc) > 0) f.upper = true;
      const sides = breached.map((toward) => sideToward(statics.map, hex, toward)).filter((k): k is number => k !== null);
      if (sides.length) f.breached = [...(f.breached ?? []), ...sides];
      byHex.set(hex, f);
    }
    // A badge only where the ground is shown too; a level shown alone (never by the rules) is still marked.
    for (const f of byHex.values()) if (f.upper && !fortifiedLocs.some((x) => x.loc === f.hex)) f.upperOnly = true;
    return [...byHex.values()];
  }, [fortifiedLocs]);
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
  /**
   * The turn a vehicle's weapons make before they fire at `target`: the turret for its CMG/RMG/IFE (case 8, SK4 3.2.4),
   * else the hull for its BMG (NT case 8, SK4 7.8); none with Infantry in the group.
   */
  const armTurn = (sw: PieceId[], target: HexId, units: PieceId[]): { tca?: number; vca?: number } => {
    if (units.length > 0) return {};
    const tca = turretTurnFor(env, { sw, target });
    if (tca !== undefined) return { tca };
    const vca = hullTurnFor(env, { sw, target });
    return vca !== undefined ? { vca } : {};
  };
  /** A declaration without its turn, to be worked out again for what is left of it. */
  const unturned = (d: FireDeclaration): FireDeclaration => {
    const { tca: _tca, vca: _vca, ...base } = d;
    return base;
  };
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
    // A vehicle's CMG/RMG/IFE aimed outside the turret's arc turn it first, paying case 8 (SK4 3.2.4), as a Gun turns to fire;
    // its BMG outside the hull's arc turns the hull (SK4 7.8).
    return { units, sw: sws, target: at, ...(directors.length ? { directors } : {}), ...armTurn(sws, at, units) };
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
    const moving = ms ? { moving: firstFireTargetsAt(env, ms, decl.target) } : {};
    const illegal = (d: FireDeclaration) => plain(env.query('fire.illegal', { decl: d, mode: fireModeFor(d), side: owner, ...moving }, null));
    if (!illegal(decl)) return [];
    const units = decl.units.filter((u) => !holders.includes(u));
    return illegal({ ...unturned(decl), units, ...armTurn(decl.sw, decl.target, units) }) ? [] : holders;
  };
  /** The chosen group with its half-squads and crews firing the weapons they hold instead of their own FP (`holdersFiringSw`). */
  const withSwFirers = (decl: FireDeclaration): FireDeclaration => {
    const holders = holdersFiringSw(decl);
    if (!holders.length) return decl;
    const units = decl.units.filter((u) => !holders.includes(u));
    return { ...unturned(decl), units, ...armTurn(decl.sw, decl.target, units) };
  };
  /** The declaration the selected fire group makes against `at`: as chosen, its HS/crews firing their SW, less any SW left out (`swLeftOut`). */
  const buildDecl = (at: HexId): FireDeclaration => {
    const decl = withSwFirers(chosenDecl(at));
    const out = swLeftOut(decl);
    let built = decl;
    if (out.length) {
      // What is left may need a different turn, or none (the BMG left out of a CMG's turn needs it still; a CMG left out, no turn).
      const sw = decl.sw.filter((id) => !out.some((l) => l.id === id));
      built = { ...unturned(decl), sw, ...armTurn(sw, at, decl.units) };
    }
    const marked = markedLeftOut(built);
    const kept = marked.ids.length ? { ...built, units: built.units.filter((u) => !marked.ids.includes(u)) } : built;
    const far = rangeLeftOut(kept);
    return far.length ? { ...kept, units: kept.units.filter((u) => !far.includes(u)) } : kept;
  };
  /**
   * Units beyond their range of the target (`beyondRange`) that keep the rest of the group from shooting: they stay
   * out when that makes the shot legal, so a stack picked up whole fires the MG its out-of-range squad holds (SK1 4.0).
   */
  const rangeLeftOut = (decl: FireDeclaration): PieceId[] => {
    if (!owner) return [];
    const moving = ms ? { moving: firstFireTargetsAt(env, ms, decl.target) } : {};
    const illegal = (d: FireDeclaration) =>
      decision?.kind === 'firstFire' ? plain(session.check({ type: 'defFire', decl: d })) : plain(env.query('fire.illegal', { decl: d, mode: fireModeFor(d), side: owner, ...moving }, null));
    const far = beyondRange(env, decl);
    if (!far.length || !illegal(decl)) return [];
    const rest = { ...decl, units: decl.units.filter((u) => !far.includes(u)) };
    return rest.units.length + rest.sw.length > 0 && !illegal(rest) ? far : [];
  };
  /**
   * Units already marked First Fire (and leaders so marked) that keep the Defensive First Fire group from shooting: they
   * fire again only as Subsequent First Fire (SK1 3.3.1: within normal range, at the nearest target), while the MG that
   * kept ROF may fire alone. Like a SW in `swLeftOut`, they stay out when that makes the rest of the group's shot legal.
   */
  const markedLeftOut = (decl: FireDeclaration): { ids: PieceId[]; why: string | null } => {
    if (!owner || decision?.kind !== 'firstFire') return { ids: [], why: null };
    const illegal = (d: FireDeclaration) => plain(session.check({ type: 'defFire', decl: d }));
    const why = illegal(decl);
    if (!why) return { ids: [], why: null };
    const ids = decl.units.filter((u) => fireMarker(state.pieces[u]!) === 'first');
    const rest = { ...decl, units: decl.units.filter((u) => !ids.includes(u)) };
    return ids.length && rest.units.length + rest.sw.length > 0 && !illegal(rest) ? { ids, why } : { ids: [], why: null };
  };
  /**
   * The selected SW that cannot fire at this target on their own (a FT out of range, a MMG or HMG
   * whose holder moved before the AFPh, …) and would make the group's shot illegal: they stay out of
   * it, so the rest of the group fires without unticking them (tester request 2026-11-06). Only when
   * leaving them out makes the shot legal; otherwise the group is shown as chosen, with its reason.
   */
  const swLeftOut = (decl: FireDeclaration): { id: PieceId; why: string }[] => {
    if (!owner || decl.sw.length === 0) return [];
    const moving = ms ? { moving: firstFireTargetsAt(env, ms, decl.target) } : {};
    const illegal = (d: FireDeclaration) => plain(env.query('fire.illegal', { decl: d, mode: fireModeFor(d), side: owner, ...moving }, null));
    if (!illegal(decl)) return [];
    const out = decl.sw.flatMap((id) => {
      const why = illegal({ units: [], sw: [id], target: decl.target, ...armTurn([id], decl.target, []) });
      return why ? [{ id, why }] : [];
    });
    const restSw = decl.sw.filter((id) => !out.some((l) => l.id === id));
    const rest: FireDeclaration = { ...unturned(decl), sw: restSw, ...armTurn(restSw, decl.target, decl.units) };
    // The rest may be legal only once its units beyond range step out too (`rangeLeftOut` takes them next): a moved
    // MMG and the squads beyond range that carried it leave their LMG to fire alone (SK1 3.2, 3.5, 4.0).
    const shoots = (d: FireDeclaration) => d.units.length + d.sw.length > 0 && !illegal(d);
    if (out.length > 0) return shoots(rest) || shoots(withinRange(env, rest)) ? out : [];
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
  // A leader marked First Fire directing only weapons not yet marked (a MG's Multiple ROF shot) stays First Fire: he
  // "can direct the fire of a MG as many times as the MG can fire" (ASLRB A7.53).
  const directsRofOnly = (id: PieceId) =>
    directors.includes(id) &&
    [...selected].filter((x) => x !== id && !directors.includes(x)).every((x) => {
      const p = state.pieces[x];
      return !!p && !p.tags['fire'] && defOf(env, p).kind === 'sw';
    });
  const declMarkerOf = (id: PieceId): string | null =>
    decision?.kind === 'firstFire'
      ? state.pieces[id]?.tags['fire'] && !(state.pieces[id]?.tags['fire'] === 'first' && directsRofOnly(id)) ? 'Final' : 'First'
      : phase === 'PFPh' ? 'FirePrep' : phase === 'AFPh' ? 'FireAdv' : phase === 'DFPh' ? 'Final' : null;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  /** The hexside a Snap Shot at the moving stack in `loc` may be traced to now (full ASL, ASLRB A8.15), or null. */
  const snapAt = (loc: string): [HexId, HexId] | null => (decision?.kind === 'firstFire' ? env.query('fire.snapSide', { target: loc }, null) : null);
  const fireDecl: FireDeclaration | null = useMemo(() => {
    if (!(isFireDecision && target && selected.size > 0)) return null;
    const snap = snapAim ? snapAt(target) : null;
    return snap ? snapDeclFor(target, snap).decl : buildDecl(target);
  }, [isFireDecision, target, selected, directors, state, env, snapAim]);

  /** Shoot the declared fire group at `at`: refused (with the reason shown) when the rules do not allow it. */
  /**
   * Why a declared fire is refused, if it is. Defensive First Fire is judged as the engine will judge the shot (its
   * validation adds the Subsequent First Fire and MF-spent limits to `fire.illegal`).
   */
  const fireRefusal = (decl: FireDeclaration, moving?: PieceId[]): string | null => {
    if (!owner) return 'no owner';
    if (decision?.kind === 'firstFire') return plain(session.check({ type: 'defFire', decl }));
    return plain(env.query('fire.illegal', { decl, mode: fireModeFor(decl), side: owner, ...(moving ? { moving } : {}) }, null));
  };
  /** The Panzerfaust lined up (`pfShot`) fired at `at` (SK4 4.4.2): its PF check, then the shot; refused, says why. */
  const firePf = (at: HexId, targetUnit?: PieceId) => {
    if (!owner || !decision || !pfShot) return;
    const pf = { ...pfShot, target: at, ...(targetUnit ? { targetUnit } : {}) };
    const why = plain(pfIllegal(env, owner, pf, decision.kind === 'firstFire' ? 'first' : FIRE_MODE[phase]!, decision.kind === 'firstFire' ? ms?.units : undefined));
    if (why) {
      setTarget(at);
      setError(why);
      return;
    }
    run(decision.kind === 'firstFire' ? { type: 'defFire.pf', pf } : { type: 'fire.pf', pf });
    setPfShot(null);
    setDeclared(false);
  };

  const fireAt = (at: HexId, vsVehicle?: PieceId) => {
    if (!owner || !decision) return;
    const decl: FireDeclaration = { ...buildDecl(at), ...(vsVehicle ? { vsVehicle } : {}) };
    if (decl.units.length + decl.sw.length === 0) {
      setError('No units in the fire group');
      return;
    }
    const illegal = fireRefusal(decl, ms ? firstFireTargetsAt(env, ms, decl.target) : undefined);
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

  /** Full ASL, Defensive First Fire: is this a full ASL game (Snap Shots exist)? */
  const fullAsl = scenarioRuleset(statics.scenario) === 'full-asl';
  /**
   * Full ASL Snap Shot (ASLRB A8.15): the declared group fires at the whole hexside the moving stack crossed in entering the
   * hex. The stack is drawn on that hexside for the shot (`snapShown`); the engine records the hexside with the shot.
   */
  /**
   * The Snap Shot the declared group makes at `loc`: a SW that cannot make one (an ATR, a Gun's IFE, ...) stays out while
   * the rest fires, as `swLeftOut` does for any shot; `out` names what stays out.
   */
  function snapDeclFor(loc: HexId, snap: [HexId, HexId]): { decl: FireDeclaration; out: PieceId[] } {
    const decl: FireDeclaration = { ...buildDecl(loc), snap };
    if (!owner || !ms) return { decl, out: [] };
    const moving = firstFireTargets(env, ms);
    const illegal = (d: FireDeclaration) => env.query('fire.illegal', { decl: d, mode: fireModeFor(d), side: owner, moving }, null);
    if (!illegal(decl)) return { decl, out: [] };
    const out = decl.sw.filter((id) => illegal({ units: [], sw: [id], target: loc, snap }));
    const rest: FireDeclaration = { ...decl, sw: decl.sw.filter((id) => !out.includes(id)) };
    return out.length && rest.units.length + rest.sw.length > 0 && !illegal(rest) ? { decl: rest, out } : { decl, out: [] };
  }
  const snapFireAt = (loc: HexId) => {
    if (!owner || decision?.kind !== 'firstFire' || !ms) return;
    const snap = snapAt(loc);
    if (!snap) return;
    const { decl } = snapDeclFor(loc, snap);
    const why = plain(env.query('fire.illegal', { decl, mode: fireModeFor(decl), side: owner, moving: firstFireTargets(env, ms) }, null));
    if (why) {
      setError(why);
      return;
    }
    const units = firstFireTargets(env, ms);
    if (!run({ type: 'defFire', decl })) setSnapShown({ hex: snap[0], from: snap[1], units });
  };
  /** The Snap Shot entries of the wheel on the moving stack's hex, in full ASL Defensive First Fire (none in the Starter Kit). */
  function snapItems(hex: HexId): WheelItem[] {
    if (!fullAsl || decision?.kind !== 'firstFire' || !ms?.hex || ms.hex !== hexOfLoc(hex) || !owner) return [];
    const loc = moveLoc(ms)!;
    const snap = snapAt(loc);
    if (!snap) {
      // The engine says why (a further MF, the stairs, from off the map, trench to trench, ...).
      const why = snapWhyNot(env, loc) ?? 'No Snap Shot here (ASLRB A8.15)';
      return [action('Snap Shot', () => {}, { icon: '⌁', disabled: true, hint: why })];
    }
    const { decl, out } = snapDeclFor(loc, snap);
    const why = selected.size === 0 ? 'Select your firers first' : plain(env.query('fire.illegal', { decl, mode: fireModeFor(decl), side: owner, moving: firstFireTargets(env, ms) }, null));
    const name = `${short(snap[0])}-${short(snap[1])}`;
    const left = out.length ? ` ${out.map((id) => pieceLabel(env, state.pieces[id])).join(', ')} cannot make a Snap Shot and stays out.` : '';
    return [
      action(`Snap Shot at ${name} (½ FP, no TEM, FFNAM or FFMO)`, () => snapFireAt(loc), {
        icon: '⌁',
        disabled: !!why,
        hint: why ?? `Traced to the whole ${name} hexside the stack crossed (both corners): Area Fire, no TEM of the hex entered, no FFNAM or FFMO, no Residual FP (ASLRB A8.15).${left}`,
      }),
      action('Preview Snap Shot', () => { setTarget(loc); setSnapAim(true); }, { icon: '◎', active: snapAim && target === loc, disabled: selected.size === 0, hint: 'Show the Snap Shot\'s FP, column and DRM in the panel first' }),
    ];
  }

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
  const buildShot = (at: HexId, targetUnit?: PieceId): OrdnanceShot | null => {
    if (!gunShot) return null;
    const ca = caChangeFor(env, gunShot.gun, at);
    // Full ASL: the vehicle named among several enemy vehicles in the Location (ASLRB A5.2), when it is there.
    const named = targetUnit ?? (gunShot.targetUnit && locOf(state, state.pieces[gunShot.targetUnit] ?? ({} as Piece)) === at ? gunShot.targetUnit : undefined);
    return {
      weapon: gunShot.gun,
      target: at,
      targetType: gunShot.targetType,
      ...(gunShot.targetType === 'VTT' && named ? { targetUnit: named } : {}),
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
    const d = g ? shotWeaponOf(env, g) : null;
    if (!g || !d || gs.targetType === 'IFE') return { ammo: null };
    const kind = gs.ammo ?? defaultAmmo(env, g, d);
    const dep = ammoStatus(env, g, d, kind).depletion;
    return { ammo: AMMO_NAME[kind], ...(dep !== undefined ? { depletion: dep } : {}) };
  };
  /** Line up a Gun: it is marked as firing and waits for a target. */
  const declareGun = (gunId: PieceId, targetType: TargetType, intensive = false, ammo?: AmmoKind, backblast?: boolean, director?: PieceId) => {
    setSelectedHex(gunHexOf(env, gunId));
    setSelected(new Set([gunId]));
    setDirectors([]);
    setGunShot({ gun: gunId, holder: weaponHolder(state, gunId), targetType, intensive, ...(ammo ? { ammo } : {}), ...(backblast !== undefined ? { backblast } : {}), ...(director ? { director } : {}) });
    setTarget(null);
    setDeclared(true);
    setError(null);
  };
  /** The moving vehicle's MGs picked for Bounding First Fire fire at `at` (SK4 3.3.2.2). */
  const fireBffMgsAt = (at: HexId) => {
    if (!owner) return;
    const illegal = (sw: PieceId[]) => plain(env.query('fire.illegal', { decl: { units: [], sw, target: at }, mode: 'bounding', side: owner }, null));
    // MGs picked together fire with those that bear on the target (a BMG outside the hull's arc
    // need not stop the CMG): each MG has its own Covered Arc (SK4 7.8).
    const bearing = bffMgs.filter((id) => !illegal([id]));
    const sw = illegal(bffMgs) && bearing.length && !illegal(bearing) ? bearing : bffMgs;
    const err = illegal(sw);
    if (err) setError(err);
    else {
      run({ type: 'vmove.bffMg', decl: { units: [], sw, target: at } }, true);
      setMode('normal');
      setBffMgs([]);
    }
  };
  const fireGunAt = (at: HexId, targetUnit?: PieceId) => {
    if (!owner || !decision || !gunShot) return;
    const shot = buildShot(at, targetUnit);
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
    const p = shot ? thPreview(env, shot, gunMode(), owner, gunMode() === 'bounding' || !ms ? undefined : firstFireTargets(env, ms)) : null;
    // Full ASL: a vehicle Hull Down to the shot (beneath a trench, B27.52; behind a roadblock, B9.36) is named: only a turret hit counts.
    if (p && shot && shot.targetType === 'VTT' && !p.illegal) {
      const hd = shotHullDown(env, shotContext(env, shot, gunMode(), owner), shot.targetUnit ?? enemyVehicleAt(env, shot.target, owner)?.id);
      if (hd) return { ...p, also: [...(p.also ?? []), hullDownLabel(hd)] };
    }
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gunShot, owner, target, env, state, ms, decision, phase]);
  /** Everyone standing in a hex (units and vehicles; held weapons excluded). */
  const unitsHereOf = (hex: HexId): Piece[] => Object.values(state.pieces).filter((p) => p.loc.kind === 'hex' && p.loc.hex === hex && !isWeaponDef(defOf(env, p)));
  /** A vehicle's MGs that have not fired and are not malfunctioned or disabled: `vehicleMgsReady` those whose crew may fire them now. */
  const vehicleMgsUnfired = (v: Piece): Piece[] => swHeldBy(state, v.id).filter((w) => (defOf(env, w) as { kind: string; fixed?: boolean }).fixed && !w.tags['fire'] && !w.tags['malf'] && !w.tags['mgDisabled']);
  // The AAMG only while Crew Exposed (SK4 7.8; ASLRB D1.83), a Buttoned Up Open-Topped AFV only its BMG.
  const vehicleMgsReady = (v: Piece): Piece[] => vehicleMgsUnfired(v).filter((w) => !vehicleMgUnavailable(env, w.id));
  const mgLabel = (mgs: Piece[]) => mgs.map((w) => `${(defOf(env, w) as { type: string }).type} ${(defOf(env, w) as { fp: number }).fp}`).join(' + ');
  /** An enemy AFV the acting side can see: only then is an Infantry MG offered as ordnance (SK4 4.1). */
  const enemyAfvInSight =
    !!owner &&
    Object.values(state.pieces).some((p) => p.side !== owner && p.loc.kind === 'hex' && vehicleDef(env, p) && !p.tags['wreck'] && env.query('piece.visibleTo', { piece: p.id, viewer: owner }, true));
  /** The label of a weapon's Fire entry in this fire phase, when it may still fire there without Intensive Fire; else null. */
  const fireEntryFor = (w: Piece): string | null => {
    const mode = FIRE_MODE[phase];
    if (!owner || !mode || w.tags['fire'] || ordnanceWeaponIllegal(env, w.id, mode, owner)) return null;
    return `Fire ${pieceLabel(env, w).replace(/^\S+ /, '')}`;
  };
  /** Guns of the acting side in a hex, manned and able to fire now (the wheel offers each its target types); MGs too while an AFV is in sight. */
  const gunsFireable = (hex: HexId): Piece[] =>
    owner
      ? [
          ...personnelInHex(env, hex, owner)
            .flatMap((u) => swHeldBy(state, u.id))
            .filter((w) => (ordnanceOf(env, w) || (mgAsOrdnance(env, w) && enemyAfvInSight)) && !w.tags['malf']),
          // A vehicle's Main Armament fires like a Gun (SK3).
          ...Object.values(state.pieces).filter((p) => p.side === owner && p.loc.kind === 'hex' && p.loc.hex === hex && vehicleDef(env, p) && !p.tags['wreck'] && !p.tags['malf'] && !p.tags['maDisabled'] && ordnanceOf(env, p)),
        ]
      : [];

  const firePreview = useMemo(() => {
    if (!fireDecl || !owner) return null;
    const fmode = fireModeFor(fireDecl);
    const illegal = fireRefusal(fireDecl, ms ? firstFireTargets(env, ms) : undefined);
    if (fireDecl.units.length + fireDecl.sw.length === 0) return { illegal: 'Select firing units or SW', fp: 0, column: null, drm: 0, parts: [] as string[] };
    try {
      // The LOS (and so any hindrance along it, or where it crosses a Woods-Road's woods) is only checked once the shot
      // is declared (ASLRB A6.11, SK4 3.2.1), so the preview shows the DRM without it.
      const attack = { ...buildAttack(env, fireDecl, fmode, owner, ms ? firstFireTargets(env, ms) : undefined, ms ? movingInfo(env, ms) : undefined), hindrance: 0, losBlind: true };
      const fp = attackFp(env, attack);
      // A secret DRM (an unrevealed fortified building) is never previewed: see `discloseDrm`.
      const drm = withoutSecrets(env.explain('fire.drm', { attack }, 0));
      return {
        illegal,
        fp,
        column: iftColumn(env, fp),
        drm: drm.value,
        parts: [
          // Full ASL Snap Shot (ASLRB A8.15): say what it is aimed at and why its numbers differ.
          ...(fireDecl.snap ? [`Snap Shot at ${fireDecl.snap.map((h) => h.replace(/^[a-z]+/, '')).join('-')}: ½ FP (Area Fire), no TEM, FFNAM or FFMO; traced to both corners of the hexside`] : []),
          ...drm.trace.filter((t) => !t.suppressedBy && t.label).map((t) => t.label!),
          // A target's own DRM (-1 vs a FT possessor) is on its result alone: named per unit (SK1 4.2, ASLRB A22.4).
          ...targetOwnDrms(env, attack, drm.value),
          'LOS and hindrances are checked when you fire',
        ],
        leftOut: [
          ...holdersFiringSw(chosenDecl(fireDecl.target)).map((u) => `${pieceLabel(env, state.pieces[u])} fires its weapon, not its own FP (SK1 4.0)`),
          ...swLeftOut(withSwFirers(chosenDecl(fireDecl.target))).map((l) => `Left out: ${l.why}`),
          ...(() => {
            const m = markedLeftOut(withSwFirers(chosenDecl(fireDecl.target)));
            return m.ids.length ? [`Left out: ${m.ids.map((u) => pieceLabel(env, state.pieces[u]!).replace(/^\S+ /, '')).join(', ')} (already marked First Fire: ${m.why})`] : [];
          })(),
          ...(() => {
            const far = beyondRange(env, withSwFirers(chosenDecl(fireDecl.target))).filter((u) => !fireDecl.units.includes(u));
            return far.length ? [`Left out: ${far.map((u) => pieceLabel(env, state.pieces[u]!).replace(/^\S+ /, '')).join(', ')} (out of range)`] : [];
          })(),
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
    // A pillbox end (full ASL B30.5: a building for rout) lights its hex; the hex readout says which Location.
    if (routing) {
      const ends = activeRoutEnds(env);
      return { unit: routing.unit, ends: ends ? new Set([...ends].map((h) => hexOfLoc(h))) : ends, endLocs: ends as ReadonlySet<string> | null, viaMines: new Set<HexId>() };
    }
    const units = [...selected].filter((u) => legal.some((a) => a.type === 'rout.step' && a['unit'] === u));
    if (!units.length) return null;
    // Each unit with a building or woods in reach marks its ends; one without (it may go anywhere away from the
    // enemy, SK1 3.6) leaves the others' ends on the map. `ends` is null only when none of them has any.
    const ends = new Set<HexId>();
    const endLocs = new Set<string>();
    // Full ASL: ends reached only through a known minefield, which the rout need not brave (ASLRB B28.413, A10.51).
    const viaMines = new Set<HexId>();
    for (const u of units) {
      const plan = planRout(env, u);
      if (plan.sheltered) for (const h of plan.destinations) {
        ends.add(hexOfLoc(h));
        endLocs.add(h);
      }
      for (const h of plan.viaAvoided ?? []) viaMines.add(hexOfLoc(h));
    }
    return { unit: units[0]!, ends: ends.size ? ends : null, endLocs: endLocs.size ? endLocs : null, viaMines };
  }, [phase, owner, routing, selected, legal, env]);
  /** The ROUT END hexes the rout under way may still reach, as "I5, " (or "I5 or J3, ") ahead of "marked ROUT END". */
  const routEndNames = (() => {
    const at = routing ? hexOfId(state, routing.unit) : '';
    const names = [...(routShown?.ends ?? [])].filter((h) => h !== at).sort().map(hexLabel);
    return names.length ? `${names.join(' or ')}, ` : '';
  })();
  /**
   * Full ASL: each pillbox the router may make for, marked on its own counter (a building for rout, ASLRB B30.5): a
   * ROUT END with the MF of going in, or barred, the hex readout and the wheel giving the rule.
   */
  const pbRoutMarks = useMemo(() => {
    if (!routShown || !fullAslRules || !owner) return null;
    return pillboxRoutMarks(env, owner, routShown.unit, routShown.endLocs, (h) => statics.map.neighbors(h), (a) => plain(session.check(a)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routShown, fullAslRules, owner, env, session, statics]);
  /** The fortifications as drawn, a pillbox the router may make for carrying its rout tag (full ASL B30.5). */
  /** A click on a hex the rout may not enter: a pillbox there barred too gives its own rule (B30.5, B30.42). */
  const pbBarNote = (hex: HexId) => {
    const m = pbRoutMarks?.get(hex);
    return m?.barred ? `. ${m.text}` : '';
  };
  const fortHexesShown = useMemo(
    () => (pbRoutMarks?.size ? fortHexes.map((f) => (f.kind === 'pillbox' && pbRoutMarks.has(f.hex) ? { ...f, rout: { chip: pbRoutMarks.get(f.hex)!.chip, barred: pbRoutMarks.get(f.hex)!.barred } } : f)) : fortHexes),
    [fortHexes, pbRoutMarks],
  );
  const routHover = useMemo(() => {
    if (!routShown || !hoverHex) return null;
    const at = hexOfId(state, routShown.unit);
    const end = routShown.ends?.has(hoverHex) ? (routShown.viaMines.has(hoverHex) ? 'the rout may end here, but only through a known minefield: it need not go this way (ASLRB B28.413)' : 'the rout may end here') : null;
    // Full ASL: a pillbox in the hex, a building for rout (B30.5): its MF, or why the rout may not end in it.
    const mark = pbRoutMarks?.get(hoverHex);
    if (mark) return { text: mark.text, barred: mark.barred };
    const step = { type: 'rout.step', unit: routShown.unit, to: hoverHex, ...(lowCrawl && !routing ? { lowCrawl: true } : {}) };
    // The off-board hex beyond the router's edge hex: the rules' refusal (ASLRB A2.6: no exit in the RtPh).
    const offEdge = !!at && !!statics.map.offboardHex(hoverHex) && statics.map.offboardNeighbors(hoverHex).onboard.includes(at);
    if (offEdge) {
      const err = session.check(step);
      if (err) return { text: plain(err) ?? err, barred: true };
    }
    if (!at || hoverHex === at || !statics.map.neighbors(at).includes(hoverHex)) return end ? { text: end, barred: false } : null;
    const err = session.check(step);
    // Full ASL: a rout step into an overstacked Location pays its MF (ASLRB A5.11; A10.51 "even if overstacked").
    const over = !err && statics.scenario.ruleset === 'full-asl' ? overstackEntryMf(env, hoverHex, [routShown.unit], state.pieces[routShown.unit]!.side) : 0;
    if (over > 0) return { text: `${end ? `${end}; ` : ''}+${over} MF overstacked (ASLRB A5.11; a shelter even if overstacked, A10.51)`, barred: false };
    if (!err || !session.check({ ...step, woods: true })) return end ? { text: end, barred: false } : null;
    const text = plain(err) ?? err;
    const ends = [...(routShown.ends ?? [])].map(hexLabel).sort();
    return { text: ends.length && /nearest legal/.test(text) ? `${text} (${ends.join(', ')})` : text, barred: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routShown, pbRoutMarks, hoverHex, state, lowCrawl, routing, session, env]);
  /**
   * MPh: why the moving stack may not step into the neighbouring hex under the pointer (a stack
   * under Assault Movement may be offered one hex of six, and the player needs to see why).
   */
  const moveHover = useMemo((): { text: string; barred: boolean } | null => {
    if (phase !== 'MPh' || !ms?.hex || !hoverHex || decision?.kind !== 'phase' || !owner || decision.owner !== owner) return null;
    if (!statics.map.neighbors(ms.hex).includes(hoverHex)) return null;
    // Choosing a DC target the question is the placement, not a step: a DC goes into an enemy-occupied hex the stack
    // may not enter (SK4 4.3, ASLRB A23.3), for the MF entering it would cost.
    if (mode === 'dc') {
      // Several Locations there (a Cave and its hill): the click asks which.
      const locs = adjacentLocs(env, moveLoc(ms)!).filter((l) => hexOfLoc(l) === hoverHex);
      // (locName is declared further down the component: this memo runs before it.)
      const where = (l: string) => (isCaveLoc(l) ? `the Cave in ${hexLabel(hexOfLoc(l))}` : locs.some(isCaveLoc) ? 'the hill' : levelOfLoc(l) ? `level ${levelOfLoc(l)}` : 'the ground');
      if (locs.length > 1 && dcPlacement(hoverHex) && !dcPlacement(hoverHex)!.vehicle) return { text: `Place the DC: click to choose ${locs.map(where).join(' or ')}`, barred: false };
      const place = dcPlacement(hoverHex);
      if (!place) return null;
      const err = session.check(place);
      if (err) return { text: plain(err) ?? err, barred: true };
      const placer = (state.pieces[place['dc'] as PieceId]!.loc as { by: PieceId }).by;
      const cost = env.query('move.cost', { unit: placer, from: ms.hex, to: hoverHex, viaRoad: false }, 0);
      const afv = place.vehicle ? state.pieces[place.vehicle] : undefined;
      return { text: `Place the DC here: ${cost} MF${afv ? `, against the ${pieceLabel(env, afv).replace(/^\S+ /, '')} (a PAATC first)` : ''}`, barred: false };
    }
    const err = session.check({ type: 'move.step', to: hoverHex });
    // Full ASL: a step into an overstacked Location names its extra MF and what overstacking brings (ASLRB A5.11, A5.12, A5.131).
    const over = !err && statics.scenario.ruleset === 'full-asl' ? overstackStepNote(env, ms, hoverHex) : null;
    if (over) return { text: `${hexLabel(hoverHex)}: ${over.badge}. ${over.warning}`, barred: false };
    if (!err || !session.check({ type: 'move.step', to: hoverHex, woods: true })) return null;
    return { text: plain(err) ?? err, barred: true };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, ms, hoverHex, decision, owner, session, env, mode]);

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
  const acrossSideOf = (hex: HexId, k: number) => sideHex(statics.map, hex, k) ?? '?';

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
      // A hexside along the map edge is named by the offboard hex beyond it: say so, as that hex is not on the map.
      const along = b.via.map((nb) => `${short(b.to)}-${short(nb)}${statics.map.hex(nb) ? '' : ' (the map edge)'}`).join(', ');
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
    // A scattered acquired stack (SK4 6.10): amber = the hexes the Gun's owner may keep the Acquired counter in.
    if (decision?.kind === ACQ_CHOICE_DECISION && owner === decision.owner) {
      for (const a of legal) if (a.type === 'acq.choose') highlights.set(a['hex'] as HexId, AMBER);
      return { selectedHex, highlights, selectedPieces: new Set<PieceId>(), los: null };
    }
    if (fortifying) {
      // Green = buildings that may be fortified; amber = the ones chosen so far (by Location: amber the ground, violet both levels).
      if (fortByLoc) {
        for (const loc of fortifiable) {
          const hex = hexOfLoc(loc);
          const picked = fortPicks.filter((l) => hexOfLoc(l) === hex).length;
          highlights.set(hex, picked === 0 ? GREEN : picked === 1 ? AMBER : VIOLET);
        }
      } else for (const h of statics.map.hexes()) if (h.buildingId && fortifiable.includes(h.buildingId)) highlights.set(h.id, fortPicks.includes(h.buildingId) ? AMBER : GREEN);
      return { selectedHex, highlights, selectedPieces: new Set<PieceId>(), los: null };
    }
    if (placing) {
      // Deployment hexes with minimums by each (LMA9 SSR 1): a tag over each with its count so far.
      const anchorBadges: HexBadge[] = anchors.map((a) => ({
        hex: a.anchor,
        text: `${a.counts.every((c) => c.have >= c.need) ? '✓' : '⚑'} ${a.counts.map((c) => `${c.label} ${c.have}/${c.need}`).join(' · ')}`,
      }));
      const facingHex = caFor ? facingHexOf(caFor) : undefined;
      if (caFor && facingHex && pillboxCaOf(caFor) === undefined) {
        // A ring around the Gun's or vehicle's hex cut into six segments, one per hexspine: click one to
        // point its Covered Arc along that hexspine (the chosen one is brass; pointing at another previews its arc).
        const p = state.pieces[caFor]!;
        const hull = pendingCa[caFor] ?? (isVehiclePiece(caFor) ? defaultVca(env, facingHex) : undefined);
        const turret = caTurret && isVehiclePiece(caFor);
        const chosen = turret ? (pendingTca[caFor] ?? hull) : hull;
        const what = turret ? 'Turret Covered Arc' : isVehiclePiece(caFor) ? 'Vehicle Covered Arc' : 'Covered Arc';
        const controls: HexControl[] = [0, 1, 2, 3, 4, 5].map((spine) => ({
          id: `face-${spine}`,
          hex: facingHex,
          spine,
          glyph: '▲',
          tone: turret ? 'turret' : 'hull',
          active: chosen === spine,
          arc: defOf(env, p).nationality,
          hint: `${what} ${spineLabel(env, facingHex, spine)}`,
          onClick: () => (turret ? pointTurret(caFor, spine) : faceGun(caFor, spine)),
        }));
        return { controls, selectedHex: facingHex, highlights, selectedPieces: new Set([caFor]), los: null };
      }
      // A placed roadblock's hexside or pillbox's Covered Arc (full ASL B29.1, B30.1): handles on the map.
      const ringed = fortRingFor !== null ? pendingForts[fortRingFor] : undefined;
      if (ringed && (ringed.kind === 'roadblock' || ringed.kind === 'pillbox')) {
        const idx = fortRingFor!;
        const controls: HexControl[] = [0, 1, 2, 3, 4, 5].map((k) => {
          if (ringed.kind === 'roadblock') {
            const err = counterTerrainIllegal(env, { ...ringed, hexside: k });
            return { id: `rb-${k}`, hex: ringed.hex, angle: hexsideScreenAngle(k, rotation), dist: 0.5, glyph: '▬', tag: 'ROAD', tone: 'turret' as const, active: ringed.hexside === k, disabled: !!err, hint: err ? plain(err)! : `Roadblock across this hexside (ASLRB B29.1)`, onClick: () => { if (!err) { changeFort(idx, { hexside: k }); setFortRingFor(null); } } };
          }
          // Handle `k` sets the arc to hex corner `k` (`FortPlacement.ca`): it is drawn on, and previews, the Gun spine of that hexspine.
          return { id: `pb-${k}`, hex: ringed.hex, spine: arcSpine(k), glyph: '▲', tone: 'hull' as const, active: ringed.ca === k, arc: statics.scenario.sides.find((x) => x.side === placing.owner)?.nationality, hint: `Pillbox Covered Arc ${pillboxArcLabel(env, ringed.hex, k)} (ASLRB B30.1)`, onClick: () => { changeFort(idx, { ca: k }); setFortRingFor(null); } };
        });
        return { controls, selectedHex: ringed.hex, highlights, selectedPieces: new Set<PieceId>(), los: null };
      }
      if (pickedFort && fortRule) {
        // Green = where the counter in hand may go (terrain, one per hex, the area; a roadblock needs a road hexside there).
        const area = fortArea(env, placing.owner);
        const probe = (hex: HexId): FortPlacement => ({ ...pickedFort, hex, hidden: !(pickedFort.kind === 'mines' && pickedFort.mines?.known), ...(pickedFort.kind === 'pillbox' ? { ca: 0 } : {}) });
        for (const h of area) {
          const c = probe(h);
          if (c.kind === 'mines' && hipIllegal(env, c)) c.hidden = !c.hidden;
          const ok = c.kind === 'roadblock' ? [0, 1, 2, 3, 4, 5].some((k) => !fortPlaceIllegal(env, placing.owner, [...pendingForts, { ...c, hexside: k }])) : !fortPlaceIllegal(env, placing.owner, [...pendingForts, c]);
          if (ok) highlights.set(h, GREEN);
        }
        return { selectedHex, highlights, selectedPieces: new Set<PieceId>(), los: null, badges: anchorBadges };
      }
      if (picked && isSw(picked)) {
        // Green = hexes holding a placed unit of the weapon's group that may take it there (a Gun not beside a building).
        for (const h of new Set(Object.values(pending))) {
          const holder = swHolderAt(picked, h);
          if (holder && !weaponDropIllegal(env, placing.owner, todo, pending, swAssign, picked, holder)) highlights.set(h, GREEN);
        }
        return { selectedHex, highlights, selectedPieces: selected, los: null, badges: anchorBadges };
      }
      const candidates = picked ? todo.filter((p) => p.id === picked) : todo.filter((p) => !pending[p.id]);
      // Green = where that counter may legally go now (area, per-hex limits, stacking); with none picked up, where
      // some counter may, so a hex already green is not checked again for the next one (S26 has ~760 setup hexes).
      const green = new Set<HexId>();
      for (const p of candidates)
        for (const h of placementHexes(env, p))
          if (!green.has(h) && !placementIllegal(shownEnv, placing.owner, todo, { ...pending, [p.id]: h }, true)) {
            green.add(h);
            highlights.set(h, GREEN);
          }
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
          turretPiece: ring.turret ? ring.piece : undefined,
          spine,
          glyph: '▲',
          tone: 'hull',
          active: ring.current === spine,
          ...(nat ? { arc: nat } : {}),
          disabled: !!err,
          hint: err ?? `${ring.what} ${spineLabel(env, ring.hex, spine)}${a ? ` · ${ring.note}` : ' (as now)'}${ring.then ? ' · then the turret' : ''}`,
          onClick: () => {
            if (ring.then) {
              setRing(ring.then(spine));
              return;
            }
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
      // A hex is amber only once every Banzai unit in it has made its one step this Impulse.
      for (const u of bz.units) {
        const h = hexOfUnit(u);
        if (h && highlights.get(h) !== BLUE) highlights.set(h, bz.moved.includes(u) ? AMBER : BLUE);
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
      badges.push({ hex: h, text: routShown!.viaMines.has(h) ? 'rout end · via minefield (optional)' : 'rout end' });
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
    // Choosing a DC target: the adjacent hexes the DC may be placed in (amber), enemy-held ones included (SK4 4.3), and
    // not the steps, as for Smoke.
    if (mode === 'dc') for (const h of dcTargets().hexes) highlights.set(h, AMBER);
    // Full ASL Dash (ASLRB A4.63): the end hexes it may be declared to, with the two-hex cost.
    if (ms?.dash && !ms.dash.void && ms.hex === ms.dash.road) badges.push({ hex: ms.hex as HexId, text: `Dashing → ${hexLabel(ms.dash.to)}` });
    if (mode === 'dash' && ms?.hex)
      for (const t of dashTargets(env)) {
        highlights.set(t.to as HexId, AMBER);
        badges.push({ hex: t.to as HexId, text: t.badge });
      }
    // Full ASL Infantry OVR (ASLRB A4.151): the hexes the ATTACKER may put the slipping SMC in.
    if (decision?.kind === OVR_PLACE && decision.owner === owner) for (const h of (decision.data?.['hexes'] as string[] | undefined) ?? []) highlights.set(h as HexId, AMBER);
    for (const a of legal) {
      // Full ASL: the stairs of the stack's own hex are a wheel entry, not a green hex (ASLRB B23.4).
      // A Bypass is a corner handle, not a green hex; the obstacle a stack in Bypass may enter is green (full ASL).
      if ((a.type === 'move.step' || a.type === 'move.manhandle') && mode !== 'smoke' && mode !== 'dc' && mode !== 'dash' && !a['bypass'] && (hexOfLoc(a['to'] as string) !== ms?.hex || (ms?.bypass && a['to'] === ms.bypass.hex))) highlights.set(hexOfLoc(a['to'] as string), GREEN);
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
    // Full ASL: an advance whose cost overstacking raises, or that makes a unit CX, says so on its hex (ASLRB A5.11, A4.72).
    if (fullAslRules && phase === 'APh' && decision?.kind === 'phase' && selected.size > 0) {
      const sel = [...selected].filter((u) => state.pieces[u]?.side === state.attacker);
      const tos = new Set(legal.filter((a) => a.type === 'advance' && (a['units'] as PieceId[]).some((u) => selected.has(u)) && !a['beneath']).map((a) => a['to'] as string));
      for (const to of tos) {
        if (!sel.length || hexOfLoc(to) === hexOfId(state, sel[0]!)) continue;
        const note = advanceNote(env, sel, to);
        if (note) badges.push({ hex: hexOfLoc(to), text: note });
      }
    }
    // Full ASL: every overstacked Location wears its attack penalty (ASLRB A5.12), for every viewer as far as each knows.
    if (fullAslRules)
      for (const b of overstackBadges(shownEnv, owner ?? null)) {
        const same = badges.find((x) => x.hex === b.hex && !x.at);
        if (same) same.text = `${same.text} · ${b.text}`;
        else badges.push({ hex: b.hex, text: b.text });
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
    // Full ASL Snap Shot (ASLRB A8.15): while one is previewed, and while its result is shown, the stack is drawn back on the
    // hexside it crossed, where the shot is traced; otherwise nothing of it is on the map.
    const snapPreview = snapAim && target && ms && decision?.kind === 'firstFire' && target === moveLoc(ms) ? snapAt(target) : null;
    const snap = snapShown ? { hex: snapShown.hex, from: snapShown.from, units: new Set<PieceId>(snapShown.units) } : snapPreview && ms ? { hex: snapPreview[0], from: snapPreview[1], units: new Set<PieceId>(firstFireTargets(env, ms)) } : null;
    return { controls, badges, ...(arrows.length ? { arrows } : {}), selectedHex, highlights, selectedPieces: selected, los, ...(declaredFire ? { declaredFire } : {}), ...(spent.size ? { spent } : {}), ...(ghost.size ? { ghost } : {}), ...(onRoad ? { onRoad } : {}), ...(smokeTried?.size ? { smokeTried } : {}), ...(amUnits?.size ? { assaultMoving: amUnits } : {}), ...(bypass ? { bypass, inBypass: inBypass! } : {}), ...(snap ? { snap } : {}) };
  }, [snapAim, snapShown, ms, legal, selected, lowCrawl, target, selectedHex, isFireDecision, state, env, placing, picked, pending, todo, phase, routs, routing, routShown, theirDraft, fortifying, fortifiable, fortPicks, ssrMarks, caFor, caTurret, pendingCa, pendingTca, swHexes, ring, owner, decision, session, turnable, mode, anchors, obaShown, banzaiDraft, banzaiUnit, bypassControls, smokePlan, smokeNext, shownEnv]);

  // ------------------------------------------------------------------ board clicks
  const onHexClick = (hex: HexId, e: { shift: boolean; ctrl: boolean; at: MapPoint; screen?: { x: number; y: number } }) => {
    setError(null);
    peekDismiss();
    if (e.ctrl) {
      pingHex(hex, e.at);
      return;
    }
    const took = ss?.onHexClick(hex, e);
    if (took === 'ping') pingHex(hex, e.at);
    if (took) return;
    if (!owner) return;
    // Scatter setup / entry groups (SSR): a click picks a rendezvous or entry hex.
    if (scatterUi.onHexClick(hex) || entryUi.onHexClick(hex) || stretchUi.onHexClick(hex)) return;
    // Full ASL Infantry OVR: the ATTACKER puts the slipping SMC in one of the amber hexes (ASLRB A4.151).
    if (decision?.kind === OVR_PLACE && decision.owner === owner) {
      const put = legal.find((a) => a.type === 'ovr.place' && a['hex'] === hex);
      if (put) run(put);
      else setError('Put him in one of the amber hexes: an adjacent Accessible Location free of your units, not a minefield, Wire or Open Ground while another is left (ASLRB A4.151)');
      return;
    }
    // A scattered acquired stack: clicking one of the amber hexes keeps the Acquired counter there (SK4 6.10).
    if (decision?.kind === ACQ_CHOICE_DECISION) {
      const keep = legal.find((a) => a.type === 'acq.choose' && a['hex'] === hex);
      if (keep) run(keep);
      else setSelectedHex(hex);
      return;
    }
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
      if (fortRingFor !== null) {
        const at = pendingForts[fortRingFor]?.hex;
        setFortRingFor(null);
        if (hex === at) return;
      }
      // The Known belt tool (B28.46): the first hex, then the second; off a Hex Grain the tray asks which zigzag.
      if (beltTool) {
        if (!beltTool.from || beltTool.to) setBeltTool({ from: hex });
        else if (hex === beltTool.from) setBeltTool({});
        else if (beltHexes(env, { from: beltTool.from, to: hex, grain: 'hex' })) layBelt(beltTool.from, hex, 'hex');
        else if (beltHexes(env, { from: beltTool.from, to: hex, grain: 'alt-left' })) setBeltTool({ from: beltTool.from, to: hex });
        else setError(`${hexLabel(beltTool.from)} and ${hexLabel(hex)} are not along one Hex Grain or Alternate Hex Grain (ASLRB B28.46)`);
        return;
      }
      // A fortification counter in hand goes down here (full ASL).
      if (pickedFort) {
        placeFort(pickedFort, hex);
        return;
      }
      if (picked) {
        // Clicking the picked counter's own hex picks the next counter there, then none.
        if (trayPending[picked] === hex) {
          const order = pickOrderAt(hex);
          setPicked(order[order.indexOf(picked) + 1] ?? null);
        } else place(picked, hex);
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
      else {
        // One of our own hexes: tick (or untick) the units there that may charge.
        const r = toggleBanzaiHex(env, owner, banzaiDraft, hex);
        if (r && 'draft' in r) setBanzaiDraft(r.draft);
        else setError(r?.error ?? 'Click an enemy hex for the target, or one of your hexes to tick its units');
      }
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
        fireBffMgsAt(hex);
        return;
      }
      if (mode === 'dash') {
        const t = dashTargets(env).find((x) => x.to === hex);
        if (t) {
          run({ type: 'move.dash', road: t.road, to: t.to }, true);
          setMode('normal');
          if (t.warning) setError(t.warning);
        } else setError('Click an amber hex beyond the road to Dash there (ASLRB A4.63)');
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
        // A hex with more than one Location the stack is ADJACENT to (S70's hill and its Cave, a building's levels): the
        // wheel asks which one the DC goes into; a click alone would place it on the ground/hill (S70 SSR 2: the Cave is
        // "a different hex" for all but Area Fire).
        const here = ms.hex ? adjacentLocs(env, moveLoc(ms)!).filter((l) => hexOfLoc(l) === hex) : [];
        // Full ASL: a pillbox the stack knows of, from an adjacent hex or its own (ASLRB B30.2, B30.31).
        const pbThere = fullAslRules && ms.hex ? pillboxKnownToSide(env, hex, owner ?? null) : null;
        if (pbThere && !here.includes(pillboxLoc(hex)) && ms.sub !== 'pb') here.push(pillboxLoc(hex));
        if (e.screen && here.length > 1 && !dcPlacement(hex)?.vehicle) {
          setMode('normal');
          setPeek(null);
          setSelectedHex(hex);
          setWheel({
            hex,
            at: e.screen,
            title: `DC on ${hexLabel(hex)}`,
            items: here.map((l) => {
              const p = dcPlacement(l)!;
              const why = plain(session.check(p));
              if (isPillboxLoc(l) && pbThere?.pillbox) {
                // B30.31: the CA DM from an adjacent CA hex or the pillbox hex itself, the NCA DM from any other adjacent hex.
                const ca = ms.hex === hex || inPillboxCa(env, pbThere, ms.hex!);
                const dm = ca ? `+${pbThere.pillbox.ca} CA` : `+${pbThere.pillbox.nca} NCA`;
                const mf = env.query('move.cost', { unit: (dcPlacementPlacer() ?? ms.units[0])!, from: ms.hex, to: hex, viaRoad: false, loc: l }, 1);
                return action(`DC on the pillbox in ${hexLabel(hex)} (${dm}, ${mf} MF)`, () => run(p, true), { icon: '✸', disabled: !!why, hint: why ?? `Placed against the pillbox: it attacks its contents in the AFPh with the ${ca ? 'CA' : 'NCA'} Defense Modification, and an Original KIA (its number +2) at least that eliminates it (ASLRB B30.31, B30.92)` });
              }
              return action(isCaveLoc(l) ? `DC into ${locName(l)}` : `DC on ${hexLabel(hex)} (${here.some(isCaveLoc) ? 'the hill' : locName(l)})`, () => run(p, true), { icon: '✸', disabled: !!why, hint: why ?? 'Place the DC in that Location: it attacks everything there in the Advancing Fire Phase' });
            }),
          });
          return;
        }
        const placement = dcPlacement(hex);
        const dc = ms.units.flatMap((u) => swHeldBy(state, u)).find((s) => (defOf(env, s) as { type?: string }).type === 'DC');
        const afv = !!placement?.vehicle;
        const place = () => { if (placement) run(placement, true); };
        // Full ASL: an ADJACENT building Location of a scenario with Fortified Buildings may instead have its hexside
        // Breached, whether or not the stack knows it is fortified (ASLRB B23.9221); one it cannot be shows the entry greyed, with the reason.
        const breachable = !!dc && !!ms.hex && !afv && !!fortifiedState(env) && !!statics.map.hex(hexOfLoc(hex))?.buildingId && adjacentLocs(env, moveLoc(ms)!).includes(hex);
        if (dc && ms.hex && e.screen && breachable) {
          const cost = plain(session.check({ type: 'move.placeDc', dc: dc.id, target: hex }));
          const entry = env.query('move.cost', { unit: dc.loc.kind === 'held' ? dc.loc.by : ms.units[0]!, from: ms.hex, to: hex, viaRoad: false }, 0);
          const breachWhy = plain(breachIllegal(env, ms, dc.id, hex));
          const known = fortifiedKnownTo(env, hex, state.attacker);
          setMode('normal');
          setPeek(null);
          setSelectedHex(hex);
          setWheel({
            hex,
            at: e.screen,
            title: `DC on ${hexLabel(hex)}`,
            items: [
              action(`DC on ${hexLabel(hex)} · ${entry} MF`, place, { icon: '✸', disabled: !!cost, hint: cost ?? `Place the DC in the Location: it attacks everything there in the Advancing Fire Phase (30 FP${known ? ', the fortified TEM' : ''})` }),
              action(`Breach ${hexLabel(hex)}/${hexLabel(ms.hex)} · 1 MF`, () => run({ type: 'move.breach', dc: dc.id, target: hex }, true), {
                icon: '⟋',
                disabled: !!breachWhy,
                hint:
                  breachWhy ??
                  (known
                    ? 'Place the DC against the hexside: in the AFPh a NMC or better Breaches it and the same DR attacks the units inside as Area Fire; then Infantry may enter through it (ASLRB B23.9221)'
                    : 'Place the DC against the hexside, not knowing whether the Location is fortified: in the AFPh the DR takes the fortified TEM; a NMC or better Breaches a Fortified Location, and shows it, or shows that it is not fortified; the same DR attacks the units inside as Area Fire (ASLRB B23.9221)'),
              }),
            ],
          });
          return;
        }
        place();
        setMode('normal');
        return;
      }
      // Full ASL: from beneath a trench the bunker of the next hex may be entered along it (ASLRB B30.8): the wheel asks.
      if (e.screen && ms.hex !== hex && legal.some((a) => a.type === 'move.step' && a['to'] === pillboxLoc(hex))) {
        const into = pillboxLoc(hex);
        setPeek(null);
        setSelectedHex(hex);
        setWheel({
          hex,
          at: e.screen,
          title: `Into ${hexLabel(hex)}`,
          items: [
            action(`Along the trench into the bunker (${env.query('move.stepCost', { ms, to: into }, 1)} MF)`, () => run({ type: 'move.step', to: into }, true), { icon: '⌂', hint: 'As if the bunker were a trench: one MF, no FFNAM, FFMO or Snap Shot (ASLRB B30.8, B27.54)' }),
            ...(legal.some((a) => a.type === 'move.step' && a['to'] === hex) ? [action(`Into ${hexLabel(hex)} (${stepCostOf(hex) ?? '?'} MF)`, () => run({ type: 'move.step', to: hex }, true), { icon: '➜', hint: 'Onto the ground of the hex, outside the pillbox' })] : []),
          ],
        });
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
      // Full ASL Infantry OVR (ASLRB A4.15): into a lone Known enemy SMC's Location, the NTC chosen on the wheel.
      const ovr = fullAslRules && !ms.vehicle && ms.hex !== hex ? ovrStep(env, ms, hex, (a) => plain(session.check(a))) : null;
      if (ovr) {
        if (ovr.refusal || !ovr.options.length) setError(ovr.refusal ?? 'No Infantry OVR there');
        else if (ovr.options.length === 1 || !e.screen) run(ovr.options[0]!.action, true);
        else {
          setPeek(null);
          setSelectedHex(hex);
          setWheel({ hex, at: e.screen, title: `Into ${hexLabel(hex)}`, items: ovr.options.map((o) => action(o.label, () => run(o.action, true), { icon: '⚔', hint: o.hint })) });
        }
        return;
      }
      if (legal.some((a) => a.type === 'move.step' && a['to'] === hex && !a['bypass'])) {
        // Full ASL Minimum Move (ASLRB A4.134): the step says so, and who ends pinned and CX, before it is made.
        const minNote = fullAslRules && !ms.vehicle ? minimumMoveNote(env, ms, hex) : null;
        if (minNote && e.screen) {
          setPeek(null);
          setSelectedHex(hex);
          setWheel({ hex, at: e.screen, title: `Into ${hexLabel(hex)}`, items: [action(minNote, () => run({ type: 'move.step', to: hex }, true), { icon: '➜', hint: 'One hex as the whole MPh, at any cost; it counts the full cost as spent (ASLRB A4.134)' })] });
          return;
        }
        // Along the road into a Woods-Road hex: the road or its woods (SK1 1.1.1).
        if (askRoadOrWoods(woodsRoadEntry(hex), hex, e.screen)) return;
        // Full ASL: straight beneath the foxhole or trench of the hex (Assault Movement, B27.4; connecting trenches, B27.54).
        if (askBeneath(hex, e.screen)) return;
        // Full ASL: into a Known minefield, the plain step, along its TB, or with all MF to clear it (B28.41, B28.61, B24.74).
        if (askMinefield(hex, e.screen)) return;
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
      const from = moverHex(ms);
      if (ms.vehicle && from) {
        const spine = turnSpineToward(statics.map, from, hex, Number(state.pieces[ms.units[0]!]!.tags['vca'] ?? 0));
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
          if (askBeneathRout(routing.unit, hex, e.screen)) return;
          routStep(routing.unit, hex);
          return;
        }
        const why = routRefusals(routing.unit, hex)[0];
        if (why) {
          setError(`${pieceLabel(env, state.pieces[routing.unit]!)} cannot rout into ${hexLabel(hex)}: ${why}${pbBarNote(hex)}`);
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
          if (askBeneathRout(can[0]!, hex, e.screen, leaders)) return;
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
          setError(`${pieceLabel(env, state.pieces[refused.u]!)} cannot rout into ${hexLabel(hex)}: ${refused.why}${pbBarNote(hex)}`);
          return;
        }
      }
    }
    if (decision?.kind === 'phase' && phase === 'APh' && selected.size > 0) {
      const units = [...selected];
      const advTo = clickLoc(advanceTos(legal, units), hex, hexOfId(state, units[0]!));
      const why = plain(session.check({ type: 'advance', units, to: advTo }));
      if (why === null) {
        // Full ASL: the advance may end beneath the foxhole or trench of the hex entered (ASLRB B27.44): ask which.
        const ent = fullAslRules ? entrenchmentKnownTo(env, hexOfLoc(advTo), owner!) : null;
        if (ent && e.screen && session.check({ type: 'advance', units, to: advTo, beneath: true }) === null) {
          const name = entrenchmentName(ent);
          setPeek(null);
          setSelectedHex(hex);
          setWheel({
            hex,
            at: e.screen,
            items: [
              action(`Advance into ${hexLabel(hex)}`, () => run({ type: 'advance', units, to: advTo }), { icon: '➜', hint: `On top of the ${name}` }),
              action(`Advance beneath the ${name}`, () => run({ type: 'advance', units, to: advTo, beneath: true }), { icon: '⌂', hint: 'Beneath it at once, an enemy-held one included: capacity is per side (ASLRB B27.44, A4.7)' }),
            ],
          });
          return;
        }
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
      // Enemy personnel, a "?" stack, or an enemy vehicle (a CE crew is a target on the IFT, SK4 7.7).
      const enemy = aimsAt(shownEnv, hex, owner!, gunShot ?? pfShot);
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
        // Full ASL: several enemy vehicles in the Location: a Vehicle Target Type shot names one, on the wheel (ASLRB A5.2).
        const aimVehicles = (gunShot ?? pfShot)?.targetType === 'VTT' ? vehicleTargets(shownEnv, at, owner!) : [];
        if (aimVehicles.length > 1 && !(gunShot?.targetUnit && aimVehicles.some((v) => v.id === gunShot.targetUnit))) {
          setPeek(null);
          setSelectedHex(hex);
          if (e.screen) setWheel({ hex, at: e.screen });
          else setError('Several enemy vehicles here: right-click the hex to choose which one to aim at');
          return;
        }
        if (gunShot) {
          if (declared) fireGunAt(at);
          else setTarget(at);
          return;
        }
        // A Panzerfaust lined up fires the PF, never the unit's own FP.
        if (pfShot) {
          if (declared) firePf(at);
          else setTarget(at);
          return;
        }
        // A lone Flamethrower at a hex where it sees only enemy AFVs predesignates one: on the IFT it could never harm a
        // Buttoned Up AFV (SK4 4.2). Several there: the wheel picks which.
        const ftAfvs = declared ? ftAfvTargets(shownEnv, fireDecl, hex, owner!) : [];
        if (ftAfvs.length > 1) {
          setPeek(null);
          setSelectedHex(hex);
          if (e.screen) setWheel({ hex, at: e.screen });
          else setError('Several AFVs here: right-click the hex to choose which the Flamethrower attacks');
          return;
        }
        if (declared) fireAt(at, ftAfvs[0]);
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
      if (keepsTicks(s, mine, { shift: e.shift, sameHex: hex === selectedHex })) return s;
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
   * vehicle has more than half its MP left, also coming on from offboard (with half or fewer, the plain step is
   * already the all-MP entry, ASLRB B13.41).
   */
  const woodsEntry = (hex: HexId): WheelItem[] | null => {
    if (!ms?.vehicle || !(ms.hex || ms.off) || !legal.some((a) => a.type === 'move.step' && a['to'] === hex)) return null;
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
      action(`Enter with all MP (${left} MP)`, () => run({ type: 'move.step', to: hex, declared: left }, true), { icon: '■', hint: `Bog Check ${sign(drm(false))} DRM; uses every MP it has left, and it may still stop (SK4 1.1.1)` }),
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
  /** The MF a step of the moving stack into `hex` costs, with every rule's addition (the extra MF beneath an entrenchment, B27.4). */
  const stepCostOf = (hex: HexId, beneath = false): number | undefined => (ms ? env.query('move.stepCost', { ms, to: hex, ...(beneath ? { beneath: true } : {}) }, 1) : undefined);
  /** The First Fire panel's first sentence: a MF spent within the hex to go beneath or climb out of its entrenchment is named (ASLRB B27.4, A8.12). */
  const firstFireMoveText = (where: string): string => {
    // Full ASL: the Wire Exit drs the DEFENDER is entitled to see before he fires (ASLRB B26.4).
    const drs = fullAslRules ? lastWireExit(env) : null;
    if (drs) return `Enemy units made their Wire Exit dr in ${where}: ${wireDrText(drs)} (ASLRB B26.4).`;
    // Full ASL: the minefield attacks the stack has just survived on this step (ASLRB B28.41; resolved before any First Fire).
    const mines = fullAslRules ? lastMineAttacks(env) : [];
    if (mines.length) return `Enemy units moving in ${where} survived a minefield attack ${mines.map((m) => `${m.way === 'exit' ? 'leaving' : 'entering'} ${hexLabel(m.hex)}`).join(' and ')}.`;
    const rb = roadblockCrossed();
    if (rb) return `Enemy units are crossing the roadblock ${rb} into ${where} (+1 MF; the +2 wall TEM against a firer without Wall Advantage over it, ASLRB B29.3, B9.31).`;
    const se = ms && fullAslRules ? stackEntrenchment(env, ms) : null;
    const trail = ms?.trail ?? [];
    const inPlace = !!ms?.hex && trail.length > 0 && trail[trail.length - 1]!.hex === ms.hex && (ms.hexesEntered === 0 || trail.filter((t) => t.hex === ms.hex).length >= 2);
    if (se && inPlace) {
      const name = entrenchmentName(se.counter);
      return se.beneath ? `Enemy units are going beneath the ${name} in ${where} (+2 TEM and no FFMO once there, ASLRB B27.3, B27.42).` : `Enemy units are climbing out of the ${name} in ${where} (no TEM on top; FFMO in Open Ground, ASLRB B27.42).`;
    }
    return `Enemy units are moving in ${where}${se?.beneath ? ` beneath the ${entrenchmentName(se.counter)} (+2 TEM, no FFMO)` : ''}.`;
  };
  /** A moving stack clicking a foxhole or trench hex it may also enter beneath (ASLRB B27.4, B27.54): the plain step or the combined one. */
  const askBeneath = (hex: HexId, at: { x: number; y: number } | undefined) => {
    if (!at || !ms?.hex || !fullAslRules) return false;
    const ent = entrenchmentKnownTo(env, hex, owner!);
    if (!ent || session.check({ type: 'move.step', to: hex, beneath: true }) !== null) return false;
    const name = entrenchmentName(ent);
    const plainCost = ms ? (session.check({ type: 'move.step', to: hex }) === null ? stepCostOf(hex) : null) : null;
    const trench = !!ms.ent && ent.kind !== 'foxhole';
    const items: WheelItem[] = [
      ...(plainCost !== null
        ? [action(`Enter ${hexLabel(hex)}${plainCost !== undefined ? ` (${plainCost} MF)` : ''}`, () => run({ type: 'move.step', to: hex }, true), { icon: '➜', hint: `On top of the ${name}: First Fire and FFMO as usual` })]
        : []),
      action(trench ? `Along the trench into ${hexLabel(hex)} (${stepCostOf(hex, true) ?? 1} MF)` : `Enter and go beneath the ${name} (${stepCostOf(hex, true) ?? '?'} MF)`, () => run({ type: 'move.step', to: hex, beneath: true }, true), {
        icon: '⌂',
        hint: trench ? 'Connecting trenches: one MF whatever the terrain, beneath throughout, no FFNAM, FFMO or Snap Shot (ASLRB B27.54)' : 'One expenditure: no First Fire in between, +2 TEM and no FFMO once beneath; Residual FP and Snap Shots still hit on the way in (ASLRB B27.4)',
      }),
    ];
    setPeek(null);
    setSelectedHex(hex);
    setWheel({ hex, at, items });
    return true;
  };
  /**
   * A moving stack clicking a Known minefield it may enter: the ways in, each with its cost or the reason it is refused
   * (ASLRB B28.41: attacked on entry; B28.61: along a TB at twice the cost, free of attack, -1 to First Fire; B24.74: all MF,
   * TI, a partial TB, the Clearance DR at the end of the CCPh, the TB's second hexside chosen now).
   */
  const askMinefield = (hex: HexId, at: { x: number; y: number } | undefined) => {
    if (!at || !ms?.hex || !fullAslRules) return false;
    const choices = mineStepChoices(env, ms, hex);
    if (!choices.length) return false;
    const plainWhy = plain(session.check({ type: 'move.step', to: hex }));
    const items: WheelItem[] = [];
    for (const c of choices) {
      if (c.mines === null) {
        items.push(action(`Enter ${hexLabel(hex)} (minefield attack)${plainWhy ? '' : ` · ${stepCostOf(hex) ?? '?'} ${ms.vehicle ? 'MP' : 'MF'}`}`, () => run({ type: 'move.step', to: hex }, true), { icon: '✹', ...(plainWhy ? { disabled: true, hint: plainWhy } : { hint: 'The minefield attacks the stack on entry, and again when it leaves (ASLRB B28.41)' }) }));
      } else if (c.mines === 'tb') {
        const why = c.reason ?? plain(session.check({ type: 'move.step', to: hex, mines: 'tb' }));
        const cost = why ? null : env.query('move.stepCost', { ms, to: hex, mines: 'tb' }, 1);
        items.push(action(`Enter along the TB (2× ${ms.vehicle ? 'MP' : 'MF'}, no attack${ms.vehicle ? '' : ', −1 to First Fire'})${cost !== null ? ` · ${cost}` : ''}`, () => run({ type: 'move.step', to: hex, mines: 'tb' }, true), { icon: '⟿', ...(why ? { disabled: true, hint: why } : { hint: 'Twice the normal cost across a Trail Break hexside, free of minefield attack (ASLRB B28.61, B13.4212)' }) }));
      } else {
        const why = c.reason ?? plain(session.check({ type: 'move.step', to: hex, mines: 'clear' }));
        const entry = mineSideToward(statics.map, hex, ms.hex);
        if (why || entry === null) {
          items.push(action('Enter and clear (all MF, TI, partial TB)', () => undefined, { icon: '🧹', disabled: true, hint: why ?? 'Not from here' }));
          continue;
        }
        // The TB's second hexside is the clearing player's choice, made now (ASLRB B24.74); the partial TB's is the first.
        const sides = [0, 1, 2, 3, 4, 5].filter((k) => k !== entry);
        const kids = sides
          .map((k) => {
            const pair: [number, number] = entry < k ? [entry, k] : [k, entry];
            const bad = plain(session.check({ type: 'move.step', to: hex, mines: 'clear', hexsides: pair }));
            const nb = statics.map.neighbors(hex).find((n) => mineSideToward(statics.map, hex, n) === k);
            return action(`TB out toward ${nb ? hexLabel(nb) : `hexside ${k}`}`, () => run({ type: 'move.step', to: hex, mines: 'clear', hexsides: pair }, true), { icon: '⟋', ...(bad ? { disabled: true, hint: bad } : { hint: `If cleared, a Trail Break from the ${hexLabel(ms.hex!)} hexside to this one` }) });
          });
        items.push(group('Enter and clear (all MF, TI, partial TB)', kids, { icon: '🧹', hint: 'Free of attack: every MF spent entering, TI; a Final DR ≤ 2 at the end of the CCPh places the TB (ASLRB B24.74)' }));
      }
    }
    setPeek(null);
    setSelectedHex(hex);
    setWheel({ hex, at, items });
    return true;
  };
  /** A routing unit clicking a foxhole or trench hex it may rout beneath (ASLRB B27.41): through, or beneath and safe from Interdiction there. */
  const askBeneathRout = (unit: PieceId, hex: HexId, at: { x: number; y: number } | undefined, leaders: PieceId[] = []) => {
    if (!at || !fullAslRules) return false;
    const ent = entrenchmentKnownTo(env, hex, owner!);
    const extra = leaders.length ? { leaders } : {};
    // A pillbox in the hex (B30.5: a building for rout): straight into it as one expenditure, free of Interdiction in the
    // hex (B30.41, A10.531), or the ground; a pillbox it may not use is shown greyed with the reason.
    const pb = pillboxKnownToSide(env, hex, owner ?? null);
    if (pb && hexOfId(state, unit) !== hex) {
      const into = pillboxLoc(hex);
      const why = plain(session.check({ type: 'rout.step', unit, to: into, ...extra }));
      const items: WheelItem[] = [
        ...(session.check({ type: 'rout.step', unit, to: hex, ...extra }) === null ? [action(`Rout into ${hexLabel(hex)}`, () => run({ type: 'rout.step', unit, to: hex, ...extra }), { icon: '➜', hint: 'Onto the ground of the hex, outside the pillbox: open to Interdiction as its terrain says' })] : []),
        ...(ent && session.check({ type: 'rout.step', unit, to: hex, beneath: true, ...extra }) === null ? [action(`Rout beneath the ${entrenchmentName(ent)} (+${entrenchmentMf(env, hex, owner!)} MF)`, () => run({ type: 'rout.step', unit, to: hex, beneath: true, ...extra }), { icon: '⌂', hint: 'The extra MF paid on entering: no Interdiction in this hex (ASLRB B27.41)' })] : []),
        action(`Rout into the pillbox (+${pillboxMf(env, pb, owner!)} MF, no Interdiction here)`, () => run({ type: 'rout.step', unit, to: into, ...extra }), {
          icon: '⌂',
          disabled: !!why,
          hint: why ?? 'A building for rout: the hex and the pillbox in one expenditure, so no Interdiction in this hex; its MF does not count toward the nearest building (ASLRB B30.5, B30.41, A10.531)',
        }),
      ];
      setPeek(null);
      setSelectedHex(hex);
      setWheel({ hex, at, items });
      return true;
    }
    if (!ent || session.check({ type: 'rout.step', unit, to: hex, beneath: true, ...extra }) !== null) return false;
    const name = entrenchmentName(ent);
    const items: WheelItem[] = [
      ...(session.check({ type: 'rout.step', unit, to: hex, ...extra }) === null ? [action(`Rout into ${hexLabel(hex)}`, () => run({ type: 'rout.step', unit, to: hex, ...extra }), { icon: '➜', hint: `Through the hex on top of the ${name}: open to Interdiction as its terrain says` })] : []),
      action(`Rout beneath the ${name} (+${entrenchmentMf(env, hex, owner!)} MF)`, () => run({ type: 'rout.step', unit, to: hex, beneath: true, ...extra }), { icon: '⌂', hint: 'The extra MF paid on entering: no Interdiction in this hex (ASLRB B27.41)' }),
    ];
    setPeek(null);
    setSelectedHex(hex);
    setWheel({ hex, at, items });
    return true;
  };
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
    // Full ASL: a pillbox shown occupied, its contents not inspectable (B30.7), is a target Location though no unit shows.
    if (fortificationView(shownEnv, owner ?? null).some((c) => c.kind === 'pillbox' && c.hex === hex && c.side !== owner && c.occupied)) at.add(pillboxLoc(hex));
    return [...at].sort((a, b) => levelOfLoc(b) - levelOfLoc(a) || (isPillboxLoc(a) ? -1 : isPillboxLoc(b) ? 1 : 0));
  }
  /** Fire at the hex's Cave Location while it stands, beside the hex's other targets (`caveFireTarget`). */
  function caveFireItems(hex: HexId, already: string[]): WheelItem[] {
    const cave = caveFireTarget(env, hex, already);
    if (!cave) return [];
    const why = fireRefusal(buildDecl(cave));
    const rule = caves?.rule ? ` (${caves.rule})` : '';
    return [
      action(`Fire at ${locName(cave)}${enemyNames(cave) ? `: ${enemyNames(cave)}` : ''}`, () => fireAt(cave), {
        icon: '✦',
        disabled: !!why,
        hint: why ?? `The Cave Location is a target of its own${rule}: a DC or FT attack that does not malfunction against a Cave with no unbroken enemy unit in it eliminates it, as does any HE, DC or FT KIA`,
      }),
    ];
  }
  /** Defensive First Fire at the moving stack: its Location, when it is in `hex` (full ASL: maybe an upper level). */
  const firstFireAt = (hex: HexId): string | null => (decision?.kind === 'firstFire' && ms?.hex === hex ? moveLoc(ms) : null);
  const locName = (l: string) =>
    isCaveLoc(l) ? `the Cave in ${hexLabel(hexOfLoc(l))}` : l === connection ? 'the Connection Location' : isPillboxLoc(l) ? 'the pillbox' : levelOfLoc(l) ? `level ${levelOfLoc(l)}` : pillboxKnownToSide(env, l, owner ?? null) ? 'outside the pillbox' : 'the ground';
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
      const pb = isPillboxLoc(at) ? ` · Pillbox${enemyNames(at) ? '' : ' (contents unknown)'}` : '';
      return [action(`Preview attack${pb}`, () => { setTarget(at); setSnapAim(false); }, { icon: '◎', active: target === at && !snapAim, disabled: noFirers, hint: pb ? `Affects only the pillbox (ASLRB B30.34). ${hint}` : hint })];
    }
    // Full ASL (B30.34): an attack on a pillbox hex reaches the pillbox only when the pillbox is its target Location, and
    // the other way round; an Area Target Type shot reaches both (said in the ordnance panel).
    return locs.map((l) => {
      const names = enemyNames(l);
      const label = isPillboxLoc(l) ? `Pillbox${names ? `: ${names}` : ' (contents unknown)'}` : `${locName(l) === 'outside the pillbox' ? 'Outside the pillbox' : locName(l)}: ${names}`;
      const scope = isPillboxLoc(l) ? 'Affects only the pillbox (ASLRB B30.34). ' : locName(l) === 'outside the pillbox' ? 'Affects only units outside the pillbox (ASLRB B30.34). ' : '';
      return action(`Preview attack · ${label}`, () => setTarget(l), { icon: '◎', active: target === l, disabled: noFirers, hint: `${scope}${hint}` });
    });
  }
  /** Rout steps up or down the stairs of the unit's own hex (full ASL; interim rule until A10.51's rout by Location). */
  function routStairs(unit: PieceId): WheelItem[] {
    const at = hexOfId(state, unit);
    const from = state.pieces[unit] ? levelOfLoc(locOf(state, state.pieces[unit]!) ?? '') : 0;
    // S70 caves: into a cave or the Connection Location (a building for rout, SSR 2).
    const caveRouts = legal
      .filter((a) => a.type === 'rout.step' && a['unit'] === unit && !a['lowCrawl'] && (isCaveLoc(a['to'] as string) || a['to'] === connection))
      .map((a) => action(`Rout into ${locName(a['to'] as string)}`, () => run(a, true), { icon: '◒', hint: a['to'] === connection ? 'Its sole action this phase: the rout ends there (S70 SSR 2)' : 'Into the Cave Location (S70 SSR 2)' }));
    // Full ASL: into the pillbox of the unit's own hex, or out of it into the hex (B30.4, B30.5, B30.6).
    const inPb = state.pieces[unit] ? isPillboxLoc(locOf(state, state.pieces[unit]!) ?? '') : false;
    const pbRouts = legal
      .filter((a) => a.type === 'rout.step' && a['unit'] === unit && !a['lowCrawl'] && hexOfLoc(a['to'] as string) === at && (isPillboxLoc(a['to'] as string) || inPb) && !a['beneath'])
      .map((a) => action(inPb ? 'Rout out of the pillbox · 1 MF' : 'Rout into the pillbox · 1 MF', () => run(a, true), { icon: inPb ? '⬆' : '⌂', hint: inPb ? 'Onto the ground of the hex, then on (ASLRB B30.4)' : 'A building for rout and rally: a broken unit inside is never forced to rout (ASLRB B30.5)' }));
    return caveRouts.concat(pbRouts).concat(legal
      .filter((a) => a.type === 'rout.step' && a['unit'] === unit && !a['lowCrawl'] && !a['woods'] && hexOfLoc(a['to'] as string) === at && !isPillboxLoc(a['to'] as string) && !inPb)
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
  function connectionActions(): { label: string; run: () => void; hint?: string; disabled?: boolean }[] {
    if (!connection || !owner || decision?.kind !== 'phase') return [];
    const inside = Object.values(state.pieces).filter((p) => p.side === owner && p.loc.kind === 'hex' && p.loc.hex === connection && !isWeaponDef(defOf(env, p))).map((p) => p.id);
    const ticked = inside.filter((id) => selected.has(id));
    const units = ticked.length ? ticked : inside;
    const out: { label: string; run: () => void; hint?: string; disabled?: boolean }[] = [];
    // Refused moves and advances are still listed, greyed with the reason (a full Cave: G11.4 stacking), so the player
    // is not left wondering why nothing is offered.
    if (phase === 'MPh' && !ms && units.length) {
      const why = plain(session.check({ type: 'move.start', units }));
      out.push({ label: `Move ${units.length > 1 ? `these ${units.length}` : pieceLabel(env, state.pieces[units[0]!])} out…`, run: () => run({ type: 'move.start', units }, true), ...(why ? { disabled: true, hint: why } : {}) });
    }
    if (ms?.hex === connection) {
      for (const a of legal.filter((x) => x.type === 'move.step')) out.push({ label: `Into ${locName(a['to'] as string)} · all MF`, run: () => run(a, true), hint: 'They emerge concealed (S70 SSR 2)' });
      if (legal.some((a) => a.type === 'move.end')) out.push({ label: 'End move', run: () => run({ type: 'move.end' }) });
      if (session.check({ type: 'move.cancel' }) === null) out.push({ label: 'Cancel move', run: () => run({ type: 'move.cancel' }), hint: 'No MF spent yet: they may still move later this phase' });
    }
    if (phase === 'APh' && units.length)
      for (const to of adjacentLocs(env, connection)) {
        const why = plain(session.check({ type: 'advance', units, to }));
        out.push({ label: `Advance into ${locName(to)}`, run: () => run({ type: 'advance', units, to }), ...(why ? { disabled: true, hint: why } : {}) });
      }
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
    // Full ASL: a pillbox shown occupied holds enemy units though none is drawn (ASLRB B30.7).
    const enemyHere = unitsHere.some((p) => p.side !== owner) || (fullAslRules && enemyLocsIn(hex).some(isPillboxLoc));
    // Full ASL: a pillbox the side has not been shown may be there (Q&A to A7 and B30: an IFT attack at a suspected one).
    const maybePillbox = fullAslRules && !!owner && isFireDecision && possiblePillbox(shownEnv, owner, hex);
    const possiblePillboxItem = () =>
      action(`Fire at a possible pillbox in ${hexLabel(hex)}`, () => fireAt(pillboxLoc(hex)), {
        icon: '✦',
        hint: 'An IFT attack at a pillbox you have not been shown but cannot rule out: if one is there and the attack comes through its Covered Arc, a PTC or better (or a result its Defense Modification turned to none) reveals it and attacks its contents; through its NCA, Small Arms, MG and IFE fire is NA. It reads alike whether a pillbox is there or not (ASLRB B30.7, B30.113, A12.33)',
      });
    const selectAll = action('Select stack', () => { setSelectedHex(hex); setSelected(new Set(stackPick(own))); }, { icon: '☰', hint: 'Select every unit here' });

    for (const c of [scatterUi.confirm, entryUi.confirm, turnsUi.confirm, lengthUi.confirm, stretchUi.confirm]) {
      if (c) items.push(action(c.label, c.onClick, { icon: c.icon, disabled: !!c.blocked, hint: c.blocked ?? c.hint ?? c.label }));
    }
    // A moving vehicle lined up for Bounding First Fire (SK4 3.3.2.2): a right-click on another hex offers the shot
    // at it, not the mover's own orders.
    const bffKind = bffWheelKind({ decisionKind: decision.kind, phase, moverHex: ms?.hex, vehicle: !!ms?.vehicle, hex, gunLinedUp: !!gunShot, mgMode: mode === 'bffMg' });
    if (bffKind) {
      if (bffKind === 'gun' && gunShot) {
        const turn = caChangeFor(env, gunShot.gun, hex);
        items.push(action(turn !== null ? 'Turn the turret and fire at this hex' : 'Fire at this hex', () => fireGunAt(hex), { icon: '✦', hint: turn !== null ? 'The target is outside the Turret Covered Arc: the turret turns first (To Hit DRM)' : 'Roll To Hit against this hex' }));
        items.push(action('Preview shot', () => setTarget(hex), { icon: '◎', active: target === hex, hint: 'Show the To Hit number and DRM in the panel first' }));
        items.push(action('Cancel shot', () => { setDeclared(false); setTarget(null); setGunShot(null); setSelected(new Set()); }, { icon: '✕' }));
      } else {
        items.push(action('Fire MGs at this hex', () => fireBffMgsAt(hex), { icon: '✦', hint: 'Half FP in the MPh, a quarter while not stopped; any MG whose arc misses the target stays silent (SK4 3.3.2.2, 7.8)' }));
        items.push(action('Cancel MG fire', () => { setMode('normal'); setBffMgs([]); }, { icon: '✕' }));
      }
      return items;
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
        // Where a special rule lets this stack set up hidden, its one "Set up hidden" entry covers the Gun too (below).
        if (hipAllowed(g.id) && !hiddenByRule.some((id) => swAssign[g.id] === id) && !todo.some((p) => hexOfLoc(pending[p.id] ?? '') === hex && hideable(p.id)))
          items.push(action(pendingHip.has(g.id) ? 'Set up in the open' : 'Hidden Initial Placement', () => toggleHip(g.id), { icon: '?', active: pendingHip.has(g.id), hint: 'The Gun and its crew stay off the board until they fire, move or are found (SK4 6.4)' }));
      }
      // Full ASL: units placed in a building hex with upper levels may set up on any of them (ASLRB A2.8, B23.42), and in a pillbox of their side (B30.1).
      const levels = statics.map.hex(hex) ? locationsOf(shownEnv, hex).filter((l) => !isPillboxLoc(l) || fortificationsHereOf(hex).some((c) => c.kind === 'pillbox')) : [];
      if (levels.length > 1) {
        const placedHere = todo.filter((p) => hexOfLoc(pending[p.id] ?? '') === hex && !isVehiclePiece(p.id));
        const chosenHere = placedHere.filter((p) => selected.has(p.id));
        const movers = chosenHere.length ? chosenHere : placedHere;
        for (const loc of levels) {
          const who = movers.filter((p) => pending[p.id] !== loc);
          if (!who.length) continue;
          const next = { ...pending, ...Object.fromEntries(who.map((p) => [p.id, loc])) };
          const pb = isPillboxLoc(loc);
          const pbCap = pb ? (fortificationsHereOf(hex).find((c) => c.kind === 'pillbox')?.pillbox?.capacity ?? 1) : 0;
          const err = plain(placementIllegal(shownEnv, placing.owner, todo, next, true) ?? (pb || levels.some(isPillboxLoc) ? fortSetupIllegal(shownEnv, placing.owner, { type: 'setup.place', side: placing.owner, decisionId: placing.id, placements: next, beneath: [...pendingBeneath].filter((id) => next[id] && !isPillboxLoc(next[id]!)) }) : null));
          const lv = levelOfLoc(loc);
          const cave = isCaveLoc(loc);
          items.push(
            action(cave ? 'Set up in the Cave' : pb ? `Set up in the pillbox (room for ${pbCap} squad${pbCap === 1 ? '' : 's'})` : lv ? `Set up at level ${lv}` : levels.some(isCaveLoc) ? 'Set up on the hill' : levels.some(isPillboxLoc) ? 'Set up outside the pillbox' : 'Set up on the ground', () => { setPending(next); setError(null); }, {
              icon: cave ? '◒' : pb ? '▣' : lv ? '▲' : '▼',
              disabled: !!err,
              hint: err ?? `${who.length === 1 ? pieceLabel(env, who[0]) : `These ${who.length} units`} ${cave ? 'in the Cave Location, under the Cave counter (+2 TEM; S70 SSR 2)' : pb ? `inside the pillbox, a Location of its own (ASLRB B30.1, B30.111)` : lv ? `on level ${lv} of the building (Level counter, ASLRB B23.421)` : 'on the ground level'}; tick units in the stack card to move only some`,
            }),
          );
        }
      }
      // Units placed here that a special rule lets set up hidden (S23 SSR 1; the Japanese 10%, SK4 8.1.8.5): the stack hides or
      // shows as one, with one entry. A Gun in it that may use HIP (SK4 6.4) hides by that, its crew with it, at no cost
      // to the rule's allowance; the other units by the rule.
      const hipGunsHere = gunTodo.filter((g) => swHexes[g.id] === hex && hipAllowed(g.id) && !hiddenByRule.some((id) => swAssign[g.id] === id));
      const hipCrews = new Set(hipGunsHere.map((g) => swAssign[g.id]).filter(Boolean));
      const ruleHere = todo.some((p) => hexOfLoc(pending[p.id] ?? '') === hex && hideable(p.id));
      const hideHere = todo.filter((p) => hexOfLoc(pending[p.id] ?? '') === hex && hideable(p.id) && !hipCrews.has(p.id));
      if (ruleHere && hideHere.length + hipGunsHere.length > 0) {
        const all = hideHere.every((p) => pendingHidden.has(p.id)) && hipGunsHere.every((g) => pendingHip.has(g.id));
        const quota = hiddenRule?.quota;
        items.push(
          action(all ? 'Set up in the open' : 'Set up hidden', () => {
            const next = new Set(pendingHidden);
            for (const p of hideHere) {
              if (all) next.delete(p.id);
              else next.add(p.id);
            }
            setPendingHidden(next);
            const open = new Set(openGuns);
            for (const g of hipGunsHere) {
              if (all) open.add(g.id);
              else open.delete(g.id);
            }
            setOpenGuns(open);
          }, {
            icon: '?',
            active: all,
            hint: `${all ? 'Show' : 'Hide'} ${hideHere.length === 1 && !hipGunsHere.length ? pieceLabel(env, hideHere[0]) : 'this stack'} and its weapons: hidden units are placed on the map when they fire or move or an enemy unit enters or tries to enter the hex (${hiddenRule?.rule ?? 'SSR'})${hipGunsHere.length ? '; a Gun hides by HIP with its crew (SK4 6.4), free of the allowance' : ''}${quota !== undefined ? `; ${hiddenSe} of ${quota} squad equivalent${quota === 1 ? '' : 's'} hidden so far` : ''}`,
          }),
        );
      }
      // Fortification counters here (full ASL): hide or show them, set a roadblock's hexside or a pillbox's arc, take one back;
      // units placed here go beneath the foxhole, trench or Wire, or stay on top (B27.1, B27.51, B26.4).
      if (fortRule) {
        const here = pendingForts.map((c, i) => ({ c, i })).filter(({ c }) => c.hex === hex);
        for (const { c, i } of here) {
          const name = fortKindName(c);
          const mines = c.kind === 'mines';
          if (!fortLocked) {
            items.push(
              action(c.hidden ? `${name}: set up in the open` : `${name}: set up hidden`, () => changeFort(i, { hidden: !c.hidden }), {
                icon: '?',
                active: c.hidden,
                disabled: mines,
                hint: mines ? (c.mines?.known ? 'A Known or Dummy minefield is placed on the board (ASLRB B28.45, B28.47)' : 'A minefield is recorded, never on the board until it attacks (ASLRB B28.1)') : c.hidden ? 'Place it on the board for all to see' : `Hidden until a Good Order enemy unit has a LOS to it within 16 hexes (at any range outside Concealment Terrain), a unit in it loses concealment, or its TEM is claimed (ASLRB A12.33)`,
              }),
            );
            if (c.kind === 'roadblock') items.push(action('Roadblock: choose the hexside…', () => setFortRingFor(i), { icon: '▬', hint: 'The road hexside it obstructs: pick one on the map (ASLRB B29.1)' }));
            if (c.kind === 'pillbox') items.push(action('Pillbox: face toward…', () => setFortRingFor(i), { icon: '◠', hint: `Covered Arc: ${c.ca !== undefined ? pillboxArcLabel(env, hex, c.ca) : 'none yet'} · pick a hexspine on the map (ASLRB B30.1)` }));
            items.push(action(`Take the ${name} back`, () => unplaceFort(i), { icon: '↩', hint: 'Back to the tray' }));
          }
        }
        const cover = fortificationsHereOf(hex).find((c) => c.kind === 'foxhole' || c.kind === 'trench' || c.kind === 'ditch') ?? fortificationsHereOf(hex).find((c) => c.kind === 'wire');
        const unitsHere = todo.filter((p) => pending[p.id] === hex && !isSw(p.id) && !vehicleTodo.some((v) => v.id === p.id));
        if (cover && unitsHere.length) {
          const chosen = unitsHere.filter((p) => selected.has(p.id));
          const who = chosen.length ? chosen : unitsHere;
          const all = who.every((p) => pendingBeneath.has(p.id));
          const next = new Set(pendingBeneath);
          for (const p of who) if (all) next.delete(p.id);
          else next.add(p.id);
          const err = all ? null : plain(fortSetupIllegal(shownEnv, placing.owner, { type: 'setup.place', side: placing.owner, decisionId: placing.id, placements: pending, beneath: [...next].filter((id) => pending[id] && !isPillboxLoc(pending[id]!)) }));
          const where = cover.kind === 'wire' ? 'beneath the Wire' : cover.kind === 'foxhole' ? `in the foxhole (room for ${cover.capacity ?? 1} squad${(cover.capacity ?? 1) === 1 ? '' : 's'})` : `beneath the ${fortKindName(cover)}`;
          items.push(
            action(all ? (cover.kind === 'wire' ? 'Set up on top of the Wire' : `Set up on top of the ${fortKindName(cover)}`) : `Set up ${where}`, () => { setPendingBeneath(next); setError(null); }, {
              icon: all ? '▴' : '▾',
              active: all,
              disabled: !!err,
              hint: err ?? `${who.length === 1 ? pieceLabel(env, who[0]) : `These ${who.length} units`} ${all ? 'on top of the counter, outside it' : where} (ASLRB ${cover.kind === 'wire' ? 'B26.4' : cover.kind === 'foxhole' ? 'B27.1, B27.12' : 'B27.51'}); tick units in the stack card to move only some`,
            }),
          );
        }
        // Full ASL: a vehicle may start beneath a trench or A-T Ditch (ASLRB B27.51), Hull Down and never moving (B27.52);
        // never beneath a foxhole (B27.1) or Wire (B26.43): the entry stays, greyed with the reason.
        const vehiclesHereNow = todo.filter((p) => pending[p.id] === hex && vehicleTodo.some((v) => v.id === p.id));
        const fortHere = fortificationsHereOf(hex).find((c) => c.kind === 'foxhole' || c.kind === 'trench' || c.kind === 'ditch') ?? fortificationsHereOf(hex).find((c) => c.kind === 'wire');
        if (fortHere)
          for (const v of vehiclesHereNow) {
            const on = pendingBeneath.has(v.id);
            const next = new Set(pendingBeneath);
            if (on) next.delete(v.id);
            else next.add(v.id);
            const err = on ? null : plain(fortSetupIllegal(shownEnv, placing.owner, { type: 'setup.place', side: placing.owner, decisionId: placing.id, placements: pending, beneath: [...next].filter((id) => pending[id] && !isPillboxLoc(pending[id]!)) }));
            const name = fortKindName(fortHere);
            items.push(
              action(on ? `${pieceLabel(env, v).replace(/^\S+ /, '')}: on top of the ${name}` : `${pieceLabel(env, v).replace(/^\S+ /, '')}: beneath the ${name}`, () => { setPendingBeneath(next); setError(null); }, {
                icon: on ? '▴' : '▾',
                active: on,
                disabled: !!err,
                hint: err ?? (on ? `Back on top: it may move, but a tracked vehicle checks for Bog changing VCA in a trench hex (ASLRB B27.55)` : `Beneath the ${name}: Hull Down, never moves (no Start MP, VCA change or Motion), outside its Infantry capacity (ASLRB B27.51, B27.52)`),
              }),
            );
          }
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
        const hullCa = pendingCa[v.id] ?? defaultVca(env, hex);
        items.push(action(pile ? `Face ${pieceLabel(env, v).replace(/^\S+ /, '')} toward…` : 'Face toward…', () => { setCaTurret(false); setCaFor(v.id); }, { icon: '◠', hint: `Vehicle Covered Arc: ${spineLabel(env, hex, hullCa)} · pick a hexspine on the map` }));
        // A turret may start pointing elsewhere than the hull (SK4 3.3.2: TCA and VCA are separate), to fire one way and
        // drive off another without turning first.
        if (vehicleDef(env, v)?.turret !== 'NT')
          items.push(action(vehicleEntry(v, pile, 'Point turret toward…'), () => { setCaTurret(true); setCaFor(v.id); }, { icon: '◎', hint: `Turret Covered Arc: ${spineLabel(env, hex, pendingTca[v.id] ?? hullCa)} · pick a hexspine on the map` }));
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
      // A Smoke Mortar fires into a hex 1 to 3 hexes from the moving AFV, in its LOS and TCA (SK4 7.5): offered on that hex.
      if (ms?.vehicle && ms.hex && hex !== ms.hex && statics.map.hex(hex) && statics.map.distance(ms.hex, hex) <= 3) {
        const mv = state.pieces[ms.units[0]!];
        const mvd = mv ? vehicleDef(env, mv) : null;
        const disp = mvd ? smokeDispenser(env, mvd) : undefined;
        if (disp?.kind === 'sM') {
          const err = plain(session.check({ type: 'vmove.smoke', target: hex }));
          items.push(
            action(`Smoke Mortar here (sM${disp.n})`, () => run({ type: 'vmove.smoke', target: hex }, true), {
              icon: '☁',
              disabled: !!err,
              hint: err ?? `DR ≤ ${disp.n} (+1 BU, +2 while not stopped, plus any Hindrance on the way) places Dispersed Smoke (+2) here for 1 MP; a miss costs nothing (SK4 7.5)`,
            }),
          );
        }
      }
      // Another of our vehicles here while a unit is still moving: it waits until that move ends (the engine refuses to
      // start it), so say so and offer the end of the move, as for a stack of Infantry.
      const waiting = ms ? vehiclesIn(hex).filter((p) => !ms.units.includes(p.id)) : [];
      if (ms && waiting.length) {
        const mover = ms.units.map((u) => pieceLabel(env, state.pieces[u])).join(', ');
        const endType = ms.vehicle ? 'vmove.end' : 'move.end';
        const endErr = plain(session.check({ type: endType }));
        const waiter = chosenVehicle(waiting) ?? waiting[0]!;
        items.push(action(`Move ${pieceLabel(env, waiter).replace(/^\S+ /, '')}`, () => {}, { icon: '➜', disabled: true, hint: `${mover} ${ms.units.length > 1 ? 'are' : 'is'} still moving: end that move first` }));
        items.push(action(`End ${mover}'s move`, () => run({ type: endType }), { icon: '■', disabled: !!endErr, hint: endErr ?? `${mover} ${ms.vehicle?.stopped ? 'spends the MP left here as Delay and ' : ''}ends its move; then this vehicle can move` }));
      }
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
        }
        // Two friendly vehicles left in one hex at the end of the MPh: the owner flips one, whichever he picks, to its wreck side (SK4 3.3.2).
        for (const id of wreckChoices(vehiclesHere, (a) => session.check(a))) {
          const v = state.pieces[id]!;
          items.push(action(vehicleEntry(v, vehiclesHere.length > 1, 'flip to wreck'), () => run({ type: 'vmove.wreck', vehicle: v.id }, true), { icon: '✕', hint: 'Only one vehicle per side may end the MPh in a hex: move one on, or wreck one (SK4 3.3.2)' }));
        }
      }
      if (ms?.vehicle) {
        const woods = woodsEntry(hex);
        if (woods) items.push(...woods);
        const v = state.pieces[ms.units[0]!]!;
        const vd = vehicleDef(env, v)!;
        // Declaring more MP than needed (SK4 3.3.2) is not open into woods (half or all, above) or a building (half its
        // printed MP, ASLRB B23.41).
        if (!vehicleEntryTerrain(env, ms, hex) && legal.some((a) => a.type === 'move.step' && a['to'] === hex && !a['bypass'])) {
          const minimum = env.query('move.stepCost', { ms, to: hex }, 0);
          const left = mfLeft(v.id);
          const enterAll = { type: 'move.step', to: hex, declared: left } as const;
          if (left > minimum && session.check(enterAll) === null) {
            items.push(action(`Enter with all MP (${left} MP)`, () => run(enterAll, true), {
              icon: '■',
              hint: 'Spend all remaining MP entering this hex without stopping, so the vehicle can end its move in Motion (SK4 3.3.2)',
            }));
          }
        }
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
              () => setRing({ hex: at, piece: v.id, what: 'Turret Covered Arc', turret: true, current: tca, note: 'free with each MP expenditure', action: (spine) => (spine === tca ? null : { type: 'vmove.turret', tca: spine }) }),
              { icon: '◎', hint: `TCA: ${spineLabel(env, at, tca)} · pick a hexspine on the map` },
            ),
          );
        // Bounding First Fire (SK4 3.3.2.2), one entry: the MA's shots (then click the target hex) and the MGs together.
        const bff: WheelItem[] = [];
        if (ms.hex && vd.ma && !v.tags['malf'] && !v.tags['maDisabled']) {
          const opts = shotOptions(env, v.id, 'bounding').filter((o) => o.type !== 'ATT' && o.type !== 'IFE');
          // From the vehicle's move so far, as the engine judges it: its MGs firing first leave the MA free to fire (SK4 3.3.2.2).
          const bffErr = maBffRefusal(env, v.id);
          const ma = `${vd.ma.caliber}${vd.ma.barrel ?? ''}`;
          if (bffErr) bff.push(action(ma, () => {}, { disabled: true, hint: bffErr }));
          else bff.push(...opts.map((o) => action(`${ma} · ${o.label}`, () => declareGun(v.id, o.type, false, o.ammo), { hint: o.hint, disabled: !o.available })));
        }
        const vdDisp = smokeDispenser(env, vd);
        if (ms.hex && vdDisp) {
          const disp = vdDisp;
          if (disp.kind === 'sM') {
            // A Smoke Mortar never smokes its own hex: the entry is on the target hex (above).
            const anyErr = plain(session.check({ type: 'vmove.smoke', target: '' }));
            const own = anyErr && !/Choose a hex|reaches 1 to 3|not on the map/i.test(anyErr) ? anyErr : null;
            items.push(action(`Smoke Mortar (sM${disp.n})`, () => {}, { icon: '☁', disabled: true, hint: own ?? 'Right-click a hex 1 to 3 hexes away, in the AFV\'s LOS and Turret Covered Arc, and choose "Smoke Mortar here" (SK4 7.5)' }));
          } else {
            const smErr = plain(session.check({ type: 'vmove.smoke' }));
            items.push(action(`Smoke dispenser (${disp.kind}${disp.n})`, () => run({ type: 'vmove.smoke' }, true), { icon: '☁', disabled: !!smErr, hint: smErr ?? `DR ≤ ${disp.n} (+1 BU) places Dispersed Smoke (+2) in this hex for 1 MP; a miss costs nothing (SK4 7.5)` }));
          }
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
          // An MG the crew's posture bars (a Buttoned Up AAMG) stays on the menu, greyed with the reason.
          if (mode !== 'bffMg')
            for (const w of vehicleMgsUnfired(v)) {
              const why = vehicleMgUnavailable(env, w.id);
              if (why) bff.push(action(`${mgLabel([w])}`, () => {}, { disabled: true, hint: why }));
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
        // Off the map by an ordinary step (a Recalled AFV at its friendly board edge, SK4 7.10).
        else if (ms.hex === hex)
          for (const to of offboardSteps.split(',').filter((o) => o && statics.map.offboardNeighbors(o).onboard.includes(hex)))
            items.push(action(`Exit the map · ${env.query('move.stepCost', { ms, to }, 1)} MP`, () => run({ type: 'move.step', to }, true), { icon: '⇥', hint: 'Leave the map off this edge (also: click the hex beyond it)' }));
        const endErr = plain(session.check({ type: 'vmove.end' }));
        items.push(action(ms.vehicle.stopped ? 'End move (stopped)' : 'End move (in Motion)', () => run({ type: 'vmove.end' }), { icon: '■', disabled: !!endErr, hint: endErr ?? (ms.vehicle.stopped ? 'MP left are spent here as Delay' : 'A vehicle that does not stop stays in Motion') }));
      } else if (!ms) {
        // A Japanese leader may lead a Banzai Charge (SK4 8.1.8.6): the panel takes the target and the units.
        if (!banzaiState(env) && !banzaiDraft) {
          const leaders = own.filter((id) => {
            const p = state.pieces[id]!;
            return defOf(env, p).kind === 'leader' && isJapanese(env, p) && p.tags['broken'] !== true && p.tags['pinned'] !== true && p.tags['moved'] === undefined && p.tags['banzai'] === undefined;
          });
          const candidates = owner ? banzaiCandidates(env, owner) : [];
          for (const l of leaders) {
            // The leader's hex starts ticked: the units there that may charge. A leader who may not (over his IPC) is greyed with why.
            const why = candidates.find((c) => c.id === l)?.why ?? null;
            const mates = [l, ...candidates.filter((c) => c.id !== l && c.why === null && own.includes(c.id)).map((c) => c.id)];
            items.push(
              action(`Banzai Charge (${pieceLabel(env, state.pieces[l]).replace(/^\S+ /, '')})`, () => setBanzaiDraft({ leader: l, units: mates, target: null }), {
                icon: '!',
                disabled: !!why,
                hint: why ?? 'Lead a chain of adjacent Good Order units at an enemy within 8 hexes in LOS: 8 MF, +1 morale, no pins, one hex per Impulse, straight at the target (SK4 8.1.8.6)',
              }),
            );
          }
        }
        // S71 SSR 2: a Japanese unit with a DC may charge an AFV alone, then attack it in CC (CCV 5, -3).
        // Offered without the LOS requirement, which is checked when the charge is declared (ASLRB A6.11).
        const dcCharges = owner ? dcChargeOptions(env, owner, { skipLos: true }).filter((a) => own.includes(a.leader)) : [];
        if (dcCharges.length)
          items.push(
            group(
              'DC charge at…',
              dcCharges.map((a) => {
                const v = state.pieces[a['vehicle'] as string]!;
                return action(`${pieceLabel(env, state.pieces[a['leader'] as string]).replace(/^\S+ /, '')} → ${pieceLabel(env, v).replace(/^\S+ /, '')} in ${hexLabel(a['target'] as string)}`, () => run(a), {
                  hint: 'A lone Banzai Charge at the AFV; unbroken in its hex after Defensive First Fire, a CC attack on it with a CCV of 5 and -3 DRM, the DC used up (SSR 2). The unit must see the AFV: that is checked when you declare',
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
              // Full ASL Dash (ASLRB A4.63): start the move, then pick the end hex beyond the road.
              ...(fullAslRules
                ? (() => {
                    const road = statics.map.neighbors(hex).some((h) => (statics.map.hex(h)?.features ?? []).some((f) => f === 'road' || f.startsWith('road:')));
                    const why = haltedMove ?? moveErr ?? (road ? null : 'No road hex beside this stack (ASLRB A4.63)');
                    return [action('Dash…', () => { start(false, false); setMode('dash'); }, { disabled: !!why, hint: why ?? 'Across the road to a Location on its far side, both two-hex entries within the MF: then click an amber end hex. First Fire at the stack in the road is Area Fire, ordnance +2 (Case J), for each firer to which both ends are non-Open Ground (ASLRB A4.63)' })];
                  })()
                : []),
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
        // Full ASL: beneath the foxhole or trench of the stack's hex, or out of it, for a MF of its own (ASLRB B27.4).
        const se = !elsewhere && fullAslRules ? stackEntrenchment(env, ms) : null;
        if (se) {
          const beneath = !se.beneath;
          const whyEnt = plain(session.check({ type: 'move.entrenchment', beneath }));
          const name = entrenchmentName(se.counter);
          items.push(
            action(beneath ? `Into the ${name} (${se.mf} MF)` : `Out of the ${name} (${se.mf} MF)`, () => run({ type: 'move.entrenchment', beneath }, true), {
              icon: beneath ? '⌂' : '⬆',
              disabled: !!whyEnt,
              hint: whyEnt ?? (beneath ? `A separate MF the DEFENDER may fire at first (ASLRB A8.12); beneath: +2 TEM, no FFMO (B27.3, B27.42)${se.mf === 0 ? '. Free while the counter is hidden (A12.33)' : ''}` : `A separate MF the DEFENDER may fire at (ASLRB A8.12, B27.4); on top the hex TEM applies and FFMO in Open Ground`),
            }),
          );
        }
        // Full ASL: open A-T mines in the stack's hex, removed by a MF of Infantry at the end of the MPh (ASLRB B28.53).
        if (!elsewhere && fullAslRules && !ms.vehicle && ms.hex && removeMinesIllegal(env) !== `No A-T mines in full view in ${ms.hex} (ASLRB B28.53)`) {
          const why = plain(removeMinesIllegal(env));
          items.push(action('Remove the A-T mines (1 MF; gone at the end of the MPh)', () => run({ type: 'move.removeMines' }, true), { icon: '✂', disabled: !!why, hint: why ?? 'Infantry not pinned or broken by then remove them at the end of the MPh (ASLRB B28.53)' }));
        }
        // Full ASL: units on top of the Wire of the stack's hex get beneath it by a Wire Exit dr each (ASLRB B26.4).
        const sw = !elsewhere && fullAslRules ? stackWire(env, ms) : null;
        if (sw && sw.onTop.length) {
          items.push(
            action('Get beneath the Wire (Wire Exit dr)', () => run({ type: 'move.wire' }, true), {
              icon: '⌇',
              disabled: !!sw.refusal,
              hint: sw.refusal ?? `Each unit on top rolls one die and spends that many MF to get beneath (no leadership DRM); a dr above its MF left hangs it up on top for this MPh. The DEFENDER sees the dr before he fires (ASLRB B26.4)`,
            }),
          );
        }
        // Full ASL: Double Time declared during the move (ASLRB A4.5 EXC), and a Dash across the road (A4.63).
        if (!elsewhere && fullAslRules && !ms.vehicle) {
          const dts = lateDoubleTimeEntries(env);
          const dtItem = (d: (typeof dts)[number]) => action(d.label, () => run({ type: 'move.doubleTime', units: d.units }, true), { icon: '»', disabled: !!d.disabled, hint: d.disabled ?? 'One MF more, and a CX counter at once (its IPC one lower) for the rest of the move (ASLRB A4.5)' });
          if (dts.length === 1) items.push(dtItem(dts[0]!));
          else if (dts.length) items.push(group('Double Time now…', dts.map(dtItem), { icon: '»' }));
          const de = dashEntry(env);
          if (de) items.push(action(de.label, () => setMode(mode === 'dash' ? 'normal' : 'dash'), { icon: '⇢', active: mode === 'dash', disabled: !!de.disabled, hint: de.disabled ?? de.hint }));
        }
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
        // Full ASL: into or out of the pillbox of this hex, one MF of its own (ASLRB B30.4, B30.33); a bunker's trench (B30.8).
        // Every refusal shows greyed with its rule (B30.42, B30.44, B30.6, B30.111, B26.4).
        const pbHere = !elsewhere && fullAslRules && ms.hex ? pillboxKnownToSide(env, ms.hex, owner ?? null) : null;
        if (pbHere && ms.hex) {
          const inside = ms.sub === 'pb';
          const to = inside ? ms.hex : pillboxLoc(ms.hex);
          const why = plain(session.check({ type: 'move.step', to }));
          const cost = why ? pillboxMf(env, pbHere, owner!) : env.query('move.stepCost', { ms, to }, 1);
          items.push(
            action(inside ? `Out of the pillbox (${cost} MF)` : `Into the pillbox (${cost} MF)`, () => run({ type: 'move.step', to }, true), {
              icon: inside ? '⬆' : '⌂',
              disabled: !!why,
              hint:
                why ??
                (inside
                  ? 'A MF of its own, onto the ground of the hex, where the DEFENDER may fire at the stack (ASLRB B30.4, B30.33)'
                  : `A MF of its own after any First Fire at the hex (ASLRB B30.4 EX, B30.33); inside: the pillbox's CA or NCA Defense Modification, LOS out only through its Covered Arc (B30.112, B30.113, B30.2)${cost === 0 ? '. Free while it is hidden (A12.33)' : ''}`),
            }),
          );
          // The bunker's own trench (B30.8): from the bunker straight beneath it.
          if (inside && bunkerTrenches(env, ms.hex).includes(ms.hex)) {
            const whyT = plain(session.check({ type: 'move.step', to: ms.hex, beneath: true }));
            items.push(action(`Into the trench (${env.query('move.stepCost', { ms, to: ms.hex, beneath: true }, 1)} MF)`, () => run({ type: 'move.step', to: ms.hex!, beneath: true }, true), { icon: '⌂', disabled: !!whyT, hint: whyT ?? 'From the bunker beneath the trench of its hex, as if the bunker were a trench: the pillbox MF, no trench MF (ASLRB B30.8)' }));
          }
        }
        if (!elsewhere && ms.hex)
          for (const a of legal.filter((x) => x.type === 'move.step' && hexOfLoc(x['to'] as string) === ms.hex && !isPillboxLoc(x['to'] as string) && !(ms.sub === 'pb' && x['to'] === ms.hex))) {
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
        if (movers.flatMap((u) => swHeldBy(state, u.id)).some((s) => (defOf(env, s) as { type?: string }).type === 'DC')) {
          // Greyed with the reason once no adjacent hex will take it (its MF spent on Smoke, say).
          const dcNow = dcTargets();
          const dcWhy = dcNow.hexes.length || mode === 'dc' ? null : (plain(dcNow.why) ?? 'No adjacent hex the DC may be placed in');
          items.push(action('Place DC…', () => setMode(mode === 'dc' ? 'normal' : 'dc'), { icon: '✸', active: mode === 'dc', disabled: !!dcWhy, hint: dcWhy ?? 'Then click an amber hex: an adjacent hex, enemy-held ones included. Placing costs the MF entering it would, spent in this hex, so place it before the stack\'s MF run out or it ends its move (SK1 4.3; an enemy AFV there is the target: a PAATC first, SK4 4.3)' }));
        }
        if (ms.hex) {
          // Recovery (and so capture of an enemy weapon, SK1 5.5 / ASLRB A21.1) by a moving unit of the player's choosing
          // (ticking a mover here means leaving it behind, so there is no shortcut by selection).
          const rec = recoverMenu('move.recover', unpossessedSwAt(env, ms.hex), ms.units.map((u) => state.pieces[u]!).filter(Boolean));
          if (rec) items.push(rec);
        }
      }
    }

    // Full ASL Fire (ASLRB B25.11, B24.72): Kindling in the PFPh, fighting a Flame in the MPh or DFPh, per Location of the hex.
    if (fullAslRules && decision.kind === 'phase' && decision.owner === owner && !placing && !fortifying && (phase === 'PFPh' || phase === 'MPh' || phase === 'DFPh')) {
      for (const loc of locationsOf(env, hex)) {
        const ownHere = personnelAt(env, loc, owner);
        if (!ownHere.length) continue;
        const where = levelOfLoc(loc) ? ` (level ${levelOfLoc(loc)})` : '';
        if (phase === 'PFPh' && owner === state.attacker) {
          const n = fireNumbers(env, loc);
          const { leaders, smcs, mmcs } = kindlers(env, loc, owner);
          const possible = (leaders.length && mmcs.length) || smcs.length;
          const why = !n
            ? `${terrainOf(env, loc).name} is not Burnable Terrain (ASLRB B25.1)`
            : blazeAt(env, loc)
              ? 'The Location is already ablaze'
              : !possible
                ? mmcs.length
                  ? 'Only a unit stacked with a Good Order leader may Kindle, or a SMC alone (ASLRB B25.11)'
                  : 'No unpinned Good Order Infantry here that has not fired this phase'
                : plain(session.check({ type: 'fire.kindle', loc, attempts: mmcs.length && leaders.length ? mmcs.map((m) => ({ unit: m.id, director: leaders[0]!.id })) : [{ unit: smcs[0]!.id }] }));
          items.push(
            action(`Kindle…${where}`, () => setKindle({ loc, picks: leaders.length ? mmcs.map((m) => m.id) : [], self: leaders.length || !smcs.length ? null : smcs[0]!.id }), {
              icon: '🔥',
              disabled: !!why,
              active: kindle?.loc === loc,
              hint: why ?? `Try to start a Flame in the ${terrainOf(env, loc).name}: Kindle # ${n!.kindle}; every attempt here is predesignated at once (ASLRB B25.11)`,
            }),
          );
          // Entrenching (ASLRB B27.11): a foxhole dug by any unbroken MMC here that has attempted nothing yet, at ground level.
          if (!levelOfLoc(loc)) {
            const hexWhy = entrenchHexIllegal(env, hex);
            const { mmcs, leaders } = entrenchers(env, loc, owner);
            const ent = entrenchmentKnownTo(env, hex, owner);
            const probe = mmcs.length ? plain(session.check({ type: 'entrench.attempt', loc, attempts: mmcs.slice(0, 1).map((m) => ({ unit: m.id, ...(leaders[0] ? { director: leaders[0].id } : {}) })) })) : null;
            const whyEnt = hexWhy ?? (mmcs.length ? probe : ownHere.some((p) => isEntrenched(p)) ? `Already beneath the ${ent ? entrenchmentName(ent) : 'entrenchment'} (ASLRB B27.11)` : 'No unpinned Good Order MMC here that has not fired or been given a task this phase (ASLRB B27.11)');
            const dig = mmcs[0] ? entrenchDrm(env, loc, mmcs[0].id, leaders[0]?.id) : null;
            items.push(
              action('Entrench…', () => setEntrench({ loc, picks: mmcs.map((m) => m.id), director: leaders[0]?.id ?? null }), {
                icon: '⛏',
                disabled: !!whyEnt,
                active: entrench?.loc === loc,
                hint: whyEnt ?? `Each squad or HS ticked makes its own DR: a foxhole 1S on a Final DR ≤ 5${dig?.drm ? ` (${dig.explain.join(', ')})` : ''}${ent ? `, growing the ${entrenchmentName(ent)} here by one size` : ''}; every participant is TI for the Player Turn (ASLRB B27.11, A4.8)`,
              }),
            );
          }
        }
        if (phase === 'MPh' || phase === 'DFPh') {
          const f = fireRecordAt(env, loc);
          if (!f) continue;
          const units = clearers(env, loc, owner);
          const why = f.blaze
            ? 'A Blaze cannot be extinguished (ASLRB B25.7)'
            : phase === 'MPh' && ms
              ? 'A Flame is fought before any stack moves (ASLRB B24.72)'
              : !units.some((p) => !isWeaponDef(defOf(env, p)) && defOf(env, p).kind !== 'leader')
                ? 'Needs an unpinned Good Order MMC here that has not moved or fired this Player Turn (ASLRB B24.72)'
                : null;
          items.push(
            action(`Fight the fire…${where}`, () => setDouse({ loc, picks: units.map((p) => p.id) }), {
              icon: '🧯',
              disabled: !!why,
              active: douse?.loc === loc,
              hint: why ?? `One Clearance DR for every unit joining: ≤ 2 puts the Flame out, 3–6 Hampers it this Player Turn; the units are TI (ASLRB B24.72)`,
            }),
          );
        }
        // Full ASL: Wire, roadblock and rubble Clearance Tasks, the DR at the end of the CCPh (ASLRB B24.71, B24.73, B24.76).
        if ((phase === 'MPh' || phase === 'DFPh') && fullAslRules) {
          for (const t of clearanceTargets(env, loc, owner)) {
            const { mmcs, leaders } = clearanceCandidates(env, t.kind, loc, owner);
            const mine = unitsHere.filter((p) => p.side === owner && !isWeaponDef(defOf(env, p)));
            const first = mine.map((p) => clearanceUnitIllegal(env, p, t.kind, loc)).find((x) => x);
            const moving = t.kind === 'rubble' && ms ? ms.units : null;
            const picks = moving ?? [...mmcs, ...leaders.slice(0, 1)].map((p) => p.id);
            // A minefield's units that entered by a partial TB name its hexside as one of the two (ASLRB B24.74).
            const partialSide = t.kind === 'mines' ? partialTbsAt(env, hexOfLoc(loc)).find((x) => x.units?.some((u) => picks.includes(u)))?.side : undefined;
            const hexsides = t.kind === 'rubble' || t.kind === 'mines' ? defaultTbHexsides(env, hexOfLoc(loc), partialSide) : undefined;
            const probe = { type: 'clearance.declare', kind: t.kind, counter: t.counter.id, loc, units: picks.filter((id) => mmcs.some((p) => p.id === id)), ...(leaders.find((l) => picks.includes(l.id)) ? { director: leaders.find((l) => picks.includes(l.id))!.id } : {}), ...(hexsides ? { hexsides } : {}) };
            const why =
              clearanceSideFor(env, t.kind) !== owner
                ? t.kind === 'rubble' || t.kind === 'mines'
                  ? t.kind === 'mines' ? (phase === 'MPh' && ms ? 'Minefield Clearance is declared before any stack moves (or by entering it with all MF: click the hex while moving) (ASLRB B24.74)' : 'Minefields are cleared in your own MPh (ASLRB B24.74)') : 'Rubble is cleared in your own MPh (ASLRB B24.71)'
                  : phase === 'MPh' && ms
                    ? 'Clearance is declared before any stack moves (ASLRB B24.73, B24.76)'
                    : 'Not your Clearance phase'
                : !mmcs.length
                  ? (first ?? 'Needs an unpinned Good Order MMC here that has not moved or fired this Player Turn (ASLRB B24.7)')
                  : plain(session.check(probe));
            const name =
              t.kind === 'wire' ? 'Clear the Wire…' : t.kind === 'rubble' ? 'Clear the rubble (Trail Break)…' : t.kind === 'mines' ? 'Clear the minefield (Trail Break)…' : `Remove the roadblock (${roadblockObstacles(env).filter((o) => o.id === t.counter.id).map((o) => `${hexLabel(o.a)}–${hexLabel(o.b)}`).join('')})…`;
            items.push(
              action(name, () => setClearing({ kind: t.kind, counter: t.counter.id, loc, picks, ...(hexsides ? { hexsides } : {}) }), {
                icon: '🧹',
                disabled: !!why,
                active: clearing?.loc === loc && clearing.counter === t.counter.id,
                hint:
                  why ??
                  (t.kind === 'mines'
                    ? 'No MF, so no First Fire; TI; Final DR ≤ 2 at the end of the CCPh places a Trail Break across two hexsides you choose; an Original 12 (11–12 Inexperienced) Casualty Reduces the clearers (ASLRB B24.74)'
                    : t.kind === 'rubble'
                    ? 'Spends all MF in the hex as Hazardous Movement (-2 to attacks on them, no FFMO/FFNAM); Final DR ≤ 2 at the end of the CCPh places a Trail Break across two hexsides you choose (ASLRB B24.71)'
                    : `Final DR ≤ 2 at the end of the CCPh; every unit ticked is TI for the Player Turn (A4.8)${t.kind === 'roadblock' ? '; Hazardous Movement: -2 to attacks on them, no FFMO/FFNAM (A4.62)' : ''} (ASLRB ${CLEARANCE_RULE[t.kind]})`),
              }),
            );
          }
        }
      }
    }
    if (decision.kind === 'phase' && phase === 'RPh') {
      const idsHere = new Set(unitsHere.map((p) => p.id));
      // A leader with several broken units here may rally them all at once, or one at a time: a broken leader rallied
      // first may then rally the others himself in the same RPh (ASLRB A10.71, Q&A), so broken leaders head the list.
      const allBy = legal.filter((a) => a.type === 'rally.rallyAll' && idsHere.has(a['leader'] as string));
      const isLeaderUnit = (a: (typeof legal)[number]) => defOf(env, state.pieces[a['unit'] as string]!).kind === 'leader';
      const rallies = legal
        .filter((a) => (a.type === 'rally.selfRally' || a.type === 'rally.rally') && idsHere.has(a['unit'] as string))
        .sort((a, b) => Number(isLeaderUnit(b)) - Number(isLeaderUnit(a)));
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
        // A leader who may not rally a broken unit here (in Melee he is not in Good Order, SK1 3.1 f): greyed, with why.
        ...(owner
          ? groupRallyRefusals(
              rallyRefusals(
                env,
                owner,
                unitsHere,
                (leader, unit) => rallies.some((a) => a.type === 'rally.rally' && a['leader'] === leader && a['unit'] === unit),
                (leader, unit) => plain(session.check({ type: 'rally.rally', leader, unit })),
              ),
            ).map((r) =>
              action(`${pieceLabel(env, state.pieces[r.leader])} rallies ${r.units.length === 1 ? pieceLabel(env, state.pieces[r.units[0]!]) : `${r.units.length} broken units`}`, () => {}, { disabled: true, hint: r.reason }),
            )
          : []),
      ];
      if (rallyItems.length === 1) items.push({ ...rallyItems[0]!, icon: '♥' } as WheelItem);
      else if (rallyItems.length > 1) items.push(group('Rally', rallyItems, { icon: '♥' }));
      // Recovery by the unit the player picks (Good Order, not yet acted this RPh; a MMC for a Gun), or the one unit ticked here.
      const holders = unitsHere.filter((p) => p.side === owner && !isWeaponDef(defOf(env, p)));
      const ticked = holders.filter((p) => selected.has(p.id));
      const rec = recoverMenu('rally.recover', unpossessedSwAt(env, hex), holders, ticked.length === 1 ? ticked[0] : undefined);
      if (rec) items.push(rec);
      // U.S. Marine Corps (SK4 8.4): a 7-6-8 deploys by NTC; two 3-4-8 with a leader recombine.
      if (!fullAslRules) {
        for (const a of legal.filter((x) => x.type === 'rally.deploy' && idsHere.has(x['unit'] as string)))
          items.push(action(`Deploy ${pieceLabel(env, state.pieces[a['unit'] as string]).replace(/^\S+ /, '')} (NTC)`, () => run(a), { icon: '⇉', hint: 'Pass a Normal Task Check to split the squad into two 3-4-8 half-squads: its sole Rally Phase action (SK4 8.4)' }));
        for (const a of legal.filter((x) => x.type === 'rally.recombine' && (x['units'] as string[]).every((u) => idsHere.has(u))))
          items.push(action(`Recombine into a 7-6-8 (${pieceLabel(env, state.pieces[a['leader'] as string]).replace(/^\S+ /, '')})`, () => run(a), { icon: '⇇', hint: 'Two Good Order 3-4-8 half-squads with a Good Order leader become a 7-6-8: their sole Rally Phase action (SK4 8.4.1)' }));
      } else items.push(...aslDeployItems(unitsHere, owner!));
      // DM (SK1 3.1 g): "Remove DM" (or "Keep DM", to take that back) on every broken unit here under DM.
      const dms = dmChoices(env, owner!, unitsHere).map((c) => ({ ...dmItem(c), label: `${c.label}: ${pieceLabel(env, state.pieces[c.unit])}` }));
      if (dms.length === 1) items.push(dms[0]!);
      else if (dms.length > 1) items.push(group('DM…', dms, { icon: '⚐' }));
      const deployHere = unitsHere.filter((p) => p.side === owner && p.defId === 'am.768' && !fullAslRules);
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
        const { drm, notes } = pfCheckDrm(env, pfShot.unit, pfShot.targetType === 'VTT');
        const pfHint = `PF check: needs ${pfCheckNeedText(drm, notes)}, a final 1-3: then To Hit ${[10, 8, 6, 4].slice(0, pfMaxRange(env) + 1).map((th, r) => `${th} at ${r}`).join(', ')}; HEAT To Kill 31, or 16 FP on one unit in a building; an original 6 pins`;
        // Full ASL: several enemy vehicles in the hex: one entry per vehicle, the PF aims at the one named (ASLRB A5.2).
        const named = pfShot.targetType === 'VTT' ? vehicleTargets(shownEnv, hex, owner!) : [];
        for (const v of named.length > 1 ? named : [null]) {
          const pf = { ...pfShot, target: hex, ...(v ? { targetUnit: v.id } : {}) };
          const why = plain(pfIllegal(env, owner!, pf, decision.kind === 'firstFire' ? 'first' : FIRE_MODE[phase]!, decision.kind === 'firstFire' ? ms?.units : undefined));
          items.push(action(v ? `Fire Panzerfaust at the ${v.label}` : 'Fire Panzerfaust at this hex', () => firePf(hex, v?.id), { icon: '✦', disabled: !!why, hint: why ?? pfHint }));
        }
        items.push(action('Cancel Panzerfaust', () => { setPfShot(null); setDeclared(false); setSelected(new Set()); }, { icon: '✕' }));
      } else if ((enemyHere || gunShot?.targetType === 'ATT') && declared && gunShot) {
        const turn = caChangeFor(env, gunShot.gun, hex);
        // Full ASL: several enemy vehicles in the hex: the Vehicle Target Type shot names one (ASLRB A5.2); a miss by less
        // than the vehicles there may still hit another (A5.132).
        const named = gunShot.targetType === 'VTT' ? vehicleTargets(shownEnv, hex, owner!) : [];
        if (named.length > 1)
          for (const v of named) {
            items.push(action(`${turn !== null ? 'Turn the Gun and fire' : 'Fire'} at the ${v.label}`, () => fireGunAt(hex, v.id), { icon: '✦', hint: `Roll To Hit against the ${v.label}; a miss by less than ${named.length} may still hit another vehicle in the hex (ASLRB A5.132)` }));
            items.push(action(`Preview shot at the ${v.label}`, () => { setGunShot({ ...gunShot, targetUnit: v.id }); setTarget(hex); }, { icon: '◎', active: target === hex && gunShot.targetUnit === v.id, hint: 'Show the To Hit number and DRM in the panel first' }));
          }
        else {
          items.push(action(turn !== null ? 'Turn the Gun and fire at this hex' : 'Fire at this hex', () => fireGunAt(hex), { icon: '✦', hint: turn !== null ? 'The target is outside the Covered Arc: the Gun turns first (To Hit DRM)' : 'Roll To Hit against this hex' }));
          items.push(action('Preview shot', () => setTarget(hex), { icon: '◎', active: target === hex, hint: 'Show the To Hit number and DRM in the panel first' }));
        }
      } else if (declared && !enemyHere && !gunShot && !pfShot && maybePillbox) {
        items.push(possiblePillboxItem());
        if (decision.kind === 'phase' && (phase === 'PFPh' || phase === 'DFPh' || phase === 'AFPh') && blindFireOffered(shownEnv, hex, owner))
          items.push(action('Fire at this hex (no enemy seen)', () => fireAt(hex), { icon: '✦', hint: 'Area Fire at a hex where you see no enemy: anything hidden there is attacked at half FP and revealed if affected (SK4 6.4); otherwise the fire is spent' }));
      } else if (declared && !enemyHere && decision.kind === 'phase' && (phase === 'PFPh' || phase === 'DFPh' || phase === 'AFPh') && (blindFireOffered(shownEnv, hex, owner) || !!caveFireTarget(env, hex, []))) {
        // Blind fire at a hex where no enemy is seen: a hidden unit there is attacked as Area Fire and revealed if
        // affected (SK4 6.4; ASLRB A12.13 "reveal the unit if affected"). Offered at every such hex alike, so it tells
        // nothing about what may be hidden. Not at a hex holding the firer's own units: nothing hidden can be there.
        if (blindFireOffered(shownEnv, hex, owner))
          items.push(action('Fire at this hex (no enemy seen)', () => fireAt(hex), { icon: '✦', hint: 'Area Fire at a hex where you see no enemy: anything hidden there is attacked at half FP and revealed if affected (SK4 6.4); otherwise the fire is spent' }));
        items.push(...caveFireItems(hex, []));
      } else if (enemyHere && declared) {
        // Full ASL: a hex with enemy units on more than one level is fired at one Location at a time (ASLRB A2.8, A7.3).
        const enemyLocs = enemyLocsIn(hex);
        // A lone Flamethrower facing only enemy AFVs: its To Kill attack on one comes first, the IFT attack (harmless to a
        // Buttoned Up AFV) after it (SK4 4.2).
        const ftOnlyAfvs = ftAfvTargets(shownEnv, fireDecl, hex, owner!).length > 0;
        const loneFt = fireDecl && fireDecl.units.length === 0 && fireDecl.sw.length === 1 && (defOf(env, state.pieces[fireDecl.sw[0]!]!) as { type?: string }).type === 'FT';
        if (loneFt && ftOnlyAfvs)
          for (const v of unitsHere.filter((p) => p.side !== owner && vehicleDef(env, p) && !p.tags['wreck']))
            items.push(action(`Flamethrower at ${pieceLabel(env, v).replace(/^\S+ /, '')}`, () => fireAt(hex, v.id), { icon: '🔥', hint: 'Predesignate the AFV: a To Kill roll on the HE & Flame table (TK 8, ½ at 2 hexes, +1 CE, +2 Open-Topped), armor ignored (SK4 4.2)' }));
        const hexHint = loneFt && ftOnlyAfvs ? 'An IFT attack on the hex: it never harms a Buttoned Up AFV, only a CE crew (SK4 4.2, 7.7)' : 'Resolve the declared fire against this hex';
        if (enemyLocs.length < 2) {
          const at = firstFireAt(hex) ?? enemyLocs[0] ?? hex;
          items.push(action(isPillboxLoc(at) ? `Fire at the pillbox${enemyNames(at) ? '' : ' (contents unknown)'}` : 'Fire at this hex', () => fireAt(at), { icon: '✦', hint: isPillboxLoc(at) ? 'Affects only the pillbox (ASLRB B30.34)' : hexHint }));
        } else
          for (const l of enemyLocs)
            items.push(action(isPillboxLoc(l) ? `Fire at the pillbox${enemyNames(l) ? `: ${enemyNames(l)}` : ' (contents unknown)'}` : `Fire at ${locName(l)}: ${enemyNames(l)}`, () => fireAt(l), { icon: '✦', hint: isPillboxLoc(l) ? 'Affects only the pillbox (ASLRB B30.34)' : locName(l) === 'outside the pillbox' ? 'Affects only units outside the pillbox (ASLRB B30.34)' : `Resolve the declared fire against ${hexLabel(l)} only` }));
        items.push(...caveFireItems(hex, enemyLocs));
        items.push(...snapItems(hex));
        if (maybePillbox && !enemyLocs.some(isPillboxLoc)) items.push(possiblePillboxItem());
        if (loneFt && !ftOnlyAfvs)
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
          // From inside a building a PF takes the Backblast or the +2 To Hit DRM; not from a PTO hut (SK4 4.4.3, 8.2.1).
          const inBuilding = backblastFrom(env, hex);
          const line = (targetType: 'VTT' | 'ITT', backblast?: boolean, director?: PieceId) => () => {
            setSelectedHex(hex);
            setSelected(new Set([u.id]));
            setPfShot({ unit: u.id, targetType, ...(backblast !== undefined ? { backblast } : {}), ...(director ? { director } : {}) });
            setTarget(null);
            setDeclared(true);
            setError(null);
          };
          type Way = readonly [string, 'VTT' | 'ITT', boolean | undefined];
          const ways: readonly Way[] = [
            ...(inBuilding
              ? [['At a vehicle · +2 To Hit (no Backblast)', 'VTT', false] as Way, ['At a vehicle · take the Backblast', 'VTT', true] as Way]
              : [['At a vehicle', 'VTT', undefined] as Way]),
            ...(inBuilding
              ? [['At Infantry in a building or a Gun · +2 To Hit', 'ITT', false] as Way, ['At Infantry in a building or a Gun · Backblast', 'ITT', true] as Way]
              : [['At Infantry in a building or a Gun', 'ITT', undefined] as Way]),
          ];
          // Each way again directed by each leader beside the firer (SK4 4.4; ASLRB A7.531), greyed with the reason when he may not.
          const pfLeaders = leadersHere(hex);
          const opts = ways.flatMap(([label, type, bb]) => [
            action(label, line(type, bb)),
            ...pfLeaders.map((l) => {
              const lwhy = plain(swDirectorIllegal(env, l.id, owner, hex, u.id));
              return action(`${label} · directed by ${pieceLabel(env, l).replace(/^\S+ /, '')}`, line(type, bb, l.id), lwhy ? { disabled: true, hint: lwhy } : { hint: 'His leadership DRM modifies the To Hit DR; he directs no other fire this phase' });
            }),
          ]);
          const left = (pfCap(env, owner) ?? 0) - pfUsed(env, owner);
          if (why) items.push(action(`Panzerfaust: ${uname}`, () => {}, { icon: '✦', disabled: true, hint: why }));
          else items.push(group(`Panzerfaust: ${uname}…`, opts, { icon: '✦', hint: `${left} PF shot${left === 1 ? '' : 's'} left this scenario; a PF check dr ≤ 3 first (SK4 4.4.2), then pick the target hex` }));
        }
      }
      // Guns here that can shoot: each by target type, and as Intensive Fire once it has lost ROF.
      if (!declared)
        for (const g of gunsFireable(hex)) {
          // An Infantry MG fires as ordnance only at an AFV (SK4 4.1): its entry says so.
          const mgShot = !ordnanceOf(env, g);
          const name = pieceLabel(env, g).replace(/^\S+ /, '') + (mgShot ? ' at a vehicle' : '');
          // Every Target Type × ammunition the counter allows; the ones the Gun cannot use now say why.
          const mode = decision.kind === 'firstFire' ? gunFirstFireMode(env, { weapon: g.id, target: ms?.hex ?? '', targetType: 'ITT' }) : FIRE_MODE[phase]!;
          // In Final Fire a Gun fires under its manning crew's First Fire marker too (SK4 3.3.3): Intensive Fire only.
          const fired = !!(mode === 'final' && !vehicleDef(env, g) ? finalFireMarker(env, g) : g.tags['fire']);
          // An ordnance SW lists each shot again directed by each leader beside it (SK4 4.4, 4.5), as Fire does for Infantry.
          const opts = directedShotOptions(env, g.id, shotOptions(env, g.id, mode)).map((t) =>
            action(t.label, () => declareGun(g.id, t.type, fired && t.type !== 'IFE', t.ammo, t.backblast, t.director), { hint: t.hint, ...(t.available ? {} : { disabled: true }) }),
          );
          // A single way to fire (a light Mortar's HE on the Area Target Type) needs no menu of one: the entry fires it.
          const fireMenu = (label: string, choices: WheelItem[], hint: string): WheelItem => {
            const only = choices.length === 1 ? choices[0]! : null;
            // A MG's one shot is already named by its entry ("Fire LMG at a vehicle").
            return only?.kind === 'action' ? { ...only, label: mgShot ? label : `${label} · ${only.label}`, icon: '✦', hint: only.hint ?? hint } : group(`${label}…`, choices, { icon: '✦', hint });
          };
          // A weapon that cannot fire at all now (a Mortar or Gun that moved, in the AFPh; malfunctioned; its crew broken):
          // the entry is greyed with the reason, rather than leading through the shot to a refusal.
          // A turreted MA whose turret Rear MG fired this phase (ASLRB D1.82) is greyed the same way.
          const cannot = owner ? plain(ordnanceWeaponIllegal(env, g.id, mode, owner) ?? (vehicleDef(env, g) ? maRmgRefusal(env, g.id) : null)) : null;
          // Intensive Fire is a Gun's or vehicle's (SK4 3.2.4); a SW that has fired (BAZ, PSK, PIAT, ATR, Light Mortar) is
          // done for the phase, and its holder's own FP is offered by the stack's Fire (SK4 4.4 LATW To Hit Example).
          const holder = g.loc.kind === 'held' ? state.pieces[g.loc.by] : undefined;
          const ownFp = holder && !fireMarker(holder) && !holder.tags['ownFpForfeit'] ? 'the unit holding it may still fire its own FP' : 'the unit holding it has fired its own FP this phase too';
          const swName = name.replace(/ at a vehicle$/, '');
          const swDone =
            fired && !!shotWeaponOf(env, g)?.light
              ? g.tags['fire']
                ? `The ${swName} has fired this phase (a SW cannot use Intensive Fire); ${ownFp}`
                : `The unit holding the ${swName} is marked First Fire, and the ${swName} with it (SK4 3.3.3); a SW cannot use Intensive Fire`
              : null;
          // IFE fires again like a MG, never as Intensive Fire (SK4 6.8; ASLRB C2.29): an entry of its own.
          const ife = shotOptions(env, g.id, mode).find((t) => t.type === 'IFE');
          const ifeAgain = (label: string, hint: string): WheelItem[] =>
            ife ? [action(`${name}: ${ife.label} ${label}`, () => declareGun(g.id, 'IFE'), { icon: '✦', hint: ife.available ? hint : ife.hint, ...(ife.available ? {} : { disabled: true }) })] : [];
          if (cannot || swDone) items.push(action(`Fire ${name}`, () => {}, { icon: '✦', disabled: true, hint: (cannot ?? swDone)! }));
          else if (fired && !g.tags['intensive'] && decision.kind !== 'firstFire' && phase !== 'AFPh')
            items.push(
              fireMenu(
                `Intensive Fire: ${name}`,
                opts.filter((o) => !/IFE/.test(o.label)),
                g.tags['fire'] ? 'One more shot after losing ROF: +2 To Hit, B# -2 (SK4 3.2.4)' : 'Its crew is marked First Fire: one shot as Intensive Fire at an adjacent hex, +2 To Hit, B# -2 (SK4 3.2.4, 3.3.3)',
              ),
              ...(phase === 'DFPh' && finalFireMarker(env, g) === 'first' ? ifeAgain('at an adjacent unit', 'Marked First Fire: its IFE fires at an adjacent unit at half FP (doubled for PBF), B# -2 (SK4 3.3.3, 6.8)') : []),
            );
          else if (fired && decision.kind === 'firstFire') {
            items.push(fireMenu(`${name} again (Intensive)`, opts.filter((o) => !/IFE/.test(o.label)), 'A Gun marked First Fire fires again only as Intensive Fire (SK4 3.3.3)'));
            items.push(
              ...(gunFirstFireMode(env, { weapon: g.id, target: ms?.hex ?? '', targetType: 'IFE' }) === 'fpf'
                ? ifeAgain('as FPF', 'Final Protective Fire like a MG: half FP (doubled for PBF), B# -2; then its crew takes a NMC on the original DR (SK4 3.3.1, 6.8)')
                : ifeAgain('as Subsequent First Fire', 'Subsequent First Fire like a MG: half FP, B# -2; not Intensive Fire (SK4 6.8)')),
            );
          } else if (!fired) items.push(fireMenu(`Fire ${name}`, opts, 'Choose how the Gun fires, then pick the target'));
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
          const dDisp = smokeDispenser(env, vd);
          if (dDisp && dDisp.kind !== 'sM') {
            const sErr = plain(session.check({ type: 'defSmoke', vehicle: v.id }));
            items.push(action(vehicleEntry(v, pile, `smoke dispenser (${dDisp.kind}${dDisp.n})`), () => run({ type: 'defSmoke', vehicle: v.id }), { icon: '☁', disabled: !!sErr, hint: sErr ?? 'Dispersed Smoke in its own hex on a DR ≤ its number (+1 BU); not a weapon, it may still fire' }));
          }
        }
      // The end-of-phase turn without MP (SK4 3.3.2): hull and turret each pick a hexspine on the map; the vehicle then fires
      // no more this phase, and a PFPh turn keeps it from moving (ASLRB C3.22).
      if (!declared && decision.kind === 'phase' && (phase === 'PFPh' || phase === 'DFPh' || phase === 'AFPh'))
        for (const v of unitsHere.filter((p) => p.side === owner && vehicleDef(env, p) && !p.tags['wreck'])) {
          const pile = unitsHere.filter((p) => p.side === owner && vehicleDef(env, p) && !p.tags['wreck']).length > 1;
          const vca = Number(v.tags['vca'] ?? 0);
          const tca = Number(v.tags['ca'] ?? vca);
          const after = phase === 'PFPh' ? 'it fires no more this phase and does not move this Player Turn (ASLRB C3.22)' : 'it fires no more this phase';
          const turretOn = vehicleDef(env, v)!.turret !== 'NT';
          const parts: { what: string; key: 'vca' | 'tca'; current: number; icon: string }[] = [{ what: 'Vehicle Covered Arc', key: 'vca', current: vca, icon: '◠' }];
          if (turretOn) parts.push({ what: 'Turret Covered Arc', key: 'tca', current: tca, icon: '◎' });
          for (const part of parts) {
            const act = (spine: number) => ({ type: 'vehicle.face', vehicle: v.id, [part.key]: spine });
            const open = [0, 1, 2, 3, 4, 5].some((s) => s !== part.current && !session.check(act(s)));
            const why = open ? null : plain(session.check(act((part.current + 1) % 6)));
            items.push(
              action(vehicleEntry(v, pile, turnWithoutFiringLabel(part.key === 'vca' ? 'turn hull' : 'turn turret')), () => setRing({ hex, piece: v.id, what: part.what, current: part.current, note: `no MP; ${after}`, action: (spine) => (spine === part.current ? null : act(spine)) }), {
                icon: part.icon,
                disabled: !open,
                hint: why ?? `Turn without MP at the end of the phase, instead of firing (SK4 3.3.2); ${after}. Pick a hexspine on the map.${turnAndFireHint(gunsFireable(hex).some((w) => w.id === v.id) ? fireEntryFor(v) : null)}`,
              }),
            );
          }
          // Hull and turret in the one end-of-phase change (SK4 3.3.2 "A TCA/VCA may also be changed"): the hull's spine,
          // then the turret's, which otherwise rides round with the hull (SK4 7.8). Turning one alone ends the vehicle's
          // turn for the phase, so the other could not follow.
          if (turretOn) {
            // The turret's spine is absolute; left where the hull carries it, it is not sent.
            const both = (hullSpine: number, turretSpine: number) => {
              const riding = (tca + hullSpine - vca + 6) % 6;
              return { type: 'vehicle.face', vehicle: v.id, ...(hullSpine !== vca ? { vca: hullSpine } : {}), ...(turretSpine !== riding ? { tca: turretSpine } : {}) };
            };
            const hullOk = (s: number) => s === vca || !session.check({ type: 'vehicle.face', vehicle: v.id, vca: s });
            const turretOk = [0, 1, 2, 3, 4, 5].some((s) => s !== tca && !session.check({ type: 'vehicle.face', vehicle: v.id, tca: s }));
            const open = turretOk && [0, 1, 2, 3, 4, 5].some((s) => s !== vca && hullOk(s));
            const why = open ? null : plain(session.check({ type: 'vehicle.face', vehicle: v.id, vca: (vca + 1) % 6 })) ?? plain(session.check({ type: 'vehicle.face', vehicle: v.id, tca: (tca + 1) % 6 }));
            items.push(
              action(vehicleEntry(v, pile, turnWithoutFiringLabel('turn hull and turret')), () =>
                setRing({
                  hex,
                  piece: v.id,
                  what: 'Vehicle Covered Arc',
                  current: vca,
                  note: 'pick the hull first',
                  action: (spine) => (spine === vca ? null : { type: 'vehicle.face', vehicle: v.id, vca: spine }),
                  then: (hullSpine) => {
                    const riding = (tca + hullSpine - vca + 6) % 6;
                    return { hex, piece: v.id, what: 'Turret Covered Arc', turret: true, current: riding, note: `no MP; ${after}`, action: (spine) => (hullSpine === vca && spine === tca ? null : both(hullSpine, spine)) };
                  },
                }), {
                icon: '◎',
                disabled: !open,
                hint: why ?? `Turn the hull and the turret together without MP at the end of the phase, instead of firing (SK4 3.3.2); ${after}. Pick the hull's hexspine, then the turret's.`,
              }),
            );
          }
          // A smoke dispenser is used only in a Movement Phase (SK4 7.5): greyed here with the reason.
          const disp = smokeDispenser(env, vehicleDef(env, v)!);
          if (disp) items.push(action(vehicleEntry(v, pile, `smoke dispenser (${disp.kind}${disp.n})`), () => {}, { icon: '☁', disabled: true, hint: SMOKE_DISPENSER_MPH_ONLY }));
        }
      // A vehicle's machine guns fire together, on the IFT (SK4 7.8).
      if (!declared)
        for (const v of unitsHere.filter((p) => p.side === owner && vehicleDef(env, p) && !p.tags['wreck'])) {
          const mgs = vehicleMgsReady(v);
          const pile = unitsHere.filter((p) => p.side === owner && vehicleDef(env, p) && !p.tags['wreck']).length > 1;
          // An MG barred whatever the target (a turret Rear MG in the phase its MA fired, ASLRB D1.82; a Buttoned Up
          // AAMG) stays on the menu, greyed with the reason.
          for (const w of vehicleMgsUnfired(v)) {
            const why = vehicleMgUnavailable(env, w.id);
            if (why) items.push(action(vehicleEntry(v, pile, `fire ${mgLabel([w])}`), () => {}, { icon: '✦', disabled: true, hint: why }));
          }
          if (!mgs.length) continue;
          const err = plain(env.query('fire.illegal', { decl: { units: [], sw: mgs.map((w) => w.id), target: hex }, mode: decision.kind === 'firstFire' ? 'first' : FIRE_MODE[phase]!, side: owner }, null));
          // The vehicle's own hex stands in for a target here: only what stops the MGs at any target greys the entry out
          // (it read "Cannot fire into own hex", which disabled the entry for every vehicle).
          const arcErr = err && !/Covered Arc|Unknown target|own hex/.test(err) ? err : null;
          items.push(action(vehicleEntry(v, pile, `fire MGs (${mgLabel(mgs)})`), () => declareFire(hex, mgs.map((w) => w.id), ''), { icon: '✦', disabled: !!arcErr, hint: arcErr ?? 'BMG through the hull arc, CMG through the turret arc, AAMG only CE; then pick the target. A target outside the arc turns the turret (or, for the BMG alone, the hull at the NT DRM) first (SK4 7.8)' }));
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
        // A stack not next to the group cannot join it (SK1 3.2); the engine would refuse the shot only once the
        // target is clicked.
        const blocked = addToGroupBlocked(env, selected, own);
        // A directed Fire Group needs a directing leader in every hex (SK1 3.2): adding a stack
        // means naming its leader too, or giving up the direction.
        if (blocked) items.push(action('Add to fire group', add, { icon: '＋', disabled: true, hint: blocked }));
        else if (leaders.length)
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
          const label = turnWithoutFiringLabel(`Turn ${pieceLabel(env, g).replace(/^\S+ /, '')}`);
          if (why) items.push(action(label, () => {}, { icon: '◠', disabled: true, hint: why }));
          else
            items.push(
              action(
                label,
                () => setRing({ hex, piece: g.id, what: 'Covered Arc', current: coveredArc(g), note: 'without firing: ends the Gun and crew\'s fire this phase, and they cannot move this Player Turn', action: (spine) => (spine === coveredArc(g) ? null : { type: 'gun.changeCa', gun: g.id, ca: spine }) }),
                { icon: '◠', hint: `Covered Arc: ${spineLabel(env, hex, coveredArc(g))} · turn without firing: the Gun and crew are done firing this phase and cannot move this Player Turn (SK4 3.2.4).${turnAndFireHint(fireEntryFor(g))}` },
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
        items.push(action('Point turret toward…', () => setRing({ hex, piece: tv.id, what: 'Turret Covered Arc', turret: true, current: tca, note: turnable.turretHint, action: (spine) => (spine === tca ? null : turnable.turret(spine)) }), { icon: '◎', hint: `TCA: ${spineLabel(env, hex, tca)} · pick a hexspine on the map (A/D)` }));
    }
    if (facingDone) items.push(action('Done turning', facingDone, { icon: '✓', hint: 'Keep this facing and go back to Defensive First Fire' }));

    if (decision.kind === 'phase' && phase === 'RtPh' && routing) {
      // A rout under way: the next hexes it may enter, and stopping where it is when that is legal.
      // The next hexes are clicked on the map (amber), never picked from a list.
      if (canStopRout) items.push(action('Stop here', () => run({ type: 'rout.stop', unit: routing.unit }), { icon: '⌂', hint: 'End the rout in this building or woods hex' }));
      // Full ASL: a squad Reduced to a HS by a minefield attack routs on by default, or ends its rout here (ASLRB B28.413).
      if (legal.some((a) => a.type === 'rout.endHere' && a['unit'] === routing.unit))
        items.push(action('End rout here', () => run({ type: 'rout.endHere', unit: routing.unit }), { icon: '⏹', hint: 'Reduced to a HS by the minefield: it may continue its rout or end it here (ASLRB B28.413)' }));
      // Full ASL: on top of the Wire, the Wire Exit dr comes before any step (ASLRB B26.41).
      if (legal.some((a) => a.type === 'rout.wire' && a['unit'] === routing.unit))
        items.push(action('Wire Exit dr (get beneath the Wire)', () => run({ type: 'rout.wire', unit: routing.unit }), { icon: '⌇', hint: 'One die: that many rout MF to get beneath; above the MF left, hung up on top (ASLRB B26.41)' }));
      items.push(...routStairs(routing.unit));
      // Right-clicked on one of the amber hexes: that step, as a click on it would take (the road-or-woods choice too).
      if (routStepTo(routing.unit, hex)) items.push(...(woodsRoadRout(routing.unit, hex) ?? [action(`Rout into ${hexLabel(hex)}`, () => routStep(routing.unit, hex), { icon: '➜', hint: 'The rout goes on into this hex' })]));
      // On the routing unit itself, with nowhere to stop: say what is left to do rather than "nothing to do".
      else if (hexOfId(state, routing.unit) === hex && !canStopRout)
        items.push(
          action('Rout on… click an amber hex', () => {}, {
            icon: '➜',
            disabled: true,
            hint: routStopWhy ?? `It has not reached a building or woods hex it may end in (${routEndNames}marked ROUT END): the amber hexes are where it may go next`,
          }),
        );
      // Other broken units here wait for this rout to end: say so, and where the router must still go (SK1 3.6).
      for (const b of unitsHere.filter((p) => p.side === owner && p.id !== routing.unit && p.tags['broken'] && !routInfo(p.id)?.done && !routing.escort.includes(p.id))) {
        const why = routWaitHint(env, b.id);
        if (why) items.push(action(`Rout ${pieceLabel(env, b).replace(/^\S+ /, '')}`, () => {}, { icon: '➜', disabled: true, hint: why }));
      }
    } else if (decision.kind === 'phase' && phase === 'RtPh') {
      const broken = unitsHere.filter((p) => p.side === owner && p.tags['broken']);
      for (const b of broken) {
        const r = routInfo(b.id);
        if (r?.done) continue;
        const stay = action('Stay here', () => run({ type: 'rout.stay', unit: b.id }), {
          icon: '⌂',
          disabled: !!r?.must,
          hint: r?.must && r.reason ? `Must rout: ${routReason(r.reason)}` : b.loc.kind === 'hex' && b.loc.sub === 'pb' ? 'Not forced to rout: inside a pillbox (ASLRB B30.5); it may still be made DM' : 'Does not rout',
        });
        // The rout is walked on the map, hex by hex: the entry selects the unit (with the Good Order
        // leader going along, SK1 3.6, when one is picked), the hexes it may enter light up amber, and a
        // click on one is the first step. Low Crawl is the toggle below.
        const canRout = legal.some((a) => a.type === 'rout.step' && a['unit'] === b.id);
        const escorts = routEscorts(env, b.id);
        const pick = (leaders: PieceId[]) => () => { setSelectedHex(hex); setSelected(new Set([b.id, ...leaders])); };
        const children = [stay];
        // Full ASL: a unit on top of the Wire rolls its Wire Exit dr first; getting beneath may be its whole rout (ASLRB B26.4, B26.41).
        const wireDr = legal.filter((a) => a.type === 'rout.wire' && a['unit'] === b.id);
        for (const a of wireDr)
          children.push(
            action(
              a['lowCrawl']
                ? 'Low Crawl beneath the Wire'
                : (a['leaders'] as string[] | undefined)?.length
                  ? `Wire Exit dr, then rout with ${(a['leaders'] as string[]).map((l) => pieceLabel(env, state.pieces[l]).replace(/^\S+ /, '')).join(', ')}`
                  : 'Wire Exit dr, then rout',
              () => run({ type: 'rout.wire', unit: b.id, ...(a['lowCrawl'] ? { lowCrawl: true } : {}), ...(a['leaders'] ? { leaders: a['leaders'] } : {}) }),
              {
                icon: '⌇',
                hint: a['lowCrawl']
                  ? 'The whole rout: the dr spent getting beneath the Wire, no further (ASLRB B26.4)'
                  : `One die${(a['leaders'] as string[] | undefined)?.length ? ' each (the leader too, if on top)' : ''}: that many rout MF to get beneath, the rest to rout on; above the MF left, hung up on top${r?.must ? ' and eliminated for Failure to Rout' : ''} (ASLRB B26.41${(a['leaders'] as string[] | undefined)?.length ? '; the leader routs along, A10.711' : ''})`,
              },
            ),
          );
        if (!canRout && !wireDr.length) {
          const why = routRefusals(b.id);
          children.push(action('No hex to rout to', () => {}, { icon: '✖', disabled: true, hint: why.length ? why.join('; ') : 'No legal rout this phase' }));
        }
        if (canRout) {
          children.push(...routStairs(b.id));
          children.push(action(escorts.length ? 'Rout alone… click a hex' : 'Rout… click a hex', pick([]), { icon: '➜', hint: 'Select it; the amber hexes are where it may go, click one' }));
          for (const l of escorts) {
            // Full ASL: a leader carrying more than his IPC routs on fewer MF, and the two keep to them (ASLRB A10.711, A4.42).
            const short = (env.query('rout.escortMf', { leader: l }, null) ?? 6) < env.query('rout.mf', { unit: b.id }, 6);
            children.push(
              action(`Rout with ${pieceLabel(env, state.pieces[l]).replace(/^\S+ /, '')}… click a hex`, pick([l]), {
                icon: '➜',
                hint: `The leader routs along: his DRM helps the Interdiction MC, but he dies if it fails${short ? '; his SW cost him MF, and the two rout only as far as his MF reach (ASLRB A10.711, A4.42)' : ''}`,
              }),
            );
          }
          // A leader stacked with it who may not rout along for a reason of his own (full ASL: more than two PP, A4.42).
          for (const p of Object.values(state.pieces)) {
            if (p.side !== b.side || p.id === b.id || escorts.includes(p.id) || defOf(env, p).kind !== 'leader' || p.tags['broken'] || locOf(state, p) !== locOf(state, b)) continue;
            const why = env.query('rout.escortIllegal', { leader: p.id }, null);
            if (why) children.push(action(`Rout with ${pieceLabel(env, p).replace(/^\S+ /, '')}`, () => {}, { icon: '➜', disabled: true, hint: why }));
          }
        }
        items.push(group(`${pieceLabel(env, b).replace(/^\S+ /, '')}${r?.must ? ' (must rout)' : ''}`, children, { icon: '☠', hint: r?.must && r.reason ? `Must rout: ${routReason(r.reason)}` : r?.cannot ? `Cannot rout: ${ROUT_BAR_TEXT[r.cannot]}` : 'May rout or stay' }));
      }
      // The click-to-rout Low Crawl toggle, only where a broken unit here may Low Crawl now.
      if (broken.some((b) => legal.some((a) => a.type === 'rout.step' && a['unit'] === b.id && a['lowCrawl'])))
        items.push(action('Low Crawl', () => setLowCrawl(!lowCrawl), { icon: '↓', active: lowCrawl, hint: 'Click-to-rout uses Low Crawl' }));
      if (broken.length) items.push({ ...selectAll, label: 'Select to rout', hint: 'Select the first broken unit here and a leader to go with it (SK1 3.6: units rout one at a time)' } as WheelItem);
    }

    // Full ASL: Wall Advantage over the wall hexsides (a roadblock) of the hex (ASLRB B9.32, B9.322); a mandatory one is the engine's.
    // In the RPh the claims wait for the end-of-RPh step, the ATTACKER first (B9.322).
    if ((decision.kind === 'phase' || decision.kind === WA_RPH_DECISION) && fullAslRules) {
      for (const p of unitsHere.filter((u) => u.side === owner && wallSidesOf(env, u).length > 0)) {
        const forfeit = hasWa(env, p);
        const type = forfeit ? 'wa.forfeit' : 'wa.claim';
        const why = plain(session.check({ type, unit: p.id }));
        items.push(
          action(`${forfeit ? 'Forfeit' : 'Claim'} Wall Advantage (${pieceLabel(env, p).replace(/^\S+ /, '')})`, () => run({ type, unit: p.id }), {
            icon: '▥',
            disabled: !!why,
            hint: why ?? (forfeit ? 'Back to the in-hex TEM; the enemy across may then claim it (ASLRB B9.31, B9.322)' : 'The wall TEM vs fire across its hexside and no in-hex TEM; denies WA to the enemy across (ASLRB B9.31, B9.321)'),
          }),
        );
      }
    }
    // A stack none of whose units may advance keeps the entry, greyed, with the reason (manhandlers may not advance, SK4 6.5).
    if (decision.kind === 'phase' && phase === 'APh' && !units.length) {
      const stuck = unitsHere.filter((p) => p.side === owner && !isWeaponDef(defOf(env, p))).map((p) => p.id);
      const why = stuck.length ? statics.map.neighbors(hex).map((to) => plain(session.check({ type: 'advance', units: stuck, to }))).find((m) => m) : null;
      if (why) items.push(action('Advance…', () => {}, { icon: '➜', disabled: true, hint: why }));
    }
    if (decision.kind === 'phase' && phase === 'APh' && units.length) {
      // Hexes are picked on the map, never from a list: the entry selects the units, the hexes they may
      // advance into light up green, and a click on one advances them.
      // On the map, or off it from an exit hex (ASLRB A2.6: units leave the map "using normal MPh/APh capabilities").
      const offboard = statics.map.offboard('N,E,S,W').filter((o) => statics.map.offboardNeighbors(o.id).onboard.includes(hex)).map((o) => o.id);
      // Upstairs, a hex beside stands for its same floor (ASLRB A4.7, B23.422).
      const tos = advanceTos(legal, units);
      const targets = [...statics.map.neighbors(hex), ...offboard].map((h) => clickLoc(tos, h, hex)).filter((to) => session.check({ type: 'advance', units, to }) === null);
      if (targets.length)
        items.push(action('Advance… click a hex', () => { setSelectedHex(hex); setSelected(new Set(units)); }, { icon: '➜', hint: `Select these units; the green hexes are where they may advance, click one${targets.some((t) => offboard.includes(t)) ? ' (the green hex beyond the map edge exits them)' : ''}` }));

      // Full ASL: up or down the stairs of this hex, one Location (ASLRB A4.7, B23.422).
      const at = state.pieces[units[0]!] ? locOf(state, state.pieces[units[0]!]!) : null;
      for (const to of statics.map.hex(hex) ? locationsOf(env, hex) : []) {
        if (!at || to === at) continue;
        const why = plain(session.check({ type: 'advance', units, to }));
        if (why === 'Advance is one hex') continue;
        // Full ASL: into the pillbox of this hex as its one Location, or out of it into this hex (B30.42, B30.44, B30.6).
        if (isPillboxLoc(to) || isPillboxLoc(at)) {
          const into = isPillboxLoc(to);
          items.push(action(into ? 'Advance into the pillbox' : 'Advance out of the pillbox', () => run({ type: 'advance', units, to }), { icon: into ? '⌂' : '⬆', disabled: !!why, hint: why ?? (into ? 'Into the pillbox of this hex: one Location (ASLRB A4.7)' : 'Out of the pillbox, halting in its hex, even beside the enemy (ASLRB B30.6)') }));
          continue;
        }
        const up = levelOfLoc(to) > levelOfLoc(at);
        items.push(action(up ? `Advance up to level ${levelOfLoc(to)}` : 'Advance down to the ground', () => run({ type: 'advance', units, to }), { icon: up ? '▲' : '▼', disabled: !!why, hint: why ?? 'Up or down the stairs of this hex: an advance of one Location (ASLRB A4.7, B23.422)' }));
      }
      // Full ASL: from beneath a trench into the bunker of the next hex, along the trench (ASLRB B30.8).
      for (const to of at && fullAslRules ? adjacentLocs(env, at).filter((l) => isPillboxLoc(l) && hexOfLoc(l) !== hex) : []) {
        const why = plain(session.check({ type: 'advance', units, to }));
        items.push(action(`Advance along the trench into the bunker in ${hexLabel(hexOfLoc(to))}`, () => run({ type: 'advance', units, to }), { icon: '⌂', disabled: !!why, hint: why ?? 'As if the bunker were a trench (ASLRB B30.8)' }));
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
    // Repairs: SW carried by our units here, and our vehicles' MA and MGs (SK4 3.1 c). Only ever in the Rally Phase (SK1
    // 3.1, SK4 3.1 c), so not offered in the others; in the RPh a greyed entry says why (already tried, say).
    const swRepairs = (phase === 'RPh' ? carried : [])
      .filter((sw) => sw.tags['malf'])
      .map((sw) => {
        const err = plain(session.check({ type: 'rally.repair', unit: (sw.loc as { by: string }).by, sw: sw.id }));
        return action(pieceLabel(env, sw), () => run({ type: 'rally.repair', unit: (sw.loc as { by: string }).by, sw: sw.id }, true), { disabled: !!err, hint: err ?? undefined });
      });
    const vehicleRepairs = phase === 'RPh' ? unitsHere.filter((p) => p.side === owner && isVehiclePiece(p.id)).flatMap(vehicleRepairItems) : [];
    const repairs = [...swRepairs, ...vehicleRepairs];
    if (repairs.length) items.push(group('Repair…', repairs, { icon: '🔧' }));

    // Attacks a card gives the side against a hex (S35: a Sniper in the Russian DFPh, a Stuka in the German one).
    if (decision.kind === 'phase')
      for (const s of ssrHexAttacks(env, owner)) {
        const a = { type: s.type, hex };
        if (session.check(a) === null) items.push(action(s.label, () => run(a, true), { icon: '✸', hint: s.hint }));
      }
    // Off-board artillery (SSR): at the start of the PFPh, a leader calls a fire mission on a hex. His LOS to it is checked
    // once the call is made (ASLRB A6.11), so every leader who may observe is offered at every hex.
    const oba = decision.kind === 'phase' && phase === 'PFPh' ? artilleryMissions(env, owner) : null;
    if (oba) {
      const spotters = artilleryObservers(env, owner, hex);
      const label = `Call ${oba.label} fire (${oba.left} left)`;
      const hint = `Contact on a dr ≤ ${scenario.ssr.find((r) => r.module === 'offboard-artillery' && (r.params as { side?: string } | undefined)?.side === owner)?.params?.['contact'] ?? '?'}; the salvo lands at the start of the AFPh, perhaps off target. The observer is marked Prep Fire. His LOS to the hex is checked when you call: without one, this phase's attempt is spent.`;
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
    if (ok.length === 0) {
      // Greyed with the reason when no unit here may take it in a phase a SW changes hands (a broken holder keeps it).
      const why = passRefusal(phase, decision?.kind, decision?.owner === owner, options.map((o) => o.err));
      return why ? action(label, () => {}, { disabled: true, hint: why }) : null;
    }
    // Each unit with what it already carries, so two alike squads can be told apart (one with an LMG, one with none).
    const to = (u: Piece) => {
      const has = swHeldBy(state, u.id).map((w) => pieceLabel(env, w).replace(/^\S+ /, ''));
      return `to ${pieceLabel(env, u).replace(/^\S+ /, '')}${has.length ? ` (has ${has.join(', ')})` : ok.length > 1 ? ' (no SW)' : ''}`;
    };
    return group(label, ok.map((o) => action(to(o.u), () => run({ type: 'rally.transfer', sw: sw.id, to: o.u.id }, true))));
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
      if (p.tags['malf'] && phase === 'RPh') {
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
        // A leader here who may not rally it (in Melee he is not in Good Order, SK1 3.1 f): greyed, with why.
        for (const r of rallyRefusals(env, owner, unitsHere.filter((u) => u.id === p.id || !!smc(env, u)), (leader) => rallies.some((a) => a['leader'] === leader), (leader, unit) => plain(session.check({ type: 'rally.rally', leader, unit }))))
          items.push(action(`Rallied by ${pieceLabel(env, state.pieces[r.leader]).replace(/^\S+ /, '')}`, () => {}, { icon: '♥', disabled: true, hint: r.reason }));
        // DM (SK1 3.1 g): out of woods and buildings a broken unit keeps it unless its owner has it removed.
        for (const c of dmChoices(env, owner!, [p])) items.push(dmItem(c));
        if (isVehiclePiece(p.id)) for (const it of vehicleRepairItems(p)) items.push({ ...it, label: it.label.replace(pieceLabel(env, p), 'Repair').trim() });
      }
      if (decision?.kind === 'phase' && phase === 'RtPh' && p.tags['broken']) {
        const r = routInfo(p.id);
        // A unit that has routed (or stayed) is done for the phase: say so rather than offer a greyed choice with no reason.
        if (r?.done) items.push(action('Routed this phase', () => {}, { icon: '⌂', disabled: true, hint: plain(endBlocked) ?? 'Done for this Rout Phase' }));
        else
          items.push(
            action('Stays (no rout)', () => run({ type: 'rout.stay', unit: p.id }), {
              icon: '⌂',
              disabled: !!r?.must || !!routing,
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
      // No unit here may take it: greyed, with the engine's reasons (a SMC may never carry more than 2 PP, SK4 4.0).
      const refused = recoverRefusal((picked ? [picked] : units).map((u) => why(u, s)));
      if (refused) return [action(pieceLabel(env, s), () => {}, { disabled: true, hint: refused })];
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

  /**
   * Full ASL Deploy and Recombine wheel entries for a stack in the RPh (`deployEntries`: ASLRB A1.31, A1.32, A2.52). A squad
   * holding two or more weapons asks how they are shared first (A1.31 "freely rearranged").
   */
  function aslDeployItems(unitsHere: Piece[], side: string): WheelItem[] {
    const send = (o: DeployOption) => {
      if (o.askSplit) setDeploySplit({ unit: o.action['unit'] as string, leader: o.action['leader'] as string, second: o.action['second'] as string[] });
      else run(o.action as never, true);
    };
    const entries = deployEntries(env, state, legal, (a) => plain(session.check(a as never)), unitsHere, side);
    const item = (e: DeployEntry): WheelItem => {
      const icon = e.kind === 'deploy' ? '⇉' : '⇇';
      if (e.disabled) return action(e.label, () => {}, { icon, disabled: true, hint: e.hint });
      if (e.options.length === 1) return action(e.label, () => send(e.options[0]!), { icon, hint: e.hint });
      return group(e.label, e.options.map((o) => action(o.label, () => send(o), { hint: o.hint })), { icon, hint: e.hint });
    };
    const deploys = entries.filter((e) => e.kind === 'deploy').map(item);
    const recombines = entries.filter((e) => e.kind === 'recombine').map(item);
    return [...(deploys.length > 1 ? [group('Deploy…', deploys, { icon: '⇉' })] : deploys), ...(recombines.length > 1 ? [group('Recombine…', recombines, { icon: '⇇' })] : recombines)];
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
    const carriers = swCarriers(env, ids);
    const firers = ids.filter((id) => state.pieces[id] && !['leader', 'sw', 'gun'].includes(defOf(env, state.pieces[id]).kind) && !carriers.includes(id));
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
  // A shot picked in the log has its LOS drawn on the map as the shot found it: clear for a shot that resolved, red for one
  // that found no LOS. Only a blocked one is traced again (over the map as it stands) to show where: re-tracing any shot
  // would be a free LOS check between those hexes now, with whatever Smoke or wrecks lie there today (ASLRB A6.11).
  const [losReview, setLosReview] = useState<number | null>(null);
  const losThreads = useMemo(() => {
    const line = losReview === null ? undefined : sections.flatMap((s) => s.lines).find((l) => l.seq === losReview);
    if (!line?.los) return null;
    const { from, to } = line.los;
    // The ends are Locations (full ASL: an upper level is traced from its height); the map draws them by hex.
    // A Snap Shot (full ASL): each firing Location's LOS went to both corners of the hexside crossed (ASLRB A8.15, B9.42).
    const snap = line.los.snap;
    const snapK = snap ? sideToward(statics.map, snap[0], snap[1]) : null;
    const ends = from.flatMap((loc) => (snapK !== null ? [snapK, (snapK + 1) % 6].map((v) => ({ loc, v })) : [{ loc, v: null as number | null }]));
    return ends.map(({ loc, v }) => {
      // Fire at a stack in Bypass (full ASL): this firing hex's LOS went to the corner it chose (ASLRB A4.34).
      const pt = line.los!.at?.[hexOfLoc(loc)];
      const vertex = v ?? (pt ? cornerBetween(statics.map, hexOfLoc(to), pt[0], pt[1]) : null);
      const blocked = !!line.los!.blocked;
      const tr = blocked ? env.query('los.trace', { from: loc, to, ...(vertex !== null ? { toAt: { vertex } } : {}), ...(v !== null ? { noBlind: true, noTargetSmoke: true } : {}) }, { clear: true, hindrance: 0, parts: [] }) : null;
      const [fromLevel, toLevel] = [levelOfLoc(loc), levelOfLoc(to)];
      return {
        from: hexOfLoc(loc),
        to: hexOfLoc(to),
        ...(vertex !== null ? { toVertex: vertex } : {}),
        clear: !blocked,
        ...(tr?.blockedAt ? { blockedAt: tr.blockedAt } : {}),
        ...(fromLevel ? { fromLevel } : {}),
        ...(toLevel ? { toLevel } : {}),
      };
    });
  }, [losReview, sections, env]);
  const theirHex = theirFocus?.hex ?? null;
  const theirColor = theirFocus?.color ?? 0;
  const ssMarks = ss?.marks;
  const boardOverlay = useMemo(() => {
    const o = losThreads ? { ...overlay, los: losThreads } : overlay;
    const t = theirHex ? { ...o, theirSelection: { hex: theirHex, color: theirColor } } : o;
    // A commentator's check lights its hexes (the firers, the target) over anything the screen lit.
    return ssMarks?.size ? { ...t, highlights: new Map([...(t.highlights ?? []), ...ssMarks]) } : t;
  }, [overlay, losThreads, theirHex, theirColor, ssMarks]);
  const result = state.result;
  const sideName = (s?: string) => (s ? (scenario.sides.find((x) => x.side === s)?.name ?? NATION[s] ?? s) : '');
  const gameOver = useMemo(() => gameOverText(env, scenario, state, sideName), [env, scenario, state.result]);
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
      /** Online play: the hex the other player has selected, as this board rings it. */
      theirFocus: theirFocus?.hex ?? null,
      /** Online setup: the other player's placements as this board receives them (piece id → hex). */
      theirDraft,
      selectedHex,
      kindOf: (id: PieceId) => (state.pieces[id] ? defOf(env, state.pieces[id]!).kind : null),
      /** The fire group as declared so far (the orders panel's), or null. */
      fireDecl,
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
            ? // A phase that cannot end yet (units still to rout) says what holds it up, naming the units.
              (plain(endBlocked) ?? `When you are finished, ${endLabel} is in the top bar.`)
            : 'Answer in the panel on the right.';

  // ------------------------------------------------------------------ render
  return (
    <div className={`game ${aside ? 'with-rail' : ''}`}>
      <div
        className={`board-pane${ss ? ` ss-${ss.status}` : ''}`}
        ref={paneRef}
        // A LOS shown from the log goes away at any click or touch on the map (pan included); the log line hides it too.
        onPointerDownCapture={(e) => {
          if (losReview !== null && (e.target as Element).closest?.('.board-host')) setLosReview(null);
        }}
      >
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
          onDropPiece={(hex, id) => (ss?.drag ? ss.drag.drop(hex, id) : placing && trayTodo.some((p) => p.id === id) && place(id, hex))}
          draggablePiece={(hex) => (ss?.drag ? ss.drag.piece(hex) : placing ? (picked && trayPending[picked] === hex ? picked : placedAt(hex)) : null)}
          onReturnPiece={(id) => pending[id] && unplace(id, false)}
          fx={fx.boardFx}
          animate={fxLevel !== 'off'}
          {...(followAction && session.mySide !== undefined ? { follow: (side: SideId) => side !== session.mySide } : {})}
          holdFace={fx.holdsFace}
          objectives={objectives}
          control={control}
          fortified={fortifiedShown}
          fires={fireHexes}
          rubble={rubbleHexes}
          fortifications={fortHexesShown}
          outOfPlay={outOfPlay}
          hidePieces={unitsHidden || peekTerrain || !!ss?.hideUnits}
          hideMarkers={markersHidden || peekBare || !!ss?.hideMarkers}
          weather={weatherFx && fxLevel !== 'off' ? { kind: weatherFxKind(weather), windAngle } : null}
          ink={ss?.ink}
          pen={ss?.pen ?? null}
          onInk={ss?.onInk}
          checkLos={ss?.checkLos ?? null}
          heat={ss?.heat ?? null}
        />
        {ss?.banner}
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
            windAngle={aslWind && aslWind.force !== 'none' && aslWind.dir !== undefined ? hexsideScreenAngle(aslWind.dir, rotation) : aslWind?.gusts && aslWind.gustDir !== undefined ? hexsideScreenAngle(aslWind.gustDir, rotation) : windAngle}
            aslWind={aslWind}
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
            // Not on a commentator's board: a bug report posts its picture of the board publicly, and that board may show
            // either side's hidden units in a match still being played.
            tools={
              ss ? null : <HudTools
                game={{
                  ...(matchId ? { matchId } : {}),
                  scenarioId: scenario.id,
                  scenarioTitle: scenario.title,
                  turn: session.state.turn,
                  phase: session.state.phase,
                  actionCount: session.actionCount,
                  ...(session.mySide !== undefined ? { mySide: session.mySide } : {}),
                  ruleset: engine.ruleset.versionHash,
                  ui: { decision: decision?.kind ?? null, resolving, wheel: !!wheel || !!chitWheel, phaseWheel: showingWheel, sideCollapsed },
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
            <b>{hexLabel(hoverHex)}</b>
            {statics.map.hex(hoverHex)?.terrain ?? (statics.map.offboardHex(hoverHex) ? 'offboard' : '')}
            {statics.map.hex(hoverHex)?.features.length ? ` · ${statics.map.hex(hoverHex)!.features.join(', ')}` : ''}
            {control[hoverHex] && <span className={`ctl side-${control[hoverHex]}`}> · {sideName(control[hoverHex])} control</span>}
            {routHover && <span className={`rout-why ${routHover.barred ? 'barred' : 'end'}`}>{routHover.text}</span>}
            {moveHover && <span className={`rout-why ${moveHover.barred ? 'barred' : 'end'}`}>{moveHover.text}</span>}
          </div>
        )}
        {peek && peekDrawn && (
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
              onClose: closePeek,
            }}
          />
        )}
        {wheel && <ActionWheel at={wheel.at} title={wheel.title ?? hexLabel(wheel.hex)} items={wheel.items ?? wheelItems(wheel.hex)} onClose={() => setWheel(null)} emptyHint={wheelEmptyHint} />}
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
        {/* The next phase is announced once a finished Close Combat's results are put away (Close, or the linger ends). */}
        {fx.wheel && !ccLingering && <PhaseWheel key={fx.wheel.id} cue={fx.wheel} phases={phases} sideName={sideName} level={fxLevel} onDone={fx.dismissWheel} />}
        {result && !reviewing && !ccShown && !resolving && (
          <GameOver winner={result.winner} reason={gameOver?.reason ?? result.reason} decidedBy={gameOver?.decidedBy} sideName={sideName} onLobby={onQuit} onReview={() => setReviewing(true)} aar={aar} awards={awards} />
        )}
        {settings && <SettingsPanel fx={fxLevel} onFx={setFxLevel} weatherFx={weatherFx} onWeatherFx={setWeatherFx} callStrip={callStrip} onCallStrip={setCallStrip} stackCard={stackCard} onStackCard={setStackCard} followAction={followAction} onFollowAction={setFollowAction} extra={settingsExtra} onClose={() => setSettings(false)} />}
        {shortcuts && <ShortcutsDialog onClose={() => setShortcuts(false)} />}
        {charts && <ChartsDialog nationalities={scenario.sides.flatMap((s) => s.nationalities ?? [s.nationality])} onClose={() => setCharts(false)} />}
        {decision?.kind === BLAZE_ESCAPE_DECISION && decision.owner === owner && (
          // Units in a Blaze at the start of the RtPh (ASLRB B25.4): break and rout out, stay (and die at the phase's end), or move out when they cannot break.
          <Modal title="Blaze: leave or stay?" kicker={PHASE_NAME[phase] ?? phase}>
            <p>Infantry in a Blaze must leave by the end of this Rout Phase or be eliminated (ASLRB B25.4). Pinned units and units in Melee cannot leave.</p>
            <ul className="end-ask-units">
              {((decision.data?.['units'] as string[] | undefined) ?? []).map((id) => {
                const p = state.pieces[id];
                const at = (decision.data?.['locs'] as Record<string, string> | undefined)?.[id] ?? (p?.loc.kind === 'hex' ? p.loc.hex : '');
                const canBreak = !!legal.find((a) => a.type === 'blaze.break' && a['unit'] === id);
                const outs = legal.filter((a) => a.type === 'blaze.moveOut' && a['unit'] === id);
                return (
                  <li key={id}>
                    {pieceLabel(env, p)}
                    <span className="muted"> · {hexLabel(hexOfLoc(at))}{levelOfLoc(at) ? ` level ${levelOfLoc(at)}` : ''} · Blaze</span>{' '}
                    {canBreak && (
                      <button className="primary small" onClick={() => run({ type: 'blaze.break', unit: id })}>
                        Break and rout out
                      </button>
                    )}{' '}
                    {outs.map((a) => (
                      <button key={String(a['to'])} className="primary small" onClick={() => run(a)}>
                        Move out to {hexLabel(hexOfLoc(String(a['to'])))}
                      </button>
                    ))}{' '}
                    <button className="ghost small" onClick={() => run({ type: 'blaze.stay', unit: id })}>
                      Stay (eliminated at the end of the RtPh)
                    </button>
                  </li>
                );
              })}
            </ul>
          </Modal>
        )}
        {deploySplit && state.pieces[deploySplit.unit] && (
          <Modal title={`Deploy ${pieceLabel(env, state.pieces[deploySplit.unit]).replace(/^\S+ /, '')}: share its weapons`} kicker="Rally Phase" onClose={() => setDeploySplit(null)}>
            <p>A squad’s possessions are freely rearranged among its half-squads when it Deploys (ASLRB A1.31). Pick the half-squad each weapon goes with; this applies only if the NTC passes.</p>
            <ul className="end-ask-units">
              {swHeldBy(state, deploySplit.unit)
                .sort((x, y) => (x.id < y.id ? -1 : 1))
                .map((w) => {
                  const second = deploySplit.second.includes(w.id);
                  const put = (toSecond: boolean) => setDeploySplit({ ...deploySplit, second: toSecond ? [...deploySplit.second.filter((x) => x !== w.id), w.id] : deploySplit.second.filter((x) => x !== w.id) });
                  return (
                    <li key={w.id}>
                      {pieceLabel(env, w)}{' '}
                      <button className={second ? 'ghost small' : 'primary small'} onClick={() => put(false)}>
                        Half-squad 1
                      </button>{' '}
                      <button className={second ? 'primary small' : 'ghost small'} onClick={() => put(true)}>
                        Half-squad 2
                      </button>
                    </li>
                  );
                })}
            </ul>
            <div className="buttons">
              <button
                className="primary"
                autoFocus
                onClick={() => {
                  const d = deploySplit;
                  setDeploySplit(null);
                  run({ type: 'rally.deploy', unit: d.unit, leader: d.leader, second: d.second }, true);
                }}
              >
                Roll the NTC
              </button>
              <button className="ghost" onClick={() => setDeploySplit(null)}>
                Cancel
              </button>
            </div>
          </Modal>
        )}
        {fortConfirm && (
          <Modal title="Unused fortification counters" kicker="Setup" onClose={() => setFortConfirm(null)}>
            <p>Confirming now forfeits what is still in the tray ({fortRule?.rule ?? 'SSR'}): counters not set up at the start of the scenario are not placed later.</p>
            <ul className="end-ask-units">
              {fortConfirm.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <div className="buttons">
              <button className="primary" onClick={() => { setFortConfirm(null); sendSetup(); }}>
                Confirm anyway
              </button>
              <button className="ghost" onClick={() => setFortConfirm(null)}>
                Back to the tray
              </button>
            </div>
          </Modal>
        )}
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
            <p className="hint">{gameOver?.reason ?? result.reason}</p>
            {!!gameOver?.decidedBy.length && (
              <ul className="result-decided">
                {gameOver.decidedBy.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
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
            <h2>{decisionTitle(decision!.kind, phase, fortOpen, decision!.data?.['ending'] === true && !banzaiState(env)?.dff, fortByLoc, appearing)}</h2>
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
            ) : decision?.kind === FORTIFY_DECISION && !fortOpen ? (
              <p className="hint">They choose their fortified {fortByLoc ? 'Locations' : 'buildings'} before setting up their units. The choice is secret: nothing they pick is shown here, and a fortification is revealed only when it matters.</p>
            ) : (
              <p className="hint">{session.mySide === null ? 'You are watching this match.' : 'The board updates as soon as they act.'}</p>
            )}
          </section>
        ) : (
          decision && (
            <section className={`panel decision side-${decision.owner}`}>
              <div className="who">{sideName(decision.owner)} — your orders</div>
              <h2>{decisionTitle(decision.kind, phase, fortOpen, decision.data?.['ending'] === true && !banzaiState(env)?.dff, fortByLoc, appearing)}</h2>
              {error && <div className="error">{error}</div>}

              {scatterUi.panel}
              {entryUi.panel}
              {turnsUi.panel}
              {lengthUi.panel}
              {stretchUi.panel}
              {banzaiDraft && decision.kind === 'phase' && phase === 'MPh' && (() => {
                // Checked as it is drawn up without the LOS to the target, which is checked when the charge is declared (A6.11).
                const err = banzaiDraft.target ? plain(banzaiIllegal(env, owner!, banzaiDraft.leader, banzaiDraft.target, banzaiDraft.units, undefined, { skipLos: true })) : 'Click the enemy hex the charge goes for';
                const candidates = banzaiCandidates(env, owner!);
                const toggle = (id: PieceId) => setBanzaiDraft({ ...banzaiDraft, units: banzaiDraft.units.includes(id) ? banzaiDraft.units.filter((u) => u !== id) : [...banzaiDraft.units, id] });
                return (
                  <div className="composer">
                    <h3>Banzai Charge</h3>
                    <p className="hint">
                      {pieceLabel(env, state.pieces[banzaiDraft.leader])} leads. Target: {banzaiDraft.target ? hexLabel(banzaiDraft.target) : 'click an enemy hex on the map'}. Tick the units that charge, or click their hexes on the map: a chain of adjacent, Good Order, unmoved Japanese Infantry. Only one of them needs to see the target within 8 hexes (SK4 8.1.8.6).
                    </p>
                    <ul className="pieces">
                      {candidates.map((c) => (
                        <li key={c.id} className="piece" title={c.why ?? undefined}>
                          <label>
                            <input type="checkbox" checked={banzaiDraft.units.includes(c.id)} disabled={c.id === banzaiDraft.leader || (c.why !== null && !banzaiDraft.units.includes(c.id))} onChange={() => toggle(c.id)} />
                            {c.label} <span className="muted small">{hexLabel(c.hex)}</span>
                            {c.why && <span className="muted small"> · {c.why}</span>}
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
                      Target {hexLabel(bz.target)}. Every unit moves one hex this Impulse (toward the target, into an enemy hex no farther from it, or next to it); a unit that has moved waits for the others, then the enemy may fire at each Banzai hex before the next Impulse. {bz.moved.length} of {bz.units.length} moved. Click a green hex to move {stepper ? pieceLabel(env, state.pieces[stepper]) : 'the next unit'}, or a Banzai hex to pick another unit.
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
              {decision.kind === ACQ_CHOICE_DECISION && (
                // The Gun's acquired stack scattered (SK4 6.10): its owner picks the one hex that keeps the counter.
                <div className="composer">
                  <p className="hint">
                    The units {pieceLabel(env, state.pieces[decision.data?.['gun'] as string])} had acquired have split up. Keep the Acquired Target counter on one of them (SK4 6.10): click an amber hex, or choose here. The others are no longer acquired.
                  </p>
                  <div className="buttons">
                    {legal
                      .filter((a) => a.type === 'acq.choose')
                      .map((a) => (
                        <button key={a['hex'] as string} className="primary" onClick={() => run(a)}>
                          Keep it in {hexLabel(a['hex'] as string)}: {enemyNames(a['hex'] as string)}
                        </button>
                      ))}
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
                    <b>Step 1 of setup: choose the fortified {fortByLoc ? 'Locations' : 'buildings'} first.</b> Your units are placed in the next step, once this choice is confirmed; it cannot be changed afterwards.
                  </p>
                  <p className="hint">
                    {scenario.ssr.find((r) => r.module === 'fortified-buildings')?.text}
                  </p>
                  {fortByLoc ? (
                    <p className="hint">
                      Click a green building hex to fortify its ground (amber), again to add level 1 (violet, where the house has one: the ground first, ASLRB B23.912), again to clear it. {fortExact ? `Exactly ${fortMax}` : `Up to ${fortMax}`} Location{fortMax === 1 ? '' : 's'}: <b>{fortPicks.length} of {fortMax}</b> chosen. Then <b>{confirmFortify?.label}</b> in the top bar.{fortOpen ? ' The card names the choice: the other side sees it.' : ' The choice stays secret until it matters.'}
                    </p>
                  ) : (
                    <p className="hint">
                      Click up to <b>{fortMax}</b> green building{fortMax === 1 ? '' : 's'} to fortify {fortMax === 1 ? 'it' : 'them'} (click again to undo), then <b>{confirmFortify?.label}</b> in the top bar.{fortOpen ? ' The card names the choice: the other side sees it.' : ' The choice stays secret until it matters.'}
                    </p>
                  )}
                  <ul className="setup-rules small">
                    {fortPicks.map((b) => (
                      <li key={b}>
                        Fortified: {fortByLoc ? fortLocLabel(b) : `building ${buildingLabel(b)}`}{' '}
                        <button className="ghost small" title="Undo" onClick={() => setFortPicks(fortPicks.filter((x) => x !== b && !(fortByLoc && hexOfLoc(x) === hexOfLoc(b) && levelOfLoc(x) > levelOfLoc(b))))}>
                          ×
                        </button>
                      </li>
                    ))}
                    {fortPicks.length === 0 && <li className="muted">{fortByLoc ? 'No Location chosen yet' : 'No building chosen yet'}</li>}
                  </ul>
                </div>
              )}
              {kindle && decision.kind === 'phase' && phase === 'PFPh' && decision.owner === owner && (() => {
                // A Kindling attempt (ASLRB B25.11): the MMC attempting (each its own DR, the leader directing), or a SMC alone.
                const loc = kindle.loc;
                const n = fireNumbers(env, loc);
                const { leaders, smcs, mmcs } = kindlers(env, loc, owner!);
                const director = leaders.find((l) => l.id !== kindle.self) ?? null;
                const attempts = [...kindle.picks.filter((u) => director).map((u) => ({ unit: u, director: director!.id })), ...(kindle.self ? [{ unit: kindle.self }] : [])];
                const err = attempts.length ? plain(session.check({ type: 'fire.kindle', loc, attempts })) : 'Tick at least one unit';
                const chance = (need: number) => `${Math.round((need <= 2 ? 36 : need > 12 ? 0 : [36, 36, 35, 33, 30, 26, 21, 15, 10, 6, 3, 1][need - 1]!) / 0.36)}%`;
                const row = (p: Piece, dir: Piece | null, on: boolean, toggle: () => void) => {
                  const { drm, explain } = kindlingDrm(env, loc, p.id, dir?.id);
                  const need = (n?.kindle ?? 0) - drm;
                  return (
                    <li key={p.id}>
                      <label>
                        <input type="checkbox" checked={on} onChange={toggle} /> {pieceLabel(env, p)} <span className="muted">DR ≥ {need}{explain.length ? ` (${explain.join(', ')})` : ''} · {chance(need)}</span>
                      </label>
                    </li>
                  );
                };
                return (
                  <div className="composer">
                    <p className="hint">
                      <b>Kindle {hexLabel(hexOfLoc(loc))}{levelOfLoc(loc) ? ` level ${levelOfLoc(loc)}` : ''}</b>: {terrainOf(env, loc).name}, Kindle # {n?.kindle}.
                      {director ? ` ${pieceLabel(env, director)} directs (NTC first; his modifier is reversed).` : ''} Every unit ticked is marked Prep Fire whatever the outcome; all attempts here are predesignated now (ASLRB B25.11).
                    </p>
                    <ul className="setup-rules small">
                      {director && mmcs.map((m) => row(m, director, kindle.picks.includes(m.id), () => setKindle({ ...kindle, picks: kindle.picks.includes(m.id) ? kindle.picks.filter((x) => x !== m.id) : [...kindle.picks, m.id] })))}
                      {smcs.map((sm) => row(sm, null, kindle.self === sm.id, () => setKindle({ ...kindle, self: kindle.self === sm.id ? null : sm.id, picks: sm.id === director?.id ? [] : kindle.picks })))}
                    </ul>
                    {err && <p className="hint warn">{err}</p>}
                    <div className="buttons">
                      <button className="ghost" onClick={() => setKindle(null)}>
                        Cancel
                      </button>
                      <button className="primary" disabled={!!err} onClick={() => { run({ type: 'fire.kindle', loc, attempts }); setKindle(null); }}>
                        Attempt
                      </button>
                    </div>
                  </div>
                );
              })()}
              {entrench && decision.kind === 'phase' && phase === 'PFPh' && decision.owner === owner && (() => {
                // An Entrenching Attempt (ASLRB B27.11): each MMC ticked rolls its own DR; a leader may direct every DR in the Location.
                const loc = entrench.loc;
                const hex = hexOfLoc(loc);
                const { mmcs, leaders } = entrenchers(env, loc, owner!);
                const director = entrench.director && leaders.some((l) => l.id === entrench.director) ? entrench.director : null;
                const attempts = entrench.picks.filter((u) => mmcs.some((m) => m.id === u)).map((unit) => ({ unit, ...(director ? { director } : {}) }));
                const err = attempts.length ? plain(session.check({ type: 'entrench.attempt', loc, attempts })) : 'Tick at least one unit';
                const ent = entrenchmentKnownTo(env, hex, owner!);
                const room = ent ? entrenchmentRoom(env, hex, owner!) : null;
                const chance = (need: number) => `${Math.round((need >= 12 ? 36 : need < 2 ? 0 : [1, 3, 6, 10, 15, 21, 26, 30, 33, 35, 36][need - 2]!) / 0.36)}%`;
                return (
                  <div className="composer">
                    <p className="hint">
                      <b>Entrench {hexLabel(hex)}</b>: {terrainOf(env, loc).name}{ent ? `, ${entrenchmentName(ent)} here${room && room.se > 0 ? ` (room for ${room.se} squad${room.se === 1 ? '' : 's'} more)` : ''}` : ''}. A Final DR ≤ 5 digs a foxhole 1S{ent ? ' (growing this one by a size)' : ''} and puts the digger beneath it.
                      {director ? ` ${pieceLabel(env, state.pieces[director]!)} directs every DR here, is TI and goes beneath with them.` : ''} Every unit ticked is TI for the Player Turn whatever the outcome (ASLRB B27.11, A4.8).
                    </p>
                    <ul className="setup-rules small">
                      {mmcs.map((m) => {
                        // A Labor counter applies to every unit ticked with its holder (ASLRB B24.8 "even if joined by new units").
                        const { drm, explain } = entrenchDrm(env, loc, m.id, director ?? undefined, attempts.map((x) => x.unit));
                        const need = 5 - drm;
                        const on = entrench.picks.includes(m.id);
                        return (
                          <li key={m.id}>
                            <label>
                              <input type="checkbox" checked={on} onChange={() => setEntrench({ ...entrench, picks: on ? entrench.picks.filter((x) => x !== m.id) : [...entrench.picks, m.id] })} /> {pieceLabel(env, m)}{' '}
                              <span className="muted">DR ≤ {need}{explain.length ? ` (${explain.join(', ')})` : ''} · {chance(need)}</span>
                            </label>
                          </li>
                        );
                      })}
                      {leaders.map((l) => (
                        <li key={l.id}>
                          <label>
                            <input type="checkbox" checked={director === l.id} onChange={() => setEntrench({ ...entrench, director: director === l.id ? null : l.id })} /> {pieceLabel(env, l)}{' '}
                            <span className="muted">directs: {smc(env, l)?.leadership ?? 0} to every DR here; TI, beneath the foxhole with them (ASLRB B27.11)</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    {err && <p className="hint warn">{err}</p>}
                    <div className="buttons">
                      <button className="ghost" onClick={() => setEntrench(null)}>
                        Cancel
                      </button>
                      <button className="primary" disabled={!!err} onClick={() => { run({ type: 'entrench.attempt', loc, attempts }); setEntrench(null); }}>
                        Attempt
                      </button>
                    </div>
                  </div>
                );
              })()}
              {douse && decision.kind === 'phase' && (phase === 'MPh' || phase === 'DFPh') && decision.owner === owner && (() => {
                // Fighting a Flame (ASLRB B24.72, B24.7): one DR for every unit joining; a leader among them directs.
                const loc = douse.loc;
                // Each Flame of the Location is fought with its own DR, and the same units may try each once (ASLRB B24.72).
                const flames = flamesAt(env, loc);
                const flame = flames.find((f) => f.id === douse.flame) ?? flames.find((f) => clearers(env, loc, owner!, f.id).length > 0) ?? flames[0];
                const candidates = flame ? clearers(env, loc, owner!, flame.id) : [];
                const picked = candidates.filter((p) => douse.picks.includes(p.id));
                const director = picked.find((p) => defOf(env, p).kind === 'leader');
                const units = picked.filter((p) => p.id !== director?.id).map((p) => p.id);
                const { drm, explain } = clearanceDrm(env, loc, units, director?.id);
                const a = flame ? { type: 'fire.extinguish', loc, flame: flame.id, units, ...(director ? { director: director.id } : {}) } : null;
                const err = !a ? 'No Flame here any more' : plain(session.check(a));
                return (
                  <div className="composer">
                    <p className="hint">
                      <b>Fight the fire in {hexLabel(hexOfLoc(loc))}{levelOfLoc(loc) ? ` level ${levelOfLoc(loc)}` : ''}</b>: Clearance DR {drm ? `${drm > 0 ? '+' : ''}${drm}` : '±0'}{explain.length ? ` (${explain.join(', ')})` : ''} · ≤ 2 extinguishes · 3–6 Hampers this Player Turn. The units are TI for the Player Turn; the DR is made at once, spending no MF, so no fire meets it; a failure earns a Labor counter (ASLRB B24.72, B24.8).
                    </p>
                    {flames.length > 1 && (
                      <ul className="setup-rules small">
                        {flames.map((f, i) => {
                          const able = clearers(env, loc, owner!, f.id).length > 0;
                          return (
                            <li key={f.id}>
                              <label title={able ? undefined : 'Every unit here has fought this Flame already, or none may fight it (ASLRB B24.72)'}>
                                <input type="radio" name="douse-flame" disabled={!able} checked={flame?.id === f.id} onChange={() => setDouse({ ...douse, flame: f.id, picks: clearers(env, loc, owner!, f.id).map((p) => p.id) })} /> Flame {i + 1}
                                {f.hampered ? <span className="muted"> (Hampered)</span> : null}
                                {!able && <span className="muted"> — already fought by these units</span>}
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    <ul className="setup-rules small">
                      {candidates.map((p) => (
                        <li key={p.id}>
                          <label>
                            <input type="checkbox" checked={douse.picks.includes(p.id)} onChange={() => setDouse({ ...douse, picks: douse.picks.includes(p.id) ? douse.picks.filter((x) => x !== p.id) : [...douse.picks, p.id] })} /> {pieceLabel(env, p)}
                            {defOf(env, p).kind === 'leader' && <span className="muted"> directs</span>}
                          </label>
                        </li>
                      ))}
                    </ul>
                    {err && <p className="hint warn">{err}</p>}
                    <div className="buttons">
                      <button className="ghost" onClick={() => setDouse(null)}>
                        Cancel
                      </button>
                      <button className="primary" disabled={!!err || !a} onClick={() => { if (a) run(a); setDouse(null); }} title={err ?? undefined}>
                        Declare (TI)
                      </button>
                    </div>
                  </div>
                );
              })()}
              {clearing && decision.kind === 'phase' && (phase === 'MPh' || phase === 'DFPh') && decision.owner === owner && (() => {
                // A Clearance Task (ASLRB B24.7, B24.73, B24.76): the MMC ticked, a leader among them directs; the DR comes at the end of the CCPh.
                const { kind, counter, loc } = clearing;
                const { mmcs, leaders } = clearanceCandidates(env, kind, loc, owner!);
                const units = mmcs.filter((p) => clearing.picks.includes(p.id)).map((p) => p.id);
                const director = leaders.find((p) => clearing.picks.includes(p.id))?.id;
                const { drm, explain } = taskDrm(env, { kind, loc, units, ...(director ? { director } : {}) });
                const a = { type: 'clearance.declare', kind, counter, loc, units, ...(director ? { director } : {}), ...(clearing.hexsides ? { hexsides: clearing.hexsides } : {}) };
                const sideName = (k: number) => {
                  const nb = acrossSide(statics.map, hexOfLoc(loc), k);
                  return nb ? `toward ${hexLabel(nb)}` : `hexside ${k}`;
                };
                const err = plain(session.check(a));
                const pick = (id: string) => setClearing({ ...clearing, picks: clearing.picks.includes(id) ? clearing.picks.filter((x) => x !== id) : [...clearing.picks, id] });
                return (
                  <div className="composer">
                    <p className="hint">
                      <b>{kind === 'wire' ? `Clear the Wire in ${hexLabel(hexOfLoc(loc))}` : kind === 'rubble' ? `Clear the rubble in ${hexLabel(hexOfLoc(loc))}` : kind === 'mines' ? `Clear the minefield in ${hexLabel(hexOfLoc(loc))}` : `Remove the roadblock from ${hexLabel(hexOfLoc(loc))}`}</b>: Final DR ≤ 2 at the end of the CCPh · DRM {drm ? `${drm > 0 ? '+' : ''}${drm}` : '±0'}{explain.length ? ` (${explain.join(', ')})` : ''}, so a DR of {2 - drm} or less. Every unit ticked is TI for the Player Turn (ASLRB A4.8){kind === 'mines' ? '; an Original 12 (11 or 12 if Inexperienced) Casualty Reduces every clearer; success places a Trail Break: entry across its hexsides at twice the MF free of attack, and once every hexside is crossed the mines are gone' : ''}{kind !== 'wire' && kind !== 'mines' ? '; it is Hazardous Movement until the DR: -2 to attacks on them, no FFMO/FFNAM (ASLRB A4.62)' : ''}{kind === 'rubble' ? '; they spend all their MF in the hex, and success places a Trail Break: entry across its two hexsides at the pre-rubble cost' : ''}; a failure earns a Labor counter (ASLRB {CLEARANCE_RULE[kind]}, B24.8).
                    </p>
                    {clearing.hexsides && (
                      <p className="hint">
                        Trail Break across{' '}
                        {[0, 1].map((i) => (
                          <select
                            key={i}
                            value={clearing.hexsides![i]}
                            onChange={(e) => {
                              const hs: [number, number] = [...clearing.hexsides!] as [number, number];
                              hs[i] = Number(e.target.value);
                              setClearing({ ...clearing, hexsides: hs });
                            }}
                          >
                            {[0, 1, 2, 3, 4, 5].map((k) => (
                              <option key={k} value={k}>
                                {sideName(k)}
                              </option>
                            ))}
                          </select>
                        ))}
                      </p>
                    )}
                    <ul className="setup-rules small">
                      {[...mmcs, ...leaders].map((p) => (
                        <li key={p.id}>
                          <label>
                            <input type="checkbox" checked={clearing.picks.includes(p.id)} onChange={() => pick(p.id)} /> {pieceLabel(env, p)}
                            {defOf(env, p).kind === 'leader' && <span className="muted"> directs</span>}
                          </label>
                        </li>
                      ))}
                    </ul>
                    {err && <p className="hint warn">{err}</p>}
                    <div className="buttons">
                      <button className="ghost" onClick={() => setClearing(null)}>
                        Cancel
                      </button>
                      <button className="primary" disabled={!!err} onClick={() => { run(a); setClearing(null); }} title={err ?? undefined}>
                        Declare (TI)
                      </button>
                    </div>
                  </div>
                );
              })()}
              {decision.kind === HD_CHOICE_DECISION && decision.owner === owner && (
                // Full ASL: a Direct Fire ordnance shot declared at a vehicle Hull Down to it in a hex with TEM: its owner
                // takes HD or the in-hex TEM before the To Hit DR (ASLRB B9.36, D4.2).
                <div className="composer">
                  <p className="hint">
                    {`${pieceLabel(env, state.pieces[decision.data?.['firer'] as string])} fires at ${pieceLabel(env, state.pieces[decision.data?.['vehicle'] as string])}. ${String(decision.data?.['label'] ?? 'Hull Down')}. Take Hull Down, or the ${String(decision.data?.['terrain'] ?? 'in-hex')} TEM (+${decision.data?.['tem']} To Hit, every hit counts) instead? (ASLRB B9.36, D4.2)`}
                  </p>
                  <div className="buttons">
                    <button className="primary" onClick={() => run({ type: 'hd.choose', choice: 'hd' })} title="Only a turret hit counts; no Case Q TEM, no Height Advantage (ASLRB D4.2, D4.22)">
                      Hull Down{typeof decision.data?.['needHd'] === 'number' ? ` (hit on ${decision.data['needHd']} or less)` : ''}
                    </button>
                    <button onClick={() => run({ type: 'hd.choose', choice: 'tem' })} title="The in-hex TEM as a To Hit DRM (Case Q); a hull hit counts too (ASLRB B9.36, D4.2)">
                      {`${String(decision.data?.['terrain'] ?? 'In-hex')} TEM +${decision.data?.['tem']}`}{typeof decision.data?.['needTem'] === 'number' ? ` (hit on ${decision.data['needTem']} or less)` : ''}
                    </button>
                  </div>
                </div>
              )}
              {decision.kind === WA_RPH_DECISION && decision.owner === owner && (
                // The end of the RPh (ASLRB B9.322, ASOP 1.32B): Wall Advantage may be claimed or forfeited now, the ATTACKER first.
                <div className="composer">
                  <p className="hint">End of the Rally Phase: claim or forfeit Wall Advantage from the hex menus of your units beside a roadblock, then go on ({decision.owner === state.attacker ? 'the ATTACKER first, then the DEFENDER' : 'the DEFENDER, after the ATTACKER'}; ASLRB B9.322).</p>
                  <div className="buttons">
                    <button className="primary" onClick={() => run({ type: 'wa.done' })}>
                      Done with Wall Advantage
                    </button>
                  </div>
                </div>
              )}
              {decision.kind === OVR_EVADE && decision.owner === owner && (() => {
                // Full ASL Infantry OVR (ASLRB A4.151): the SMC stays (mandatory TPBF if armed, then CC) or slips away.
                const smcId = decision.data?.['smc'] as string;
                const ev = evadeEntries(env, smcId);
                return (
                  <div className="composer">
                    <p className="hint">{`The ${moveShortName(env, smcId)} in ${hexLabel(String(decision.data?.['hex'] ?? ''))} is being overrun by ${((decision.data?.['units'] as string[] | undefined) ?? []).map((u) => moveShortName(env, u)).join(', ')}: stay and fight (CC at once after the First Fire), or slip away, free of fire, to a hex the ATTACKER picks (ASLRB A4.151).`}</p>
                    <div className="buttons">
                      <button className="primary" onClick={() => run({ type: 'ovr.stay' })}>{ev.stay}</button>
                      <button disabled={!!ev.slipDisabled} title={ev.slipDisabled ?? undefined} onClick={() => run({ type: 'ovr.slip' })}>{ev.slip}</button>
                    </div>
                  </div>
                );
              })()}
              {decision.kind === OVR_PLACE && decision.owner === owner && (
                <p className="hint wheel-hint">{`Put the ${moveShortName(env, decision.data?.['smc'] as string)} in one of the amber hexes (ASLRB A4.151).`}</p>
              )}
              {decision.kind === MANDATORY_TPBF && decision.owner === owner && (() => {
                const panel = tpbfPanel(env, String(decision.data?.['hex'] ?? ''));
                const shots = legal.filter((a) => a.type === 'tpbf.fire');
                return (
                  <div className="composer">
                    <p className="hint">{panel?.text ?? 'Mandatory TPBF (A8.312)'}</p>
                    <div className="buttons">
                      {shots.map((a, i) => (
                        <button key={i} className={i === 0 ? 'primary' : undefined} onClick={() => run({ type: 'tpbf.fire', decl: a['decl'] })}>
                          {i === 0 ? 'Fire (required, A8.312)' : `Fire with every SW (${((a['decl'] as { sw: string[] }).sw).map((w) => moveShortName(env, w)).join(', ')})`}
                        </button>
                      ))}
                    </div>
                    <p className="hint">The units in the entered Location must fire first (ASLRB A8.312): no other First Fire, and no Pass, until they have.</p>
                  </div>
                );
              })()}
              {decision.kind === WIRE_DROP_DECISION && (
                // A unit that started the turn on the Wire rolled more than its MF: it may leave excess PP on top (ASLRB B26.4).
                <div className="composer">
                  <p className="hint">
                    {`${pieceLabel(env, state.pieces[decision.data?.['unit'] as string])} rolled ${decision.data?.['dr']} on its Wire Exit dr with ${decision.data?.['mf']} MF left. Leave SW on top of the Wire to free MF, or keep them and stay hung up on top for this MPh (ASLRB B26.4).`}
                  </p>
                  <div className="buttons">
                    {legal
                      .filter((a) => a.type === 'wire.drop')
                      .map((a) => (
                        <button key={(a['sw'] as string[]).join()} className="primary" onClick={() => run({ type: 'wire.drop', unit: a['unit'], sw: a['sw'] })}>
                          Leave {(a['sw'] as string[]).map((id) => pieceLabel(env, state.pieces[id])).join(', ')} on the Wire
                        </button>
                      ))}
                    <button onClick={() => run({ type: 'wire.keep', unit: decision.data?.['unit'] })}>Keep them (hung up)</button>
                  </div>
                </div>
              )}
              {decision.kind === BREACH_SIDE_DECISION && (
                // A HE KIA along a hexspine: the firer picks which of the two hexsides at that corner is Breached (ASLRB B23.9221).
                <div className="composer">
                  <p className="hint">
                    {decision.data?.['known'] === false
                      ? `If ${hexLabel(hexOfLoc(decision.data?.['loc'] as string))} is a Fortified Building Location, the KIA Breaches it: the line of fire ran along a hexspine, so choose which of its two hexsides would be Breached (ASLRB B23.9221). Whether it is stays secret until it is revealed (ASLRB B23.911).`
                      : `The KIA in ${hexLabel(hexOfLoc(decision.data?.['loc'] as string))} Breaches the Fortified Building Location: the line of fire ran along a hexspine, so choose which of its two hexsides is Breached (ASLRB B23.9221).`}
                  </p>
                  <div className="buttons">
                    {((decision.data?.['options'] as string[] | undefined) ?? []).map((toward) => (
                      <button key={toward} className="primary" onClick={() => run({ type: 'breach.choose', toward })}>
                        The {hexLabel(toward)} side
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {placing && (
                <div className="composer">
                  <SetupTray
                    env={env}
                    title="Units to place"
                    hint={
                      placing.kind === 'setup'
                        ? `Drag each counter onto a green hex, or click it and then a hex. A weapon goes in a hex with a unit of its group, which then carries it (a leader alone will). Drag placed counters to move them, or back here to return them; a unit takes its weapons along. Click a stack again to pick its next counter, a weapon on its own.${gunTodo.length ? ' A Gun goes with a crew; once it is down, click a segment of the ring around its hex to set its Covered Arc (or right-click its hex).' : ''}`
                        : appearing === 'all'
                          ? 'Set up each unit that appears this turn in a green hex: the map hexes its card names (it appears there, with no edge to enter by). A weapon goes in a hex with a unit of its group, which then carries it.'
                          : `${appearing === 'some' ? 'Units that appear on the map go in the green map hexes their card names. ' : ''}Set up everything entering this turn in the offboard hexes along its entry edge (green). They enter from there in the Movement Phase, into the map hexes the card allows (blue where it names them). A weapon goes in a hex with a unit of its group, which then carries it.${
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
                  {fortRule && placing.kind === 'setup' && (
                    <FortTray
                      env={env}
                      side={placing.owner}
                      params={fortRule}
                      placed={fortLocked ? fortCounters(env).filter((c) => c.side === placing.owner) : pendingForts}
                      locked={fortLocked}
                      picked={pickedFort}
                      onPick={(spec) => { setPickedFort(spec); if (spec) { setPicked(null); setBeltTool(null); } }}
                      onUnplace={unplaceFort}
                      onChange={changeFort}
                      belt={beltTool}
                      onBelt={() => { setBeltTool(beltTool ? null : {}); setPickedFort(null); setPicked(null); }}
                      onGrain={(grain) => beltTool?.from && beltTool.to && layBelt(beltTool.from, beltTool.to, grain)}
                    />
                  )}
                  <SetupRules env={env} todo={todo} rulesShownInTray={!!trayGroups} anchors={anchors} />
                  {fullAslRules && aslSetupQuota && (placing.kind === 'setup' || placing.kind === 'offboardSetup') && (
                    <div className="setup-deploy">
                      {aslSetupQuota.quota.refused ? (
                        <p className="hint">Deploy squads: {aslSetupQuota.quota.refused}</p>
                      ) : (
                        <>
                          <p className="hint">
                            Deploy squads ({aslSetupQuota.quota.rule}: up to <b>{aslSetupQuota.quota.max}</b> of {aslSetupQuota.squads.length + aslSetupQuota.quota.used}, free, without leader or Task Check; {aslSetupQuota.quota.used} split). A squad keeps its hex and weapons in its first half; the second joins the tray; either may then be given the other's weapons. Undo takes a split back.
                          </p>
                          <ul className="setup-rules small">
                            {aslSetupQuota.squads.map((p) => {
                              const why = plain(session.check({ type: 'setup.deploy', unit: p.id }));
                              return (
                                <li key={p.id}>
                                  {pieceLabel(env, p)}
                                  {pending[p.id] ? ` in ${hexLabel(pending[p.id]!)}` : ''}{' '}
                                  <button className="ghost small" disabled={!!why} onClick={() => run({ type: 'setup.deploy', unit: p.id }, true)} title={why ?? 'Replace this squad with two half-squads (ASLRB A2.9)'}>
                                    Deploy into 2 HS
                                  </button>
                                  {why && <span className="muted"> {why}</span>}
                                </li>
                              );
                            })}
                          </ul>
                        </>
                      )}
                    </div>
                  )}
                  {!fullAslRules && (deployRule || deployableSquads(env, placing.owner).length > 0) && (placing.kind === 'setup' || placing.kind === 'offboardSetup') && (
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
                      Facing <b>{pieceLabel(env, state.pieces[caFor])}</b>{caTurret ? '\'s turret' : ''} in {hexLabel(facingHexOf(caFor)!)}: click a segment of the ring around its hex to point its {caTurret ? 'Turret ' : ''}Covered Arc along that hexspine (point at one to preview the arc). <a onClick={() => setCaFor(null)}>Later</a>
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
                      {hiddenRule.rule ?? 'SSR'}: {hiddenRule.quota !== undefined ? <>up to <b>{hiddenRule.quota} squad equivalent{hiddenRule.quota === 1 ? '' : 's'}</b> of MMC ({hiddenSe} used; leaders with them, Guns by HIP free) may set up hidden: </> : null}right-click a stack{hiddenRule.notOpenGround ? ' outside Open Ground' : ''} and choose <b>Set up hidden</b> to keep it and its weapons off the map until it fires or moves or an enemy unit finds it.
                      {hiddenField.length > 0 && (
                        <>
                          {' '}Hidden: <b>{hiddenField.map((id) => `${pieceLabel(env, state.pieces[id])} (${hexLabel(pending[id]!)})`).join(', ')}</b>.
                        </>
                      )}
                    </p>
                  )}
                  {concealmentOn && obConceal.total > 0 && (
                    <p className="hint">
                      Concealment (SK4 8.3): your OB has <b>{obConceal.total} “?” counter{obConceal.total === 1 ? '' : 's'}</b> ({obConceal.used + concealedStacks} used), one per stack set up in Concealment Terrain (jungle, palm trees, kunai, bamboo, huts, buildings): right-click a stack there and choose <b>Conceal</b>.
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
                      ? <>Enemy units have stopped in {hexLabel(String(decision.data?.['hex'] ?? ''))} with movement left: your last chance to fire at them there before another unit moves (SK1 3.3.1). Select your firers (shift-click hexes, tick units), then right-click the stack (or press and hold on it): <b>Fire!</b> Or pass.</>
                      : <>{firstFireMoveText(hexLabel(String(decision.data?.['hex'] ?? '')))} Select your firers (shift-click hexes, tick units), then right-click the moving stack (or press and hold on it): <b>Fire!</b> Or pass and let them move on.</>}
                  </p>
                  {ms?.dcPending && state.pieces[ms.dcPending.placer] && (
                    // The DC goes in only if its placer is still unbroken and unpinned once all Defensive First Fire is done (SK4 4.3).
                    <p className="hint">
                      <b>DC placement:</b> {pieceLabel(env, state.pieces[ms.dcPending.placer])} is placing a DC {ms.dcPending.breach ? `to Breach ${hexLabel(ms.dcPending.breach)} from ` : 'into '}{locName(ms.dcPending.target)}
                      {ms.dcPending.vehicle && state.pieces[ms.dcPending.vehicle] ? ` against ${pieceLabel(env, state.pieces[ms.dcPending.vehicle])}` : ''}. It is placed only if the placer is still unbroken and unpinned once your Defensive First Fire is done (SK4 4.3): fire at it now to stop it.
                    </p>
                  )}
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
                  light={!!(state.pieces[gunShot.gun] && shotWeaponOf(env, state.pieces[gunShot.gun]!)?.light)}
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
                      <b>needs {pfCheckNeedText(drm, [])}</b>
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
                      <>Right-click your stack (or press and hold on it) and choose <b>Fire</b> (directed by a leader if you like), or <b>Fire gun…</b> for a Gun. Untick units in the stack card first to fire with only some of them.{decision.kind === 'firstFire' ? ' Or Pass (top bar or P).' : ''}</>
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
                      {!ms.vehicle.stopped && owner && decision.owner === owner && mode === 'normal' && (() => {
                        const left = mfLeft(ms.units[0]!);
                        const destinations = new Map<HexId, number>();
                        for (const a of legal) {
                          const to = a['to'];
                          // Woods and buildings have their own entry costs (SK4 1.1.1; ASLRB B13.41, B23.41): the wheel offers them.
                          if (a.type !== 'move.step' || typeof to !== 'string' || a['bypass'] || a['beneath'] || a['noTb'] || vehicleEntryTerrain(env, ms, to)) continue;
                          const minimum = env.query('move.stepCost', { ms, to }, 0);
                          if (minimum + 0.5 <= left && session.check({ type: 'move.step', to, declared: minimum + 0.5 }) === null)
                            destinations.set(to, minimum);
                        }
                        return destinations.size > 0 && (
                          <VehicleEntryMp key={`${ms.units[0]}:${ms.hex ?? ms.off}:${left}`} hexLabel={hexLabel} destinations={destinations} left={left} check={session.check} enter={(step) => run(step, true)} />
                        );
                      })()}
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
                            <span className="mp-ctl" title="Spend MP standing still: one Defensive First Fire chance for the whole Delay; the MP count toward the Bounding First Fire DRM">
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
                          {ms?.vehicle?.stopped && !ms.vehicle.started && (
                            <>
                              <b>Stopped:</b> right-click the vehicle and <b>Start again (1 MP)</b> before turning the hull or driving on (ASLRB D2.12: a vehicle not in Motion pays a start MP to enter a hex or change its VCA).{' '}
                            </>
                          )}
                          Click a green hex ahead to drive on (within the Vehicle Covered Arc). When available, use <b>Enter hex</b> above to choose a destination and spend more than the minimum on entry (SK4 3.3.2). The <b>HULL</b> handles beside the vehicle turn the hull (1 MP per hexspine) and the <b>TURRET</b> ones the turret (free); or click a neighbouring hex outside the arc to turn the hull that way, or press <b>Q</b>/<b>E</b> and <b>A</b>/<b>D</b>. Right-click the vehicle to <b>stop</b>, go <b>CE/BU</b>, fire <b>Bounding First Fire</b> or <b>end the move</b>. Stopped, it may <b>Delay</b> any number of MP in one go (<b>S</b> for 1 MP, or the Delay row above); a vehicle that never stops ends in Motion (SK4 3.3.2).
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
                              <span className="mp-ctl">
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
                          {(() => {
                            // Full ASL: the DRM every push of this stack takes whatever the hex (Labor, B24.8; CX, A4.51), and the roadblock's.
                            if (!ms.hex) return null;
                            const standing = env
                              .explain('manhandle.drm', { gun: ms.manhandle!.gun, units: ms.units, from: ms.hex, to: ms.hex, cost: 0 }, 0)
                              .trace.filter((t) => !t.suppressedBy && t.label && /^asl\.manhandle\.(labor|cx)$/.test(t.id))
                              .map((t) => t.label!);
                            const roadblock = fullAslRules ? ' A known roadblock hexside crossed adds +2 (ASLRB C10.3).' : '';
                            return standing.length || roadblock ? <> Every push here: {standing.length ? standing.join(', ') : 'no Labor or CX'}.{roadblock}</> : null;
                          })()}
                        </p>
                      ) : mode === 'dash' ? (
                        <p className="hint wheel-hint">Dash (ASLRB A4.63): click an amber hex beyond the road to declare the Dash there; the stack steps into the road at once, and its next step can only be that hex. Esc to cancel.</p>
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
                          Click the DC target hex (amber; an enemy AFV there is the target). <a onClick={() => setMode('normal')}>Cancel</a>
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
                              : routStopWhy
                                ? `${routStopWhy}. Click an amber hex to rout on.`
                                : `It has not reached a building or woods hex it may end in (${routEndNames}marked ROUT END): click an amber hex to rout on. Open Ground in the view of an enemy able to fire means Interdiction.`}
                        </span>
                        {canStopRout && <button onClick={() => run({ type: 'rout.stop', unit: routing.unit })}>Stop here</button>}
                        {legal.some((x) => x.type === 'rout.endHere' && x['unit'] === routing.unit) && (
                          <button title="Reduced to a HS by the minefield: it may continue its rout, or end it here (ASLRB B28.413)" onClick={() => run({ type: 'rout.endHere', unit: routing.unit })}>
                            End rout here
                          </button>
                        )}
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
                      <li key={r.unit} className={`${r.done || r.cannot ? 'done' : r.must ? 'must' : ''} ${selected.has(r.unit) ? 'sel' : ''}`} title={r.cannot ? ROUT_BAR_TEXT[r.cannot] : (!r.done && routWaitHint(env, r.unit)) || undefined}>
                        <button className="link" onClick={() => { setSelected(new Set([r.unit])); setSelectedHex(hexOfId(state, r.unit) as HexId); }} disabled={r.done}>
                          {pieceLabel(env, state.pieces[r.unit])} <span className="muted">({hexLabel(hexOfId(state, r.unit) ?? '')})</span>
                        </button>
                        <span className="rout-status">
                          {r.done ? 'done' : routing?.unit === r.unit ? 'routing — not over yet' : r.must && r.reason ?`must rout — ${routReason(r.reason)}` : r.cannot ? `stays — ${r.cannot === 'noDm' ? 'no DM' : 'in Melee'}` : 'may rout'}
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
                  {ccStateOf(env)?.mph ? <><b>Infantry Overrun CC (A4.152)</b>, in the MPh: </> : null}
                  Drag your units and their targets into attack groups in the panel, then lock them in. Each unit attacks once and is attacked once (SK1 3.8).
                  {pillboxCcNote() && <> {pillboxCcNote()}</>}
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
              <b className={`nat nat-${secretFortList.side}`}>{sideName(secretFortList.side)}</b> fortified {secretFortList.locations ? `Location${secretFortList.locations.length === 1 ? '' : 's'}` : `building${secretFortList.buildings.length === 1 ? '' : 's'}`} <span className="muted">{fortOpen ? '(SSR)' : '(secret)'}</span>
            </summary>
            <ul>
              {secretFortList.locations
                ? secretFortList.locations.map((loc) => (
                    <li key={loc}>
                      {fortLocLabel(loc)}{!fortOpen && <span className="muted">{(secretFortList.revealedLocs ?? []).includes(loc) ? ' · revealed' : ' · hidden'}</span>}
                    </li>
                  ))
                : secretFortList.buildings.map((b) => (
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
          fortified={fortifiedLocs}
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
          <LogSections sections={sections} sideName={sideName} losReview={losReview} onLosReview={setLosReview} />
        </section>
      </aside>
    </div>
  );
}

function hexOfId(state: { pieces: Record<string, Piece> }, id: string) {
  const p = state.pieces[id];
  return p?.loc.kind === 'hex' ? p.loc.hex : '';
}

function decisionTitle(kind: string, phase: string, fortifyOpen = false, endingMove = false, fortifyByLoc = false, appear: 'all' | 'some' | 'none' = 'none') {
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
      // Units that appear on map hexes (ASLRB A2.51) are set up on the map, not offboard.
      return appear === 'all' ? 'Set up reinforcements on the map' : appear === 'some' ? 'Set up reinforcements' : 'Set up reinforcements offboard';
    case 'fortify':
      if (fortifyByLoc) return fortifyOpen ? 'Fortify Locations' : 'Fortify Locations (secret)';
      return fortifyOpen ? 'Fortify a building' : 'Fortify buildings (secret)';
    case BREACH_SIDE_DECISION:
      return 'Breach: which hexside?';
    case WIRE_DROP_DECISION:
      return 'Wire: leave PP on top?';
    case OVR_EVADE:
      return 'Overrun: stay or slip away?';
    case OVR_PLACE:
      return 'Overrun: where does the SMC go?';
    case MANDATORY_TPBF:
      return 'Mandatory TPBF (A8.312)';
    case BLAZE_ESCAPE_DECISION:
      return 'Blaze: leave or stay?';
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
    case 'acqChoice':
      return 'Acquired Target';
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
    // A unit that appears on map hexes (ASLRB A2.51) has no edge: its hexes stand in for one, marked '@'.
    const where = p.tags['appearHexes'] !== undefined ? `@${p.tags['appearHexes']}` : p.tags['entryEdge'];
    const k = `${pending ? 'dr' : p.tags['entryTurn']}|${p.side}|${where}${pending ? `|${p.tags['force']}` : ''}`;
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
              <b className={`nat nat-${side}`}>{sideName(side)}</b> · {edge!.startsWith('@') ? appearWords(edge!.slice(1)) : edgeWords(edge!) === 'any' ? 'any edge' : `${edgeWords(edge!)} edge`}:{' '}
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
  const hexLabel = hexNamer(env);
  const sc = (env.statics as Statics).scenario;
  const forces = [...new Set(todo.map((p) => p.tags['force'] as number))].map((i) => sc.forces[i]!);
  const lines = rulesShownInTray ? [] : forces.map((f) => setupRule(f, sc));
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
      <li className="muted">
        {sc.ruleset === 'full-asl'
          ? 'Stacking: 3 squad-equivalents (five SMC = a HS) and 4 SMC per Location; none may set up overstacked, in play more is allowed with penalties (ASLRB A2.9, A5)'
          : 'Stacking: 3 squad-equivalents and 4 leaders per hex'}
      </li>
    </ul>
  );
}
