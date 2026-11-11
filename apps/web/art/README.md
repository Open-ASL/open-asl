# Art

VASL-derived boards, counters and markers, converted to WebP by `tools/vasl-import`.
Redistributed under the GNU LGPL 2.1 like the VASL sources; provenance and credits are in
`NOTICE.md` at the repository root. Regenerate with `npx tsx tools/vasl-import/src/cli.ts`
rather than editing files here.

The board images themselves are Neal Ulen's high-resolution redraws (twice the VASL geometry; see
`NOTICE.md`). The importer leaves those boards' art alone.

Vite serves this directory as the public dir, so `boards/y.webp` is `/boards/y.webp` in the
app, in development and in the built site alike.
