// Builds the version history shown in the game (app/src/data/changelog.json) from the git history:
// each day something was published is one version, listing that day's changes newest first. Merge commits
// are left out. The numbers:
//   1.0  the original game, made in Scratch (before this project; added by hand below)
//   2.x  from the first commit (2.0), the Scratch game converted, one more each day
//   3.x  from the refactor that removed the Scratch code (3.0), one more each day
// A new major number starts on the day in MAJORS.
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

/** Each major version starts on this day (and runs until the next one). */
const MAJORS = [
  { major: 2, from: '2026-10-19' },   // the first commit: the Scratch game converted
  { major: 3, from: '2026-10-27' },   // the refactor that removed the Scratch code
];
const SCRATCH = { version: '1.0', date: '', changes: ['The original Build That Wall game, made in Scratch.'] };

const counts = new Map();
const versions = [...days.entries()].map(([date, changes]) => {
  const major = [...MAJORS].reverse().find(m => date >= m.from)?.major ?? MAJORS[0].major;
  const minor = counts.get(major) ?? 0;
  counts.set(major, minor + 1);
  return { version: major + '.' + minor, date, changes: changes.reverse() };
}).reverse();
versions.push(SCRATCH);

const old = existsSync(out) ? JSON.parse(readFileSync(out, 'utf8')) : [];
if (versions.length < old.length) {
  console.log('changelog: only ' + versions.length + ' days of history here (shallow copy?), kept the ' + old.length + ' in ' + out);
  process.exit(0);
}
writeFileSync(out, JSON.stringify(versions, null, 1) + '\n');
console.log('changelog: ' + versions.length + ' versions, latest ' + versions[0].version + ' (' + versions[0].date + ')');
