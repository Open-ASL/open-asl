# Full ASL Chapter A: coverage ledger

Every numbered Chapter A rule of the eASLRB v3.14, its status in the engine, and the test that proves the status.
Every ✅ row cites a test.

**Legend:**
- ✅ done: implemented in shared code (the SK rulesets count) and covered by the cited test.
- ◐ SK-simplified or partial: the Evidence column says what is missing.
- ✗ missing.
- ⏸ deferred (outside Chapter A's scope for now: no counters, Chapter B–D, overlays, optional rules).
- — not applicable in a computer game.

**Columns:** Rule is the eASLRB number; Name is the rule's header as printed ("(untitled)" for numbered
paragraphs without one; no rule text is reproduced here). Evidence is `file › test title` (paths under `packages/`;
the title is the exact `it(...)` text) plus short notes. "Starter Kit scenario tests" are the tests of the Starter Kit
module scenarios, which are not part of this repository.

**Updating:**
1. When a rule lands, set the row to ✅ (or ◐ with what remains) and cite the test in
   `packages/rules/test/asl/<topic>.test.ts` that proves it.
2. A behaviour change to a ✅ row must keep its cited test passing or update the citation.
3. Add a short reading here when the row needed one.

**Totals (552 rows):** ✅ 223 · ◐ 72 · ✗ 160 · ⏸ 94 · — 3.

**Bypass:** full ASL Bypass movement in `asl/bypass.ts` (A4.3–A4.34): `move.step` with `bypass` hexsides into Bypass, further round (one MF for one or two hexsides, doubled once from the third), out at the corner or into the obstacle; a full look-ahead refuses a Bypass that could not end outside it (A4.32); no End move, Recovery (A4.44) or Control (A26.11) in Bypass; stacking ignored there; Assault Movement one Location; hidden Guns stay hidden (A12.151 by analogy); no Gun pushed in Bypass. Fire: each firing hex picks the centre or a corner of a bypassed hexside after declaring (`FireDeclaration.at`, A4.34, A6.11), no obstacle TEM but against Residual FP (A8.2), FFMO in the open; units broken/pinned there stay in Bypass for the rest of the MPh. LOS to a corner or a hexside road point (A6.12) in both tracers; A4.132's second target point. Hexsides open to Bypass measured on the board art (`bypassMask`). Fixture: `bypass`.

**Board-u Chapter B pass** (the Chapter B rows are the section at the end): every rule of B1, B3, B10, B12, B13, B14 and B23 checked against the engine for the terrain on board u (open ground, woods, brush, orchards, stone and wooden buildings, paved and dirt roads, twelve Orchard-Road and three Woods-Road hexes, a level 1 hill). One gap was found and fixed in shared code, because SK4 1.1.1 has the same rule: **Orchard-Road** (B14.6) LOS along the road is clear of the orchard at any height, a unit entering at the road rate is subject to FFMO from a firer whose LOS stays on the road, and Infantry may claim the orchard instead, forfeiting the road bonus (B3.43). Full ASL only: SMOKE is part of the COT doubled uphill (B.2, `asl/terrain.ts`). A4.132's second target point (the road/hexside intersection) came with Bypass, which brings LOS to a point other than a centre dot. Fixture: `orchard-road`.

**LOS with heights:** in full ASL `'los.trace'` is the map's `losAt` between the two Locations' heights (`asl/los.ts`; pixel tracer in `content/src/los.ts`, hex-level one in `HexGridMap.gridLosAt`, the rules in `common/losHeights.ts`): obstacle heights (woods, buildings 1, Two Story House 1½, orchard 1 in season, rubble ½), seeing over obstacles, Blind Hexes (A6.4–A6.43, B10.23), Hindrances only between same-level ends, hills as obstacles of their level (B10.2, B10.21). Every LOS a unit traces now starts from its Location (fire, DFF, Interdiction, VC, SW ordnance; this also fixes fire between ADJACENT level 1 Locations of one building), and Height Advantage compares Location heights (shared, SK identical). Not done: A6.21 hexside obstacles and B10.5 cliffs (none on t–z), B10.211 Alpine Hills (optional). Fixture: `los-heights`.

**Multi-level buildings:** every building of boards t–z is classified from the board art in `content/src/buildingLevels.ts` (B23.21–23; VASL codes kept as hints, all agreeing), so board u's eight multi-hex buildings are Two Story Houses with level 1 in full ASL. Changing level (B23.4: 1 MF, A8.12: a new Location for Defensive First Fire), upper-floor movement (B23.25, B23.421, B23.422), A4.14 per Location, stair advances, PBF between levels (A7.21), FG contiguity by Location (A7.5, shared fix), no LOS between non-ADJACENT Locations of one building (B23.25) and Indirect Fire on every level (B23.32) are in. UI: Level counters on the board, Location sections in the peek and stack card, stairs and per-Location targets on the wheel. Fixture: `two-story-house`.
**Interim rules:** a routing unit may take the stairs for 1 MF, its destination still per SK1 3.6 by hex (`sk1/rout.ts` `stairStepCheck`, TODO: A10.51 by Location); a fortified building is fortified on every level (`sk1/fortified.ts`, TODO: B23.911 fortified Locations).

**Location model** (`packages/rules/docs/location-model.md`): a Location is a string id, the ground Location being the hex id, so SK state and recordings are unchanged. A2.8 is ✅ at model level: occupants, stacking, targets, Residual FP, Melee/CC, advance, Control and Known enemies are per Location, gated by `'hex.locations'` / `'loc.adjacent'` (`asl/locations.ts` adds upper building levels from `MapHex.building`). Without board level data A5.1, A7.212 and A8.12 stay ◐ (proven only on a synthetic Two Story House in `rules/test/asl/location.test.ts`). Rout paths, ordnance at upper levels, LOS with heights and the level UI are not part of it.

**Test bed:** T1 (`content/src/scenarios/aslTest.ts`) has both sides' leaders, MG, FT, DC, ELR and a SAN
(data only for now), and the Russian fortified building. BPV of every Starter Kit MMC from the eASLRB National
Capabilities Chart (`content/src/counters.ts`; gaps from asl-players.net's chart; leaders and SW have none, H1.2), for A16 and A18.2 (now the
highest BPV in full ASL). Dev fixtures for play tests: `content/src/fixtures.ts`.

**Shared fixes:** A.9, A.11, A.18, A4.12, A7.301, A7.302, A9.72, A10.31, A18.11 and A19.34 are now ✅;
A17.2 lacks only carrying a wounded man; A18.2's BPV base MMC came with the test bed. Shared fixes cite both rulebooks
in the SK modules; the Random Selection ties of A.9 (A7.301, A7.302, A9.71, A11.11) are the full ASL module
`asl/randomSelection.ts`, because the SK text picks exactly one unit (or the KIA number); A18.11's ATTACKER-only
first MMC Rally attempt is `asl/fieldPromotion.ts`, SK 5.3 being read literally. Also fixed: an ATR's IFT
breakdown malfunctions it (SK4 4.4.4), and the FPF NMC's original 12 is a Casualty MC (A10.31). Tests:
`packages/rules/test/asl/shared-fixes.test.ts` and the flipped `verify-a-defs.test.ts` rows.

The eASLRB v3.14 has no A15.22 header, so the A15 rows skip it.

