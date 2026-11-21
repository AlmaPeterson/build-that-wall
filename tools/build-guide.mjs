// Builds the player's guide web page (app/public/guide.html) from docs/guide.md.
// The page has the contents down the left: sections, their sub-sections and sub-sub-sections; a click jumps
// to that part, and the part being read is highlighted. Screenshots live in app/public/guide/.
//
//   node tools/build-guide.mjs
//
// docs/guide.md uses a small part of Markdown: # headings, paragraphs, - and 1. lists (nested by indenting),
// | tables |, **bold**, *italic*, [links](url) and ![pictures](guide/file.png), with an *italic* line straight
// after a picture as its caption.
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const md = fs.readFileSync(new URL('docs/guide.md', root), 'utf8').replace(/\r\n/g, '\n');
const out = new URL('app/public/guide.html', root);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Inline Markdown → HTML. */
function inline(text) {
  const kept = [];
  const keep = html => `\u0000${kept.push(html) - 1}\u0000`;
  let s = text.replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, (_, c) => keep(esc(c)));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, src) => keep(`<img src="${esc(src)}" alt="${esc(alt)}" loading="lazy">`));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => {
    const outside = /^https?:/.test(href) && !href.includes('almapeterson.github.io/build-that-wall');
    return keep(`<a href="${esc(href)}"${outside ? ' target="_blank" rel="noopener"' : ''}>`) + label + keep('</a>');
  });
  s = esc(s);
  s = s.replace(/\*\*([^*]+(?:\*[^*]+\*[^*]*)*)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\s][^*]*)\*/g, '<em>$1</em>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[+i]);
}

/** A PNG's size from its header, so the page knows each picture's height before it loads (jumps land in the right place). */
function pngSize(src) {
  try {
    const buf = fs.readFileSync(new URL('app/public/' + src, root));
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  } catch { return null; }
}
const sizeAttrs = src => { const d = pngSize(src); return d ? ` width="${d.w}" height="${d.h}"` : ''; };

const slug = s => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

// ---- blocks
const lines = md.split('\n');
const toc = [];            // { level, id, text }
let html = '', title = 'How To Use Build That Wall';
let h2 = '', h3 = '';
let i = 0;
const used = new Set();
const uniq = id => { let u = id, n = 2; while (used.has(u)) u = id + '-' + n++; used.add(u); return u; };

function heading(level, text) {
  const num = text.match(/^(\d+(?:\.\d+)*)\.?\s/);
  let id;
  if (num) id = 's' + num[1].replace(/\./g, '-');
  else id = (level === 4 ? h3 || h2 : level === 3 ? h2 : '') + (level > 2 ? '-' : '') + slug(text);
  id = uniq(id);
  if (level === 2) { h2 = id; h3 = ''; }
  if (level === 3) h3 = id;
  toc.push({ level, id, text: inline(text) });
  return `<h${level} id="${id}">${inline(text)}</h${level}>\n`;
}

function list(start) {
  // Items at this indent; deeper lines belong to the item above
  const indent = lines[start].match(/^\s*/)[0].length;
  const ordered = /^\s*\d+\.\s/.test(lines[start]);
  let h = ordered ? '<ol>' : '<ul>';
  let j = start;
  while (j < lines.length) {
    const m = lines[j].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
    if (!m || m[1].length !== indent) break;
    h += '<li>' + inline(m[3]);
    j++;
    if (j < lines.length && /^(\s*)([-*]|\d+\.)\s/.test(lines[j]) && lines[j].match(/^\s*/)[0].length > indent) {
      const sub = list(j); h += sub.html; j = sub.next;
    }
    h += '</li>';
  }
  return { html: h + (ordered ? '</ol>' : '</ul>') + '\n', next: j };
}

