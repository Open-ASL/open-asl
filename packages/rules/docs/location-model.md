# Location model (Full ASL)

This is the design for representing an ASL Location (A2.8) in Open ASL. SK and Full ASL share all code; SK always plays at ground level and must behave identically.

## Rules readings
- **A2.8:** only upper building levels, pillboxes, bridges, sewers, tunnels and caves create extra Locations in a hex. Each Location has its own stacking limits (A5.1, B23.42). A leader on one level cannot affect units on another.
- **B27.13:** foxholes and trenches are positions *within* a Location. They change TEM, Recovery and Recombine, but CC, LLMC, stacking and targeting are shared.
- **A4.3, A4.32, A4.33:** Bypass is a position of the moving stack, not a Location. Infantry may not voluntarily end its MPh in Bypass; a unit broken or pinned while bypassing counts as in the obstacle after its MPh. Vehicle Bypass (VBM) is Chapter D and deferred.
- **A26.11–26.14:** Control has three tiers:
  - Location Control.
  - Hex Control: gained only by an MMC at ground level.
  - Building Control: any non-rooftop level counts.
- **A7.212:** with a Known enemy in its own Location, a unit may fire only within that Location.
- **B23.21–23:** a building's levels depend on its hex count and printed stairwells.
  - Single-hex, no stairwell: ground level only, a 1-level obstacle.
  - Multi-hex, no stairwell: a Two Story House, with level 1 and an inherent stairwell in every hex; a 1½-level obstacle.
  - Any printed stairwell: a Multi-Story Building with levels 1 and 2 and stairs only in stairwell hexes; a 2½-level obstacle.

## Data model
```ts
// packages/rules/src/common/location.ts (new)
export type LocId = string; // 'uK4' | 'uK4:1' | 'uK4:2' | 'uK4:pb' | 'uK4:roof' (future ':-1', ':br')
export type SubLoc = 'pb' | 'roof' | 'bridge';
export const locId = (hex: HexId, level = 0, sub?: SubLoc): LocId => (sub ? `${hex}:${sub}` : level ? `${hex}:${level}` : hex);
export function parseLoc(id: LocId): { hex: HexId; level: number; sub?: SubLoc };
export const hexOfLoc = (id: LocId) => id.split(':')[0] as HexId; // ':' never occurs in HexIds
export const levelOfLoc = (id: LocId) => parseLoc(id).level;
export const isGroundLoc = (id: LocId) => !id.includes(':');
export const locOf = (state: GameState, p: Piece): LocId | null; // follows 'held' like hexOf; no allocation at ground level
```
The engine `Location` union (`packages/engine/src/core/types.ts`) gains optional fields. They are **never written as 0 or false**, so SK JSON and the `toEqual({kind:'hex',hex})` tests are unchanged.
```ts
| { kind: 'hex'; hex: HexId; level?: number; sub?: 'pb' | 'roof' | 'bridge'; pos?: { ent?: 'foxhole' | 'trench' | 'ditch' } }
```
- Bypass lives on `MoveState.bypass?`, never on the piece.
- `hexOf()` keeps returning the HexId; `locOf()` returns the Location.
- No new event types: a level change is a `piece.moved` with the same hex and `level: 1`. SK event counts, and so decision ids, cannot change.
- Absolute height for LOS is `heightOf(env, loc) = elevation(hex) + level` (+½ for rooftop later), in `sk2/elevation.ts`.

### Ruleset gate
Every "which Locations / adjacent Locations" question goes through two queries, so SK scenarios on board u stay one Location per hex even after the importer adds level data:
- `'hex.locations': { ctx: { hex }; value: LocId[] }`. The SK default is `[hex]`; `asl/locations.ts` adds upper levels from map data.
- `'loc.adjacent'` (A.8 / B23.25). The SK default is the neighbouring hexes.

### Map data
```ts
interface MapHex { …; building?: { upper: 0 | 1 | 2; stairwell?: 'printed' | 'inherent' }; obstacleHeight?: number }
interface TerrainDef { …; height?: number }
interface GameMap { …;
  hexside?(a: HexId, b: HexId): { kind: 'wall' | 'hedge' | 'rowhouse' | 'cliff' }[] | undefined; // placeholder
  losAt?(from: LosEnd, to: LosEnd): LosResult; // LosEnd = { hex; height; vertex?: number }
}
```
- `losAt` at ground height with no vertex delegates to `los()`: identical SK results, from the same cache.
- `HexGridMap.hex(id)` throws on an id containing ':'. A LocId passed where a HexId belongs would otherwise silently read the hex as 'open'.