## A.x Definitions

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A.1 | DICE | ✅ | `rules/test/rof.test.ts` › a MG fired with its squad keeps ROF on a low colored dr, stays unmarked and fires again; the squad is marked; `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other. Colored/white dr (ROF) and Original vs Final DR. |
| A.2 | ERRORS | — | Not applicable: the engine enforces each decision when it is made (no take-backs). |
| A.3 | MOVE/ADVANCE | ✅ | `rules/test/asl/verify-a-defs.test.ts` › a unit that Prep Fired may not move in the MPh but may still advance in the APh |
| A.4 | OPTIONAL RULES | — | Optional rules (*) are not offered: *7.37 IIFT, *8.10 First Fire counters. |
| A.5 | ATTACK DRM | ✅ | `rules/test/fire.test.ts` › a target possessing a FT deducts one from the attack DR against it, and the result says so (SK1 4.2). One DR, a Final DR per defender. |
| A.6 | IN/INTO | ⏸ | Depressions (Chapter B); none on board u. |
| A.7 | GOOD ORDER | ✅ | `rules/test/control.test.ts` › advancing into an enemy hex does not take it; a Melee that goes on leaves control where it was; `rules/test/asl/verify-a1-a6.test.ts` › passes a SW between Good Order unpinned units of one Location in the RPh, not in the MPh. Melee units are not Good Order; pinned units are. |
| A.8 | ADJACENT | ✅ | `rules/test/movement.test.ts` › a broken unit not under DM is placed under DM when an enemy moves adjacent to it (SK1 3.2.1). Plain adjacency. The ADJACENT (LOS + hypothetical APh move) test only differs once levels and obstacle hexsides exist: re-check with multi-level buildings. |
| A.9 | RANDOM SELECTION | ✅ | `rules/test/asl/verify-a-defs.test.ts` › SK: a tie for the highest dr is re-rolled until one unit is picked (SK1 3.2.1 "one unit suffers Casualty Reduction"); `rules/test/asl/verify-a-defs.test.ts` › full ASL: every unit tied for the highest dr suffers the K (A.9, A7.302 "at least one"). **Reading:** every SK use of Random Selection picks exactly one unit or exactly the KIA number (SK1 3.2.1, 3.8, 4.1), so the SK procedure keeps re-rolling ties; A.9 ties are the full ASL module `asl/randomSelection.ts` (K, KIA, CC Partial Kill, multiple MG breakdown). The MMC a created leader defends with and a sniper target still pick one. |
| A.10 | LEADERSHIP DRM (∆) | ◐ | `rules/test/fire.test.ts` › uses the lowest quality leader DRM, no cowering, and marks both leaders as fired. ∆ exceptions in place for FT (see A22.2); berserk cases arrive with their rules. |
| A.11 | PERMANENT BREAKDOWN | ✅ | `rules/test/asl/verify-a-defs.test.ts` › a captured LMG (B11 -2 = B9) is removed on an original 11, its printed B# made an X# (A.11; SK1 5.5); `rules/test/asl/verify-a-defs.test.ts` › an Inexperienced (Green, no leader) user makes a B12 MMG B11/X12: 11 malfunctions, 12 removes (A.11; SK1 5.4); `rules/test/asl/verify-a-defs.test.ts` › Sustained Fire (a MG firing again after First Fire) does turn the printed B# into an X# (A9.3). Fixed (shared, `sk1/fire.ts`): any lowering of the B# for the attack turns the printed B# into an X#; ordnance already did (SK4 6.12). |
| A.12 | WHITE COUNTERS | ✅ | `rules/test/fire.test.ts` › a Prep Fire marker blocks Advancing Fire; both come off at the end of the AFPh |
| A.13 | ATTACKER/DEFENDER | ✅ | `rules/test/asl/verify-a-defs.test.ts` › runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER; `rules/test/cc.test.ts` › before the CC, each side with a leader and two MMC may restack him, the ATTACKER first |
| A.14 | COLLATERAL ATTACKS (A.14–.14B) | ⏸ | Collateral Attacks: see D.8 (Chapter D). |
| A.15 | FIRST/FINAL FIRE | ✅ | `rules/test/asl/verify-a-defs.test.ts` › a unit that used Defensive First Fire may fire again in the DFPh, at an adjacent hex only, as Area Fire |
| A.16 | SMOKE | ◐ | `rules/test/ammo.test.ts` › WP: a full +2 counter in the PFPh and a NMC for the units hit, Air Burst +1 in woods. Smoke and ordnance WP exist; WP grenades are missing. |
| A.17 | DRM | ✅ | `rules/test/rally.test.ts` › a leader rally records the DRM, its sources and the leader on the check event |
| A.18 | MORALE LEVEL CEILING | ✅ | `rules/test/asl/verify-a-defs.test.ts` › a 9-2 stacked with a Commissar reaches 10, and a morale-10 leader stays at 10 (A.18). Fixed (shared): `sk1.morale.ceiling` clamps `unit.morale` at 10; SK is silent. |

## A1 Personnel Counters

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A1.1 | (untitled) | ✅ | `rules/test/casualties.test.ts` › records each loss with its CVP: squads 2, half-squads 1, leaders 1 plus negative modifiers, reductions 1; SW nothing. |
| A1.11 | SINGLE-MAN COUNTER (SMC) | ◐ | Leaders only; heroes arrive with Heat of Battle. `rules/test/fire.test.ts` › an SMC wounded by the K takes no MC; the others do |
| A1.12 | MULTI-MAN COUNTERS (MMC) | ✅ | `rules/test/casualties.test.ts` › records each loss with its CVP: squads 2, half-squads 1, leaders 1 plus negative modifiers, reductions 1; SW nothing |
| A1.121 | SQUAD | ✅ | `rules/test/casualties.test.ts` › records each loss with its CVP: squads 2, half-squads 1, leaders 1 plus negative modifiers, reductions 1; SW nothing |
| A1.122 | HALF-SQUAD (HS) | ✅ | `rules/test/casualties.test.ts` › records each loss with its CVP: squads 2, half-squads 1, leaders 1 plus negative modifiers, reductions 1; SW nothing; `rules/test/fire.test.ts` › a squad Reduced by the K takes the MC as a HS, with the leader |
| A1.123 | CREW | ✅ | `rules/test/crew.test.ts` › a crew possessing a Gun counts as a full squad for stacking; `rules/test/crew.test.ts` › a crew firing a weapon forfeits its own FP, like a half-squad |
| A1.2 | MMC CAPABILITIES | ✅ | `content/test/content.test.ts` › reads printed values from the counter art |
| A1.21 | FIREPOWER (FP) | ✅ | `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A1.22 | RANGE | ✅ | `rules/test/fire.test.ts` › leader-directed long range fire: halved FP, leadership DRM, doubles do not cower |
| A1.23 | MORALE | ✅ | `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A1.24 | IDENTITY | ✅ | `rules/test/acquisition.test.ts` › tells a side's Guns apart by letter, in id order, each side from A. Unique piece ids stand in for identity letters; Guns are lettered. |
| A1.25 | CLASS | ✅ | `rules/test/fire.test.ts` › inexperienced cowering shifts two columns; original 12 on MC reduces and ELR-replaces; `rules/test/crew.test.ts` › a crew that fails a MC by more than the ELR breaks but is not replaced |
| A1.3 | COMPONENT PARTS | ✅ | `rules/test/fire.test.ts` › inexperienced cowering shifts two columns; original 12 on MC reduces and ELR-replaces. Squad → its own HS on Casualty Reduction. |
| A1.31 | DEPLOYMENT | ✗ |  |
| A1.32 | RECOMBINE | ✗ |  |
| A1.4 | BROKEN SIDE | ✅ | `rules/test/asl/verify-a1-a6.test.ts` › a broken unit has no FP: it cannot fire; `rules/test/rally.test.ts` › a failed self-rally is reported as failed |
| A1.5 | SPECIAL STATUS | ◐ | Spraying Fire missing. |
| A1.6 | UNIT SIZE NUMBER (US#) | ⏸ | Unit Size (Chapter D). |

## A2 The Mapboard

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A2.1 | BOARD CONFIGURATION | ✅ | `rules/test/map.test.ts` › merges overlapping half hexes of butted boards; Starter Kit scenario tests › stacks board y turned 180° on board z, playable halves A-P and R-GG, with the card’s north east |
| A2.2 | GRID COORDINATES | ✅ | `rules/test/map.test.ts` › names columns A..Z then AA..GG |
| A2.3 | HALF-HEXES | ✅ | `rules/test/map.test.ts` › merges overlapping half hexes of butted boards |
| A2.4 | CUMULATIVE TERRAIN EFFECTS | ✅ | Levels: the same building TEM upstairs (B23.31), Indirect Fire +1 per level above (`rules/test/asl/levels.test.ts` › a mortar hit on a Two Story House hex attacks both levels with one DR, +1 at the ground for the level above). Board u's combined terrain: Woods-Road and Orchard-Road follow their own rules (B13.31, B14.6), SMOKE adds to the COT (`rules/test/asl/terrain.test.ts` › Open Ground uphill into SMOKE costs 2 × (1 + 1) = 4 MF; the Starter Kit adds the Smoke after the doubling (3)). |
| A2.5 | ENTRY | ✅ | Starter Kit scenario tests › has the Germans set up offboard at the start of their Turn 1 RPh, then enter from there |
| A2.51 | OFFBOARD SETUP | ✅ | Starter Kit scenario tests › has the Germans set up offboard at the start of their Turn 1 RPh, then enter from there; `rules/test/offboardStacking.test.ts` › Infantry set up offboard keep the stacking limits; vehicles may share an offboard hex (A5.1 "never during initial or offboard setup") |
| A2.52 | OFFBOARD ACTIONS | ✅ | `rules/test/offboardStacking.test.ts` › three squads may move together along the edge, but not into an offboard hex already holding a fourth; Starter Kit scenario tests › SSR 1: off-board terrain exists, so moving offboard and exiting cost the printed terrain (SK4: Open Ground otherwise) |
| A2.6 | EXIT | ✅ | Starter Kit scenario tests › the Germans win at once by exiting 10 VP off the west edge between I1 and Y1 |
| A2.7 | OVERLAYS | ⏸ | Overlays. |
| A2.71 | CUTTING OUT OVERLAYS | ⏸ | Overlays. |
| A2.72 | (untitled) | ⏸ | Overlays. |
| A2.73 | SSR PLACEMENT | ⏸ | Overlays. |
| A2.74 | (untitled) | ⏸ | Overlays. |
| A2.75 | SPECIFIC OVERLAYS | ⏸ | Overlays. |
| A2.76 | WADIS/STREAMS | ⏸ | Wadis/streams. |
| A2.8 | LOCATION | ✅ | Model level: `rules/test/asl/location.test.ts` › ground level is the plain hex id; levels and sub-Locations add a suffix; `rules/test/asl/location.test.ts` › personnelAt takes one Location; personnelInHex takes the whole hex; `rules/test/asl/location.test.ts` › ASL: a Two Story House hex has level 1 (B23.22); an open hex has only ground level. Real level data: `content/src/buildingLevels.ts`. |
| A2.9 | SETUP LIMITATIONS | ✅ | Starter Kit scenario tests › sets up under the normal stacking limits: three squads in a hex, not four (SK1 3.3); Starter Kit scenario tests › requires the Americans to place every unit in the setup hexes before play starts |

## A3 Sequence of Play

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A3.1 | RALLY PHASE (RPh) | ✅ | `rules/test/asl/verify-a-defs.test.ts` › runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER; `rules/test/rally.test.ts` › a leader rallies every broken unit in his Location in one action, each with its own DR |
| A3.2 | PREP FIRE PHASE (PFPh) | ✅ | `rules/test/asl/verify-a-defs.test.ts` › runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER; `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A3.3 | MOVEMENT PHASE (MPh) | ✅ | `rules/test/asl/verify-a-defs.test.ts` › runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER; `rules/test/movement.test.ts` › First Fire on a moving stack: FFNAM/FFMO, Residual FP and First Fire markers |
| A3.4 | DEFENSIVE FIRE PHASE (DFPh) | ✅ | `rules/test/asl/verify-a-defs.test.ts` › runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER; `rules/test/asl/verify-a-defs.test.ts` › a unit that used Defensive First Fire may fire again in the DFPh, at an adjacent hex only, as Area Fire |
| A3.5 | ADVANCING FIRE PHASE (AFPh) | ✅ | `rules/test/asl/verify-a-defs.test.ts` › runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER; `rules/test/fire.test.ts` › AFPh firers wear Advancing Fire, not Prep Fire, and cannot fire again (SK1 3.5) |
| A3.6 | ROUT PHASE (RtPh) | ✅ | `rules/test/asl/verify-a-defs.test.ts` › runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER; `rules/test/rout.test.ts` › a broken unit in Open Ground where an enemy could Interdict it must rout (SK1 3.6) |
| A3.7 | ADVANCE PHASE (APh) | ✅ | `rules/test/asl/verify-a-defs.test.ts` › runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER; `rules/test/asl/verify-a-defs.test.ts` › a unit that Prep Fired may not move in the MPh but may still advance in the APh |
| A3.8 | CLOSE COMBAT PHASE (CCPh) | ✅ | `rules/test/asl/verify-a-defs.test.ts` › runs RPh, PFPh, MPh, DFPh, AFPh, RtPh, APh, CCPh, then the other side becomes the ATTACKER; `rules/test/cc.test.ts` › advancing into an enemy hex puts a CC counter on it; after the CCPh it becomes Melee if both sides remain |

## A4 Infantry Movement

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A4.1 | BASIC MPh | ✅ | `rules/test/movement.test.ts` › rejects movement beyond MF and into enemy hexes |
| A4.11 | MOVEMENT FACTOR (MF) | ✅ | `rules/test/movement.test.ts` › rejects movement beyond MF and into enemy hexes; `rules/test/movement.test.ts` › portage: a 5PP MMG leaves a 4-4-7 two MF, three when Double Timing |
| A4.12 | LEADER BONUS | ✅ | `rules/test/movement.test.ts` › a leader pinned by Defensive First Fire takes the leader bonus with him (SK1 3.3, ASLRB A4.12); `rules/test/asl/shared-fixes.test.ts` › a wounded leader still gives MMC moving with him the 2 MF bonus |
| A4.13 | TERRAIN EFFECTS | ✅ | `rules/test/asl/verify-a1-a6.test.ts` › Infantry pay 1 MF into Open Ground and 2 MF into woods or a building; levels (B23.4, B23.421): `rules/test/asl/levels.test.ts` › level 1 to level 1 of the next hex of the building costs the building's two MF (B23.421) |
| A4.131 | HEXSIDE COSTS | ⏸ | No hexside costs on board u. |
| A4.132 | ROAD | ✅ | `rules/test/movement.test.ts` › road bonus: earned only by road steps, and never spent on Smoke; `rules/test/woodsRoad.test.ts`, `rules/test/orchardRoad.test.ts`; `rules/test/asl/bypass.test.ts` › full ASL: the road point is clear of the woods, so the unit on the road is subject to FFMO; the Starter Kit: centre only (A4.132 b) |
| A4.133 | ELEVATION CHANGE | ✅ | `rules/test/elevation.test.ts` › doubles the cost of terrain entered across a Crest Line uphill, not downhill; full ASL doubles the SMOKE MF with it (B.2): `rules/test/asl/terrain.test.ts` › Open Ground uphill into SMOKE costs 2 × (1 + 1) = 4 MF; the Starter Kit adds the Smoke after the doubling (3) |
| A4.134 | MINIMUM MOVE | ✗ |  |
| A4.14 | ENEMY UNITS | ✅ | `rules/test/movement.test.ts` › rejects movement beyond MF and into enemy hexes. Per Location: `rules/test/asl/levels.test.ts` › an enemy on the ground below does not bar level 1 (A4.14 is per Location); one at level 1 does. The exceptions (berserk, HW, Disrupted, Unarmed, OVR) arrive with their rules. |
| A4.15 | INFANTRY OVR | ✗ |  |
| A4.151 | SMC OPTIONS | ✗ |  |
| A4.152 | CC | ✗ |  |
| A4.2 | MECHANICS OF MOVEMENT | ✅ | `rules/test/movement.test.ts` › a stack breaks up: the unit out of MF stops, the rest move on (SK1 3.3) |
| A4.3 | BYPASS | ✅ | `rules/test/asl/bypass.test.ts` › round a building from the next hex costs one MF for one or two hexsides, and puts the stack at the corner; only the hexsides travelled along must be clear, and not the one crossed into the hex; cannot bypass an obstacle holding a Known enemy unit (A4.3); `content/test/bypassU.test.ts` › every building hex can be bypassed; 66 of the 68 woods hexes. Hexsides measured on the LOS raster (`content/src/los.ts` `bypassMask`); Ablaze/rubble/Wire/roadblock/mine limits are missing |
| A4.31 | (untitled) | ✅ | `rules/test/asl/bypass.test.ts` › a third hexside doubles the hex Bypass cost once: one MF more, then nothing for a fourth (A4.31 example); from the corner: the two hexes there or the obstacle; entering it costs its whole COT in the same Location |
| A4.32 | BROKEN IN BYPASS | ✅ | `rules/test/asl/bypass.test.ts` › may not end its move in Bypass (A4.32): no End move, no units left behind; refuses a Bypass that could never end outside Bypass, by a full look-ahead |
| A4.33 | PINNED IN BYPASS | ✅ | `rules/test/asl/bypass.test.ts` › units pinned in Bypass stay there for the rest of the MPh: fired on again without TEM, no FFMO while pinned (A4.33) |
| A4.34 | BYPASS LOS | ✅ | `rules/test/asl/bypass.test.ts` › fired at a corner: no building TEM, FFNAM and FFMO; at the hex centre the LOS must cross a bypassed hexside; each firing hex of a Fire Group chooses its own point; `rules/test/asl/hex-corners.test.ts`, `content/test/bypassU.test.ts` (LOS to a corner). Crest Line case: the Bypass position is at the hex's level |
| A4.4 | PORTAGE | ✅ | `rules/test/movement.test.ts` › portage: a 5PP MMG leaves a 4-4-7 two MF, three when Double Timing |
| A4.41 | AFPh SW FIRE LIMITS | ◐ | AFPh SW limits (mortars, INF guns). |
| A4.42 | INHERENT PORTAGE CAPACITY (IPC) | ✅ | `rules/test/movement.test.ts` › portage: a 5PP MMG leaves a 4-4-7 two MF, three when Double Timing; `rules/test/sw.test.ts` › a SMC may not recover a SW that would take it over 2 PP |
| A4.43 | POSSESSION | ✅ | Starter Kit scenario tests › may be given to any unit of their group, leaders included, whatever hex each is placed in; `rules/test/sw.test.ts` › an unbroken unit may drop a SW in the APh; a broken one may not |
| A4.431 | TRANSFER | ✅ | `rules/test/asl/verify-a1-a6.test.ts` › passes a SW between Good Order unpinned units of one Location in the RPh, not in the MPh |
| A4.44 | RECOVERY | ✅ | `rules/test/sw.test.ts` › a failed MPh recovery blocks a retry this MPh only; the tag is cleared when the phase ends; `rules/test/crew.test.ts` › no RPh Recovery in a hex with an enemy unit (ASLRB A4.44): the Gun waits until the Melee is over |
| A4.5 | DOUBLE TIME | ◐ | Double Time declared at the start of the move only. `rules/test/movement.test.ts` › a CX counter comes off at the start of the next MPh, which still forbids Double Time (SK1 3.3); the road bonus on top of eight MF: `rules/test/asl/terrain.test.ts` › a leader with a squad Double Timing along the J road enters nine road hexes: eight MF and the road bonus |
| A4.51 | COUNTER EXHAUSTION (CX) | ✅ | `rules/test/movement.test.ts` › a CX counter comes off at the start of the next MPh, which still forbids Double Time (SK1 3.3) |
| A4.52 | PORTAGE EFFECTS | ✅ | `rules/test/movement.test.ts` › portage: a 5PP MMG leaves a 4-4-7 two MF, three when Double Timing. CX IPC one lower when Double Timing. |
| A4.6 | MOVEMENT MODIFIERS (FFMO/FFNAM) | ✅ | `rules/test/movement.test.ts` › First Fire on a moving stack: FFNAM/FFMO, Residual FP and First Fire markers; on the road through an Orchard-Road hex (shared): `rules/test/orchardRoad.test.ts` › on the road: FFMO against a firer whose LOS stays on the road; not from the side, nor once in the orchard |
| A4.61 | ASSAULT MOVEMENT | ✅ | `rules/test/asl/verify-a1-a6.test.ts` › is one hex, without spending all MF; Starter Kit scenario tests › SSR 1 and SSR 3: no FFMO against Russians Assault Moving in the open; German MMC break with a morale one higher |
| A4.62 | HAZARDOUS MOVEMENT | ◐ |  |
| A4.63 | DASH | ✗ |  |
| A4.7 | ADVANCE PHASE | ✅ | `rules/test/asl/levels.test.ts` › a unit may advance one level up in its own hex, but not up into another hex; `rules/test/cc.test.ts` › advancing into an enemy hex puts a CC counter on it; after the CCPh it becomes Melee if both sides remain; `rules/test/asl/verify-a-defs.test.ts` › a unit that Prep Fired may not move in the MPh but may still advance in the APh |
| A4.71 | vs AN AFV | ✅ | `rules/test/vehicleCc.test.ts` › MMC roll ≤ morale (leader DRM) to advance into an enemy AFV hex; a failure pins; the leader needs none. |
| A4.72 | vs DIFFICULT TERRAIN | ◐ | `rules/test/asl/verify-a1-a6.test.ts` › an advance costing all of a unit's MF makes it CX; one costing 4 of 6 MF does not (ASL: CX at ≥ 4 MF too). An advance makes a unit CX only when it costs all its MF (the SK4 wording); ASL also counts a hex costing ≥ 4 MF. SK differs, so this belongs in an asl/ module. |
| A4.8 | TEMPORARILY IMMOBILIZED (TI) | ✗ |  |