while (i < lines.length) {
  const line = lines[i];
  if (!line.trim()) { i++; continue; }
  const hm = line.match(/^(#{1,4})\s+(.*)$/);
  if (hm) {
    if (hm[1].length === 1) title = hm[2];
    else html += heading(hm[1].length, hm[2]);
    i++; continue;
  }
  if (/^\s*([-*]|\d+\.)\s/.test(line)) { const l = list(i); html += l.html; i = l.next; continue; }
  if (line.startsWith('|')) {
    const rows = [];
    while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i]); i++; }
    const cells = r => r.replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.trim());
    const head = cells(rows[0]), body = rows.slice(2).map(cells);
    html += '<div class="table"><table><thead><tr>' + head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>'
      + body.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>\n';
    continue;
  }
  // A picture on its own line, with its caption (an italic line) after it
  const pic = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
  if (pic) {
    i++;
    while (i < lines.length && !lines[i].trim()) i++;
    let cap = '';
    const cm = lines[i]?.match(/^\*([^*].*)\*\s*$/);
    if (cm) { cap = cm[1]; i++; }
    html += `<figure><a href="${esc(pic[2])}" target="_blank"><img src="${esc(pic[2])}" alt="${esc(pic[1])}"${sizeAttrs(pic[2])} loading="lazy"></a>${cap ? `<figcaption>${inline(cap)}</figcaption>` : ''}</figure>\n`;
    continue;
  }
  // A paragraph: lines up to a blank line or another block
  const para = [];
  while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\||\s*([-*]|\d+\.)\s|!\[)/.test(lines[i])) { para.push(lines[i]); i++; }
  html += `<p>${inline(para.join(' '))}</p>\n`;
}

