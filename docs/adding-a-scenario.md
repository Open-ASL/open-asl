# Adding a scenario

This guide walks you through adding a Starter Kit scenario card to Open ASL by hand: the data file, the
tests, and checking it in the running app. The free scenarios already in the repository are the best
models: `packages/content/src/scenarios/skFree.ts` (the free download cards) and
`packages/content/src/scenarios/lma/` (one file per card).

Before you start, set up the project with the [getting started guide](getting-started.md) and read
[CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. Check that the card may be added

- **Only free cards.** A scenario goes in only if its author has released it for free distribution. Link that
  permission in your pull request (CONTRIBUTING, rule 1). Cards from products that are sold cannot be added.
- **The card's words, exactly.** History, aftermath, victory conditions, SSRs, balance, setup lines, credits
  and notes are reproduced word for word. Never summarise, paraphrase or fill a gap with your own words. If a
  provision is unclear, ask in an issue rather than guess.
- **No images in the repository.** The card's photograph never goes in a commit. If you want it shown in your
  own build, put it in `assets-local/scenarios/<id>.jpg` (git ignores that folder) and set
  `photo: { src: 'scenarios/<id>.jpg' }`.

## 2. Create the scenario file

1. Copy a similar card as a template, for example `packages/content/src/scenarios/lma/lma4.ts`, into a new
   file for your card.
2. It exports one `ScenarioDef`. The type, with every field documented, is in
   `packages/rules/src/common/statics.ts`.
3. Add it to its series list (for example `LMA_SCENARIOS` in `scenarios/lma.ts`). The series lists are
   joined into `ALL_SCENARIOS` in `packages/content/src/catalog.ts`.
4. A new series also needs its product in `packages/content/src/products.ts`.

## 3. Encode the card

### Identity

`id` (lower case, e.g. `lma-11`), `product`, `number` (as printed), `title`, `designer`, `credit`, `place`,
`date`, `history`, `aftermath`, `notes`. Set `month` (1–12): it decides the season and the dates of weapons
such as the Panzerfaust.

### Boards

- `boards: [{ board, position, rotation?, columns? }]`.
- The board's letter is printed beside hex A10, and where it sits on the card's map tells you how the board
  lies:
  - bottom left: upright;
  - top right: turned 180° (`rotation: 180`);
  - bottom right or top left: turned 90°.
- Set `compass` so the card's north arrow maps to the board's edges, e.g. `{ N: 'W', E: 'N', S: 'E', W: 'S' }`.
  The existing cards show every layout used so far, including two and three boards side by side.
- The red area on the card is the playable area. `columns: ['A', 'P']` cuts a board to those hexrows.

### Turns and sides

- `turns` is the number in the last box of the Turn Record Chart. If that box is slashed, add
  `halfFinalTurn: true`.
- The side that "Moves First" is `firstSide`. The side that "Sets Up First" gets `setupFirst: true`.
- `sides: [{ side, name, nationality, elr }]`. A side fielding two counter sets lists both in
  `nationalities`, and `nationalityNames` names them the card's way.

### Forces

- `forces: [{ id, group, side, units: [{ def, count, withSw }], setup }]`.
- Counter ids are in `packages/content/src/counters.ts`: squads like `ge.467` or `am.747`, leaders like
  `ru.L92`, SW like `ge.MMG`, vehicles like `ge.pzivh`.
- Every counter must already exist with its art. `packages/content/test/counterArt.test.ts` fails on any that
  does not. A counter the game lacks needs its own pull request first; open an issue.

### Setup areas

- `setup: { kind: 'area', description, hexes }`. `description` is the card's own line; `hexes` is the
  engine's reading of it.
- Build `hexes` with the helpers in `packages/content/src/scenarios/areas.ts`:
  - `hexesWhere(board, { rows, numbered, terrain, elevation })`, e.g. "hexes numbered ≤ 2" is
    `numbered: [0, 2]`, and "east of hexrow R" is `rows: ['R', 'GG']`;
  - `buildingAt`, `buildingHexesOf`, `buildingHexesWithin`, `edgeHexesWhere`, `hexesWithin`.
- Units entering during play use `{ kind: 'enter', turn, edge }`.
- Provisos on where units may stand ("not adjacent to another Gun") are `constraints` on the area; see
  `statics.ts` for the kinds.
- Check the result against the printed board: count the hexes.

### Victory conditions

- `victoryText` is the card's text, verbatim.
- `victory` is the engine's reading. The kinds are listed in `statics.ts`: `controlBuildings`,
  `controlHexes`, `exitVp`, `eliminateCvp`, `noGoodOrderEnemyIn`, `vpTally`, `all` / `any`, and more.
- **Timing.** A condition is judged at game end unless the card says "win **immediately**". Only then set
  `immediate: true`. A test fails if the flag and the word disagree. "At the end of Game Turn 4" is
  `atEndOfTurn: 4`.

### SSRs

- Each SSR is `{ module, params, text }`, with the card's text verbatim.
- The available modules are registered in `packages/content/src/ssr.ts` (`SSR_MODULES`). Search the existing
  cards for a module's name to see its params in use.
- If the engine cannot enforce a provision, use `{ module: 'text', text }` and add a note to `notes` that
  starts "Engine note:" and says what is not enforced.

### Balance

One entry per side, its text verbatim. The ops include `addUnits`, `removeUnits`, `swapUnits`, `addSw`,
`removeSw`, `setTurns`, `removeSsr` and `setVictoryAtLeast` (all in `statics.ts`). Use `unavailable: 'why'`
when the engine cannot offer it.

### Weather

Every game has clear weather, dry ground and a mild breeze from the west unless the card says otherwise:
`weather: { sky, ground, wind: { from, force } }`.

## 4. Write the tests

- In `packages/content/test/content.test.ts`, add a `describe` for the card that checks:
  - the setup areas (the hex count, a hex inside and one outside);
  - the victory reading and its timing (the game does not end early unless the card says "immediately");
  - each SSR's effect;
  - each balance option.
- Add the id to the playable list in `packages/content/test/scenarios.test.ts`. That test plays the card
  through at random, to a result, at every turn boundary.
- A card with vehicles also goes in `content.test.ts`'s `withVehicles` list.
- Run `pnpm typecheck && pnpm test`. Read the output for `error` and `Failed`, not just the last line.

## 5. Check it in the app

1. Start the app with `pnpm dev` and the emulators, as in the getting started guide. Create a hotseat game of
   your card.
2. Open the **Briefing** and read its **"As enforced by the engine"** line beside the card, word for word. It
   must not add a condition, a timing or an exception the card does not have.
3. Play the setup for both sides: each side may place only in its own area, and the default placement is
   legal.
4. Play a few turns: entry and reinforcements arrive on the right turn and edge, and every SSR you encoded
   shows up in play.

## 6. If the card needs a rule the engine does not have

- Never write one-off code for one card. A new SSR becomes a general rules module in `packages/rules/src/`,
  registered in `SSR_MODULES`, with its own tests. Send it as its own pull request first, citing the rule.
- Its interface appears only in scenarios that list the SSR. Test it from the action through into the next
  Player Turn.
- Until it is built, keep the card's text with the `text` module and an "Engine note:".

## 7. Open the pull request

- Sign off every commit (`git commit -s`).
- In the description, say what you tested in the app, and link the card's free-distribution permission.
- Name any provision the engine does not enforce.
