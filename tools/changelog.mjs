// Builds the version history shown in the game (app/src/data/changelog.json) from the git history:
// each day something was published is one version (1.0 on the first day, then 1.1, 1.2, ...), listing
// that day's changes newest first. Merge commits are left out.
//
// Run by `npm run build` (prebuild). With no git, or a shallow copy that has fewer days than the file
// already holds, the file is left as it is.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'app', 'src', 'data', 'changelog.json');

let log = '';
try {
  log = execFileSync('git', ['log', '--reverse', '--no-merges', '--date=short', '--format=%ad%x1f%s%x1e'], { cwd: root, encoding: 'utf8' });
} catch {
  console.log('changelog: no git history here, kept ' + out);
  process.exit(0);
}

const days = new Map();
for (const rec of log.split('\x1e')) {
  const [date, subject] = rec.trim().split('\x1f');
  if (!date || !subject) continue;
  if (!days.has(date)) days.set(date, []);
  days.get(date).push(subject.trim());
}

const versions = [...days.entries()].map(([date, changes], i) => ({ version: '1.' + i, date, changes: changes.reverse() })).reverse();

const old = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
if (versions.length < old.length) {
  console.log('changelog: only ' + versions.length + ' days of history here (shallow copy?), kept the ' + old.length + ' in ' + out);
  process.exit(0);
}
writeFileSync(out, JSON.stringify(versions, null, 1) + '\n');
console.log('changelog: ' + versions.length + ' versions, latest ' + versions[0].version + ' (' + versions[0].date + ')');
