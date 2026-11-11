# Contributing to Open ASL

Thank you for helping. Open ASL is a community project, and bug reports, rules fixes, tests, features and
new free scenarios are all welcome. This page sets out how to contribute and the rules every contribution
follows. Please read it before opening a pull request.

## Ways to help

- **Report a bug.** Open an issue with the scenario, the turn and phase, what you did, what happened and
  what the rules say should happen (with the rule number). A screenshot or the game's log helps a lot.
- **Fix a rule.** Cite the rule (for example *SK1 3.2.3* or *ASLRB A8.31*) in the issue, the test and the
  pull request.
- **Add a feature.** For anything larger than a small fix, open an issue first so we can agree on the
  approach before you spend time on it.
- **Add a scenario.** Only scenarios whose authors have released them for free distribution, with
  their permission; see [rule 1](#1-no-copyrighted-commercial-material).

## Getting set up

Follow the [getting started guide](docs/getting-started.md). In short: Node 22+, pnpm 10, Java 21+, then
`pnpm install` and `pnpm dev`.

## The rules for every contribution

### 1. No copyrighted commercial material

Open ASL exists because it respects the people who make ASL. Pull requests must not contain, and must not
be built from:

- scans, photographs or traces of commercial map boards, counters, overlays or charts;
- scenario cards, or scenario data, from any product that is sold, unless the copyright holder has
  released it for free distribution (say so, with a link, in the pull request);
- rulebook text, Q&A text or chart text copied word for word. Implement the rule in your own words and
  cite its number;
- tools whose purpose is to bring any of the above into the app.

Contributions that break this rule are closed, and their history removed.

### 2. No AI slop

AI-assisted code is welcome. Unreviewed AI output is not. If you submit it, you own it:

- you have **run it** and **tested it** yourself, in the running app as well as in the unit tests;
- you **understand it**: you can explain every change and why it is right, and answer review questions
  without asking the AI;
- you have checked it against the rules text, not against what the AI said the rules are;
- the pull request description is written by you and says what you tested.

Pull requests that are clearly unreviewed (invented rule numbers, dead code, tests that test nothing,
unrelated churn) are closed.

### 3. Keep the look and feel

Open ASL has a deliberate visual identity: the palette, the type, the counters, the board, the wheels and
the panels. Please:

- make **no material changes to the branding or the UI's style, look or feel** (logo, colours, fonts,
  layout language) without agreement in an issue first;
- make new UI **follow the existing design**: reuse the existing components, CSS classes and tokens in
  `apps/web/src/styles.css`, and match the tone of the existing copy;
- include **before and after screenshots** in any pull request that changes what players see.

### 4. Quality

- `pnpm typecheck` and `pnpm test` pass.
- Rules changes come with tests that cite the rule. A test should play on past the moment it checks: the
  units involved can still move, fire and be attacked next turn, and any marker the change sets comes off.
- If the change adds something a player chooses, the player can reach it in the UI, and a disabled option
  says why.
- Code reads like the code around it: same naming, same idioms, comments that explain *why*.
- One topic per pull request. Small pull requests are reviewed faster.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests.
3. Write commit messages in the [Conventional Commits](https://www.conventionalcommits.org) style, scoped to
   the package: `fix(rules): a leader's DRM never applies to his own FPF check (A8.31)`.
4. **Sign off every commit** (see below): `git commit -s`.
5. Open the pull request, fill in the template, and say how you tested it.

A maintainer reviews every pull request. Expect questions; they are not a judgement on you. Accepted pull
requests are squash-merged.

## Contributor terms

By opening a pull request you agree to the following.

1. **Developer Certificate of Origin.** You certify the [Developer Certificate of Origin 1.1](https://developercertificate.org):
   the contribution is your own work, or you have the right to submit it under the project's licence. You
   show this by signing off each commit (`Signed-off-by: Your Name <you@example.com>`, added by
   `git commit -s`).
2. **Licence.** Your contribution is licensed to everyone under the project's licence (the GNU AGPL 3.0
   with the Commons Clause; see `LICENSE`).
3. **The maintainer's site.** You also grant the project maintainer a perpetual, worldwide, royalty-free
   licence to use, modify and run your contribution in the maintainer's own deployment of Open ASL,
   alongside components that are not published (such as the computer opponent),
   without those components becoming subject to the project's licence.
4. **The maintainer's commitment.** In return, the maintainer commits that every contribution, and every
   later change made to it, is published in this public repository. A contribution is never taken private.

## Code of conduct

Everyone taking part follows the [Code of Conduct](CODE_OF_CONDUCT.md). Be kind; we are all here because we
love the game.

## Security

Please do not report security problems in public issues. See [SECURITY.md](SECURITY.md).
