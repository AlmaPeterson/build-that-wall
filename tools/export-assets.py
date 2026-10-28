"""Copy the game's pictures and sounds out of assets/ under readable names, for the TypeScript app.

Usage (from the repo root):  python3 -I tools/export-assets.py [project.json] [public-dir] [manifest.json]

- Every costume and sound goes to app/public/assets/<sprite-slug>/<name-slug>.<ext>.
- A file used by several sprites is copied once (to the first sprite in sorted order) and the
  manifest points every user at that copy.
- Images stored inside Stage lists as data: URLs (card pictures in three sizes, wall art) are
  written to app/public/assets/lists/<list-slug>/<n>.<ext>, n = item number (= card id).
- app/src/data/assets.json maps sprite -> costume/sound name -> path and the numbers the UI
  needs to place things (rotation centre, bitmap resolution, costume number).
Runs are deterministic: the same project gives the same files and manifest.
"""
import base64
import json
import os
import re
import shutil
import sys
import urllib.parse

SRC = sys.argv[1] if len(sys.argv) > 1 else 'classic/assets/project.json'
PUB = sys.argv[2] if len(sys.argv) > 2 else 'app/public'
MANIFEST = sys.argv[3] if len(sys.argv) > 3 else 'app/src/data/assets.json'
ASSET_DIR = os.path.dirname(SRC)
MIME_EXT = {'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/gif': 'gif'}


def slug(name):
    s = re.sub(r"['’]", '', str(name).lower())
    s = re.sub(r'[^a-z0-9]+', '-', s).strip('-')
    return s or 'unnamed'


def main():
    p = json.load(open(SRC))
    out_root = os.path.join(PUB, 'assets')
    if os.path.isdir(out_root):
        shutil.rmtree(out_root)              # start clean so renamed costumes don't leave stale files
    os.makedirs(out_root)

    copied = {}                              # md5ext -> published path (first copy wins)
    taken = set()                            # published paths already used
    manifest = {'sprites': {}, 'lists': {}}
    targets = sorted(p['targets'], key=lambda t: (not t['isStage'], t['name'].lower()))

    def publish(sprite_slug, name, md5ext, ext):
        if md5ext in copied:
            return copied[md5ext]
        base = '%s/%s' % (sprite_slug, slug(name))
        path, n = '%s.%s' % (base, ext), 2
        while path in taken:                 # same name twice in one sprite: -2, -3, ...
            path = '%s-%d.%s' % (base, n, ext)
            n += 1
        taken.add(path)
        os.makedirs(os.path.join(out_root, sprite_slug), exist_ok=True)
        shutil.copyfile(os.path.join(ASSET_DIR, md5ext), os.path.join(out_root, path))
        copied[md5ext] = 'assets/' + path
        return copied[md5ext]

    for t in targets:
        ss = slug(t['name'])
        entry = {'costumes': {}, 'sounds': {}}
        for i, c in enumerate(t['costumes'], 1):
            entry['costumes'][c['name']] = {
                'path': publish(ss, c['name'], c['md5ext'], c['dataFormat']),
                'number': i,
                'rotationCenterX': c.get('rotationCenterX', 0),
                'rotationCenterY': c.get('rotationCenterY', 0),
                'bitmapResolution': c.get('bitmapResolution', 1),
            }
        for s in t['sounds']:
            entry['sounds'][s['name']] = {
                'path': publish(ss, s['name'], s['md5ext'], s['dataFormat']),
                'rate': s.get('rate'),
                'sampleCount': s.get('sampleCount'),
            }
        manifest['sprites'][t['name']] = entry

    # Pictures kept inside Stage lists as data: URLs
    stage = next(t for t in p['targets'] if t['isStage'])
    for name, items in sorted((v[0], v[1]) for v in stage['lists'].values()):
        if not any(str(x).startswith('data:image/') for x in items):
            continue
        ls = slug(name)
        os.makedirs(os.path.join(out_root, 'lists', ls), exist_ok=True)
        paths = []
        for i, item in enumerate(items, 1):
            m = re.match(r'data:([^;,]+)(;base64)?,(.*)', str(item), re.S)
            if not m:
                paths.append(None)
                continue
            ext = MIME_EXT.get(m.group(1), 'bin')
            data = base64.b64decode(m.group(3)) if m.group(2) else urllib.parse.unquote(m.group(3)).encode()
            rel = 'lists/%s/%02d.%s' % (ls, i, ext)
            with open(os.path.join(out_root, rel), 'wb') as f:
                f.write(data)
            paths.append('assets/' + rel)
        manifest['lists'][name] = paths

    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, 'w') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
        f.write('\n')
    print('%d files copied, %d list images, manifest: %s' % (
        len(copied), sum(len(v) for v in manifest['lists'].values()), MANIFEST))


main()