## A5 Stacking Limits

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A5.1 | INFANTRY/CAVALRY | ◐ | Per Location (`rules/test/asl/location.test.ts` › three squads at level 1 do not stop three more entering the ground level below); board u's Two Story Houses have level 1 (`content/test/buildingLevels.test.ts` › full ASL: a Two Story House hex has level 1; the Starter Kit keeps every hex at ground level). Overstacking is missing. Starter Kit scenario tests › sets up under the normal stacking limits: three squads in a hex, not four (SK1 3.3) |
| A5.11 | MOVEMENT | ✗ |  |
| A5.12 | ATTACK PENALTY | ✗ |  |
| A5.13 | DEFENSE PENALTIES | ✗ |  |
| A5.131 | PERSONNEL | ✗ |  |
| A5.132 | VEHICULAR | ✗ |  |
| A5.2 | VEHICULAR | ✅ | `rules/test/vehicleMove.test.ts` › two friendly vehicles may not end the MPh in one hex |
| A5.3 | PRC | ⏸ | PRC (Chapter D). |
| A5.4 | COMBINED ARMS | ✅ | `rules/test/asl/verify-a1-a6.test.ts` › a vehicle in a hex does not alter the Personnel stacking limit |
| A5.5 | EQUIVALENTS | ◐ | "5 SMC = HS" missing. `rules/test/crew.test.ts` › a crew possessing a Gun counts as a full squad for stacking |
| A5.6 | LOCATION RESTRICTIONS | ✗ |  |

## A6 Line of Sight

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A6.1 | CHECKING LOS | ✅ | `content/test/content.test.ts` › reproduces the SK1 Line of Sight example (pixel LOS) |
| A6.11 | LOS CHECKS | ✅ | `rules/test/fire.test.ts` › accepts a shot without LOS (declared first, then wasted) and rejects units that already fired; `rules/test/ammo.test.ts` › a shot with no LOS still makes its To Hit DR (ASLRB A6.11): depletion and breakdown apply, nothing is hit |
| A6.12 | ATYPICAL LOS | ✅ | A LOS to a corner (Bypass, A4.34) or a hexside road point (A4.132): `LosEnd.vertex`/`side`, `rules/test/asl/hex-corners.test.ts`. Snap Shot (A8.15) is missing |
| A6.2 | OBSTACLES | ✅ | `rules/test/asl/los-heights.test.ts` › an obstacle below both ends has no effect, one at or above the higher end blocks, one between is seen over; `content/test/losHeights.test.ts` › level 1 to the ground beyond ground-level woods is blocked: one level is not above the woods (A6.2 EX, B10.22); `rules/test/asl/los.test.ts` › level 1 sees over ground-level woods to level 1 beyond, not to the ground beyond. Full ASL only (`asl/los.ts`, `losAt`). |
| A6.21 | HALF-LEVEL OBSTACLES | ⏸ | Half-level obstacles: none on board u. |
| A6.3 | DEPRESSIONS | ⏸ | Depressions. |
| A6.4 | BLIND HEXES | ✅ | `rules/test/asl/los-heights.test.ts` › a level 2 viewer sees over ground woods, but the hex right behind them is a Blind Hex (A6.4); `content/test/losHeights.test.ts` › board w: level 1 of the G4 Two Story House on the level 1 hill (height 2) cannot see the ground right behind a house. No Location on board u is above level 1, so none occurs there. |
| A6.41 | (untitled) | ✅ | `rules/test/asl/los-heights.test.ts` › A6.41: woods five hexes away make two Blind Hexes |
| A6.42 | (untitled) | ✅ | `rules/test/asl/los-heights.test.ts` › A6.41/A6.42 EX: a 1½-level obstacle 12 hexes away makes 3 Blind Hexes from level 2, 2 from level 3, 1 from level 4 up |
| A6.43 | (untitled) | ✅ | `rules/test/asl/los-heights.test.ts` › A6.43: a hex behind the obstacle lower than the obstacle's hex is blind farther out, a higher one less; `rules/test/asl/los-heights.test.ts` › B10.23 EX (F)/(G) and A6.43: the hex behind lower than the obstacle's adds to the Blind Hexes, higher takes off |
| A6.5 | RECIPROCITY | ✅ | `rules/test/asl/verify-a1-a6.test.ts` › a LOS traced one way is the same LOS traced back; `content/test/losHeights.test.ts` › is the same both ways (A6.5) (`losAt` orders its ends, higher first, before tracing). |
| A6.6 | UNITS | ✅ | `rules/test/asl/verify-a1-a6.test.ts` › Personnel units in an intervening hex neither block nor hinder fire through it. Full ASL: a vehicle or wreck hinders only same-level LOS (`asl.los.vehicles-same-level`, A6.7/B10.22; no test-bed vehicles, untested). |
| A6.7 | LOS HINDRANCE | ✅ | `content/test/content.test.ts` › a LOS along the shared hexside of two grain hexes at the same range counts one +1, not two (tester report, board y); `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A6.8 | (untitled) | ✅ | Adjacent units without LOS. Levels (`rules/test/asl/levels.test.ts` › no LOS between non-ADJACENT Locations of one building next to each other (B23.25)); Bypass (`rules/test/asl/hex-corners.test.ts` › a LOS to a corner is blocked by the obstacle of that hex when it crosses it) |

## A7 Fire Attacks

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A7.1 | (untitled) | ✅ | `rules/test/fire.test.ts` › AFPh firers wear Advancing Fire, not Prep Fire, and cannot fire again (SK1 3.5); `rules/test/asl/verify-a-defs.test.ts` › a unit that used Defensive First Fire may fire again in the DFPh, at an adjacent hex only, as Area Fire |
| A7.2 | FIREPOWER MODIFIERS | ✅ | `rules/test/fire.test.ts` › AFPh firers wear Advancing Fire, not Prep Fire, and cannot fire again (SK1 3.5); `rules/test/fire.test.ts` › leader-directed long range fire: halved FP, leadership DRM, doubles do not cower. Fractions kept, then rounded up after Assault Fire. |
| A7.21 | POINT BLANK FIRE (PBF) | ✅ | `rules/test/asl/levels.test.ts` › the ground and level 1 of one hex fire at each other with PBF (ADJACENT, A7.21); `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A7.211 | TPBF vs PRC | ◐ | TPBF. |
| A7.212 | TARGET SELECTION LIMITS | ◐ | Per Location (`rules/test/asl/location.test.ts` › A7.212: a Known enemy in its own Location confines a unit to firing at that Location; one at another level does not); real levels on board u. "Known" waits for concealment. |
| A7.22 | LONG RANGE FIRE | ✅ | `rules/test/fire.test.ts` › leader-directed long range fire: halved FP, leadership DRM, doubles do not cower |
| A7.23 | AREA FIRE | ◐ | Area Fire vs concealed. |
| A7.24 | AFPh FIRE | ✅ | `rules/test/fire.test.ts` › AFPh firers wear Advancing Fire, not Prep Fire, and cannot fire again (SK1 3.5) |
| A7.25 | OPPORTUNITY FIRE | ✗ | Opportunity Fire. |
| A7.26 | MISCELLANEOUS | ◐ | `rules/test/fire.test.ts` › AFPh firers wear Advancing Fire, not Prep Fire, and cannot fire again (SK1 3.5); `rules/test/fire.test.ts` › leader-directed long range fire: halved FP, leadership DRM, doubles do not cower; `rules/test/asl/verify-a7-a9.test.ts` › a PTC failed pins the target; a pinned unit fires at half FP and may not move. **Reading:** A7.26 only points to the FP modifiers listed beneath the IFT and in their own rules. In place: PBF ×2, long range ½, AFPh ½, pinned ½, firing again ½, lone SMC with a MG ½, Assault Fire +1 (`sk1/fire.ts` `fire.partFp`) and Area Fire vs hidden units. Missing: TPBF ×3, Opportunity Fire, Spraying Fire, Fire Lane. |
| A7.3 | RESOLUTION | ✅ | `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A7.301 | #KIA | ✅ | `rules/test/sw.test.ts` › each possessed SW rolls a dr on the attack column: KIA destroys it, K malfunctions it, anything else spares it; `rules/test/asl/verify-a-defs.test.ts` › full ASL: a KIA takes more units than its number when the last pick is tied (A7.301). SK1 3.2.1 says "as many targets as the number", so the tie rule is the full ASL module `asl/randomSelection.ts`. |
| A7.302 | K/# | ✅ | `rules/test/fire.test.ts` › an SMC wounded by the K takes no MC; the others do; `rules/test/fire.test.ts` › a squad Reduced by the K takes the MC as a HS, with the leader; `rules/test/asl/verify-a-defs.test.ts` › full ASL: every unit tied for the highest dr suffers the K (A.9, A7.302 "at least one"). SK1 3.2.1 says "one unit", so the tie rule is the full ASL module `asl/randomSelection.ts`. |
| A7.303 | NMC | ✅ | `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A7.304 | #MC | ✅ | `rules/test/fire.test.ts` › inexperienced cowering shifts two columns; original 12 on MC reduces and ELR-replaces |
| A7.305 | PTC | ✅ | `rules/test/asl/verify-a7-a9.test.ts` › a PTC failed pins the target; a pinned unit fires at half FP and may not move |
| A7.306 | — (No Effect) | ✅ | `rules/test/fire.test.ts` › a broken target goes under DM when the attack could inflict a NMC, even if it rolls no effect, and says so. |
| A7.307 | vs ARMORED TARGETS | ✅ | `rules/test/toKill.test.ts` › Infantry fire does nothing to a BU AFV; against a CE crew it is an IFT attack that can Stun the AFV. |
| A7.308 | vs UNARMORED VEHICLES | ⏸ | No unarmored vehicles yet. |
| A7.309 | UNLIKELY KILL | ✗ |  |
| A7.31 | (untitled) | ✅ | `rules/test/asl/verify-a7-a9.test.ts` › a target may be attacked any number of times in a phase, each attack declared after the last is resolved |
| A7.32 | (untitled) | ✅ | `rules/test/asl/verify-a7-a9.test.ts` › a target may be attacked any number of times in a phase, each attack declared after the last is resolved |
| A7.33 | MULTIPLE TARGETS | ✅ | `rules/test/rof.test.ts` › a MG fired with its squad keeps ROF on a low colored dr, stays unmarked and fires again; the squad is marked. The squad is marked, its MG fires on. |
| A7.34 | SQUAD SPRAYING FIRE | ✗ |  |
| A7.35 | SW USAGE | ✅ | `rules/test/crew.test.ts` › a crew firing a weapon forfeits its own FP, like a half-squad; `rules/test/sw.test.ts` › a squad that destroyed one SW and fires another forfeits its own FP |
| A7.351 | (untitled) | ✅ | `rules/test/sw.test.ts` › a squad that destroyed one SW and fires another forfeits its own FP. |
| A7.352 | (untitled) | ✅ | `rules/test/crew.test.ts` › a crew firing a weapon forfeits its own FP, like a half-squad. |
| A7.353 | (untitled) | ✅ | `rules/test/movement.test.ts` › a Fire Group may mix a unit marked First Fire (Subsequent First Fire) with one firing for the first time. SW-use forfeit lifted for SFF/FPF/adjacent Final Fire (`sk1/fire.ts` basicIllegal). |
| A7.36 | ASSAULT FIRE | ✅ | `rules/test/fire.test.ts` › AFPh firers wear Advancing Fire, not Prep Fire, and cannot fire again (SK1 3.5) |
| A7.37 | INCREMENTAL IFT (IIFT) — optional (*) | ⏸ | Optional (*) Incremental IFT: not offered. |
| A7.371 | COLUMN SHIFTS | ⏸ | this is a sub-rule of the optional *7.37 Incremental IFT, which the engine does not offer. Standard-IFT column shifts (cowering) are covered at A7.9/A19.33. |
| A7.372 | FIREPOWER MODIFIERS | ⏸ | sub-rule of the optional *7.37 Incremental IFT (see A7.371). |
| A7.4 | TARGET DETERMINATION | ✅ | `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A7.5 | FIRE GROUP (FG) | ✅ | `rules/test/asl/levels.test.ts` › a Fire Group needs ADJACENT Locations: level 1 of K4 and the ground of J4 next door are not (A7.5, B23.25); `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A7.51 | VEHICLES/ORDNANCE | ◐ |  |
| A7.52 | (untitled) | ✅ | `rules/test/fire.test.ts` › lets fire be declared along a near-blocked LOS: the firer has fired, no attack |
| A7.53 | FIRE DIRECTION | ✅ | `rules/test/fire.test.ts` › uses the lowest quality leader DRM, no cowering, and marks both leaders as fired; `rules/test/fire.test.ts` › allows one directing leader per hex, and no more |
| A7.531 | (untitled) | ✅ | `rules/test/fire.test.ts` › uses the lowest quality leader DRM, no cowering, and marks both leaders as fired. |
| A7.54 | BERSERK | ◐ | Berserk. |
| A7.55 | MANDATORY FG | ✅ | `rules/test/movement.test.ts` › the Mandatory Fire Group binds per moving stack and MF expenditure, not per hex (SK1 1.2.4, ASLRB A7.55) |
| A7.6 | TEM & LOS HINDRANCES | ✅ | `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A7.7 | ENCIRCLEMENT | ✗ |  |
| A7.71 | FG | ✗ | Encirclement of a FG. |
| A7.72 | UPPER LEVELS | ✗ |  |
| A7.8 | PIN | ✅ | `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other; `rules/test/asl/verify-a7-a9.test.ts` › a PTC failed pins the target; a pinned unit fires at half FP and may not move |
| A7.81 | INFANTRY EFFECTS | ✅ | `rules/test/asl/verify-a7-a9.test.ts` › a PTC failed pins the target; a pinned unit fires at half FP and may not move |
| A7.82 | VEHICLE/CREW | ⏸ | Chapter D. |
| A7.821 | PASSENGERS/RIDERS | ⏸ | Chapter D. |
| A7.83 | MOVEMENT/ADVANCE | ✅ | `rules/test/asl/verify-a10.test.ts` › a mover pinned by Defensive First Fire is fired on again there, without FFNAM/FFMO; the movers keep them |
| A7.831 | LEADERS | ✅ | `rules/test/movement.test.ts` › a leader pinned by Defensive First Fire takes the leader bonus with him (SK1 3.3, ASLRB A4.12) |
| A7.9 | COWERING | ◐ | Cowering exists (`rules/test/rof.test.ts` › original doubles cower a non-directed attack: the MG loses ROF and is marked with the squad); Random Selection of the units marked and nationality exemptions are missing. |

