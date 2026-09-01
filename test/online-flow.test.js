"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { WebSocket } = require("ws");

test("四位玩家可创建、加入并同步发牌", { timeout: 12_000 }, async () => {
  process.env.PORT = "0";
  const { server, wss } = require("../server");
  if (!server.listening) await once(server, "listening");
  const port = server.address().port;
  const cookies = await Promise.all(Array.from({ length: 4 }, async (_, index) => {
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `player${index}@example.com`, password: "mahjong88", nickname: index ? `牌友${index}` : "房主" }),
    });
    assert.equal(response.status, 201);
    return response.headers.get("set-cookie").split(";")[0];
  }));
  const clients = await Promise.all(cookies.map((cookie) => new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Cookie: cookie } });
    socket.once("open", () => resolve(socket)); socket.once("error", reject);
  })));
  const queues = clients.map(() => []);
  const waiters = clients.map(() => []);
  clients.forEach((client, index) => client.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const waiterIndex = waiters[index].findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) waiters[index].splice(waiterIndex, 1)[0].resolve(message); else queues[index].push(message);
  }));
  function waitFor(index, predicate) {
    const queuedIndex = queues[index].findIndex(predicate);
    if (queuedIndex >= 0) return Promise.resolve(queues[index].splice(queuedIndex, 1)[0]);
    return new Promise((resolve) => waiters[index].push({ predicate, resolve }));
  }
  clients[0].send(JSON.stringify({ type: "create", name: "房主", circles: 0, baseScore: 5 }));
  const session = await waitFor(0, (message) => message.type === "session");
  for (let index = 1; index < 4; index += 1) {
    clients[index].send(JSON.stringify({ type: "join", name: `牌友${index}`, roomCode: session.roomCode }));
    await waitFor(index, (message) => message.type === "session");
  }
  const ready = await waitFor(0, (message) => message.type === "state" && message.connectedCount === 4);
  assert.equal(ready.players.filter(Boolean).length, 4);
  assert.equal(ready.baseScore, 5);
  clients[0].send(JSON.stringify({ type: "action", action: "start" }));
  const dealtStates = await Promise.all([0, 1, 2, 3].map((index) => waitFor(index, (message) => message.type === "state" && message.game?.phase === "discard")));
  assert.equal(dealtStates.filter((state) => state.game.turn === 0).length, 1);
  dealtStates.forEach((state) => {
    assert.equal(state.game.hand.length, state.game.turn === 0 ? 14 : 13);
    assert.equal(state.players.length, 4);
    assert.deepEqual(state.match.scores, [0, 0, 0, 0]);
    assert.equal(state.players[state.game.turn].seatWind, 0);
  });
  const activeClient = dealtStates.findIndex((state) => state.game.turn === 0);
  const discardedId = dealtStates[activeClient].game.hand[0].id;
  clients[activeClient].send(JSON.stringify({ type: "action", action: "discard", tileId: discardedId }));
  const afterDiscard = await Promise.all([0, 1, 2, 3].map((index) => waitFor(index, (message) => message.type === "state" && message.game?.river.length === 1)));
  afterDiscard.forEach((state, index) => {
    assert.equal(state.game.river[0].tile.id, discardedId);
    if (state.game.legal.pass) clients[index].send(JSON.stringify({ type: "action", action: "pass" }));
  });
  const nextTurnStates = await Promise.all([0, 1, 2, 3].map((index) => waitFor(index, (message) => message.type === "state" && message.game?.phase === "discard" && message.game.river.length === 1 && message.game.wallCount === 82)));
  assert.equal(nextTurnStates.filter((state) => state.game.turn === 0).length, 1);
  nextTurnStates.forEach((state) => assert.equal(state.players[state.game.turn].seatWind, 1));
  clients.forEach((client) => client.close());
  await new Promise((resolve) => wss.close(() => server.close(resolve)));
});
