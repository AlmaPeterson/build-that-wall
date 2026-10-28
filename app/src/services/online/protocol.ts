// Online play wire protocol: the same topics and JSON messages as the PenguinMod version,
// so old and new clients can share the public MQTT relay.
//
// Topics, for a room code like "K7Q2M" (world rooms start with "W"):
//   btwwall/v1/<code>/room       retained room info, read before joining and by quick match ("" = closed)
//   btwwall/v1/<code>/up         players -> host (every message carries the player's cid)
//   btwwall/v1/<code>/down       host -> every player
//   btwwall/v1/<code>/c/<cid>    host -> one player who is joining (welcome / full)

export const TOPIC_PREFIX = 'btwwall/v1/';
export const ALL_ROOMS = TOPIC_PREFIX + '+/room';

export function topics(code: string) {
  const base = TOPIC_PREFIX + code;
  return {
    room: base + '/room',
    up: base + '/up',
    down: base + '/down',
    client: (cid: string) => base + '/c/' + cid,
  };
}

/** The code from a ".../<code>/room" topic. */
export function codeFromTopic(topic: string): string {
  return topic.split('/')[2] ?? '';
}

/** Retained on the room topic by the host every few seconds. */
export interface RoomInfo {
  open: 1;
  players: number;
  max: number;
  running: 0 | 1;
  world: 0 | 1;
  /** Date.now() when the host last published it; old info means the host is gone. */
  ts: number;
}

// ---- game messages: can travel both ways, the host relays them between players

/** The whole shared game state, sent by whoever's turn it is when it changes. */
export interface StateMsg {
  t: 'state';
  // NOTE: the PenguinMod client sends { v: {variables}, l: {lists} } here (a snapshot of Scratch
  // variables). The envelope is the same, but the payload only means something to the same game version.
  data: unknown;
  from: number;
}

/** A question for another player's device (e.g. "block this card with Self-Defense?"). */
export interface AskMsg {
  t: 'ask';
  to: number;
  from: number;
  /** "<counter>-<asking seat>" */
  id: string;
  l1: string;
  l2: string;
  l3: string;
  card: number;
  mode: string;
}

export interface AnswerMsg {
  t: 'answer';
  to: number;
  id: string;
  value: string;
}

/** Ask the device that controls the current turn to end it. */
export interface EndTurnMsg {
  t: 'endturn';
  to: number;
}

/**
 * Anything else a game version wants to send (the TypeScript game uses it for per-player snapshots and
 * actions). Host -> one player travels on that player's own topic; player -> host on /up. Older clients ignore it.
 */
export interface DataMsg {
  t: 'x';
  to: number;
  from: number;
  data: unknown;
}

export type GameMsg = StateMsg | AskMsg | AnswerMsg | EndTurnMsg | DataMsg;

// ---- player -> host (on /up)

export type UpMsg =
  | { t: 'hello'; cid: string }
  | { t: 'bye'; cid: string }
  | { t: 'hb'; cid: string }
  | (GameMsg & { cid: string });

// ---- host -> players (on /down, or /c/<cid> while joining)

export type DownMsg =
  | { t: 'welcome'; seat: number; spectator?: true }
  | { t: 'full' }
  | { t: 'playerleft'; seat: number }
  | { t: 'hb' }
  | { t: 'end' }
  /** _except: the seat this was relayed from, which ignores it. */
  | (GameMsg & { _except?: number; cid?: string });

export type AnyMsg = UpMsg | DownMsg;

/** Parse a payload, or null if it isn't a message. */
export function parseMsg(text: string): AnyMsg | null {
  if (!text) return null;
  try {
    const d: unknown = JSON.parse(text);
    return d && typeof d === 'object' && typeof (d as { t?: unknown }).t === 'string' ? (d as AnyMsg) : null;
  } catch {
    return null;
  }
}

export function parseRoomInfo(text: string): RoomInfo | null {
  if (!text) return null;
  try {
    const d: unknown = JSON.parse(text);
    return d && typeof d === 'object' ? (d as RoomInfo) : null;
  } catch {
    return null;
  }
}
