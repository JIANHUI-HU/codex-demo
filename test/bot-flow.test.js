"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket } = require("ws");

test("房主可添加电脑并由电脑自动出牌", { timeout: 15_000 }, async () => {
  process.env.PORT = "0";
  const { server, wss, rooms } = require("../server");
  if (!server.listening) await once(server, "listening");
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/ws`);
  await once(socket, "open");

  const queue = [];
  const waiters = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const index = waiters.findIndex((waiter) => waiter.predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0].resolve(message);
    else queue.push(message);
  });
  function waitFor(predicate, timeout = 10_000) {
    const index = queue.findIndex(predicate);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve: (message) => { clearTimeout(timer); resolve(message); } };
      const timer = setTimeout(() => {
        const waiterIndex = waiters.indexOf(waiter);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error("等待电脑玩家状态超时"));
      }, timeout);
      waiters.push(waiter);
    });
  }

  socket.send(JSON.stringify({ type: "create", name: "房主", circles: 0, baseScore: 2 }));
  const session = await waitFor((message) => message.type === "session");
  for (let count = 0; count < 3; count += 1) socket.send(JSON.stringify({ type: "action", action: "addBot" }));
  const ready = await waitFor((message) => message.type === "state" && message.connectedCount === 4);
  assert.equal(ready.botCount, 3);
  assert.equal(ready.players.filter((player) => player?.bot).length, 3);

  socket.send(JSON.stringify({ type: "action", action: "start" }));
  await waitFor((message) => message.type === "state" && message.game?.phase === "dealing");
  const room = rooms.get(session.roomCode);
  room.game.turn = 1;
  room.game.dealer = 1;

  const acted = await waitFor((message) => message.type === "state" && (
    message.game?.river.some((discard) => discard.player === 1)
    || (message.game?.phase === "finished" && message.game.result?.winner === 1)
  ));
  assert.ok(acted.game.river.some((discard) => discard.player === 1) || acted.game.result?.winner === 1);

  room.timers.forEach(clearTimeout);
  room.timers.clear();
  socket.close();
  await new Promise((resolve) => wss.close(() => server.close(resolve)));
});
