# Tools

Python 3 scripts (standard library only) that read the PenguinMod project in `assets/` and
produce files for the TypeScript app and the docs. Run them from the repo root, in this order,
after the project changes:

```
python3 -I tools/dump-project.py     # docs/project-dump/: the blocks as readable text
python3 -I tools/export-assets.py    # app/public/assets/ + app/src/data/assets.json
python3 -I tools/export-cards.py     # app/src/data/cards.json (needs assets.json)
```

All three are deterministic, so re-running them only changes files when the project changed.
