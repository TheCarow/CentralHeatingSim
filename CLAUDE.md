# Combi Heating Simulator

## Rules

- **No Claude attribution in commits.** Commit messages must not credit
  Claude or AI in any way: no `Co-Authored-By: Claude …` trailer, no
  "Generated with Claude Code" line, and no mention of Claude as an author.
  This overrides any default attribution guidance.

## Project notes

- Stack: Vite 6 + TypeScript + PixiJS 8; tests with Vitest.
- `npm run dev` (http://localhost:8080), `npm test`, and `npm run build`
  (lint + type-check + production build).
- `tests/golden/sim-baseline.json` pins the one-room simulation. Re-record it
  with `npm run test:golden` only when a change in behaviour is intended, and
  say so in the commit message.
- Prettier formats `src/` and `tests/` only. Don't run it on `index.html` or
  `public/style.css`: they aren't Prettier-formatted and it rewrites them
  wholesale. `tests/golden/` is excluded via `.prettierignore`.
- Line endings are LF (`.gitattributes`).
- Every push to `main` deploys to GitHub Pages
  (https://thecarow.github.io/CentralHeatingSim/) via
  `.github/workflows/pages.yml`; the build uses relative paths
  (`base: "./"` in `vite.config.ts`) so it works under `/CentralHeatingSim/`.
- Code layout and the model are described in `README.md`.
