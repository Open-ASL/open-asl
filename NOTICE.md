# Notices

Open ASL is distributed under the GNU Affero General Public License, version 3, with the Commons
Clause condition (see `LICENSE`), except for the files listed below, which keep their own licences.
Credits for the people whose work Open ASL builds on are in `CREDITS.md`.

| Where | Licence |
| --- | --- |
| `apps/web/art/counters/`, `apps/web/art/markers/`, `tools/counter-art/art/` | GNU LGPL 2.1 (`LICENSES/LGPL-2.1.txt`), derived from VASL |
| `packages/content/src/generated/` | GNU LGPL 2.1 (`LICENSES/LGPL-2.1.txt`), derived from VASL |
| `apps/web/art/boards/*.webp` | Neal Ulen's high-resolution board art, redistributed with his permission (see below) |
| `functions/fonts/*.ttf` | SIL Open Font License 1.1 (the `*_OFL.txt` file beside each font) |
| `apps/web/src/audio/sounds/` | CC0 1.0 (`apps/web/src/audio/sounds/CREDITS.md`) |

## Material derived from VASL

VASL (Virtual Advanced Squad Leader, https://github.com/vasl-developers/vasl) is distributed
by its developers under the GNU Lesser General Public License, version 2.1. The following
parts of this repository are derived from it and are redistributed under the same license:

| Where | What | Derived from |
| --- | --- | --- |
| `apps/web/art/counters/` | Counter art, rendered to WebP | SVG and GIF counter images in the VASL 6.7.3 module (`dist/images/` in the VASL repository), rasterised with the module's own fonts |
| `apps/web/art/markers/` | Marker art, rendered to WebP | The same |
| `packages/content/src/generated/los-*.ts` | Per-pixel terrain rasters for line of sight, boards m, n, o and t–z | Each board's `LOSData` in `boards/bdFiles/` of the VASL repository, authors as recorded in each board's `BoardMetadata.xml` |
| `packages/content/src/generated/boards.json` | Per-hex terrain, road hexsides, building groupings | Derived from the same `LOSData` |
| `packages/content/src/generated/counters.json`, `assets.json` | Counter definitions and the art manifest | The module's `buildFile` and counter metadata |

The conversion is done by `tools/vasl-import` in this repository, so the modified form can be
regenerated from the VASL sources. The VASL version is recorded in `assets.json`.

Some counters (the German ones first) are re-rendered at a higher resolution with new full-colour
pictures in place of VASL's silhouettes. The numbers, symbols and layout are still VASL's SVGs,
unchanged; the pictures are new, made for this project with an image model, and released under the
same licence. Their sources are in `tools/counter-art/art/`.

The VASL boards are original artwork drawn by their VASL authors as recreations of the
published game boards; they are not scans. The counter art likewise reproduces the published
counter designs as the VASL artists drew them.

### VASL credits

The VASL module's `Credits.txt`, reproduced as required:

> VASL and the VASSAL engine were written by Rodney Kinney (vasl@vasl.org), but
> they are far from the work of one man. New counter artwork in version 5 was
> contributed by Kenn Monte, Ken Knudsen, Jeff Leslie, Eric Givler, and Zoltan
> Grose. Counter redesign was done by Jeffrey Malter. Tom Repetti contributed
> map work, terrain design, and overall moral support. David Sullivan has allowed
> use of his Java libraries for computing LOS. David Lake (www.lakewebworks.com)
> designed the VASL web site. Thanks to counter trolls Klaus Fischer, Scott Brady,
> Sam Tyson, Brad Hampson, and Carl Fung. Thanks to map gnomes Tim Fachko, Gordon
> Molek, Carl Pfeiffer, and Bruce Mansfield. Thanks to Gary Krockover for the
> TurnPhase indicator, and to Ole Bøe for permission to use his IIFT(M)QRDC.
> GameSquad users 'General Mayhem' and 'wlk' contributed code for VASL 5.9.
>
> Finally, thanks to Multi-Man Publishing for their selfless support
> of the ASL hobby, and their continued indulgence of VASL.

## High-resolution board art

`apps/web/art/boards/<letter>.webp` for boards m, n, o, t, u, v, w, x, y and z are Neal Ulen's
high-resolution redraws (https://asl-players.net), at twice the VASL board geometry, used with his
permission. They may not be redistributed apart from Open ASL without his permission. Each redraw is a
uniform stretch of the VASL board,
so the hex grids, the line-of-sight rasters and the per-hex terrain data for these boards are still
the VASL-derived files listed above.

## Multi-Man Publishing and Hasbro

Advanced Squad Leader and ASL are trademarks of Hasbro, Inc., used under licence by Multi-Man
Publishing. Open ASL is not affiliated with, sponsored by or endorsed by Hasbro, Multi-Man Publishing
or the VASL developers.

Open ASL is an independent, non-commercial implementation of the game's rules: a fair-use
interpretation of the rulebook, written in its own words. No rulebook text, chart or illustration is
reproduced.
The scenarios in `packages/content/src/scenarios/skFree.ts` are Multi-Man Publishing's free
downloadable Starter Kit scenarios, with their card text and photographs, reproduced for play and
credited to their designers. No scenario sold by Multi-Man Publishing is included.

## Sound effects

The recordings in `apps/web/src/audio/sounds/` are CC0 (public domain dedication); their
sources are credited in that directory.
