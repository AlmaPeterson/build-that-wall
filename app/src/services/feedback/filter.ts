// ---- feedback filter: only real, new suggestions get sent, and they get sent politely.
// Everything here is pure: text in, text out. Nothing touches the page or the network.

const NL = '\n';

/** map[key], but never Object.prototype's own members ("constructor", "toString"...). */
function own(map: Record<string, string>, key: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : undefined;
}

// Squash a word so "F.U.C.K", "fuuuck" and "sh1t" all match: lowercase, undo leetspeak, letters only
export function squash(w: string): string {
  const leet: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i' };
  return String(w).toLowerCase().replace(/[013457@$!]/g, (c) => leet[c]!).replace(/[^a-z]/g, '');
}

const MASKABLE = ['fuck', 'fucking', 'fucked', 'fucker', 'shit', 'shitty', 'bitch', 'ass', 'asshole', 'damn', 'crap', 'cunt', 'dick', 'bastard'];

const SWEAR_RULES: [RegExp, string][] = [
  [/^f+u+c*k+e+d+$/, 'broken'],
  [/^(?:f+u+c*k+|f+u+k+|f+c+k+|f+u+q+|p+h+u+c*k+|f+r+e+a+k+|f+r+i+g+|e+f+f+)(?:i+n+g*|i+n+|e+r+s?|s)?$/, ''],
  [/^b+u+l+s+h+i+t+$/, 'unfair'],
  [/^(?:s+h+i+t+|c+r+a+p+)(?:t+y+|p+y+|s)?$/, 'bad'],
  [/^(?:d+a+m+n+|d+a+r+n+|g+o+d+d+a+m+n+)(?:i+t+|e+d+)?$/, ''],
  [/^(?:w+t+f+|w+t+h+|o+m+f+g+|s+t+f+u+|g+t+f+o+|f+f+s+|f+m+l+)$/, ''],
  [/^(?:a+s+s+(?:h+o+l+e+)?s?|a+r+s+e+|b+i+t+c+h+(?:e+s+|y+)?|b+a+s+t+a+r+d+s?|d+i+c+k+(?:h+e+a+d+)?s?|p+r+i+c+k+s?|c+u+n+t+s?|t+w+a+t+s?|w+a+n+k+e+r+s?|d+o+u+c+h+e+(?:b+a+g+)?s?|j+e+r+k+s?|m+o+r+o+n+s?|i+d+i+o+t+s?|l+o+s+e+r+s?|n+o+o+b+s?)$/, ''],
  [/^(?:r+e+t+a+r+d+(?:e+d+)?s?|s+t+u+p+i+d+|d+u+m+b+|i+d+i+o+t+i+c+|b+r+a+i+n+d+e+a+d+)$/, 'not great'],
  [/^s+u+c+k+s+$/, 'needs work'], [/^s+u+c+k+e+d+$/, 'was not good'], [/^s+u+c+k+y+$/, 'weak'],
  [/^(?:t+r+a+s+h+y*|g+a+r+b+a+g+e+|t+e+r+r+i+b+l+e+|h+o+r+r+i+b+l+e+|a+w+f+u+l+|a+t+r+o+c+i+o+u+s+|p+a+t+h+e+t+i+c+|l+a+m+e+|t+r+a+s+h+)$/, 'not great'],
  [/^w+o+r+s+t+$/, 'weakest'],
  [/^h+a+t+e+$/, 'dislike'], [/^h+a+t+e+s+$/, 'dislikes'], [/^h+a+t+e+d+$/, 'disliked'],
];

// Replacement for a swear or insult word ("" = just remove it), or null if the word is fine
export function swearReplacement(w: string): string | null {
  // Masked words like "f***ing" or "sh*t": each * stands for one letter
  if (/^[a-z][a-z*]*\*[a-z*]*$/i.test(String(w).replace(/[!?.]+$/, ''))) {
    const re = new RegExp('^' + String(w).toLowerCase().replace(/[!?.]+$/, '').replace(/\*/g, '[a-z]') + '$');
    const base = MASKABLE.find((b) => re.test(b));
    if (base) return swearReplacement(base);
  }
  const s = squash(String(w).replace(/[!]+$/, ''));
  if (!s) return null;
  for (const [re, rep] of SWEAR_RULES) if (re.test(s)) return rep;
  return null;
}