## A8 Defensive Fire Principles

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A8.1 | FIRST FIRE | ✅ | `rules/test/movement.test.ts` › First Fire on a moving stack: FFNAM/FFMO, Residual FP and First Fire markers |
| A8.10 | OPTIONAL FIRST FIRE COUNTERS — optional (*) | — | Optional (*) First Fire counters: not offered. |
| A8.11 | FACING | ◐ | Facing. |
| A8.12 | MOVING WITHIN LOCATION | ✅ | `rules/test/asl/location.test.ts` › MF spent at level 1 make the stack a First Fire target there, and only there; `rules/test/asl/levels.test.ts` › up the inherent stairwell costs one MF and puts the stack at level 1 (a new Location: its MF count starts afresh). |
| A8.13 | DEFENSIVE FIRST FIRE DRM | ✅ | `rules/test/movement.test.ts` › First Fire on a moving stack: FFNAM/FFMO, Residual FP and First Fire markers; `rules/test/movement.test.ts` › a Residual FP attack names its DRM: FFNAM and FFMO apply (SK1 3.3.1) |
| A8.14 | FOLLOW-UP ATTACK | ✅ | `rules/test/movement.test.ts` › a stack broken whole by Defensive First Fire may be fired on again there, FFNAM/FFMO still applying, before its move ends; `rules/test/movement.test.ts` › a unit broken there is left behind when the rest of its stack moves on, and no longer a target |
| A8.15 | SNAP SHOT | ✗ |  |
| A8.2 | RESIDUAL FIREPOWER | ✅ | `rules/test/movement.test.ts` › First Fire on a moving stack: FFNAM/FFMO, Residual FP and First Fire markers |
| A8.21 | (untitled) | ✅ | `rules/test/asl/verify-a7-a9.test.ts` › a smaller Residual FP leaves the larger counter in place; a larger one replaces a smaller |
| A8.22 | RESTRICTIONS | ✅ | `rules/test/movement.test.ts` › a Residual FP attack names its DRM: FFNAM and FFMO apply (SK1 3.3.1) |
| A8.221 | MALFUNCTION | ✅ | `rules/test/asl/verify-a7-a9.test.ts` › a weapon that malfunctions on the attack leaves no Residual FP of its own |
| A8.222 | vs AFV | ⏸ | Residual FP vs AFV / Vulnerable PRC (Chapter D collateral). |
| A8.223 | SNAP SHOT | ✗ |  |
| A8.224 | COWERING | ✅ | `rules/test/asl/verify-a7-a9.test.ts` › a Residual FP attack never cowers, even on doubles |
| A8.23 | ROF | ✅ | `rules/test/rof.test.ts` › a MMG that keeps ROF leaves no Residual FP; its owner may give the ROF up for it while still deciding |
| A8.24 | SPRAYING FIRE | ✗ |  |
| A8.25 | ORDNANCE | ⏸ | Ordnance Residual (Chapter C). |
| A8.26 | EFFECT OF DRM | ✅ | `rules/test/fire.test.ts` › halves the column, then drops a column per point of outside DRM |
| A8.3 | SUBSEQUENT FIRST FIRE | ✅ | `rules/test/movement.test.ts` › a Fire Group may mix a unit marked First Fire (Subsequent First Fire) with one firing for the first time |
| A8.31 | FINAL PROTECTIVE FIRE (FPF) | ◐ | Every MG must fire in FPF. `rules/test/movement.test.ts` › a Fire Group may mix a unit using FPF with one firing for the first time: only the FPF user takes the NMC |
| A8.311 | RESTRICTIONS | ◐ | `rules/test/vehicleCc.test.ts` › fire into the firer's own hex at an enemy vehicle is tripled (TPBF); with an enemy unit in its hex a unit fires at that hex only. the Known-enemy-in-Location clause holds (a unit with an enemy in its hex fires only at that hex); the "Infantry manning ordnance may not fire it in FPF" clause has no test or code path found. |
| A8.312 | TPBF | ✗ |  |
| A8.4 | FINAL FIRE | ✅ | `rules/test/asl/verify-a-defs.test.ts` › a unit that used Defensive First Fire may fire again in the DFPh, at an adjacent hex only, as Area Fire |
| A8.41 | MULTIPLE ROF | ✅ | `rules/test/rof.test.ts` › a MG fired with its squad keeps ROF on a low colored dr, stays unmarked and fires again; the squad is marked |

