// Every saved thing lives in localStorage as "btw:<key>". These names must not change,
// or players lose their saves when they move to the new version of the game.

export const PREFIX = 'btw:';

export const KEYS = {
  user: 'user',               // Google sign-in: {name, email, sub, token, exp}
  gname: 'gname',             // name from the older Google pop-up sign-in (googleAuth extension)
  gemail: 'gemail',           // email from the older Google pop-up sign-in
  name: 'name',               // the player's chosen name
  prefs: 'prefs',             // settings, as a JSON object of strings
  lb: 'lb',                   // this device's leaderboard: {name: {games, wins, best, walls, spent}}
  codes: 'codes',             // Gold codes (BTW1.<payload>.<signature>) as a JSON array
  paid: 'paid',               // purchases and server entitlements as a JSON array of PaidRecord
  trials: 'trials',           // emails that already used the free trial on this device
  trialDay: 'trialDay',       // "<exp>:<days left>" of the last trial countdown shown
  trialEnd: 'trialEnd',       // exp of the trial whose "trial ended" notice was shown
  freeclaims: 'freeclaims',   // free packs claimed: {"<pack>:<email>": 1, "server:<pack>": 1}
  aimem: 'aimem',             // what hard bots learned about each human
  fbsent: 'fbsent',           // feedback already sent (owned by the feedback service)
  fbraw: 'fbraw',             // raw feedback already sent (owned by the feedback service)
} as const;

// Cosmetics and stats that follow a signed-in player to the game server (see SAVE_KEYS in game-server.gs)
export const ACCOUNT_KEYS = ['name', 'back', 'color', 'starc', 'namebg', 'tutor', 'prefs', 'lb',
  'stat_games', 'stat_wins', 'stat_best', 'stat_walls'] as const;
export const ACCOUNT_KEY_RE = /^(name|back|color|starc|namebg|tutor|prefs|lb|stat_[a-z]+)$/;

// Keys that belong to the device, not to whoever is signed in. Full localStorage names.
export const DEVICE_KEY_RE = /^btw:(user|lb|aimem|trials|fbsent|fbraw|gname|gemail|acct:.*)$/;

// Where a signed-out account's data waits for the next sign-in: "btw:acct:g:<google sub>" or "btw:acct:e:<email>"
export const stashKey = (accountId: string) => PREFIX + 'acct:' + accountId;
