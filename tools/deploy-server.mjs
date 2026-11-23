// Puts game-server.gs on the game's Google Apps Script and deploys it as a new version of the SAME web app,
// so its address (Server URL in game-settings.json) stays the same. Uses Google's clasp tool.
//
// One-time setup, by the owner of the script (the Google account it belongs to):
//   1. https://script.google.com/home/usersettings  >  turn on "Google Apps Script API"
//   2. In a terminal: npx @google/clasp@2.4.2 login   (sign in with the script's Google account, press Allow)
// After that:  node tools/deploy-server.mjs
//
// The sign-in is kept in your user folder (~/.clasprc.json), never in this project.
import { execSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT_ID = '1X91cst8mPUS4sa5CuaArEYL4W3uzRM5Z7X9Y1XhBe5qu--RSl0t-9CAr';   // the "Build That Wall" Apps Script project
const CLASP = 'npx --yes @google/clasp@2.4.2';
const MARK = 'Build That Wall - game server';

const settings = JSON.parse(readFileSync(join(ROOT, 'app/public/game-settings.json'), 'utf8'));
const deployment = /\/macros\/s\/([^/]+)\/exec/.exec(settings['Server URL'] || '')?.[1];
if (!deployment) throw new Error('No Server URL in app/public/game-settings.json');

const code = readFileSync(join(ROOT, 'game-server.gs'), 'utf8');
if (!code.includes(MARK)) throw new Error('game-server.gs does not look like the game server');

const run = (cmd, cwd) => execSync(cmd, { cwd, stdio: 'inherit' });
let version = '';
try { version = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim(); } catch { /* not a git checkout */ }

const dir = mkdtempSync(join(tmpdir(), 'btw-server-'));
try {
  writeFileSync(join(dir, '.clasp.json'), JSON.stringify({ scriptId: SCRIPT_ID, rootDir: dir, fileExtension: 'gs' }));
  // Start from what's there now, so the project's settings (appsscript.json) are kept
  run(CLASP + ' pull', dir);
  const files = readdirSync(dir).filter(f => f.endsWith('.gs'));
  const target = files.find(f => readFileSync(join(dir, f), 'utf8').includes(MARK)) ?? (files.length === 1 ? files[0] : null);
  if (!target) throw new Error('Could not tell which file in the Apps Script project is the game server: ' + files.join(', '));
  for (const f of files) if (f !== target) console.warn('Note: the project also has ' + f + '; it is left as it is.');
  writeFileSync(join(dir, target), code);
  run(CLASP + ' push --force', dir);
  run(CLASP + ' deploy --deploymentId ' + deployment + ' --description "Build That Wall server' + (version ? ' ' + version : '') + '"', dir);
  console.log('\nThe game server is updated. Same address as before: ' + settings['Server URL']);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