## A9 Machine Guns

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A9.1 | COUNTERS | ✅ | `rules/test/rof.test.ts` › a MG fired with its squad keeps ROF on a low colored dr, stays unmarked and fires again; the squad is marked |
| A9.11 | MMC USAGE | ✅ | `rules/test/rof.test.ts` › a MG fired with its squad keeps ROF on a low colored dr, stays unmarked and fires again; the squad is marked |
| A9.12 | SMC USAGE | ◐ |  |
| A9.2 | MULTIPLE ROF | ✅ | `rules/test/rof.test.ts` › a MG fired with its squad keeps ROF on a low colored dr, stays unmarked and fires again; the squad is marked |
| A9.21 | FIELD OF FIRE | ✗ |  |
| A9.22 | FIRE LANE | ✗ |  |
| A9.221 | ALTERNATE HEX GRAIN | ✗ |  |
| A9.222 | RESIDUAL FP | ✗ |  |
| A9.223 | CANCELLATION | ✗ |  |
| A9.3 | SUSTAINED FIRE | ✅ | `rules/test/asl/verify-a-defs.test.ts` › Sustained Fire (a MG firing again after First Fire) does turn the printed B# into an X# (A9.3). B# −2 and Area Fire when firing again after First Fire. |
| A9.4 | MANDATORY FIRE DIRECTION | ◐ |  |
| A9.5 | SPRAYING FIRE | ✗ |  |
| A9.51 | vs VEHICLE | ✗ |  |
| A9.52 | RESTRICTIONS | ✗ |  |
| A9.6 | VEHICULAR TARGETS | ✗ |  |
| A9.61 | AFV KILL | ✗ |  |
| A9.611 | EFFECT vs PERSONNEL | ✗ |  |
| A9.7 | SUPPORT WEAPON (SW) MALFUNCTION | ✅ | `rules/test/rof.test.ts` › a blocked attack is still rolled (ASLRB A6.11): the MG may keep ROF, or break down; `rules/test/asl/shared-fixes.test.ts` › an original 12 malfunctions the ATR (its inherent B12), it is not removed (SK4 4.4.4 "normal breakdown"; fixed: non-MG SW with a B# malfunction, X# ones are removed). |
| A9.71 | MULTIPLE SW MALFUNCTION | ✅ | `rules/test/asl/verify-a7-a9.test.ts` › when a FG of two MG rolls their B#, Random Selection picks the one that malfunctions. Ties: SK one MG (SK1 4.1); full ASL every tied MG, `rules/test/asl/shared-fixes.test.ts` › SK: one MG malfunctions (SK1 4.1); full ASL: both tied MGs do. |
| A9.72 | SW/GUN REPAIR | ✅ | `rules/test/asl/shared-fixes.test.ts` › SK: a squad tries to repair one SW, its one action of the RPh; `rules/test/asl/shared-fixes.test.ts` › ASL: a squad may try to repair two SW in one RPh; `rules/test/asl/shared-fixes.test.ts` › ASL: a half-squad only one, and a unit that repaired may not also Recover a SW (A4.44: its sole action); `rules/test/asl/shared-fixes.test.ts` › ASL: a squad may not spend both attempts on one SW; `rules/test/rally.test.ts` › a unit makes one repair attempt, and a SW that failed its dr cannot be passed on to try again (SK1 3.1; ASLRB A9.72). **Reading:** SK1/SK4 3.1 allow each unit one RPh action, so SK makes one repair attempt per unit (`sk1/rally.ts`); a squad's second attempt is the full ASL module `asl/swRepair.ts`. Each SW gets one dr per Player Turn in both. |
| A9.73 | SW SELF-DESTRUCTION | ◐ | Destruction yes, deliberate malfunction no. `rules/test/sw.test.ts` › a squad may wreck a SW in the PFPh: it is gone, the squad has used a SW and cannot move |
| A9.74 | RANDOM SW/GUN DESTRUCTION | ✅ | `rules/test/sw.test.ts` › each possessed SW rolls a dr on the attack column: KIA destroys it, K malfunctions it, anything else spares it |
| A9.8 | DISMANTLED (dm) SW | ✗ |  |

## A10 Morale

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A10.1 | MORALE CHECK (MC)/TASK CHECK (TC) | ✅ | `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other |
| A10.2 | LEADER LOSS MORALE CHECK (LLMC)/LEADER LOSS TASK CHECK (LLTC) | ◐ | LLMC/LLTC for the moving stack only, same level; leaders check in leadership order rather than Morale order. `rules/test/rally.test.ts` › a leader killed by an original 12 on his rally causes the LLMC at once, not at the next fire attack (ASLRB A10.2) |
| A10.21 | LEADERSHIP DRM | ✅ | `rules/test/fire.test.ts` › a squad Reduced by the K takes the MC as a HS, with the leader; `rules/test/rout.test.ts` › a Good Order leader may rout with a broken unit, adds his DRM to the Interdiction NMC, and dies if it fails (SK1 3.6) |
| A10.22 | (untitled) | ◐ | A leader never uses his own DRM (holds); he borrows from leaders who checked before him, ordered by leadership not Morale. |
| A10.3 | MCE4 FAILURE | ✅ | `rules/test/fire.test.ts` › multi-hex FG: PBF doubling, worst hindrance, NMC breaks one squad and pins the other; `rules/test/fire.test.ts` › inexperienced cowering shifts two columns; original 12 on MC reduces and ELR-replaces |
| A10.31 | CASUALTY MC | ✅ | `rules/test/asl/shared-fixes.test.ts` › an 8-1 failing by more than the ELR on an original 12 is replaced by an 8-0 first, and it is the 8-0 a fatal wound kills; `rules/test/asl/shared-fixes.test.ts` › a squad is replaced, then Reduced: the ELR event names the squad, not its HS; `rules/test/fire.test.ts` › inexperienced cowering shifts two columns; original 12 on MC reduces and ELR-replaces. Fixed (shared; SK1 3.2.1/5.1 are silent on the order). A HS or crew the reduction eliminates is not replaced first (same CVP).; `rules/test/asl/shared-fixes.test.ts` › a 4-6-7 using FPF on an original 12 is replaced by a 4-4-7 (fails by 5, ELR 3), then Reduced to a 2-3-7 (the FPF NMC is a Casualty MC too). |
| A10.4 | BROKEN UNITS | ✅ | `rules/test/asl/verify-a1-a6.test.ts` › a broken unit has no FP: it cannot fire; `rules/test/rout.test.ts` › a broken unit in Open Ground where an enemy could Interdict it must rout (SK1 3.6) |
| A10.41 | VOLUNTARY BREAK | ✗ |  |
| A10.5 | ROUTING | ◐ | SK1 3.6 rout (A10.5 by Location is missing). INTERIM: stairs for 1 MF, destination by hex: `rules/test/asl/levels.test.ts` › a unit routing from level 1 comes down the stairs (1 MF) or keeps to its floor; it never steps out of the window |
| A10.51 | DIRECTION | ◐ | INTERIM (until rout by Location): `rules/test/asl/levels.test.ts` › having reached its destination hex, a routing unit may go upstairs there as its last step; `rules/test/rout.test.ts` › a rout ends in the first building or woods it reaches unless the next hex is one too, MF left or not (SK1 3.6, A10.51) |
| A10.52 | LOW CRAWL | ✅ | `rules/test/rout.test.ts` › Low Crawl is a one-hex rout that uses every MF and cannot be Interdicted |
| A10.53 | INTERDICTION | ✅ | `rules/test/rout.test.ts` › SK1 3.6: Open Ground forces a rout only where Interdiction could happen: not through a Hindrance, nor from a pinned or CX enemy. Reading: a routing unit entering an Orchard-Road hex claims the orchard (one MF either way, nothing to forfeit), so it is not Interdicted there. |
| A10.531 | OPEN GROUND | ✅ | `rules/test/rout.test.ts` › a broken unit in Open Ground where an enemy could Interdict it must rout (SK1 3.6) |
| A10.532 | INTERDICTOR | ✅ | `rules/test/rout.test.ts` › SK1 3.6: Open Ground forces a rout only where Interdiction could happen: not through a Hindrance, nor from a pinned or CX enemy |
| A10.533 | CONCEALMENT | ◐ |  |
| A10.6 | RALLY | ✅ | `rules/test/rally.test.ts` › a leader rallies every broken unit in his Location in one action, each with its own DR |
| A10.61 | TERRAIN BONUS | ✅ | `rules/test/rally.test.ts` › a leader rally records the DRM, its sources and the leader on the check event |
| A10.62 | DESPERATION MORALE (DM) | ◐ | Keeping DM; DM from CC. `rules/test/fire.test.ts` › a broken target goes under DM when the attack could inflict a NMC, even if it rolls no effect, and says so |
| A10.63 | SELF-RALLY | ✅ | `rules/test/rally.test.ts` › no self-rally in a Location with a Good Order friendly leader (ASL A10.63); `rules/test/rally.test.ts` › a failed self-rally is reported as failed |
| A10.64 | FATE | ✅ | `rules/test/rally.test.ts` › a leader killed by an original 12 on his rally causes the LLMC at once, not at the next fire attack (ASLRB A10.2) |
| A10.7 | LEADERSHIP | ✅ | `rules/test/rally.test.ts` › a leader rally records the DRM, its sources and the leader on the check event |
| A10.71 | RALLY | ✅ | `rules/test/rally.test.ts` › a leader rallies every broken unit in his Location in one action, each with its own DR |
| A10.711 | VOLUNTARY ROUT | ✅ | `rules/test/rout.test.ts` › a Good Order leader may rout with a broken unit, adds his DRM to the Interdiction NMC, and dies if it fails (SK1 3.6) |
| A10.72 | MANDATORY LEADERSHIP | ◐ | `rules/test/asl/verify-a10.test.ts` › a 6+1 leader passing his MC does not worsen the MC of the squad with him; ASL makes the +1 mandatory ). A positive leadership modifier (6+1) is never applied to a MC/TC (`checkGroup` lends `Math.min(0, …)`); A10.72 makes any non-zero modifier mandatory. |
| A10.8 | FANATICISM | ✗ |  |

## A11 Close Combat

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A11.1 | (untitled) | ✅ | `rules/test/cc.test.ts` › advancing into an enemy hex puts a CC counter on it; after the CCPh it becomes Melee if both sides remain |
| A11.11 | RESOLUTION | ✅ | `rules/test/cc.test.ts` › a preview gives the strengths, the odds column, the DRM with its notes and the legality; `rules/test/asl/shared-fixes.test.ts` › SK: one unit (SK1 3.8); full ASL: "one (or more)" (Partial Kill ties, `asl/randomSelection.ts`). |
| A11.12 | MECHANICS | ✅ | `rules/test/cc.test.ts` › a side may split its units into several attacks, each resolved on its own roll; `rules/test/cc.test.ts` › a squad reduced by the other side's attack still strikes back at its full strength |
| A11.13 | SW | ✗ |  |
| A11.14 | SMC | ◐ |  |
| A11.141 | LEADER | ◐ |  |
| A11.15 | MELEE | ✅ | `rules/test/cc.test.ts` › advancing into an enemy hex puts a CC counter on it; after the CCPh it becomes Melee if both sides remain |
| A11.16 | BROKEN UNITS | ◐ |  |
| A11.17 | STEALTH | ◐ |  |
| A11.18 | LAX | ◐ |  |
| A11.19 | CONCEALMENT | ✗ |  |
| A11.2 | WITHDRAWAL FROM MELEE | ✗ |  |
| A11.21 | WITHDRAWAL MECHANICS | ✗ |  |
| A11.22 | INFILTRATION | ✗ |  |
| A11.3 | SEQUENTIAL CC | ✅ | `rules/test/vehicleCc.test.ts` › attacks are sequential, the non-vehicular player first; a leader with a squad has CCV 6; DR = CCV Immobilizes (SK4 example) |
| A11.31 | vs VEHICLE | ✅ | `rules/test/vehicleCc.test.ts` › attacks are sequential, the non-vehicular player first; a leader with a squad has CCV 6; DR = CCV Immobilizes (SK4 example) |
| A11.32 | AMBUSH | ✅ | `rules/test/hip.test.ts` › a router entering the hex is revealed to and eliminated for failure to rout; an advance into it is an ambush |
| A11.33 | PRISONERS | ✗ |  |
| A11.34 | (untitled) | ◐ | Precedence of sequential-CC criteria: unverified, review with Ambush. |
| A11.4 | AMBUSH | ◐ |  |
| A11.41 | AMBUSH WITHDRAWAL | ✗ |  |
| A11.5 | CC vs A VEHICLE | ✅ | `rules/test/vehicleCc.test.ts` › attacks are sequential, the non-vehicular player first; a leader with a squad has CCV 6; DR = CCV Immobilizes (SK4 example) |
| A11.501 | UNLIKELY KILL | ✅ | `rules/test/vehicleCc.test.ts` › an original 2 that could not otherwise succeed rolls a third die; an original 12 is a Casualty Reduction for the attacker |
| A11.51 | CC DRM | ✅ | `rules/test/cc.test.ts` › a preview gives the strengths, the odds column, the DRM with its notes and the legality |
| A11.52 | CAPTURE OF VEHICLE IN CC | ⏸ | Vehicle capture (Chapter D). |
| A11.6 | CC vs AN AFV | ✅ | `rules/test/vehicleCc.test.ts` › MMC roll ≤ morale (leader DRM) to advance into an enemy AFV hex; a failure pins; the leader needs none |
| A11.61 | CC ATTACK DRM vs AFV | ✅ | `rules/test/vehicleCc.test.ts` › a Motion vehicle holds nobody in Melee; an immobile one adds -1 and a vehicle without an MG -1 |
| A11.611 | PRC | ⏸ | PRC (Chapter D). |
| A11.612 | AF | ◐ | AF ignored in CC: unverified. |
| A11.62 | AFV CC ATTACKS vs INFANTRY | ✅ | `rules/test/vehicleCc.test.ts` › a vehicle attacks Infantry with its MG FP at odds against their CCV; the sides alternate until everyone has attacked |
| A11.621 | CREW SMALL ARMS | ✅ | `rules/test/vehicleCc.test.ts` › an original 2 that could not otherwise succeed rolls a third die; an original 12 is a Casualty Reduction for the attacker |
| A11.622 | CLOSE DEFENSE WEAPON SYSTEM | ⏸ | CDWS (Chapter D). |
| A11.7 | VEHICLE WITHDRAWAL FROM CC | ✅ | `rules/test/vehicleCc.test.ts` › a vehicle in a Melee hex may still move away, but fires only into its hex while it stays |
| A11.71 | OTHER WITHDRAWAL FROM CC | ✅ | `rules/test/vehicleCc.test.ts` › a Stopped vehicle holds Infantry in Melee only until it starts: then they may Reaction Fire, and fire at it once it has gone |
| A11.8 | STREET FIGHTING | ✗ |  |

## A12 Concealment

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A12.1 | (untitled) | ✗ |  |
| A12.11 | KNOWN/DUMMY ENEMY UNIT | ✗ |  |
| A12.12 | PLACEMENT | ✗ |  |
| A12.121 | CONCEALMENT LOSS/GAIN TABLE | ✗ |  |
| A12.122 | CONCEALMENT dr | ✗ |  |
| A12.13 | EFFECT | ✗ |  |
| A12.14 | REMOVAL | ✗ |  |
| A12.141 | ACTIONS | ✗ |  |
| A12.15 | DETECTION | ✗ |  |
| A12.151 | BYPASS | ✗ |  |
| A12.152 | SEARCHING | ✗ | Searching. |
| A12.153 | MOPPING UP | ✗ | Mopping Up. |
| A12.154 | SEARCH CASUALTIES | ✗ |  |
| A12.16 | RIGHT OF INSPECTION | ✗ |  |
| A12.2 | CONCEALED 5/8" COUNTERS | ✗ |  |
| A12.3 | HIDDEN INITIAL PLACEMENT (HIP) | ◐ | SK4 Gun HIP only. `rules/test/hip.test.ts` › hides the Gun and crew from the other side: not a target, not a Known Enemy Unit, not an obstacle to movement orders |
| A12.31 | (untitled) | ✅ | `rules/test/hiddenUnits.test.ts` › is placed on the map when it fires |
| A12.32 | (untitled) | ✅ | `rules/test/hiddenUnits.test.ts` › is placed on the map when it moves |
| A12.33 | FORTIFICATIONS | ◐ | Fortified buildings ◐; counter fortifications ✗. `rules/test/fortified.test.ts` › asks the fortifying side first, for buildings in its setup area only |
| A12.34 | HIDDEN GUNS | ✅ | `rules/test/hip.test.ts` › hides the Gun and crew from the other side: not a target, not a Known Enemy Unit, not an obstacle to movement orders |
| A12.4 | VEHICULAR MOVEMENT THROUGH CONCEALMENT | ✗ |  |
| A12.41 | OVR | ✗ |  |
| A12.42 | BYPASS | ✗ |  |

## A13 Cavalry

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A13.1 | (untitled) | ⏸ | No cavalry counters. |
| A13.2 | STACKING | ⏸ | No cavalry counters. |
| A13.3 | MOVEMENT | ⏸ | No cavalry counters. |
| A13.31 | MF COSTS | ⏸ | No cavalry counters. |
| A13.32 | CAPACITY | ⏸ | No cavalry counters. |
| A13.33 | PORTAGE | ⏸ | No cavalry counters. |
| A13.34 | MF ALLOTMENT | ⏸ | No cavalry counters. |
| A13.35 | ENEMY UNITS | ⏸ | No cavalry counters. |
| A13.351 | FPF | ⏸ | No cavalry counters. |
| A13.36 | GALLOP | ⏸ | No cavalry counters. |
| A13.4 | FIRE EFFECTS | ⏸ | No cavalry counters. |
| A13.5 | VULNERABILITY | ⏸ | No cavalry counters. |
| A13.51 | MC | ⏸ | No cavalry counters. |
| A13.511 | (untitled) | ⏸ | No cavalry counters. |
| A13.52 | PIN & HEAT OF BATTLE | ⏸ | No cavalry counters. |
| A13.6 | CHARGE | ⏸ | No cavalry counters. |
| A13.61 | POST-RESOLUTION | ⏸ | No cavalry counters. |
| A13.62 | CAVALRY WAVE | ⏸ | No cavalry counters. |
| A13.7 | HORSES | ⏸ | No cavalry counters. |

## A14 Snipers

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A14.01 | (untitled) | ◐ | SK `ssr.sniper` stays for SK. |
| A14.1 | SNIPER ACTIVATION NUMBER (SAN) | ◐ | SK SSR sniper only. `rules/test/ssrAttacks.test.ts` › dr 1 breaks a MMC, dr 2 pins it, more misses; once per Defensive Fire Phase |
| A14.2 | TARGET SELECTION | ◐ | SK SSR sniper only. |
| A14.21 | ALTERNATE TARGET | ◐ | SK SSR sniper only. |
| A14.22 | NON-TARGETS | ◐ | SK SSR sniper only. |
| A14.23 | CONCEALED TARGETS | ◐ | SK SSR sniper only. |
| A14.3 | RESOLUTION | ◐ | SK SSR sniper only. `rules/test/ssrAttacks.test.ts` › dr 1 breaks a MMC, dr 2 pins it, more misses; once per Defensive Fire Phase |
| A14.31 | vs SNIPER | ◐ | SK SSR sniper only. |
| A14.32 | vs CC | ◐ | SK SSR sniper only. |
| A14.33 | vs UNARMORED VEHICLE | ⏸ | No unarmored vehicles exist yet (see A7.308). |
| A14.4 | SNIPER CHECK | ◐ | SK SSR sniper only. |

## A15 Heat of Battle

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A15.1 | HEAT OF BATTLE | ✗ |  |
| A15.2 | HEROES | ✗ |  |
| A15.21 | CREATION | ✗ |  |
| A15.23 | WEAPONS USE | ✗ |  |
| A15.24 | HEROIC DRM | ✗ |  |
| A15.3 | BATTLE HARDENING | ✗ |  |
| A15.4 | BERSERK | ✗ |  |
| A15.41 | LEADER CONSEQUENCES | ✗ |  |
| A15.42 | MORALE | ✗ |  |
| A15.43 | CHARGE | ✗ |  |
| A15.431 | (untitled) | ✗ | |
| A15.432 | (untitled) | ✗ | |
| A15.44 | NO ENEMY IN LOS | ✗ |  |
| A15.45 | TERRAIN RESTRICTIONS | ✗ |  |
| A15.46 | RETURN TO NORMAL | ✗ |  |
| A15.5 | SURRENDER | ✗ |  |

## A16 Battlefield Integrity

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A16.1 | INTEGRITY BASE | ✗ |  |
| A16.11 | (untitled) | ✗ |  |
| A16.12 | (untitled) | ✗ | |
| A16.2 | INTEGRITY CHECK | ✗ |  |
| A16.21 | (untitled) | ✗ |  |
| A16.3 | REGAINING ELR | ✗ |  |

## A17 Wounds

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A17.1 | OCCURRENCE | ✅ | `rules/test/fire.test.ts` › an SMC wounded by the K takes no MC; the others do |
| A17.11 | SEVERITY | ✅ | `rules/test/fire.test.ts` › an SMC wounded by the K takes no MC; the others do; `rules/test/rally.test.ts` › a leader killed by an original 12 on his rally causes the LLMC at once, not at the next fire attack (ASLRB A10.2) |
| A17.2 | MOVEMENT | ◐ | `rules/test/movement.test.ts` › a SMC wounded on the way drops to 3 MF at once and cannot Double Time (SK1 3.3); `rules/test/asl/shared-fixes.test.ts` › a SMC wounded after spending more than 3 MF is pinned; one wounded at exactly 3 is not; `rules/test/asl/shared-fixes.test.ts` › a wounded leader still gives MMC moving with him the 2 MF bonus. Left: carrying a wounded man. |
| A17.3 | EFFECTS | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › a wounded leader has his morale lowered by one and his leadership worsened by one |

## A18 Leadership

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A18.1 | (untitled) | ✅ | `rules/test/rally.test.ts` › an original 2 on a first self-rally rolls Leader Creation and reports the leader it made (SK1 5.3) |
| A18.11 | SELF-RALLY | ✅ | `rules/test/rally.test.ts` › an original 2 on a first self-rally rolls Leader Creation and reports the leader it made (SK1 5.3); `rules/test/asl/shared-fixes.test.ts` › SK: the DEFENDER's first self-rally may promote too; ASL: only the ATTACKER's (A18.11); `rules/test/asl/shared-fixes.test.ts` › SK: a leader rallying a MMC is no self-rally and leaves the first one to come; ASL: it is the first MMC Rally attempt; `rules/test/asl/shared-fixes.test.ts` › SK: a leader's own self-rally is the side's first self-rally attempt; ASL: it is no MMC Rally attempt; `rules/test/asl/shared-fixes.test.ts` › ASL: a MMC without self-rally capability self-rallies only as the first MMC Rally attempt; SK sets no such order. **Reading:** SK 5.3 is read literally (each side's first self-rally attempt of the RPh, any unit's; leader rallies do not count) in `sk1/rally.ts`; the ATTACKER-only first *MMC Rally attempt* and the free MMC self-rally as that attempt are the full ASL module `asl/fieldPromotion.ts`. |
| A18.12 | CCPh | ✅ | `rules/test/cc.test.ts` › an MMC eliminated by the other side still rolls Leader Creation on its original 2, and the leader joins both attacks |
| A18.2 | (untitled) | ◐ | `rules/test/asl/shared-fixes.test.ts` › an original 2 in CC vs an AFV rolls Leader Creation with the -1 "CC vs AFV" drm; `rules/test/asl/leader-creation.test.ts` › full ASL: the highest BPV (the 6-6-6), with its own Morale for the drm (`asl/leaderCreation.ts`; SK keeps the best Morale, SK1 5.3 "the best one": `rules/test/asl/leader-creation.test.ts` › SK: the best Morale). BPV: `content/src/counters.ts` `BPV`. **DEFERRED: the chart's "−1 Base unit has Morale Level ≥ 8" drm is not applied** (SK reading; TODO at `content/src/tables.ts` `leaderCreation`). |

## A19 Unit Substitution

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A19.1 | EXPERIENCE LEVEL RATING (ELR) | ✅ | `rules/test/fire.test.ts` › inexperienced cowering shifts two columns; original 12 on MC reduces and ELR-replaces |
| A19.11 | ELR IMMUNITY | ✅ | `rules/test/crew.test.ts` › a crew that fails a MC by more than the ELR breaks but is not replaced; `rules/test/commissar.test.ts` › has the card’s morale 10 and leadership 0, no ELR; units stacked with it gain +1 morale |
| A19.12 | DISRUPTION | ✗ |  |
| A19.13 | REPLACEMENT | ◐ | Underscored replacement missing. `rules/test/commissar.test.ts` › a unit failing to rally under the Commissar is Replaced by the next lower quality, a Conscript squad Casualty Reduced |
| A19.131 | AMMUNITION SHORTAGES | ✗ |  |
| A19.132 | (untitled) | ✗ | |
| A19.2 | GREEN & CONSCRIPT TROOPS | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › a Green MMC is Inexperienced unless stacked with an unbroken leader (pinned will do); a Conscript always is |
| A19.3 | INEXPERIENCED PERSONNEL RESTRICTIONS | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › a Green MMC is Inexperienced unless stacked with an unbroken leader (pinned will do); a Conscript always is; `rules/test/sw.test.ts` › a Green squad keeps 4 MF beside a pinned leader (still Good Order), but not a broken one. **Reading:** A19.3 exempts a Green MMC stacked with an *unbroken* leader; Conscripts are always Inexperienced. The engine (`sk1.inexperienced.base`, `sk1/status.ts`) uses "Good Order SMC in the hex": a pinned leader counts (correct: pinned is unbroken), a broken one does not, Conscripts never exempt. Good Order also excludes Melee, so a Green MMC in Melee with an unbroken leader is Inexperienced where ASL says not: moot until CC uses Inexperience (19.34 CCV, 19.36 Lax). ELR Replacement (`applyElr`) is likewise applied only to units unbroken before the MC (A19.11/19.13). |
| A19.31 | MOVEMENT | ✅ | `rules/test/sw.test.ts` › a Green squad keeps 4 MF beside a pinned leader (still Good Order), but not a broken one |
| A19.32 | SW | ✅ | `rules/test/sw.test.ts` › a Green squad placing a DC fixes its X# at 9: non-elite -2 and Inexperienced -1 |
| A19.33 | COWERING | ✅ | `rules/test/fire.test.ts` › inexperienced cowering shifts two columns; original 12 on MC reduces and ELR-replaces |
| A19.34 | PAATC | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › take +1 on the PAATC (a 1PAATC); elite and other nationalities do not; `rules/test/asl/shared-fixes.test.ts` › a Conscript squad attacks a vehicle with CCV 4, not 5 (SK4 5.4). Inexperienced CCV −1 fixed (SK4 5.4 and A19.34 agree). |
| A19.35 | CAPTURE | ✗ |  |
| A19.36 | LAX | ◐ |  |

## A20 Prisoners

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A20.1 | VALUE | ✗ |  |
| A20.2 | CAPTURE | ✗ |  |
| A20.21 | RtPh | ✗ |  |
| A20.22 | CCPh | ✗ |  |
| A20.221 | (untitled) | ✗ | |
| A20.23 | MOPPING UP | ✗ | Mopping Up (prisoners). |
| A20.24 | (untitled) | ✗ |  |
| A20.3 | NO QUARTER | ✗ |  |
| A20.4 | MASSACRE | ✗ |  |
| A20.5 | GUARDS & UNARMED UNITS | ✗ |  |
| A20.51 | STACKING | ✗ |  |
| A20.52 | GUARD FP | ✗ |  |
| A20.53 | MOVEMENT | ✗ |  |
| A20.54 | ATTACK EFFECTS | ✗ |  |
| A20.55 | ESCAPE | ✗ |  |
| A20.551 | REARMING | ✗ |  |
| A20.552 | SCROUNGING | ✗ |  |

## A21 Captured Equipment

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A21.1 | POSSESSION | ✅ | `rules/test/crew.test.ts` › a weapon of any nationality the side fields is not captured; `rules/test/asl/verify-a17-a26.test.ts` › a captured MG has its B# lowered by two and its multiple ROF by one |
| A21.11 | MALFUNCTION | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › a captured MG has its B# lowered by two and its multiple ROF by one. The B#→X# part is A.11 (◐). |
| A21.12 | PERFORMANCE | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › a captured MG has its B# lowered by two and its multiple ROF by one |
| A21.13 | NON-QUALIFIED USE | ◐ | SMC using captured SW. |
| A21.2 | VEHICLE | ⏸ | Vehicle capture (Chapter D). |
| A21.21 | TEMPORARY DRIVER | ⏸ |  |
| A21.22 | TEMPORARY CREW | ⏸ |  |

## A22 Flamethrowers and Molotov Cocktails

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A22.1 | FP MODIFICATION | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › A22.1, A22.2: 24 FP never doubled for PBF, halved at two hexes; no TEM and no leadership DRM |
| A22.2 | DRM | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › A22.1, A22.2: 24 FP never doubled for PBF, halved at two hexes; no TEM and no leadership DRM |
| A22.3 | USAGE | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › A22.3, A22.5: removed on an original DR ≥ its X# 10, ≥ 8 for a non-elite user |
| A22.31 | FG | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › A22.31, A22.33: a FT combines with nothing, not even its possessor; a pinned unit cannot use it |
| A22.32 | LINE OF FIRE (LOF) | ◐ | FT line of fire and elevation. |
| A22.33 | RESTRICTIONS | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › A22.31, A22.33: a FT combines with nothing, not even its possessor; a pinned unit cannot use it |
| A22.34 | vs AFV | ◐ | PRC collateral. `rules/test/vehicleCc.test.ts` › a FT predesignating an AFV rolls on the HE & Flame table: TK 8 (+1 CE), below it the AFV burns; AF ignored |
| A22.35 | vs TERRAIN | ✗ | FT vs terrain (kindling). |
| A22.4 | VULNERABILITY | ✅ | `rules/test/fire.test.ts` › a target possessing a FT deducts one from the attack DR against it, and the result says so (SK1 4.2) |
| A22.5 | MALFUNCTION | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › A22.3, A22.5: removed on an original DR ≥ its X# 10, ≥ 8 for a non-elite user |
| A22.6 | MOLOTOV COCKTAILS (MOL) | ✗ |  |
| A22.61 | AVAILABILITY | ✗ |  |
| A22.611 | vs UNARMORED TARGETS | ✗ | MOL sub-rule. |
| A22.6111 | (untitled) | ✗ | MOL sub-rule. |
| A22.612 | vs ARMORED TARGETS | ✗ | MOL sub-rule. |
| A22.613 | vs TERRAIN | ✗ | MOL sub-rule. |
| A22.62 | LEADERSHIP | ✗ |  |

## A23 Demolition Charges

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A23.1 | (untitled) | ✅ | `rules/test/sw.test.ts` › the AFPh attack is a dud on an original DR of 10 against X# 9, and goes off on 8 |
| A23.2 | USAGE | ✅ | `rules/test/sw.test.ts` › a Green squad placing a DC fixes its X# at 9: non-elite -2 and Inexperienced -1 |
| A23.3 | PLACEMENT | ✅ | `rules/test/sw.test.ts` › a Green squad placing a DC fixes its X# at 9: non-elite -2 and Inexperienced -1 |
| A23.4 | DETONATION | ✅ | `rules/test/sw.test.ts` › the AFPh attack is a dud on an original DR of 10 against X# 9, and goes off on 8 |
| A23.41 | vs TERRAIN | ✗ | DC vs terrain: rubble, Breach. |
| A23.5 | vs AFV | ✅ | `rules/test/vehicleCc.test.ts` › a DC placed against an AFV needs a PAATC, then rolls its placement: ≤ 8 attacks the armor through the hexside it was placed from |
| A23.6 | THROWN DC | ✗ |  |
| A23.61 | (untitled) | ✗ |  |
| A23.62 | AFPh | ✗ |  |
| A23.63 | FINAL FIRE | ✗ |  |
| A23.7 | SET DEMOLITION | ✗ |  |
| A23.71 | (untitled) | ✗ |  |
| A23.72 | SET DC CLEARANCE | ✗ |  |

## A24 Smoke

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A24.1 | INFANTRY USAGE | ◐ | Grenade limits. `rules/test/movement.test.ts` › Smoke grenades: once per unit per MPh, so each squad of a moving stack may try (SK1 3.3) |
| A24.11 | (untitled) | ✅ | `rules/test/movement.test.ts` › Smoke grenades: once per unit per MPh, so each squad of a moving stack may try (SK1 3.3). ½" counter removed at the end of the MPh (`sk1.movement.end`). |
| A24.2 | EFFECT | ✅ | `rules/test/smokeLos.test.ts` › a LOS exactly along a hexside of a Smoke hex is hindered by it; `rules/test/asl/verify-a17-a26.test.ts` › entering a SMOKE hex costs one more MF; fire traced out of it is hindered one more than fire into it |
| A24.3 | WHITE PHOSPHORUS (WP) | ✗ |  |
| A24.31 | CASUALTIES | ◐ | `rules/test/ammo.test.ts` › WP: a full +2 counter in the PFPh and a NMC for the units hit, Air Burst +1 in woods |
| A24.32 | FIRES | ✗ | WP fires. |
| A24.4 | HEIGHT & DURATION | ◐ |  |
| A24.5 | STRENGTH | ✅ | `rules/test/ammo.test.ts` › a PFPh hit on the ATT places a full +3 ⅝" Smoke counter: no IFT attack, no acquisition, ROF spent; `rules/test/ammo.test.ts` › WP: a full +2 counter in the PFPh and a NMC for the units hit, Air Burst +1 in woods |
| A24.6 | WEATHER | ◐ |  |
| A24.61 | DRIFT | ✗ |  |
| A24.62 | GUSTS | ✗ |  |
| A24.7 | MOVEMENT | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › entering a SMOKE hex costs one more MF; fire traced out of it is hindered one more than fire into it |
| A24.8 | OUTGOING LOS HINDRANCES | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › entering a SMOKE hex costs one more MF; fire traced out of it is hindered one more than fire into it |

## A25 Nationality Distinctions

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A25.01 | ASSAULT ENGINEERS | ✗ |  |
| A25.1 | GERMAN | ✗ |  |
| A25.11 | SS | ✗ |  |
| A25.111 | LATE WAR SS | ✗ |  |
| A25.12 | COMBAT ENGINEERS | ✗ |  |
| A25.13 | VOLKSGRENADIER | ✗ |  |
| A25.2 | RUSSIAN | ✗ |  |
| A25.21 | ENTRENCHING | ✗ | Russian entrenching. |
| A25.211 | RUSSIAN SMG SQUADS | ✗ |  |
| A25.212 | RUSSIAN EARLY WAR DOCTRINE | ✗ |  |
| A25.22 | COMMISSAR | ◐ | Commissar by SSR. `rules/test/commissar.test.ts` › has the card’s morale 10 and leadership 0, no ELR; units stacked with it gain +1 morale |
| A25.221 | (untitled) | ◐ | `rules/test/commissar.test.ts` › has the card’s morale 10 and leadership 0, no ELR; units stacked with it gain +1 morale |
| A25.222 | RALLY | ◐ | `rules/test/commissar.test.ts` › rallies without the +4 DM DRM, at the raised morale; `rules/test/commissar.test.ts` › must attempt to rally every broken unit stacked with it: those left are rolled for as the side ends its RPh |
| A25.223 | BERSERK | ◐ |  |
| A25.224 | 8+1 COMMISSAR | ◐ |  |
| A25.23 | HUMAN WAVE (HW) | ✗ | Human Wave. |
| A25.231 | DIRECTION | ✗ | Human Wave. |
| A25.2311 | FORWARD AND SIDE LOCATIONS | ✗ | Human Wave. |
| A25.232 | MOVEMENT | ✗ | Human Wave. |
| A25.2321 | RANGE | ✗ | Human Wave. |
| A25.2322 | (untitled) | ✗ | Human Wave. |
| A25.233 | ENEMY UNITS | ✗ | Human Wave. |
| A25.234 | ENDING THE HUMAN WAVE | ✗ | Human Wave. |
| A25.24 | PARTISANS | ⏸ | Partisans: no counters. |
| A25.241 | MOVEMENT | ⏸ | Partisans: no counters. |
| A25.242 | (untitled) | ⏸ | Partisans: no counters. |
| A25.25 | NKVD MMC | ⏸ | NKVD: no counters. |
| A25.3 | AMERICAN | ◐ | American: parent of 25.31–25.35. |
| A25.31 | PARATROOPS | ✗ |  |
| A25.32 | ORDNANCE | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › uses the red To Hit numbers before 1944 and the black from 1944 |
| A25.33 | AMMUNITION | ⏸ | Chapter C. |
| A25.34 | SMOKE | ✗ |  |
| A25.35 | U.S.-BUILT, BRITISH-/FRENCH-COLOR | ⏸ | U.S.-built equipment colors (DYO/ordnance notes). |
| A25.4 | BRITISH | ✅ | Starter Kit scenario tests › SSR 1: British 1st Line squads do not cower, Americans do; SSR 2: a British leader directing Americans pays +1; `content/test/content.test.ts` › reads the British and Allied Minor infantry |
| A25.41 | GREEN | ✅ | `content/test/content.test.ts` › applies the SK2 Nationality Chart on top of SK1 |
| A25.42 | AIRBORNE | ✗ |  |
| A25.43 | GURKHA | ✗ |  |
| A25.44 | ANZAC | ✗ |  |
| A25.45 | COWERING | ◐ | Starter Kit scenario tests › SSR 3: Elite and 1st Line British MMC do not cower; German MMC do |
| A25.46 | WP | ✗ | British WP. |
| A25.5 | FRENCH | ⏸ | French: no counters. |
| A25.51 | GREEN | ⏸ | French: no counters. |
| A25.52 | ORDNANCE | ⏸ | French: no counters. |
| A25.53 | FREE FRENCH | ⏸ | French: no counters. |
| A25.54 | PRE-12/43 EQUIPMENT | ⏸ | French: no counters. |
| A25.55 | 12/43-5/45 EQUIPMENT | ⏸ | French: no counters. |
| A25.56 | FRENCH-BUILT EQUIPMENT | ⏸ | French: no counters. |
| A25.57 | DYO | ⏸ | French: no counters. |
| A25.58 | VICHY FRENCH | ⏸ | French: no counters. |
| A25.6 | ITALIAN | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › uses the red To Hit numbers |
| A25.61 | ELITE | ✅ | Starter Kit scenario tests › fields the card counters: Italian 3-4-6s with an HMG, an MMG and three LMG; American paratroopers; British 4-5-7s |
| A25.62 | 1ST LINE | ✅ | `content/test/content.test.ts` › applies the SK2 Nationality Chart on top of SK1 |
| A25.63 | SURRENDER | ✗ |  |
| A25.64 | LAX | ✗ |  |
| A25.65 | PAATC | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › take +1 on the PAATC (a 1PAATC); elite and other nationalities do not |
| A25.66 | ERITREAN | ⏸ | Eritreans: no counters. |
| A25.7 | FINNISH | ⏸ | Finns: no counters. |
| A25.71 | LEADERS | ⏸ | Finns: no counters. |
| A25.72 | BATTLE HARDENING | ⏸ | Finns: no counters. |
| A25.73 | SISSI | ⏸ | Finns: no counters. |
| A25.74 | 1ST LINE | ⏸ | Finns: no counters. |
| A25.75 | CAPTURED EQUIPMENT | ⏸ | Finns: no counters. |
| A25.76 | PANZERFAUST (PF) | ⏸ | Finns: no counters. |
| A25.77 | PANZERSCHRECK (PSK) | ⏸ | Finns: no counters. |
| A25.78 | OBA | ⏸ | Finns: no counters. |
| A25.79 | ORDNANCE | ⏸ | Finns: no counters. |
| A25.8 | AXIS MINORS | ⏸ | Axis Minors: no counters. |
| A25.81 | PAATC | ⏸ | Axis Minors: no counters. |
| A25.82 | ESCAPE | ⏸ | Axis Minors: no counters. |
| A25.83 | ORDNANCE | ⏸ | Axis Minors: no counters. |
| A25.84 | SMG SQUADS | ⏸ | Axis Minors: no counters. |
| A25.85 | PANZERFAUST (PF) | ⏸ | Axis Minors: no counters. |
| A25.86 | HUNGARIAN TROOPS | ⏸ | Axis Minors: no counters. |
| A25.87 | ROMANIAN ATMM | ⏸ | Axis Minors: no counters. |
| A25.9 | ALLIED MINORS | ✗ |  |
| A25.91 | PAATC | ✅ | `rules/test/asl/verify-a17-a26.test.ts` › take +1 on the PAATC (a 1PAATC); elite and other nationalities do not |
| A25.92 | (untitled) | ⏸ |  |
| A25.93 | ETHIOPIAN | ⏸ | Ethiopians: no counters. |
| A25.931 | ELITE | ⏸ | Ethiopians: no counters. |
| A25.932 | 1ST LINE | ⏸ | Ethiopians: no counters. |
| A25.933 | HUMAN WAVE | ⏸ | Ethiopians: no counters. |
| A25.934 | CC | ⏸ | Ethiopians: no counters. |
| A25.935 | TANK FLIP | ⏸ | Ethiopians: no counters. |
| A25.9351 | RESOLUTION | ⏸ | Ethiopians: no counters. |
| A25.936 | MMG/HMG/MTR | ⏸ | Ethiopians: no counters. |
| A25.937 | CAPTURED USE | ⏸ | Ethiopians: no counters. |
| A25.938 | NO QUARTER & LEADER CREATION | ⏸ | Ethiopians: no counters. |

## A26 Victory Conditions

| Rule | Name | Status | Evidence |
|---|---|---|---|
| A26.1 | CONTROL VICTORY CONDITIONS | ✅ | Starter Kit scenario tests › awards the Germans the win only when they Control all three buildings |
| A26.11 | GAINING CONTROL | ◐ | Initial Control. `rules/test/control.test.ts` › is taken the moment a Good Order MMC is alone in a hex: at setup, and mid-MPh as it moves |
| A26.12 | VEHICULAR CONTROL | ✅ | `rules/test/vehicleCc.test.ts` › an AFV Controls the hex it sits in while no Good Order enemy unit is there, and Control reverts when it leaves |
| A26.13 | HEX CONTROL | ✅ | `rules/test/control.test.ts` › a hex of a Controlled building is not a Controlled hex until entered; ground level only: `rules/test/asl/location.test.ts` › a MMC at level 1 takes the building and its Location, but not the hex (A26.13: ground level only) |
| A26.131 | BRIDGE HEX | ⏸ | Bridge hex: no water yet. |
| A26.132 | PILLBOX HEX | ✗ | Pillbox hex. |
| A26.14 | BUILDING CONTROL | ✅ | `rules/test/control.test.ts` › a controlBuildings condition shows and counts the whole building |
| A26.15 | CONCEALMENT | ✗ |  |
| A26.16 | CONTROL FORFEITURE | ✗ | Control forfeiture by Fire. |
| A26.161 | (untitled) | ✗ | |
| A26.162 | (untitled) | ✗ | |
| A26.2 | VICTORY POINTS | ✅ | `rules/test/casualties.test.ts` › records each loss with its CVP: squads 2, half-squads 1, leaders 1 plus negative modifiers, reductions 1; SW nothing |
| A26.21 | VICTORY POINT VALUE | ✅ | Starter Kit scenario tests › the Americans exit off the south edge between F0-L0 for 7 VP at the card’s scale: squad 2, HS 1, 9-2 3, 9-1 and 8-1 2, 7-0 1 |
| A26.211 | INFANTRY & PRC | ✅ | Starter Kit scenario tests › the Americans exit off the south edge between F0-L0 for 7 VP at the card’s scale: squad 2, HS 1, 9-2 3, 9-1 and 8-1 2, 7-0 1; `rules/test/casualties.test.ts` › records each loss with its CVP: squads 2, half-squads 1, leaders 1 plus negative modifiers, reductions 1; SW nothing |
| A26.212 | VEHICLES & EQUIPMENT | ◐ | Gun CVP. |
| A26.213 | (untitled) | ◐ | Inherent crews/Gun VP: unverified, review with 26.212. |
| A26.22 | CASUALTY VICTORY POINTS | ✅ | `rules/test/casualties.test.ts` › records each loss with its CVP: squads 2, half-squads 1, leaders 1 plus negative modifiers, reductions 1; SW nothing |
| A26.221 | (untitled) | ✅ | `rules/test/casualties.test.ts` › records each loss with its CVP: squads 2, half-squads 1, leaders 1 plus negative modifiers, reductions 1; SW nothing; `rules/test/casualties.test.ts` › reads the CVP thresholds out of composite victory conditions, keyed by the side amassing them |
| A26.222 | CAPTURE | ✗ |  |
| A26.23 | EXIT VICTORY CONDITIONS | ◐ | Exit VP for captured units. |
| A26.3 | AVOIDANCE | ✅ | Starter Kit scenario tests › awards the Americans the win unless a Good Order German holds a VC building |
| A26.4 | BALANCE | ✅ | Starter Kit scenario tests › applies balance options |

## Chapter B: board-u terrain

The Chapter B rules for the terrain on board u (B1, B3, B10, B12, B13, B14, B23). Rules for terrain
that is not on board u, or that only an SSR brings, are ⏸. These rows are not in the Chapter A totals above.

| Rule | Name | Status | Evidence |
|---|---|---|---|
| B1.1 | (untitled) | ✅ | `rules/test/asl/terrain.test.ts` › Open Ground and bare hill are Open Ground; brush, orchard and woods are not; TEM 0, 0, 0, +1 |
| B1.11 | ROADS | ✅ | `rules/test/movement.test.ts` › road bonus: earned only by road steps, and never spent on Smoke |
| B1.12 | RUNWAY | ⏸ | No runway on board u. |
| B1.13 | SHELLHOLES | ⏸ | No shellholes on board u (S35's SSR shellholes are their own terrain). |
| B1.14 | HILLS | ✅ | `rules/test/asl/terrain.test.ts` › a unit that crossed the Crest Line through the hexside the LOS crosses gets no Height Advantage and is subject to FFMO |
| B1.15 | BRIDGES | ⏸ | No bridge on boards t–z. |
| B1.16 | HEXSIDES | ⏸ | No hexside terrain on board u. |
| B1.17 | ARTIFICIAL TERRAIN | ✅ | A Hindrance negates FFMO (`sk1/fire.ts` `ffmoApplies`); wrecks and AFV: `sk3/wrecks.ts`. No vehicles on the test bed. |
| B1.2 | (untitled) | ✅ | `content/test/orchardRoad.test.ts` › a ground LOS down the J5-J7 road is not hindered by its Orchard-Road hexes |
| B1.3 | (untitled) | ✅ | `rules/test/asl/terrain.test.ts` › Open Ground and bare hill are Open Ground; brush, orchard and woods are not; TEM 0, 0, 0, +1 |
| B3.1 | (untitled) | ✅ | Paved and dirt road both cost Infantry one MF and a vehicle ½ MP (B3.4, B3.41); no hex of board u has both. |
| B3.2 | (untitled) | ✅ | `content/test/orchardRoad.test.ts` › a ground LOS down the J5-J7 road is not hindered by its Orchard-Road hexes |
| B3.3 | (untitled) | ✅ | `rules/test/woodsRoad.test.ts`, `rules/test/orchardRoad.test.ts`; A4.132's second target point: `rules/test/asl/bypass.test.ts` › the road point |
| B3.4 | (untitled) | ✅ | `rules/test/asl/terrain.test.ts` › a leader with a squad Double Timing along the J road enters nine road hexes: eight MF and the road bonus. Mines, Wire, roadblocks and Searching are missing. |
| B3.41 | (untitled) | ✅ | Vehicles (SK4 1.1.1): `sk3/vehicleMove.ts` `vehicleEntryCost`. No vehicles on the test bed. |
| B3.42 | (untitled) | ✅ | Vehicles: `vehicleEntryCost` (+2 MP per vehicle or wreck along the road). |
| B3.43 | ROAD-NEGATING TERRAIN | ✅ | `rules/test/woodsRoad.test.ts` › Infantry entering along the road choose the road or the woods; `rules/test/orchardRoad.test.ts` › Infantry entering along the road choose the road or the orchard, both at one MF; the orchard forfeits the road bonus (shared) |
| B3.5 | (untitled) | ✗ | No hidden mines or entrenchments in a paved road hex: missing with the fortifications. |
| B10.1 | (untitled) | ✅ | `content/test/losHeights.test.ts` › a Single Story House on the hill is a level 2 obstacle between them (B10.1, B23.2) |
| B10.11 | CREST LINE | ✅ | `rules/test/elevation.test.ts` › doubles the cost of terrain entered across a Crest Line uphill, not downhill |
| B10.2 | DIFFERENT LEVEL LOS | ✅ | `rules/test/asl/los-heights.test.ts` › hill ground is an obstacle of its level: a ridge between two ground hexes blocks; hill ends see across it and across a valley (B10.2, B10.21) |
| B10.21 | SAME LEVEL LOS | ✅ | `content/test/losHeights.test.ts` › level 1 of G2 sees the hill hexes its ground floor cannot (B10.21: level 1 over level 1 hill ground) |
| B10.211 | ALPINE HILL OPTION | ⏸ | Optional, SSR only. |
| B10.22 | (untitled) | ✅ | `rules/test/asl/los.test.ts` › level 1 sees over ground-level woods to level 1 beyond, not to the ground beyond |
| B10.23 | BLIND HEXES | ✅ | `rules/test/asl/los-heights.test.ts` › B10.23 EX (C), (D), (E): Crest Line Blind Hexes |
| B10.3 | (untitled) | ✅ | `rules/test/asl/terrain.test.ts` › Open Ground and bare hill are Open Ground; brush, orchard and woods are not; TEM 0, 0, 0, +1 |
| B10.31 | HEIGHT ADVANTAGE | ✅ | `rules/test/asl/terrain.test.ts` › a unit that crossed the Crest Line through the hexside the LOS crosses gets no Height Advantage and is subject to FFMO; `rules/test/asl/los.test.ts` › Height Advantage compares Location heights (B10.31): level 1 of a ground-level house is not lower than a level 1 hill hex |
| B10.4 | (untitled) | ✅ | `rules/test/elevation.test.ts` › doubles the cost of terrain entered across a Crest Line uphill, not downhill; vehicles: `vehicleEntryCost` |
| B10.5 | ABRUPT ELEVATION CHANGES | ⏸ | No two-level change across a hexside on boards t–z. |
| B10.51 | (untitled) | ⏸ | As B10.5. |
| B10.52 | DOUBLE-CRESTS | ⏸ | As B10.5. |
| B12.1 | (untitled) | ✅ | `content/test/terrainU.test.ts` › has open ground, woods, brush, orchards, stone and wooden buildings, and nothing else |
| B12.2 | (untitled) | ✅ | `rules/test/asl/los-heights.test.ts` › Hindrances count only between same-level ends at their level (A6.7, B12.2, B15.2) |
| B12.3 | (untitled) | ✅ | `rules/test/asl/terrain.test.ts` › Open Ground and bare hill are Open Ground; brush, orchard and woods are not; TEM 0, 0, 0, +1 |
| B12.4 | (untitled) | ✅ | `rules/test/asl/terrain.test.ts` › Open Ground and bare hill are Open Ground; brush, orchard and woods are not; TEM 0, 0, 0, +1 |
| B12.5 | (untitled) | ✗ | Kindling. |
| B12.6 | (untitled) | ⏸ | Deep Snow: no such weather in the engine. |
| B12.7 | VINEYARD | ⏸ | SSR only. |
| B13.1 | (untitled) | ✅ | `content/test/terrainU.test.ts` › has open ground, woods, brush, orchards, stone and wooden buildings, and nothing else |
| B13.2 | (untitled) | ✅ | `rules/test/asl/los.test.ts` › level 1 sees over ground-level woods to level 1 beyond, not to the ground beyond |
| B13.3 | AIR BURSTS | ✅ | `rules/test/lightMortar.test.ts` › To Hit Example #2: the 50mm Mortar fires on the ATT at range 2, Air Burst in woods; the squad keeps its own FP. "EXC vs Bypass": `rules/test/asl/bypass.test.ts` › fired at a corner: no building TEM (the woods rule is the same `asl.bypass.no-tem`); Indirect Fire keeps the Air Burst (no mortar on the test bed). |
| B13.31 | (untitled) | ✅ | `rules/test/woodsRoad.test.ts` › keeps the woods TEM, and is not in Open Ground, against a LOS that crosses a woods symbol in the hex; `content/test/terrainU.test.ts` › a LOS down the dirt road into DD4 does not cross its woods; one from the side does |
| B13.32 | (untitled) | ⏸ | Vehicular OVR (Chapter D). |
| B13.4 | (untitled) | ✅ | `rules/test/woodsRoad.test.ts` › Infantry entering along the road choose the road or the woods |
| B13.41 | VEHICLES | ✅ | `rules/test/vehicleMove.test.ts` › entering woods at half its MP takes a Bog Check: +1 ground pressure +3 half MP, bogs on 12 and stops there |
| B13.42 | FULLY-TRACKED | ✅ | `rules/test/vehicleMove.test.ts` › a Fully Tracked vehicle may enter woods with all its MP instead: no +3, only +1 ground pressure (SK4 1.1.1 and its Bog example; tester report) |
| B13.421 | TRAIL BREAK | ⏸ | Chapter D. |
| B13.4211 | (untitled) | ⏸ | Chapter D. |
| B13.4212 | (untitled) | ⏸ | Chapter D. |
| B13.43 | AFV RIDERS | ⏸ | Chapter D. |
| B13.5 | (untitled) | ✗ | Kindling. |
| B13.6 | PATHS | ⏸ | No paths on board u. |
| B13.7 | FOREST | ⏸ | SSR only. |
| B13.8 | PINE WOODS | ⏸ | SSR only. |
| B13.81 | OBSTACLE HEIGHT | ⏸ | SSR only. |
| B13.82 | MF COST | ⏸ | SSR only. |
| B14.1 | (untitled) | ✅ | `rules/test/asl/los-heights.test.ts` › B14.2: an orchard is a same-level +1; between a higher Location and its base an obstacle in season, else +1 |
| B14.2 | SEASONS | ✅ | `content/test/losHeights.test.ts` › an orchard in season blocks level 1 looking down past it to the ground, out of season it hinders (B14.2) |
| B14.21 | SAME LEVEL HINDRANCE | ✅ | `rules/test/orchardRoad.test.ts` › a LOS along the road through Orchard-Road hexes is not hindered; one across them is |
| B14.3 | (untitled) | ✅ | `rules/test/asl/terrain.test.ts` › Open Ground and bare hill are Open Ground; brush, orchard and woods are not; TEM 0, 0, 0, +1 |
| B14.4 | (untitled) | ✅ | `rules/test/asl/terrain.test.ts` › Open Ground and bare hill are Open Ground; brush, orchard and woods are not; TEM 0, 0, 0, +1 |
| B14.5 | (untitled) | ✗ | Kindling. |
| B14.6 | ORCHARD ROAD | ✅ | Shared fix (SK4 1.1.1 the same). `content/test/orchardRoad.test.ts` › a ground LOS down the J5-J7 road is not hindered by its Orchard-Road hexes; `content/test/orchardRoad.test.ts` › from level 1 of M7, in season, the ground along the K8-J8 road is in view: the road lifts the obstacle too; `rules/test/orchardRoad.test.ts` › on the road: FFMO against a firer whose LOS stays on the road; not from the side, nor once in the orchard. |
| B14.7 | CACTUS PATCH | ⏸ | SSR only. |
| B14.8 | OLIVE GROVE | ⏸ | SSR only. |
| B23.1 | (untitled) | ✅ | `content/test/buildingLevels.test.ts` › lists every building of every board, with the same hexes as the import |
| B23.2 | (untitled) | ✅ | `content/test/losHeights.test.ts` › level 1 to level 1 sees over Single Story Houses between (B23.2); the ground floors do not |
| B23.21 | SINGLE STORY HOUSE | ✅ | `rules/test/asl/levels.test.ts` › a single-hex building and open ground have no level to climb to |
| B23.211 | LUMBERYARD | ⏸ | None on boards t–z. |
| B23.22 | TWO STORY HOUSE | ✅ | `content/test/buildingLevels.test.ts` › board u: the 17 hexes of its eight Two Story Houses have level 1 and an inherent stairwell; `content/test/losHeights.test.ts` › level 1 to level 1 across another Two Story House is blocked: 1½ levels (B23.22) |
| B23.23 | MULTI-STORY BUILDING | ⏸ | None on boards t–z (the printed-stairwell path is in `asl/locations.ts`). |
| B23.24 | THIRD LEVEL STRUCTURES | ⏸ | SSR only. |
| B23.25 | ADJACENT BUILDING HEXES | ✅ | `rules/test/asl/levels.test.ts` › no LOS between non-ADJACENT Locations of one building next to each other (B23.25) |
| B23.26 | STAIRWELL | ✅ | Only two levels on boards t–z: every attack up or down a stairwell is to the next level. |
| B23.3 | (untitled) | ✅ | `rules/test/asl/verify-a1-a6.test.ts` › Infantry pay 1 MF into Open Ground and 2 MF into woods or a building; TEM +3 stone, +2 wood (`sk1/data/terrain.ts`). |
| B23.31 | (untitled) | ✅ | The target building's TEM whatever the firer's (`sk1.drm.tem`); no building TEM vs a unit in Bypass except Residual FP: `rules/test/asl/bypass.test.ts` › fired at a corner: no building TEM; Residual FP left by fire at the Bypass attacks it again with the building TEM (A8.2, note 12) |
| B23.32 | INDIRECT FIRE | ✅ | `rules/test/asl/levels.test.ts` › a mortar hit on a Two Story House hex attacks both levels with one DR, +1 at the ground for the level above |
| B23.4 | (untitled) | ✅ | `rules/test/asl/levels.test.ts` › up the inherent stairwell costs one MF and puts the stack at level 1 |
| B23.41 | CELLARS | ⏸ | SK4's tracked BU AFV building entry is in `vehicleEntryCost`; rubble and cellars: Chapter D. |
| B23.42 | (untitled) | ✅ | Stacking per level: `rules/test/asl/location.test.ts`. |
| B23.421 | UPPER LEVELS | ✅ | `rules/test/asl/levels.test.ts` › level 1 to level 1 of the next hex of the building costs the building's two MF (B23.421) |
| B23.422 | (untitled) | ✅ | `rules/test/asl/levels.test.ts` › a unit may advance one level up in its own hex, but not up into another hex |
| B23.423 | GUNS | ✅ | Guns and vehicles never go upstairs (`asl/levels.ts`); `rules/test/lightMortar.test.ts` › may not fire from a building, nor in the AFPh after its possessor moved |
| B23.424 | SCALING | ⏸ | Commandos by SSR only. |
| B23.5 | (untitled) | ✗ | Fortifications in a building hex. |
| B23.6 | (untitled) | ✗ | Kindling. |
| B23.7 | SPECIAL BUILDING TYPES | ⏸ | None on boards t–z (B23.71–B23.743). |
| B23.8 | ROOFTOPS | ⏸ | SSR only (B23.81–B23.88). |
| B23.9 | FORTIFIED BUILDINGS | ◐ | Fortified on every level; per-Location B23.91–B23.94 missing. |
