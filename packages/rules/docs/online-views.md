# Online play: per-viewer views

Decided 2026-11-08, before Concealment (SK4 8.3) is built on it.

## Why
Until now both clients replayed an online match's full action log from a shared seed. Hidden information (HIP
Guns, secret designations, soon concealed stacks) was hidden only by the screen, and the dice could be
foreseen from the seed. Open ASL's promise is enforcement, not an honour system.

## Model
- The server keeps the recording (`matches/{id}/actions`, closed to clients while the match is open or active) and
  the seed (`matches/{id}/private/game`, never readable). A finished match gets its seed written back onto the
  document and its recording opens (replays, after action reports).
- After every action the server writes each **viewer** (each side, and `public` when the match is public):
  - `views/{viewer}`: the position as `redactState(engine, state, side)` shows it, JSON in `json`;
  - `views/{viewer}/steps/{seq}`: the action's events as `Engine.redactTransition` makes them safe for that viewer
    (`json`), one per real event, same `seq`; step 0 holds the game's creation events.
- `submitAction` returns the caller's own step (`stateJson`, `eventsJson`), so the board moves in one round trip.
- Clients (`apps/web/src/game/onlineSession.ts`) replay nothing and roll nothing: the snapshot is the state,
  the steps are the log, `engine.validate` on the snapshot gives instant refusals, the server is authoritative.
- An allowed undo deletes the step of the action taken back and rewrites every snapshot (`rewindViews`).
- Matches created before this (`model` absent) keep the open-recording path (`onlineSessionLegacy.ts`) until
  a migration has moved every live one; then the legacy hook goes.

## Redaction (`packages/rules/src/sk1/known.ts`)
`redactState` = the pieces `piece.visibleTo` allows (plus whatever a hidden piece hides behind: weapons it holds),
a stand-in where a hidden piece offers one (`piece.standIn`, the "?" of a concealed stack: def `?`, kind
`unknown`), each module's secret `ext` slice as its redactor shows it (`RuleBuilder.redact`: fortified buildings,
secret length, secret entry turns, entry groups, scatter plans), pending decisions with hidden ids removed, a fixed
dice generator, and a last-line scrub of any surviving hidden piece id (ids name their counter). The computer
opponent plays from the same function.

## Invariants (tested)
- `fold(redact(S_i), redactedEvents) ≡ redact(S_j)` for every prefix, viewer and playable scenario
  (`packages/content/test/redact.test.ts`, `packages/engine/test/view.test.ts`, `functions/test/views.test.ts`).
- No id of a piece hidden before and after an action, and no unrevealed secret, reaches that viewer's snapshot or
  stream.
- `legalActions` on a redacted state never throws.

## Operations
- Rules: `firestore.rules` (`actions` closed while live for online matches, `views/{viewer}` per seat or public,
  `private/**` closed). `submitAction` runs with `minInstances: 1`: every move now waits for the function.
- Migration: an admin script replays each live legacy online match into views.
