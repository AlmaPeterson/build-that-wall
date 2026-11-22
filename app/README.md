# Build That Wall

The game: TypeScript, Preact and Vite. Every push to `main` runs the tests, builds this folder and
publishes it to GitHub Pages (`.github/workflows/`). The old PenguinMod version has been removed;
`/classic/` only sends people here.

```
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run build      # type-check and build to dist/
```

## Layout

- `src/game/` — the game rules, cards and bots. No DOM.
- `src/services/` — things that talk to the outside world: storage, sign-in, Gold, payments,
  online play, feedback.
- `src/ui/` — screens and components (HTML/CSS + SVG), sound and music (`audio.ts`, `music/`).
- `src/data/` — the card list and other fixed data.
- `public/` — pictures, sounds and pages served as they are, including `game-settings.json` and
  `how-to-play.html` (it repeats the in-game Instructions; a test keeps them the same), and
  `guide.html`, the full player's guide with screenshots (built from `../docs/guide.md` by
  `../tools/build-guide.mjs`).

## Owner settings

`public/game-settings.json` turns the online parts on. Empty values leave that part off, and the
game still works without any of them.

| Setting | What it's for |
|---|---|
| Server URL | The game server (`../game-server.gs`, a free Google Apps Script). Accounts, Gold, leaderboards and username/password sign-in need it. |
| Google Client ID | Sign in with Google. |
| Apple Client ID | Sign in with Apple (the Services ID). Also set `APPLE_CLIENT_ID` on the server. |
| GitHub Client ID | Sign in with GitHub. Also set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` on the server. |
| Feedback URL | Where Send feedback goes: the same as Server URL. The server keeps it for the owner's notification bell and To-fix list (set `OWNER_EMAIL` on the server); it is never emailed. Empty = sent through FormSubmit instead. |
| PayPal Client ID, PayPal Plan Month, PayPal Plan Year | Selling Gold Membership. |
| PayPal Plan Month Sale, PayPal Plan Year Sale, Sale Percent | Holiday sales on Gold (Easter, Independence Day, Thanksgiving, Black Friday, Silver Saturday, Christmas). Make two PayPal plans priced Sale Percent below the normal ones (25 = 25% off). Without them the sale isn't sold or announced (while payments are turned off it is announced, saying it can't be used yet). |
| Gold Price Year, Gold Price Month, Currency | The prices shown in the store. |
| Amazon Tag, Merch URL | Links to the real card game and merchandise. |
| Free Online Players | Kept from the old game; this version doesn't use it yet. |

How to set up the server, sign-in and PayPal is at the top of `../game-server.gs`.