const REWRITES: [RegExp, string][] = [
  [/^(?:i|we)\s+(?:really\s+|kinda\s+|so\s+)?(?:dislike|don'?t like|do not like|can'?t stand)\s+(?:it\s+)?how\s+(.+?)[.!]?$/i, 'Please change how $1.'],
  [/^(?:i|we)\s+(?:really\s+|kinda\s+|so\s+)?(?:dislike|don'?t like|do not like|can'?t stand)\s+(?:it\s+)?(?:when|that)\s+(.+?)[.!]?$/i, "Please change it so that this doesn't happen: $1."],
  [/^(?:i|we)\s+(?:really\s+|kinda\s+|so\s+)?(?:dislike|don'?t like|do not like|can'?t stand)\s+(.+?)[.!]?$/i, 'Please improve $1.'],
  [/^(.+?)\s+(?:is|are|was|were)\s+(?:so\s+|really\s+|very\s+|kind of\s+|kinda\s+|just\s+)?(?:not great|bad|weak|annoying|boring|weakest|was not good)[.!]?$/i, 'Please improve $1.'],
  [/^(.+?)\s+(?:is|are)\s+(?:so\s+|really\s+|very\s+|kind of\s+|kinda\s+)?confusing[.!]?$/i, 'Please make $1 clearer.'],
  [/^(.+?)\s+(?:is|are)\s+(?:so\s+|really\s+|totally\s+)?broken[.!]?$/i, 'Please fix $1.'],
  [/^(.+?)\s+needs work\b\s*(.*?)[.!]?$/i, 'Please improve $1 $2.'],
  [/^why\s+(?:can'?t|cannot|can not)\s+(?:i|we|you)\s+(.+?)\??$/i, 'Please let players $1.'],
  [/^why\s+(?:is|are)\s+there\s+no\s+(.+?)\??$/i, 'Please add $1.'],
  [/^why\s+(?:is|are)\s+(.+?)\s+so\s+(\w+)\??$/i, '$1 is too $2. Please change it.'],
  [/^(?:can|could|would|will)\s+you\s+(?:please\s+)?(.+?)\??$/i, 'Please $1.'],
];

// Swears become neutral words, then rants become requests
export function polite(text: string): string {
  let t = String(text);
  // "f u c k" / "s.h.i.t" spelled out letter by letter
  t = t.replace(/\b(?:[a-z][\s.\-_*]){2,}[a-z]\b/gi, (m) => { const w = m.replace(/[^a-z]/gi, ''); return swearReplacement(w) !== null ? w : m; });
  t = t.replace(/\b(what|why|how|where|who)\s+the\s+(?:hell|heck|f\S*)/gi, '$1');
  // "you idiots" / "u morons": the insult goes, so the "you" goes with it
  t = t.replace(/\b(?:you|u|ya|ur)\s+((?:[A-Za-z0-9@$!*#]+\s+)?[A-Za-z0-9@$!*#]+)/gi, (m, rest: string) => {
    const ws = rest.split(/\s+/);
    return ws.length && swearReplacement(ws[ws.length - 1]!) === '' && ws.every((w) => swearReplacement(w) !== null) ? '' : m;
  });
  t = t.replace(/[A-Za-z0-9@$!*#]+/g, (w) => {
    if (!/[a-z]/i.test(w)) return w;
    const r = swearReplacement(w);
    if (r === null) return w;
    const tail = (w.match(/[!?.]+$/) || [''])[0];  // keep "great!" punctuation
    return r + tail;
  });
  // Shouting and punctuation storms
  const letters = t.replace(/[^a-z]/gi, '');
  if (letters.length > 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) t = t.toLowerCase();
  t = t.replace(/([!?])[!?1]+/g, '$1').replace(/\.{4,}/g, '...');
  t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([,.!?;:])/g, '$1').replace(/^[\s,.;:!?-]+/, '').trim();
  t = t.replace(/^(?:and|also|plus|oh and|btw|but|so|ok so)\s+/i, '');
  // Rephrase negative sentences into requests
  for (const [re, rep] of REWRITES) if (re.test(t)) {
    t = t.replace(re, rep).replace(/\s+\./g, '.').replace(/^(Please \w+(?: how)? )(The|This|These|Those|My|Your|Our)\b/, (m, a: string, b: string) => a + b.toLowerCase());
    break;
  }
  t = t.replace(/\b(please)\s+please\b/gi, '$1').replace(/\.{2}$/, '.').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

const STOP = new Set(('a an the and or but if then so to of in on at for with by from up down out about into over under is are was were be been being am do does did have has had ' +
  'i me my we our you your he she they them their it its this that these those there here what which who when where why how all any both each some such no nor not only own same ' +
  'than very just also really can will should now get got like please pls plz would could maybe kinda kind sort lot lots too much many add adding added fix fixed fixing change ' +
  'make making remove put let allow enable need needs want wish hope idea suggest suggestion improve better game thing things stuff everything something it\'s im i\'m dont don\'t ' +
  'cant can\'t doesnt doesn\'t wont won\'t isnt isn\'t players player people way able there\'s thats that\'s one').split(' '));

const SYNONYMS: Record<string, string> = {
  ai: 'bot', bots: 'bot', computer: 'bot', cpu: 'bot', robot: 'bot', npc: 'bot', song: 'music', songs: 'music', soundtrack: 'music', tune: 'music', tunes: 'music',
  sfx: 'sound', sounds: 'sound', btn: 'button', buttons: 'button', colour: 'color', colours: 'color', colors: 'color', multiplayer: 'online', internet: 'online',
  lag: 'slow', laggy: 'slow', lagging: 'slow', freeze: 'crash', freezes: 'crash', frozen: 'crash', crashes: 'crash', crashing: 'crash', crashed: 'crash',
  glitch: 'bug', glitches: 'bug', glitchy: 'bug', bugs: 'bug', buggy: 'bug', error: 'bug', errors: 'bug', guide: 'tutorial', instructions: 'tutorial', help: 'tutorial',
  theme: 'mode', bigger: 'big', larger: 'big', large: 'big', huge: 'big', smaller: 'small', tiny: 'small', faster: 'fast', quicker: 'fast', quick: 'fast', speed: 'fast',
  louder: 'loud', quieter: 'quiet', softer: 'quiet', phone: 'mobile', tablet: 'mobile', ipad: 'mobile', iphone: 'mobile', android: 'mobile', cards: 'card', walls: 'wall',
  miles: 'mile', turns: 'turn', decks: 'deck', screens: 'screen', menus: 'menu', options: 'setting', option: 'setting', settings: 'setting',
};

// Words a suggestion is "about", so reworded versions of the same fix match
export function keyWords(text: string): string[] {
  const out = new Set<string>();
  for (let w of String(text).toLowerCase().match(/[a-z']+/g) || []) {
    w = w.replace(/'s$/, '');
    if (STOP.has(w)) continue;
    // NOTE: deliberate fix. The original looked words up in plain objects, so "constructor" or
    // "toString" found Object.prototype's functions and put them in the keys / message text.
    const syn = own(SYNONYMS, w);
    if (syn) { out.add(syn); continue; }
    if (w.length > 4) w = w.replace(/(?:ing|ed|es|ly|s)$/, '');
    w = own(SYNONYMS, w) ?? w;
    if (w.length > 1 && !STOP.has(w)) out.add(w);
  }
  return [...out].sort();
}

/** Two suggestions are the same when most of their key words match. */
export function sameSuggestion(x: string[], y: string[]): boolean {
  if (!x.length || !y.length) return false;
  const inter = x.filter((w) => y.includes(w)).length;
  return inter / new Set([...x, ...y]).size >= 0.6 || (inter >= 2 && inter / Math.min(x.length, y.length) >= 0.8);
}

// Is this sentence an actual request/bug report with something specific in it?
export function isUseful(text: string): boolean {
  const low = String(text).toLowerCase();
  if (/\b(?:kys|kill\s+(?:yo)?urself|hope\s+you\s+die|go\s+die)\b/.test(low)) return false;
  const words = low.match(/[a-z']+/g) || [];
  if (words.length < 2) return false;
  // Keyboard mashing: long words with no vowels, or "asdf"-style runs
  const mash = words.filter((w) => (w.length > 4 && !/[aeiouy]/.test(w)) || /(asdf|qwer|zxcv|jkl|hjk|(\w{2,})\2{2,})/.test(w)).length;
  if (mash / words.length > 0.4) return false;
  const cue = /\b(add|fix|change|make|remove|delete|put|let|allow|enable|disable|option|setting|please|pls|plz|should|could|would|can you|need|needs|want|wish|hope|idea|suggest|maybe|instead|improve|better|easier|harder|more|less|fewer|too|bug|glitch|crash\w*|freez\w*|frozen|stuck|lag\w*|slow|error|broken|not working|doesn'?t|does not|won'?t|will not|can'?t|cannot|isn'?t|unable|missing|wrong|problem|issue|fail\w*|disappear\w*|overlap\w*|cut off|confusing|unclear|hard to|support|feature|mode|update|balance|nerf|buff|clearer)\b/;
  if (!cue.test(low)) return false;
  return keyWords(text).length > 0;              // "make it better" has nothing specific left
}

// Personal details: email addresses, phone numbers, street addresses, real names, schools, usernames
export function removePII(text: string): string {
  return String(text)
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '(email removed)')
    .replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, (m) => (m.replace(/\D/g, '').length >= 9 ? '(phone number removed)' : m))
    .replace(/\b\d{1,5}\s+(?:[A-Za-z]+\s+){1,3}(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|court|ct|boulevard|blvd|way|place|pl|circle|cir|highway|hwy)\b\.?/gi, '(address removed)')
    .replace(/\b(my name is|my full name is|call me|i am|i'm|im)\s+([A-Z][a-z]+)(\s+[A-Z][a-z]+)\b/g, '$1 (name removed)')
    .replace(/\b(my name is|call me)\s+([A-Za-z]+)\b/gi, '$1 (name removed)')
    .replace(/\b(my\s+(?:mom|mum|dad|brother|sister|son|daughter|friend|teacher|wife|husband)(?:'s name)?\s+is)\s+([A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?/g, '$1 (name removed)')
    .replace(/\b(?:at|go to|from)\s+(?:[A-Z][a-z]+\s+){1,3}(?:Elementary|Middle|High|Primary|Secondary)?\s*School\b/g, 'at (school removed)')
    .replace(/(^|\s)@[A-Za-z0-9_.]{3,}/g, '$1(username removed)');
}

const PROMO = /\b(subscribe|sub to|follow me|check out my|my (?:youtube|channel|tiktok|twitch|insta|instagram|discord|server|stream|website|site|shop|store)|join my|free (?:robux|v-?bucks|gift ?cards?|money)|giveaway|promo code|discount code|use code|click here|dm me|buy (?:now|cheap)|earn \$|make money|crypto|bitcoin|onlyfans)\b/i;
const LINK = /(https?:\/\/|www\.)\S+|\b[\w-]+\.(?:com|net|org|io|gg|tv|ly|xyz|co)\b(?:\/\S*)?/i;

// Links come out; adverts and self-promotion mean the whole sentence goes
export function stripLinks(text: string): { t: string; promo: boolean; hadLink?: boolean } {
  const hadLink = LINK.test(text);
  if (PROMO.test(text)) return { t: '', promo: true };
  const t = String(text).replace(new RegExp(LINK.source, 'gi'), '(link removed)');
  return { t, promo: false, hadLink };
}

// Slurs, stored encoded so the source isn't full of them
let slurs: Set<string> | null = null;
function slurList(): Set<string> {
  if (!slurs) slurs = new Set(atob('bmlnZ2VyIG5pZ2dhIG5pZ2dhaCBuaWdndWggY2hpbmsgZ29vayBzcGljIHNwaWNrIHdldGJhY2sga2lrZSBreWtlIGJlYW5lciByYWdoZWFkIHRvd2VsaGVhZCBzYW5kbmlnZ2VyIGNvb24gamlnYWJvbyBwb3JjaG1vbmtleSBqdW5nbGVidW5ueSBwYWtpIHdvcCBkYWdvIGNoaW5hbWFuIHppcHBlcmhlYWQgZmFnZ290IGZhZyBmYWdvdCBkeWtlIHRyYW5ueSBzaGVtYWxlIHNwYXogbW9uZ29sb2lkIGd5cHBvIGdvbGxpd29nIGRhcmtpZSByZWRza2luIHNxdWF3IGhhbGZicmVlZA==').split(' '));
  return slurs;
}

// Hate speech: slurs and hate slogans
export function isHate(text: string): boolean {
  const list = slurList();
  if (/\b(heil hitler|sieg heil|white power|white pride|gas the \w+|kill all \w+|1488|go back to (?:your|ur) (?:country|own country))\b/i.test(text)) return true;
  return (String(text).match(/[A-Za-z0-9@$!*]+/g) || []).some((w) => {
    // Masked like "f*g": each * stands for one letter
    if (/[a-z]\*|\*[a-z]/i.test(w)) {
      const re = new RegExp('^' + w.toLowerCase().replace(/[^a-z*]/g, '').replace(/\*/g, '[a-z]') + '(?:e?s)?$');
      if ([...list].some((x) => re.test(x))) return true;
    }
    const s = squash(w).replace(/(.)\1{2,}/g, '$1$1');
    return list.has(s) || list.has(s.replace(/(?:e?s|z)$/, ''));
  });
}

// Words that tie a sentence to this game (so "add a Biden card" is fine but "Biden is evil" is not)
export function isAboutGame(text: string): boolean {
  return /\b(cards?|deck|game|walls?|sections?|miles?|bots?|players?|mode|button|packs?|expansion|rounds?|turns?|rules?|characters?|version|screen|menu|settings?|sound|music|tutorial|instructions|man hours?|savings|debt|self-defense|voting machine|trump train|gold|card backs?|colors?|names?|leaderboards?|online|lobby|ads?|levels?|difficulty|draw pile|discard|hand|zoom|qr)\b/i.test(text);
}

// Political venting aimed at real people or parties instead of the game
export function isPolitical(text: string): boolean {
  const pol = /\b(trump|donald|biden|obama|harris|kamala|hillary|clinton|pelosi|vance|desantis|aoc|maga|democrats?|dems|republicans?|gop|liberals?|libs|libtards?|conservatives?|leftists?|right-?wingers?|commies?|communists?|socialists?|fascists?|nazis?|antifa|congress|senators?|white house|the president|politicians?|election|woke)\b/i;
  if (!pol.test(text)) return false;
  return !isAboutGame(text);
}

// Attempts to give orders to the smart filter
export function isInjection(text: string): boolean {
  return /\b(?:ignore|disregard|forget|override)\s+(?:all\s+|any\s+|the\s+|your\s+|my\s+|previous\s+|prior\s+|above\s+|earlier\s+|these\s+)*(?:instructions|rules|prompts?|directions|guidelines)\b|\bsystem prompt\b|\byou are now\b|\b(?:act|behave) as (?:a|an|if)\b|\bpretend (?:to be|you are)\b|\bjailbreak\b|\bdeveloper mode\b|\bdan mode\b|<\/?\s*(?:system|feedback|known_suggestions|private_feedback)\b|\b(?:mark|label|treat) (?:this|it) as (?:new|not a duplicate|urgent)\b/i.test(text);
}

// Cheats and exploits go to the owner privately, never to a public list
export function isExploit(text: string): boolean {
  return /\b(exploit\w*|cheat\w*|hack\w*|infinite \w+|unlimited \w+|dupe\w*|duplicat\w+ (?:cards?|gold|walls?)|free gold|gold for free|bypass\w*|without paying|skip (?:the |an )?ads?|glitch to win|always win|win every time|soft-?lock\w*|steal (?:other|another) player)\b/i.test(text);
}

// Strategy tips would spoil the game if suggestions are ever shown to players
export function isStrategy(text: string): boolean {
  return /\b(strategy|strategies|the trick is|a trick|pro tip|tip:|secret is|best way to win|easy win|easiest way to win|always (?:play|keep|save|use|hold)|never play|to win,? you|how i win|i always win by|save your|hold (?:on to )?your|combo)\b/i.test(text);
}

// Requests about other games or apps
export function isOffTopic(text: string): boolean {
  const other = /\b(minecraft|fortnite|roblox|among us|gta|grand theft auto|call of duty|pokemon|pokémon|zelda|mario|sonic|valorant|league of legends|overwatch|apex legends|terraria|skyrim|halo|clash royale|clash of clans|candy crush|subway surfers|geometry dash|brawl stars|genshin|five nights at freddy'?s|fnaf|animal crossing|rocket league|rainbow six|counter-?strike|csgo|dota|stardew|tiktok|snapchat|instagram|my homework|my phone bill)\b/i;
  if (/\b(?:make|create|build|code|program|design)\s+(?:me\s+)?(?:a|an|another|your own|a new|new)\s+(?:\w+\s+){0,2}(?:game|app|website|site|mod|server)\b(?!\s+(?:mode|option|setting|card|button|version))/i.test(text) && !/\b(?:build that wall|this game|expansion)\b/i.test(text)) return true;
  const m = String(text).match(other);
  if (!m) return false;
  const comparison = new RegExp('\\b(?:like|similar to|as in|than|from|inspired by)\\s+(?:the\\s+)?(?:one in\\s+)?' + m[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  return !comparison.test(text);
}

// How-to questions that the rules already answer
export function isQuestion(text: string): boolean {
  const low = String(text).toLowerCase().trim();
  if (!/\?$/.test(low) && !/^(how|what|where|when|which|who)\b/.test(low)) return false;
  if (!/^(how|what|where|when|which|who|why|can i|can you|is there|are there|do i|does|is it|do you|should i)\b/.test(low)) return false;
  // "Can you add...", "Why is there no..." and anything with "please" are requests, not questions
  return !/^(?:can|could|would|will)\s+you\b|^why\b|\bplease\b|\bshould (?:add|be|have)\b|\bthere no\b|\bisn'?t there\b/.test(low);
}

const FAQ: [RegExp, string][] = [
  [/\b(win|winner|goal|end|ends|over|point)\b/, 'Goal: have the most miles of wall when the game ends. The game ends when a player completes 3 wall sets, or (in the faster game) when the Draw pile runs out. Either way, everyone else gets one final turn.'],
  [/\b(build|walls?|sections?|man hours?)\b/, 'To build, discard a Man Hour card (or 3 Wall Section cards) and lay a Wall Section in front of you. You can also discard 2 Wall Section cards to use them as a Man Hour (this uses 1 action).'],
  [/\b(miles?|score|points|sets?|stack)\b/, "Matching Wall Sections stack together: 1 section is 3 miles, 2 sections are 8 miles and 3 sections are 16 miles. 3 matching sections make a complete set, which can't be taken or destroyed."],
  [/\b(turns?|actions?|draw|end turn)\b/, 'On your turn: draw 3 cards, take up to 3 actions (building a wall or playing a card), then press End Turn.'],
  [/\b(red|immediately)\b/, "Play Immediately cards have a red title. You must use them right away, and they don't cost an action."],
  [/\b(zoom|read|bigger|qr|see the card|look at)\b/, "To zoom in on a card, right-click it (on a touch screen, press and hold it). Then press Scan Card's QR Code to open that card's web page."],
  [/\b(debt)\b/, 'Debt takes a built section from an opponent. They can block it with a Savings card.'],
  [/\b(self-defense|self defense|block|protect)\b/, 'Self-Defense stops a bad effect aimed at you. Savings blocks Debt, and Trump Train can protect a set of 2.'],
  [/\b(trump train|trump card|trump)\b/, 'Trump: discard it to draw 3 cards. Trump Train: draw 3 cards, or protect a set of 2.'],
  [/\b(voting machine)\b/, 'Voting Machine works like a Man Hour that builds 2 sections with one action.'],
  [/\b(how many players|players|bots?|computer)\b/, 'The game is for 2 to 6 players (3 or 4 is best). Change the number of players and bots in Settings.'],
  [/\b(gold|premium|trial|membership|pay|price|ads?)\b/, 'Gold gives you a colored star, name and background, holiday card backs, confetti, leaderboards and no video ads. Open Gold Membership on the main menu. Signed-in players can try it free for 7 days.'],
  [/\b(online|multiplayer|friends?|room code|join|host)\b/, 'To play with friends on different devices, set Game Mode to Multiplayer in Settings, then share your room code so they can join.'],
  [/\b(pass|share|one device|same device)\b/, "In Pass'n'Play, everyone shares one device. When a turn ends, pass the device to the player named on the screen; they tap the button to see their cards."],
  [/\b(sign in|log in|login|account|google)\b/, 'Open Account & Store on the main menu and choose Sign in with Google.'],
  [/\b(music|songs?|sound)\b/, 'Music and sound effects are in Settings, where you can add your own songs or YouTube links.'],
];

/** A short answer from the rules for a how-to question. */
export function answerFor(question: string): string {
  const low = String(question).toLowerCase();
  const hit = FAQ.find(([re]) => re.test(low));
  return hit ? hit[1] : 'The full rules are in Instructions on the main menu.';
}

// Someone who might be in danger or thinking about hurting themselves
export function isDistress(text: string): boolean {
  return /\b(kill(?:ing)? myself|want(?:ed)? to die|wanna die|wish i (?:was|were) dead|end (?:it all|my life)|suicid\w*|self[- ]?harm\w*|cut(?:ting)? myself|hurt(?:ing)? myself|no reason to live|don'?t want to (?:live|be alive)|nobody (?:cares about|loves) me|i'?m being (?:bullied|abused|hurt)|(?:someone|somebody) is (?:hurting|abusing|touching) me|(?:he|she|they|my \w+) (?:hits|beats|hurts|abuses) me)\b/i.test(String(text));
}

// NOTE: the original list had "cuz" twice (same meaning); it appears once here.
const EXPANSIONS: Record<string, string> = {
  u: 'you', ur: 'your', ya: 'you', yah: 'you', r: 'are', pls: 'please', plz: 'please', plox: 'please', pleez: 'please', thx: 'thanks', thnx: 'thanks', ty: 'thank you',
  idk: "I don't know", idc: "I don't care", imo: 'in my opinion', imho: 'in my opinion', tbh: 'to be honest', btw: 'by the way', fyi: 'for your information',
  nvm: 'never mind', irl: 'in real life', rn: 'right now', atm: 'at the moment', asap: 'as soon as possible', bc: 'because', bcuz: 'because', cuz: 'because',
  coz: 'because', cos: 'because', b4: 'before', gr8: 'great', '2day': 'today', tmrw: 'tomorrow', tmr: 'tomorrow', '2morrow': 'tomorrow', gonna: 'going to',
  wanna: 'want to', gotta: 'have to', kinda: 'kind of', sorta: 'sort of', dunno: "don't know", lemme: 'let me', gimme: 'give me', yea: 'yes', yeah: 'yes',
  ye: 'yes', yep: 'yes', yup: 'yes', nah: 'no', nope: 'no', k: 'okay', kk: 'okay', ok: 'okay', msg: 'message', lvl: 'level', lvls: 'levels', ppl: 'people',
  prob: 'probably', probs: 'probably', def: 'definitely', obv: 'obviously', obvi: 'obviously', tho: 'though', thru: 'through', nite: 'night', pic: 'picture',
  pics: 'pictures', vid: 'video', vids: 'videos', info: 'information', dev: 'developer', devs: 'developers', mins: 'minutes', secs: 'seconds', sec: 'second',
  approx: 'approximately', etc: 'and so on', vs: 'versus', ui: 'user interface', fps: 'frame rate', pc: 'computer', ai: 'bot', ais: 'bots', cpu: 'bot',
  npc: 'bot', npcs: 'bots', mp: 'multiplayer', gg: 'good game', dm: 'direct message', pfp: 'profile picture',
  dont: "don't", doesnt: "doesn't", didnt: "didn't", isnt: "isn't", arent: "aren't", wasnt: "wasn't", werent: "weren't", cant: "can't", wont: "won't",
  wouldnt: "wouldn't", couldnt: "couldn't", shouldnt: "shouldn't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", aint: "isn't", im: "I'm", ive: "I've",
  youre: "you're", theyre: "they're", thats: "that's", whats: "what's", theres: "there's", hes: "he's", shes: "she's", alot: 'a lot', definately: 'definitely',
  definatly: 'definitely', recieve: 'receive', seperate: 'separate', wierd: 'weird', untill: 'until', becuase: 'because', becasue: 'because', beacuse: 'because',
  teh: 'the', thier: 'their', freind: 'friend', freinds: 'friends', beleive: 'believe', occured: 'occurred', accross: 'across', tommorow: 'tomorrow',
  tomorow: 'tomorrow', realy: 'really', finaly: 'finally', begining: 'beginning', wich: 'which', ofcourse: 'of course', aswell: 'as well', infront: 'in front',
  everytime: 'every time', noone: 'no one', plaer: 'player', plyer: 'player', buton: 'button', setings: 'settings', becaus: 'because',
  shud: 'should', shld: 'should', cud: 'could', wud: 'would', wut: 'what', wat: 'what', wht: 'what', enuf: 'enough', btn: 'button', btns: 'buttons',
  doin: 'doing', goin: 'going', playin: 'playing', nothin: 'nothing', somethin: 'something', tryin: 'trying', gettin: 'getting', makin: 'making',
  sumthin: 'something', luv: 'love', rly: 'really', srsly: 'seriously', pwease: 'please', ipad: 'iPad', iphone: 'iPhone',
};

// Texting speak, abbreviations and common misspellings, written out in full
export function expand(text: string): string {
  let t = String(text)
    .replace(/\b(?:lol|lmao|lmfao|rofl|xd|xD|haha+|hehe+|omg|smh|ikr)\b[!.]*/gi, '')
    .replace(/\be\.g\.?(?=\s)/gi, 'for example').replace(/\bi\.e\.?(?=\s)/gi, 'that is')
    .replace(/\bw\/o\b/gi, 'without').replace(/\bw\/(?=\s|\w)/gi, 'with ').replace(/\bb\/c\b/gi, 'because').replace(/\bw\/e\b/gi, 'whatever')
    .replace(/([a-z])\1{2,}/gi, '$1$1');
  // NOTE: deliberate fix, see keyWords: "constructor" used to become "function Object() { [native code] }"
  t = t.replace(/[A-Za-z0-9']+/g, (w) => own(EXPANSIONS, w.toLowerCase()) ?? w);
  // Numbers used as words: "2 slow" is "too slow", "a btn 2 skip" is "to", "4 me" is "for"
  t = t.replace(/\b2\s+(slow|fast|hard|easy|long|short|big|small|many|much|loud|quiet|dark|bright|strong|weak|expensive|boring|confusing|difficult)\b/gi, 'too $1')
    .replace(/(?<=[a-z]\s)2(?=\s[a-z])/gi, 'to').replace(/(?<=[a-z]\s)4(?=\s[a-z])/gi, 'for')
    .replace(/\bits(?=\s+(?:too|so|not|really|very|kind of|a|an|the|going|always|never|hard|easy)\b)/gi, "it's")
    .replace(/\byour(?=\s+(?:so|too|not|going|gonna|being|really|very|the best|awesome|amazing)\b)/gi, "you're");
  t = t.replace(/\bsoo+\b/gi, 'so').replace(/\bnoo+\b/gi, 'no').replace(/\byess+\b/gi, 'yes').replace(/\bpleasee+\b/gi, 'please').replace(/\b(\w+)(?:\s+\1\b)+/gi, '$1')
    .replace(/\bi\b/g, 'I').replace(/,(?=\S)/g, ', ').replace(/\s{2,}/g, ' ').trim();
  return t;
}

// Finish a sentence: capital letter at the start, full stop at the end
export function tidy(text: string): string {
  const t = String(text).trim().replace(/^[a-z]/, (c) => c.toUpperCase());
  return /[.!?)]$/.test(t) ? t : t + '.';
}

/** Sounds like a bug report (so device details get added). */
export function isBug(text: string): boolean {
  return /\b(bug|glitch\w*|crash\w*|freez\w*|frozen|stuck|broken|not working|doesn'?t work|won'?t|can'?t|cannot|error|fail\w*|disappear\w*|overlap\w*|cut off|lag\w*|slow|wrong|missing|black screen|white screen|blank)\b/i.test(text);
}

// Not written in English? (Other alphabets, or mostly common words from other languages)
export function isForeign(text: string): boolean {
  const s = String(text), letters = (s.match(/\p{L}/gu) || []).length;
  if (!letters) return false;
  if ((s.match(/[^\x00-\x7FÀ-ɏ]/gu) || []).filter((c) => /\p{L}/u.test(c)).length / letters > 0.3) return true;
  const words = s.toLowerCase().match(/[\p{L}']+/gu) || [];
  const en = new Set('the and is to it you i a of that this for with please add make fix can game cards card my your not be are have would should'.split(' '));
  const other = new Set(('el los las que por para con una está muy juego pero más también porque cuando hay tiene puedo quiero cartas ' +
    'les des est pas je vous et jeu mais avec pour dans sur nous très merci cartes ' +
    'der das und ist nicht ich ein eine spiel bitte mit auch aber wenn kann sehr danke karten ' +
    'não é um jogo muito obrigado você ' +
    'il che non è gioco per favore grazie molto carte').split(' '));
  const e = words.filter((w) => en.has(w)).length, o = words.filter((w) => other.has(w)).length;
  return o >= 2 && o > e;
}

export interface PrivateReport {
  kind: 'cheat or exploit' | 'strategy tip';
  text: string;
}

export interface FeedbackResult {
  /** Public suggestions, tidied. */
  parts: string[];
  /** Cheats, exploits and strategy tips: only for the owner. */
  private: PrivateReport[];
  /** How-to questions the rules answer (shown to the player instead of sent). */
  questions: string[];
  /** Key words of each kept suggestion, to remember what was sent. */
  keys: string[][];
  /** Suggestions dropped because this player already sent them. */
  dupes: number;
  /** Sentences dropped as junk, adverts, hate, politics, off-topic... */
  dropped: number;
  /** The player may be in danger: sent untouched. */
  urgent: boolean;
  /** Part of the message tried to give orders to the filter. */
  injection: boolean;
  /** Not in English: sent as written for the owner's server to translate. */
  foreign: boolean;
  translatedFrom?: string;
  /** Device details, added for bug reports. */
  device: string;
  subject: string;
  message: string;
}

export interface FilterOptions {
  /** Key words of suggestions this player sent before. */
  seen?: string[][];
  /** Device details for bug reports. */
  deviceInfo?: () => string;
}

const list = (a: string[]) => (a.length > 1 ? a.map((p) => '- ' + p).join(NL) : (a[0] || ''));

// Splits feedback into sentences and keeps the useful, new, polite ones
export function filterFeedback(subject: string, message: string, opts: FilterOptions = {}): FeedbackResult {
  const full = [subject, message].filter(Boolean).join(NL);
  const out: FeedbackResult = { parts: [], private: [], questions: [], keys: [], dupes: 0, dropped: 0, urgent: false, injection: false, foreign: false, device: '', subject: '', message: '' };
  // Someone may be in danger: pass it on untouched and fast
  if (isDistress(full)) {
    out.urgent = true; out.parts = [full.trim()];
    out.subject = 'URGENT: a player may need help'; out.message = full.trim();
    return out;
  }
  out.foreign = isForeign(full);
  const seen = opts.seen ?? [];
  const pieces = [String(subject || '')].concat(String(message || '').replace(/\be\.g\./gi, 'for example').replace(/\bi\.e\./gi, 'that is')
    .split(/\n+|(?<=[.!?;])\s+|,\s+(?=(?:can|could|would|will|please|pls|plz|also|and|but)\b)/i));
  pieces.forEach((raw, i) => {
    let t = raw.replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, '').trim();
    if (!t) return;
    t = removePII(t);
    const link = stripLinks(t);
    if (link.promo) { out.dropped++; return; }
    t = link.t;
    if (isInjection(t)) { out.injection = true; out.dropped++; return; }
    if (isHate(t)) { out.dropped++; return; }
    // Other languages can't be judged by these English rules: the owner's server translates them
    // NOTE: so foreign sentences skip the duplicate check and are never remembered (no keys).
    if (out.foreign) { out.parts.push(t); return; }
    t = polite(expand(t));
    // NOTE: a subject (i = 0) that comes out empty isn't counted as dropped.
    if (!t) { if (i > 0) out.dropped++; return; }
    if (isPolitical(t) || isOffTopic(t)) { out.dropped++; return; }
    if (isQuestion(t)) { out.questions.push(t); return; }
    const exploit = isExploit(t);
    const strategy = !exploit && isStrategy(t) && !/\b(add|fix|change|remove|please|should|could you|can you|let|allow)\b/i.test(t);
    const useful = isUseful(t);
    if (!useful && !((exploit || strategy) && t.split(/\s+/).length >= 3)) { if (i > 0) out.dropped++; return; }
    const key = keyWords(t);
    if (out.keys.some((k) => sameSuggestion(k, key)) || seen.some((k) => sameSuggestion(k, key))) { out.dupes++; return; }
    out.keys.push(key);
    t = tidy(t);
    if (exploit || strategy) out.private.push({ kind: exploit ? 'cheat or exploit' : 'strategy tip', text: t });
    else out.parts.push(t);
  });
  if (out.parts.concat(out.private.map((p) => p.text)).some(isBug)) out.device = opts.deviceInfo?.() ?? '';
  out.message = list(out.parts);
  out.subject = (out.parts[0] || (out.private[0] && 'Private report') || '').slice(0, 70);
  return out;
}

// Everything the owner gets, as one readable email body (used by the simple form service)
export function feedbackBody(fb: FeedbackResult): string {
  let s = fb.message;
  if (fb.private.length) s += (s ? NL + NL : '') + 'PRIVATE (do not share publicly):' + NL + fb.private.map((p) => '- [' + p.kind + '] ' + p.text).join(NL);
  if (fb.foreign) s += NL + NL + '(Not written in English' + (fb.translatedFrom ? '; translated from ' + fb.translatedFrom : '') + '.)';
  if (fb.injection) s += NL + NL + '(Part of this message tried to give orders to the filter and was removed.)';
  if (fb.device) s += NL + NL + 'Device details (added automatically for bug reports):' + NL + fb.device;
  return s;
}
