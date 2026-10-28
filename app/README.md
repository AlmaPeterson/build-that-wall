# Build That Wall (TypeScript)

The new version of the game. The PenguinMod version at the repo root stays live until this one
reaches parity; see `../docs/REFACTOR_PLAN.md`.

```
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run build      # type-check and build to dist/
```

## Layout

- `src/services/` — things that talk to the outside world: storage, account, Gold, payments,
  online play, feedback. No game rules, no Scratch.
- `src/game/` — pure game logic: state, rules, cards, bots. No DOM.
- `src/ui/` — screens and components (HTML/CSS + SVG).
- `src/data/` — card catalogue and other static data.
- `public/` — images and sounds, served as-is.