// ---- the contents
function tocHtml() {
  let h = '<ol class="toc">';
  for (let k = 0; k < toc.length; k++) {
    const t = toc[k];
    if (t.level !== 2) continue;
    const subs = [];
    for (let j = k + 1; j < toc.length && toc[j].level > 2; j++) subs.push(toc[j]);
    h += `<li class="l2" data-id="${t.id}">${subs.length ? '<button class="twisty" aria-label="Show sub-sections" aria-expanded="false"></button>' : ''}<a href="#${t.id}">${t.text}</a>`;
    if (subs.length) {
      h += '<ol>';
      for (let j = 0; j < subs.length; j++) {
        const s = subs[j];
        if (s.level !== 3) continue;
        const deeper = [];
        for (let x = j + 1; x < subs.length && subs[x].level > 3; x++) deeper.push(subs[x]);
        h += `<li class="l3" data-id="${s.id}">${deeper.length ? '<button class="twisty" aria-label="Show sub-sections" aria-expanded="false"></button>' : ''}<a href="#${s.id}">${s.text}</a>`;
        if (deeper.length) h += '<ol>' + deeper.map(d => `<li class="l4" data-id="${d.id}"><a href="#${d.id}">${d.text}</a></li>`).join('') + '</ol>';
        h += '</li>';
      }
      h += '</ol>';
    }
    h += '</li>';
  }
  return h + '</ol>';
}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}: the complete guide</title>
<meta name="description" content="The complete guide to the Build That Wall website: every screen, button, setting and card, with screenshots. Starting a game, Pass'n'Play, playing online, sign-in, Gold, feedback and more.">
<link rel="canonical" href="https://almapeterson.github.io/build-that-wall/guide.html">
<link rel="icon" type="image/png" href="./icon.png">
<!-- Made by tools/build-guide.mjs from docs/guide.md: edit those, not this file -->
<style>
  :root { --red: #d8332d; --red-dark: #7a1a16; --blue: #2121ff; --paper: #faf7f2; --ink: #222; --muted: #666; --line: #e8dcd8; --side: 310px; }
  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; scroll-padding-top: 76px; }
  @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
  body { margin: 0; font: 16px/1.6 Arial, Helvetica, sans-serif; color: var(--ink); background: #fff; }
  .top { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 12px; height: 60px; padding: 0 16px; background: var(--red); color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,.25); }
  .top h1 { margin: 0; flex: 1; font: 900 1.25rem/1.1 'Arial Black', Arial, sans-serif; letter-spacing: .3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .top a.play { background: var(--blue); color: #fff; text-decoration: none; font-weight: bold; padding: 8px 16px; border-radius: 8px; border: 2px solid #fff; white-space: nowrap; }
  .top a.play:hover, .top a.play:focus-visible { background: #0000c8; }
  .menu-btn { display: none; background: #fff; color: var(--red); border: 0; border-radius: 8px; font-weight: bold; padding: 8px 12px; cursor: pointer; }
  .wrap { display: flex; align-items: flex-start; }
  nav.side { position: sticky; top: 60px; width: var(--side); flex: none; height: calc(100vh - 60px); overflow-y: auto; background: var(--paper); border-right: 1px solid var(--line); padding: 12px 8px 40px; }
  .filter { width: 100%; padding: 8px 10px; border: 2px solid var(--red-dark); border-radius: 8px; font: inherit; margin: 0 0 10px; }
  .toc, .toc ol { list-style: none; margin: 0; padding: 0; }
  .toc li { position: relative; }
  .toc a { display: block; padding: 5px 8px 5px 26px; border-radius: 6px; color: var(--ink); text-decoration: none; font-size: .93rem; line-height: 1.3; }
  .toc a:hover { background: #f1e6e3; }
  .toc .l2 > a { font-weight: bold; color: var(--red-dark); }
  .toc .l3 > a { padding-left: 40px; font-size: .9rem; }
  .toc .l4 > a { padding-left: 56px; font-size: .86rem; color: var(--muted); }
  .toc li > ol { display: none; }
  .toc li.open > ol { display: block; }
  .toc a.active { background: var(--red); color: #fff !important; }
  .twisty { position: absolute; left: 4px; top: 4px; width: 20px; height: 22px; border: 0; background: none; cursor: pointer; color: var(--red-dark); padding: 0; }
  .l3 > .twisty { left: 18px; }
  .twisty::before { content: '\\25B8'; display: inline-block; transition: transform .15s; }
  li.open > .twisty::before { transform: rotate(90deg); }
  .toc li.hidden { display: none; }
  main { flex: 1; min-width: 0; padding: 24px 32px 80px; }
  .content { max-width: 860px; margin: 0 auto; }
  .lead { background: var(--paper); border: 1px solid var(--line); border-radius: 12px; padding: 14px 18px; }
  h2 { font: 900 1.7rem/1.2 'Arial Black', Arial, sans-serif; color: var(--red); margin: 2.4em 0 .5em; padding-top: .6em; border-top: 3px solid var(--red); }
  h2:first-of-type { margin-top: .6em; }
  h3 { font-size: 1.3rem; color: var(--red-dark); margin: 1.8em 0 .4em; }
  h4 { font-size: 1.08rem; margin: 1.4em 0 .3em; }
  a { color: var(--blue); }
  p, li { max-width: 72ch; }
  li { margin: .25em 0; }
  .table { overflow-x: auto; margin: 1em 0; }
  table { border-collapse: collapse; width: 100%; font-size: .95rem; }
  th, td { border: 1px solid var(--line); padding: 7px 10px; text-align: left; vertical-align: top; }
  th { background: var(--red); color: #fff; }
  tr:nth-child(even) td { background: var(--paper); }
  figure { margin: 1.2em 0 1.6em; }
  figure img { display: block; max-width: 100%; height: auto; border: 1px solid #ccc; border-radius: 10px; box-shadow: 0 4px 14px rgba(0,0,0,.15); }
  figcaption { margin-top: 6px; font-size: .9rem; color: var(--muted); font-style: italic; }
  .foot { margin-top: 60px; padding: 18px; background: #2020ff; color: #fff; text-align: center; border-radius: 10px; font-size: .9rem; }
  .foot a { color: #fff; font-weight: bold; }
  .totop { position: fixed; right: 16px; bottom: 16px; background: var(--red); color: #fff; border: 0; border-radius: 50%; width: 46px; height: 46px; font-size: 22px; cursor: pointer; box-shadow: 0 3px 10px rgba(0,0,0,.3); opacity: 0; pointer-events: none; transition: opacity .2s; }
  .totop.show { opacity: 1; pointer-events: auto; }
  @media (max-width: 900px) {
    .menu-btn { display: inline-block; }
    nav.side { position: fixed; left: 0; top: 60px; z-index: 15; transform: translateX(-100%); transition: transform .2s; width: min(88vw, 340px); box-shadow: 4px 0 16px rgba(0,0,0,.25); }
    body.nav-open nav.side { transform: none; }
    main { padding: 16px 16px 80px; }
    h2 { font-size: 1.4rem; }
    .top h1 { font-size: 1rem; }
  }
</style>
</head>
<body>
<header class="top">
  <button class="menu-btn" aria-controls="side" aria-expanded="false">☰ Contents</button>
  <h1>${esc(title)}</h1>
  <a class="play" href="./">Play now</a>
</header>
<div class="wrap">
  <nav class="side" id="side" aria-label="Contents">
    <input class="filter" type="search" placeholder="Search the contents…" aria-label="Search the contents">
    ${tocHtml()}
  </nav>
  <main>
    <div class="content">
${html}
      <div class="foot">
        <p>Ready? <a href="./">Play Build That Wall now</a> · <a href="./how-to-play.html">About &amp; How to Play</a> · <a href="./privacy.html">Privacy</a> · <a href="./terms.html">Terms &amp; Conditions</a></p>
        <p>™ &amp; ® 2024 Beacon Political. All scenarios and characters portrayed in the deck are purely for entertainment and comical purposes.</p>
      </div>
    </div>
  </main>
</div>
<button class="totop" aria-label="Back to the top">↑</button>
<script>
(() => {
  const nav = document.getElementById('side');
  const links = [...nav.querySelectorAll('a')];
  const byId = new Map(links.map(a => [a.getAttribute('href').slice(1), a]));
  const heads = [...document.querySelectorAll('main h2, main h3, main h4')];
  const menuBtn = document.querySelector('.menu-btn');
  const setNav = open => { document.body.classList.toggle('nav-open', open); menuBtn.setAttribute('aria-expanded', open); };
  menuBtn.addEventListener('click', () => setNav(!document.body.classList.contains('nav-open')));

  // Open a section's sub-sections with its arrow
  nav.addEventListener('click', e => {
    const t = e.target.closest('.twisty');
    if (t) { const li = t.parentElement; li.classList.toggle('open'); t.setAttribute('aria-expanded', li.classList.contains('open')); return; }
    if (e.target.closest('a')) { setNav(false); const li = e.target.closest('li'); li.classList.add('open'); }
  });

  // Highlight the part being read, and open its branch of the contents
  let current = null;
  function mark(id) {
    if (id === current) return;
    current = id;
    links.forEach(a => a.classList.remove('active'));
    nav.querySelectorAll('li.open.auto').forEach(li => li.classList.remove('open', 'auto'));
    const a = byId.get(id);
    if (!a) return;
    a.classList.add('active');
    for (let li = a.parentElement; li && li !== nav; li = li.parentElement) {
      if (li.tagName === 'LI' && !li.classList.contains('open')) li.classList.add('open', 'auto');
    }
    if (!document.querySelector('.filter').value) {
      const r = a.getBoundingClientRect(), n = nav.getBoundingClientRect();
      if (r.top < n.top + 40 || r.bottom > n.bottom - 40) nav.scrollTop += r.top - n.top - n.height / 3;
    }
  }
  function onScroll() {
    let id = heads[0]?.id;
    for (const h of heads) { if (h.getBoundingClientRect().top < 110) id = h.id; else break; }
    mark(id);
    document.querySelector('.totop').classList.toggle('show', scrollY > 600);
  }
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();
  document.querySelector('.totop').addEventListener('click', () => scrollTo({ top: 0 }));

  // Search the contents
  document.querySelector('.filter').addEventListener('input', e => {
    const q = e.target.value.trim().toLowerCase();
    nav.querySelectorAll('li').forEach(li => {
      const hit = !q || li.textContent.toLowerCase().includes(q);
      li.classList.toggle('hidden', !hit);
      if (q && hit) li.classList.add('open'); else if (!q) li.classList.remove('open');
    });
    if (!q) { current = null; onScroll(); }
  });
})();
</script>
</body>
</html>
`;

fs.writeFileSync(out, page);
console.log('wrote app/public/guide.html: ' + toc.length + ' headings, ' + (html.match(/<figure>/g) || []).length + ' pictures');
