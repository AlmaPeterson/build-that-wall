// The worldwide board over the public MQTT relay: one retained message on WORLD_BOARD_TOPIC.
// Read it, and with an update merge it in and publish it back (as the PenguinMod version did).
import type { Connect } from '../online/transport';
import { mergeWorldBoard, WORLD_BOARD_TOPIC, type Board, type WorldBoardTransport } from './leaderboard';

const READ_MS = 1800;      // wait this long for the retained board after subscribing
const SEND_MS = 600;       // let the publish go out before closing

export function mqttWorldBoard(connect: Connect, wait = (ms: number) => new Promise(r => setTimeout(r, ms))): WorldBoardTransport {
  return {
    async readAndUpdate(update) {
      let tr;
      try { tr = await connect(); } catch { return null; }
      if (!tr) return null;
      let got: Board | null = null;
      tr.onMessage((topic, payload) => {
        if (topic !== WORLD_BOARD_TOPIC) return;
        try { got = JSON.parse(payload) as Board; } catch { /* not a board */ }
      });
      await tr.subscribe(WORLD_BOARD_TOPIC);
      await wait(READ_MS);
      let board: Board = got ?? {};
      if (update) {
        board = mergeWorldBoard(board, update);
        tr.publish(WORLD_BOARD_TOPIC, JSON.stringify(board), true);
        await wait(SEND_MS);
      }
      tr.end();
      return board;
    },
  };
}