### Importer (level data)
VASL codes from SharedBoardMetadata (vasl-6.7.3):

| Codes | Meaning | Obstacle height |
|---|---|---|
| 40 / 50 | Stone / wooden building | 1 |
| 41 / 51 | "1 Level" | 1½ |
| 42 / 52 | "2 Level" | 2½ |
| 203 / 206 | MultipleWooden / MultipleStone | 1, coded as 1-level by VASL |

- **Board u:** every multi-hex building is 41/51 (G2–H1, I3–I5, K4–K5, L3–M3, L5–M5, L8–M9, M7–N7, P2–P3), so all are Two Story Houses. It has no stairwell pixels, so no multi-story buildings.
- **Boards w–z:** two-hex buildings coded 203/206 are Two Story Houses per B23.22 in full ASL.
- **Stray override:** the `O4 Stone Building, 1 Level` entry in boards t, v, w, x, y and z's `buildingTypes` looks like a template artifact; verify it against the art.
- **Import rule:** derive `building.upper` and `stairwell` per buildingId from B23.21–23, using hex count and stairwell pixels. Cross-check against the VASL code and the overrides, sending mismatches to the review list. Terrain ids and buildingId numbering must not move.

## LOS with heights (this model fixes only the API)
- One tracer with optional heights. With no heights it takes today's code path exactly.
- With heights it applies A6.2 obstacle tops and the A6.4 blind-hex count.
- `'los.trace'` ctx `from`/`to` become LocIds; HexIds are valid LocIds.
- `asl/los.ts` suppresses `sk1.los.terrain` and contributes the heights version. Both call one shared helper for hindrance, Smoke and A6.7.

## Re-keying inventory (HexId → LocId)

| Area | Where | Change |
|---|---|---|
| Occupants | `common/pieces.ts`: personnelAt, vehiclesAt, unitsAt, unpossessedWeaponsAt | Take a LocId and compare with `locOf`. Add `…InHex` variants. Classify every call site as hex-scope or Location-scope. |
| SW drop on death | `pieces.ts` | The `lastHex` tag holds the LocId; level/sub are restored on drop. |
| Stacking | `movement.ts:stepIllegal`; `scenario.ts`: occupants, placementIllegal, constraintViolation, defaultPlacement | Per Location. Setup placements become `Record<PieceId, LocId>`. |
| Stack order | `status.ts`: stackedOn, stackOrder, restack, goodOrderLeadersAt | Per Location (a leader affects his own level only). |
| Melee / Good Order | `status.ts`: inMelee, isGoodOrder | `hexMarkers[loc].melee` |
| Targets | `fire.ts`: FireDeclaration.target, FireAttackCtx.target, buildAttack, simpleDeclarations; `firePhases.ts:fireTargets` | LocId; range via hexOfLoc. |
| A7.212 | `fire.ts:basicIllegal` (ownHexOk), around line 1304 | "own hex" becomes "own Location"; another Location in the same hex goes through `'loc.adjacent'`. |
| Fire log | `fire.ts:pairKey` | LocId pairs |
| Residual FP | `fire.ts` ~956; `sk2/ordnance.ts` ~463; `movement.ts` residualAttack and related | LocId |
| ROF / Residual choice | `movement.ts`: RofChoice.hex, recordRofChoice, rofDeclineResidual | LocId |
| First Fire bookkeeping | MoveState (hex, from, trail, mfHere, firedHere, residualDrmHere); `moveState.ts:expenditureKey`; DFF validate; movingInfo | Add `level?` and a `loc()` accessor. A level change resets mfHere/firedHere (A8.12). |
| Entering | MOVE_ENTER / enterHex(to: LocId); `sk2/hip.ts` wrapper; SK3 vehicle wrappers | Vehicles stay ground-only. |
| Smoke | `move.smoke`, `terrain.ts` smokeIn/smokeDrm | Stays hex-keyed. |
| DC | `move.placeDc.target`; `firePhases.ts:resolveDcBase` | LocId |
| CC | `closeCombat.ts`: ccHexes, ccUnits, beginHex, CC_HEX state, cc.* queries, cc.chooseHex.hex, cc/hipAmbush markers | LocId (field names keep `hex`). |
| Rout | `rout.ts`: RoutView, stepIllegal, enterHex, ROUT_ENTER, interdicted, routRequirement, inStartBuilding | LocId; SK offers ground Locations only. |
| Advance | `advance.ts`: AdvanceAction.to, advanceIllegal, advanceEnter | LocId |
| Control | `scenario.ts`: updateControl, controlState, controlledHexes | Hex Control from ground-level MMC only (identical in SK). A new `locations?: Record<LocId, SideId>` is written only when non-empty. Building Control counts any non-rooftop level. The UI shows hex and building Control only for now. |
| Known / LOS | `known.ts`: hasLos, knownEnemiesFrom, adjacentToKnownEnemy, visibleEnemyAt | LocId plus `'loc.adjacent'` |
| TEM | `'hex.tem'`, `'hex.openGround'` ctx | Accept a LocId; contributions read hexOfLoc. |
| Height Advantage | `sk2/elevation.ts:heightAdvantageHex` | `heightOf(loc)` |

