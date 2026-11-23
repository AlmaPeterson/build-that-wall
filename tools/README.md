# Tools

`changelog.mjs` makes the version history (`app/src/data/changelog.json`) from the git history; `npm run build` runs it.

`build-guide.mjs` builds the player's guide web page, `app/public/guide.html`, from `docs/guide.md`
(screenshots in `app/public/guide/`). Edit the Markdown, then run `node tools/build-guide.mjs`.

`deploy-server.mjs` puts `game-server.gs` on the game's Google Apps Script and deploys it as a new
version of the same web app, so the Server URL doesn't change: `node tools/deploy-server.mjs`.
One-time setup by the script's Google account: turn on "Google Apps Script API" at
https://script.google.com/home/usersettings, then run `npx @google/clasp@3.4.1 login` and press Allow.
The sign-in is kept in your user folder (`~/.clasprc.json`), never in this project.

## Moving over from PenguinMod

Python 3 scripts (standard library only) that were used to move the game over from the old
PenguinMod project. That project has been removed, so they can't be run any more: the files they
made (`app/public/assets/`, `app/src/data/assets.json`, `app/src/data/cards.json` and
`docs/project-dump/`) are now edited directly. They are kept to show where those files came from.

```
python3 -I tools/dump-project.py     # docs/project-dump/: the blocks as readable text
python3 -I tools/export-assets.py    # app/public/assets/ + app/src/data/assets.json
python3 -I tools/export-cards.py     # app/src/data/cards.json (needs assets.json)
```