- **Computer opponent:** no change. `loc.hex` stays a HexId and SK never produces a level.
- **Web:** group by `locOf` instead of `loc.hex` in BoardView, StackPeek, StackInspector and GameScreen. The full level UI comes with multi-level buildings.

## Replay compatibility
Recordings hold only actions, and decision ids equal the event count. Four invariants:
1. SK flows emit exactly the same events.
2. HexId action fields become LocId, a string superset, so every recorded action stays valid.
3. Optional fields are omitted, never set to 0.
4. SK rulesets gain no new module ids or versions.

Full ASL recordings may break between versions while the ruleset is dev-gated.

## Migration sequence (every commit keeps all SK tests green)
1. **Types and helpers:** `location.ts`, the optional `Location` fields, `locOf`, the ':' guard, and the `'hex.locations'` / `'loc.adjacent'` queries with SK defaults. Unit tests.
2. **Occupant helpers:** move to Location semantics, plus the audited `…InHex` callers.
3. **Stacking and stack order:** movement, setup, status, rally/transfer.
4. **Fire:** declarations, targets, A7.212, fire log, Residual FP, ROF choice, DC target, the `'los.trace'` LocId ctx.
5. **MoveState and First Fire bookkeeping:** MOVE_ENTER, the HIP and vehicle wrappers.
6. **Melee and CC:** markers and state.
7. **Rout and advance.**
8. **Control:** Location, hex and building tiers.
9. **Known/LOS helpers and the TEM ctx.**
10. **Map schema:** building, obstacleHeight, TerrainDef.height, the hexside() stub, losAt with a ground-level delegate. No data yet.

## Tests
- **Unchanged on every commit:** the whole SK suite, selfplay and replay.
- **New SK invariant:** after selfplay of every SK scenario, no piece loc has level, sub or pos, and no hexMarkers key contains ':'.
- **Production dumps:** before commit 1, record each match's event count, decision count and final state hash (outside the repo); replays must match after each commit.
- **Computer opponent:** identical results on fixed seeds.
- **SK LOS golden table:** sample (from, to) pairs on boards t–z, pixel and grid, captured once and held identical once LOS with heights is built.
- **New `test/asl/location.test.ts`:** a synthetic two-hex Two Story House with pieces at level 1, in an ASL ruleset. It checks:
  - stacking per level;
  - separate targets and Residual FP;
  - A7.212;
  - Melee per Location;
  - Building but not Hex Control from level 1;
  - a SW dropped at level 1 staying there.

## Risks
- **Hex/Location confusion at about 124 `hexOf` sites:** the ':' guard, level-1 tests, and a per-site classification in each commit.
- **Board level data leaking into SK:** everything is gated through `'hex.locations'`, and the SK LOS path stays unchanged.
- **`toEqual` brittleness:** never write `level: 0`.
- **`locOf` cost in AI loops:** no allocation at ground level.

## As built
- `MapHex.building` and its `HexTerrainSpec` pass-through came in commit 1, not 10, so `asl/locations.ts` could add levels from the start and every later commit's tests could use them. Commit 10 adds the rest of the schema.
- `locations` in the Control state holds only Locations above ground: the ground Location is Controlled with its hex, so the field never appears in a Starter Kit game.
- Rout paths still walk ground hexes, ordnance has no level rules, and fire between two Locations of one hex has no PBF yet. These come with multi-level buildings (levels and stairs) or the chapter that owns them.
- The web keeps grouping stacks by hex: the stack inspector and the clicked-hex checks are hex-scope until the level UI.
