"use strict";

const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { WebSocketServer, WebSocket } = require("ws");
const { makeWall, tileCode, sortTiles, countsOf, patternsFor, fanTotal, winSettlement, gangSettlement } = require("./game-rules");

const requestedPort = Number(process.env.PORT);
const PORT = Number.isInteger(requestedPort) && requestedPort >= 0 ? requestedPort : 3000;
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const rooms = new Map();
const windNames = ["东", "南", "西", "北"];
const mimeTypes = { ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  const requestPath = decodeURIComponent((request.url || "/").split("?")[0]);
  const relativePath = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  if (!filePath.startsWith(ROOT) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); response.end("Not found"); return;
  }
  response.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream", "cache-control": "no-cache" });
  fs.createReadStream(filePath).pipe(response);
});

const wss = new WebSocketServer({ server, path: "/ws" });

function safeName(value) {
  const name = String(value || "牌友").replace(/[<>\r\n]/g, "").trim().slice(0, 10);
  return name || "牌友";
}
function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;
  do { code = Array.from({ length: 6 }, () => alphabet[crypto.randomInt(alphabet.length)]).join(""); } while (rooms.has(code));
  return code;
}
function makeToken() { return crypto.randomBytes(18).toString("base64url"); }
function send(socket, message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function sendError(socket, message) { send(socket, { type: "error", message }); }
function relativeSeat(actualSeat, viewerSeat) { return (actualSeat - viewerSeat + 4) % 4; }
function actualSeat(relative, viewerSeat) { return (relative + viewerSeat) % 4; }
function nextSeat(seat) { return (seat + 3) % 4; }

function createRoom(ownerSocket, payload) {
  const code = makeCode();
  const token = makeToken();
  const circles = [0, 4, 8, 12].includes(Number(payload.circles)) ? Number(payload.circles) : 0;
  const baseScore = [1, 2, 5, 10, 20].includes(Number(payload.baseScore)) ? Number(payload.baseScore) : 1;
  const room = {
    code,
    ownerSeat: 0,
    status: "waiting",
    circles,
    baseScore,
    players: [{ name: safeName(payload.name), token, socket: ownerSocket, connected: true }, null, null, null],
    match: null,
    game: null,
    timers: new Set(),
    touchedAt: Date.now(),
  };
  rooms.set(code, room);
  attachSession(ownerSocket, room, 0);
  send(ownerSocket, { type: "session", roomCode: code, seat: 0, token });
  broadcastRoom(room);
}

function joinRoom(socket, payload) {
  const code = String(payload.roomCode || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return sendError(socket, "房间不存在，请检查房间号");
  if (room.status !== "waiting") return sendError(socket, "牌局已经开始，只能使用原设备重连");
  const seat = room.players.findIndex((player) => !player);
  if (seat < 0) return sendError(socket, "房间已满");
  const token = makeToken();
  room.players[seat] = { name: safeName(payload.name), token, socket, connected: true };
  room.touchedAt = Date.now();
  attachSession(socket, room, seat);
  send(socket, { type: "session", roomCode: code, seat, token });
  broadcastRoom(room);
}

function reconnectRoom(socket, payload) {
  const code = String(payload.roomCode || "").trim().toUpperCase();
  const room = rooms.get(code);
  if (!room) return sendError(socket, "原房间已经失效");
  if (typeof payload.token !== "string" || !payload.token) return sendError(socket, "重连凭证无效");
  const seat = room.players.findIndex((player) => !player?.bot && player?.token === payload.token);
  if (seat < 0) return sendError(socket, "重连凭证无效");
  const player = room.players[seat];
  if (player.socket && player.socket !== socket) player.socket.close(4001, "在另一设备重连");
  player.socket = socket; player.connected = true; room.touchedAt = Date.now(); attachSession(socket, room, seat);
  send(socket, { type: "session", roomCode: code, seat, token: player.token, reconnected: true });
  broadcastRoom(room);
}

function addBot(room) {
  if (room.status !== "waiting") return false;
  const seat = room.players.findIndex((player) => !player);
  if (seat < 0) return false;
  const usedNumbers = new Set(room.players.filter((player) => player?.bot).map((player) => Number(player.name.replace(/\D/g, ""))));
  let number = 1;
  while (usedNumbers.has(number)) number += 1;
  room.players[seat] = { name: `电脑${number}`, token: null, socket: null, connected: true, bot: true };
  broadcastRoom(room);
  return true;
}

function removeBot(room) {
  if (room.status !== "waiting") return false;
  for (let seat = room.players.length - 1; seat >= 0; seat -= 1) {
    if (!room.players[seat]?.bot) continue;
    room.players[seat] = null;
    broadcastRoom(room);
    return true;
  }
  return false;
}

function attachSession(socket, room, seat) { socket.session = { roomCode: room.code, seat }; }
function clearRoomTimers(room) { room.timers.forEach(clearTimeout); room.timers.clear(); }
function later(room, callback, delay) { const timer = setTimeout(() => { room.timers.delete(timer); callback(); }, delay); room.timers.add(timer); return timer; }

function roomSnapshot(room, viewerSeat) {
  const players = [0, 1, 2, 3].map((relative) => {
    const seat = actualSeat(relative, viewerSeat);
    const player = room.players[seat];
    return player ? {
      name: player.name,
      connected: player.connected,
      bot: Boolean(player.bot),
      owner: seat === room.ownerSeat,
      seatWind: room.match ? room.match.seatWinds[seat] : null,
      handCount: room.game ? room.game.hands[seat].length : 0,
      melds: room.game ? room.game.melds[seat] : [],
    } : null;
  });
  const snapshot = {
    type: "state",
    roomCode: room.code,
    roomStatus: room.status,
    circles: room.circles,
    baseScore: room.baseScore,
    isOwner: viewerSeat === room.ownerSeat,
    players,
    connectedCount: room.players.filter((player) => player && (player.bot || player.connected)).length,
    botCount: room.players.filter((player) => player?.bot).length,
  };
  if (!room.match || !room.game) return snapshot;
  const game = room.game;
  const circleIndex = room.circles ? Math.floor(room.match.handIndex / 4) : 0;
  snapshot.match = {
    handIndex: room.match.handIndex,
    totalHands: room.match.totalHands,
    circleIndex,
    handInCircle: room.circles ? room.match.handIndex % 4 + 1 : 1,
    circleWind: circleIndex % 4,
    wins: [0, 1, 2, 3].map((relative) => room.match.wins[actualSeat(relative, viewerSeat)]),
    scores: [0, 1, 2, 3].map((relative) => room.match.scores[actualSeat(relative, viewerSeat)]),
  };
  snapshot.game = {
    phase: game.phase,
    dealing: game.phase === "dealing",
    over: game.phase === "finished",
    wallCount: game.wall.length,
    hand: game.hands[viewerSeat],
    drawnId: game.drawnIds[viewerSeat],
    turn: relativeSeat(game.turn, viewerSeat),
    dealer: relativeSeat(game.dealer, viewerSeat),
    river: game.river.map((discard) => ({ player: relativeSeat(discard.player, viewerSeat), tile: discard.tile })),
    last: game.last ? { from: relativeSeat(game.last.from, viewerSeat), tile: game.last.tile } : null,
    legal: legalActions(room, viewerSeat),
    result: game.result ? {
      ...game.result,
      winner: game.result.winner == null ? null : relativeSeat(game.result.winner, viewerSeat),
      discarder: game.result.discarder == null ? null : relativeSeat(game.result.discarder, viewerSeat),
      scoreDeltas: [0, 1, 2, 3].map((relative) => game.result.scoreDeltas[actualSeat(relative, viewerSeat)]),
      scores: [0, 1, 2, 3].map((relative) => game.result.scores[actualSeat(relative, viewerSeat)]),
      scoreEvents: game.result.scoreEvents.map((event) => ({
        ...event,
        winner: relativeSeat(event.winner, viewerSeat),
        source: event.source == null ? null : relativeSeat(event.source, viewerSeat),
        deltas: [0, 1, 2, 3].map((relative) => event.deltas[actualSeat(relative, viewerSeat)]),
      })),
    } : null,
  };
  return snapshot;
}

function legalActions(room, seat) {
  const game = room.game;
  const legal = { discard: false, hu: false, gang: false, peng: false, pass: false };
  if (!game || game.phase === "finished" || game.phase === "dealing") return legal;
  if (game.phase === "discard" && game.turn === seat) {
    legal.discard = true;
    legal.hu = patternsForSeat(room, seat).length > 0;
    legal.gang = countsOf(game.hands[seat]).some((count) => count === 4);
  }
  if (game.phase === "claim" && game.claimOptions?.[seat] && !(seat in game.claimResponses)) {
    Object.assign(legal, game.claimOptions[seat], { pass: true });
  }
  return legal;
}

function broadcastRoom(room) {
  room.touchedAt = Date.now();
  room.players.forEach((player, seat) => { if (player?.connected) send(player.socket, roomSnapshot(room, seat)); });
}

function randomSeatWinds() {
  const dealer = crypto.randomInt(4);
  return [0, 1, 2, 3].map((seat) => (dealer - seat + 4) % 4);
}
function currentCircleWind(room) {
  return room.circles ? Math.floor(room.match.handIndex / 4) % 4 : 0;
}
function patternsForSeat(room, seat, extraTile = null) {
  return patternsFor(room.game.hands[seat], room.game.melds[seat], extraTile, {
    seatWind: room.match.seatWinds[seat],
    circleWind: currentCircleWind(room),
  });
}
function applyScore(room, settlement, event) {
  settlement.deltas.forEach((delta, seat) => { room.match.scores[seat] += delta; });
  room.game.scoreEvents.push({ ...event, amount: settlement.amount, deltas: settlement.deltas });
}
function startMatch(room) {
  if (room.players.some((player) => !player || (!player.bot && !player.connected))) return false;
  room.match = { handIndex: 0, totalHands: room.circles ? room.circles * 4 : 1, seatWinds: randomSeatWinds(), wins: [0, 0, 0, 0], scores: [0, 0, 0, 0] };
  startHand(room); return true;
}
function startHand(room) {
  clearRoomTimers(room);
  const wall = makeWall();
  const hands = [[], [], [], []];
  for (let round = 0; round < 13; round += 1) for (let seat = 0; seat < 4; seat += 1) hands[seat].push(wall.pop());
  hands.forEach(sortTiles);
  const dealer = room.match.seatWinds.indexOf(0);
  room.status = "playing";
  room.game = { wall, hands, melds: [[], [], [], []], river: [], turn: dealer, dealer, phase: "dealing", drawnIds: [null, null, null, null], last: null, result: null, claimOptions: null, claimResponses: {}, handStartScores: [...room.match.scores], scoreEvents: [] };
  broadcastRoom(room);
  later(room, () => beginTurn(room), 2650);
}
function beginTurn(room) {
  const game = room.game;
  if (!game || game.phase === "finished") return;
  if (!game.wall.length) return finishDraw(room);
  const tile = game.wall.pop(); game.hands[game.turn].push(tile); game.drawnIds.fill(null); game.drawnIds[game.turn] = tile.id; game.phase = "discard"; broadcastRoom(room); scheduleBotTurn(room, game.turn);
}

function botKeepValue(hand, tile) {
  const counts = countsOf(hand);
  const code = tileCode(tile);
  let value = counts[code] * 4;
  if (code >= 27) return value;
  const position = code % 9;
  if (position > 0) value += counts[code - 1] * 2;
  if (position < 8) value += counts[code + 1] * 2;
  if (position > 1) value += counts[code - 2] * 0.7;
  if (position < 7) value += counts[code + 2] * 0.7;
  if (position === 0 || position === 8) value -= 0.4;
  return value;
}
function chooseBotDiscard(hand) {
  return [...hand].sort((a, b) => botKeepValue(hand, a) - botKeepValue(hand, b) || a.id.localeCompare(b.id))[0];
}
function scheduleBotTurn(room, seat) {
  if (!room.players[seat]?.bot) return;
  later(room, () => {
    const game = room.game;
    if (!game || game.phase !== "discard" || game.turn !== seat) return;
    const legal = legalActions(room, seat);
    if (legal.hu) return selfHu(room, seat);
    if (legal.gang && game.wall.length > 1 && crypto.randomInt(100) < 80) return concealedGang(room, seat);
    const tile = chooseBotDiscard(game.hands[seat]);
    if (tile) discard(room, seat, tile.id);
  }, 650 + crypto.randomInt(450));
}
function scheduleBotClaims(room) {
  Object.keys(room.game.claimOptions || {}).forEach((seatKey) => {
    const seat = Number(seatKey);
    if (!room.players[seat]?.bot) return;
    later(room, () => {
      const game = room.game;
      const options = game?.claimOptions?.[seat];
      if (!game || game.phase !== "claim" || !options || seat in game.claimResponses) return;
      const action = options.hu ? "hu" : options.gang ? "gang" : options.peng && crypto.randomInt(100) < 70 ? "peng" : "pass";
      respondClaim(room, seat, action);
    }, 420 + crypto.randomInt(380));
  });
}

function discard(room, seat, tileId) {
  const game = room.game;
  if (game.phase !== "discard" || game.turn !== seat) return false;
  const index = game.hands[seat].findIndex((tile) => tile.id === tileId);
  if (index < 0) return false;
  const [tile] = game.hands[seat].splice(index, 1); sortTiles(game.hands[seat]); game.drawnIds.fill(null);
  game.river.push({ player: seat, tile }); game.last = { from: seat, tile }; prepareClaims(room); return true;
}
function prepareClaims(room) {
  const game = room.game;
  game.claimOptions = {};
  game.claimResponses = {};
  for (let seat = 0; seat < 4; seat += 1) {
    if (seat === game.last.from) continue;
    const count = game.hands[seat].filter((tile) => tileCode(tile) === tileCode(game.last.tile)).length;
    const option = { hu: patternsForSeat(room, seat, game.last.tile).length > 0, gang: count >= 3, peng: count >= 2 };
    if (option.hu || option.gang || option.peng) game.claimOptions[seat] = option;
  }
  if (!Object.keys(game.claimOptions).length) return moveAfterDiscard(room);
  game.phase = "claim"; broadcastRoom(room); scheduleBotClaims(room); later(room, () => resolveClaims(room), 8000);
}
function respondClaim(room, seat, action) {
  const game = room.game;
  const options = game.claimOptions?.[seat];
  if (game.phase !== "claim" || !options || seat in game.claimResponses) return false;
  if (action !== "pass" && !options[action]) return false;
  game.claimResponses[seat] = action;
  if (Object.keys(game.claimResponses).length === Object.keys(game.claimOptions).length) resolveClaims(room); else broadcastRoom(room);
  return true;
}
function nearestSeat(seats, from) { return seats.sort((a, b) => (from - a + 4) % 4 - (from - b + 4) % 4)[0]; }
function resolveClaims(room) {
  const game = room.game;
  if (!game || game.phase !== "claim") return;
  const responses = Object.entries(game.claimResponses).map(([seat, action]) => ({ seat: Number(seat), action }));
  const huSeats = responses.filter((item) => item.action === "hu").map((item) => item.seat);
  if (huSeats.length) return finishGame(room, nearestSeat(huSeats, game.last.from), game.last.tile);
  for (const action of ["gang", "peng"]) {
    const seats = responses.filter((item) => item.action === action).map((item) => item.seat);
    if (seats.length) return applyClaim(room, nearestSeat(seats, game.last.from), action);
  }
  moveAfterDiscard(room);
}
function moveAfterDiscard(room) {
  const game = room.game; game.turn = nextSeat(game.last.from); game.phase = "drawing"; game.claimOptions = null; game.claimResponses = {}; broadcastRoom(room); later(room, () => beginTurn(room), 350);
}
function removeMatching(hand, code, amount) {
  const removed = [];
  for (let count = 0; count < amount; count += 1) { const index = hand.findIndex((tile) => tileCode(tile) === code); if (index < 0) return null; removed.push(hand.splice(index, 1)[0]); }
  return removed;
}
function applyClaim(room, seat, action) {
  const game = room.game;
  const source = game.last.from;
  const incoming = game.river.pop().tile;
  const amount = action === "peng" ? 2 : 3;
  const removed = removeMatching(game.hands[seat], tileCode(incoming), amount);
  if (!removed) return moveAfterDiscard(room);
  game.melds[seat].push({ type: action === "peng" ? "碰" : "杠", tiles: [...removed, incoming] });
  if (action === "gang") applyScore(room, gangSettlement({ baseScore: room.baseScore, winner: seat, source }), { type: "明杠", winner: seat, source });
  game.turn = seat; game.last = null; game.claimOptions = null; game.claimResponses = {}; sortTiles(game.hands[seat]);
  if (action === "gang") return drawSupplement(room, seat);
  game.phase = "discard"; broadcastRoom(room); scheduleBotTurn(room, seat);
}
function concealedGang(room, seat) {
  const game = room.game;
  if (game.phase !== "discard" || game.turn !== seat) return false;
  const code = countsOf(game.hands[seat]).findIndex((count) => count === 4);
  if (code < 0) return false;
  const removed = removeMatching(game.hands[seat], code, 4);
  game.melds[seat].push({ type: "暗杠", tiles: removed });
  applyScore(room, gangSettlement({ baseScore: room.baseScore, winner: seat, concealed: true }), { type: "暗杠", winner: seat, source: null });
  game.drawnIds[seat] = null; drawSupplement(room, seat); return true;
}
function drawSupplement(room, seat) {
  const game = room.game;
  if (!game.wall.length) return finishDraw(room);
  const tile = game.wall.pop(); game.hands[seat].push(tile); game.drawnIds.fill(null); game.drawnIds[seat] = tile.id; game.turn = seat; game.phase = "discard"; broadcastRoom(room); scheduleBotTurn(room, seat);
}
function selfHu(room, seat) {
  const game = room.game;
  if (game.phase !== "discard" || game.turn !== seat || !patternsForSeat(room, seat).length) return false;
  finishGame(room, seat, null); return true;
}
function finishGame(room, winner, winningTile) {
  const game = room.game;
  if (!game || game.phase === "finished") return;
  const patterns = patternsForSeat(room, winner, winningTile);
  const fan = fanTotal(patterns);
  const discarder = winningTile ? game.last.from : null;
  const settlement = winSettlement({ baseScore: room.baseScore, fan, winner, selfDraw: !winningTile, discarder });
  applyScore(room, settlement, { type: winningTile ? "点炮" : "自摸", winner, source: discarder });
  room.match.wins[winner] += 1;
  game.phase = "finished";
  game.result = { kind: "win", winner, winnerName: room.players[winner].name, discarder, selfDraw: !winningTile, patterns, fan, amount: settlement.amount, hand: sortTiles(winningTile ? [...game.hands[winner], winningTile] : [...game.hands[winner]]), melds: game.melds[winner], scoreDeltas: room.match.scores.map((score, seat) => score - game.handStartScores[seat]), scores: [...room.match.scores], scoreEvents: [...game.scoreEvents] };
  broadcastRoom(room);
}
function finishDraw(room) {
  const game = room.game;
  if (!game || game.phase === "finished") return;
  game.phase = "finished"; game.result = { kind: "draw", winner: null, winnerName: null, discarder: null, selfDraw: false, patterns: [], fan: 0, amount: 0, hand: [], melds: [], scoreDeltas: room.match.scores.map((score, seat) => score - game.handStartScores[seat]), scores: [...room.match.scores], scoreEvents: [...game.scoreEvents] }; broadcastRoom(room);
}
function advanceMatch(room) {
  if (room.game?.phase !== "finished") return false;
  if (!room.circles || room.match.handIndex + 1 >= room.match.totalHands) return startMatch(room);
  room.match.handIndex += 1;
  room.match.seatWinds = room.match.seatWinds.map((wind) => (wind + 3) % 4);
  startHand(room); return true;
}

function handleAction(socket, payload) {
  const session = socket.session;
  if (!session) return sendError(socket, "请先创建或加入房间");
  const room = rooms.get(session.roomCode);
  if (!room) return sendError(socket, "房间已经失效");
  const seat = session.seat;
  switch (payload.action) {
    case "start":
      if (seat !== room.ownerSeat) return sendError(socket, "只有房主可以开始");
      if (!startMatch(room)) return sendError(socket, "需要补满四个座位且真人在线才能开始");
      break;
    case "addBot":
      if (seat !== room.ownerSeat) return sendError(socket, "只有房主可以添加电脑玩家");
      if (!addBot(room)) sendError(socket, "当前无法添加电脑玩家");
      break;
    case "removeBot":
      if (seat !== room.ownerSeat) return sendError(socket, "只有房主可以移除电脑玩家");
      if (!removeBot(room)) sendError(socket, "当前没有可移除的电脑玩家");
      break;
    case "discard": if (!discard(room, seat, String(payload.tileId || ""))) sendError(socket, "当前不能打出这张牌"); break;
    case "peng": if (!respondClaim(room, seat, "peng")) sendError(socket, "当前不能碰"); break;
    case "mingGang": if (!respondClaim(room, seat, "gang")) sendError(socket, "当前不能明杠"); break;
    case "pass": if (!respondClaim(room, seat, "pass")) sendError(socket, "当前无需过牌"); break;
    case "dianHu": if (!respondClaim(room, seat, "hu")) sendError(socket, "当前不能点炮和牌"); break;
    case "gang": if (!concealedGang(room, seat)) sendError(socket, "当前不能暗杠"); break;
    case "hu": if (!selfHu(room, seat)) sendError(socket, "当前不能自摸"); break;
    case "next":
      if (seat !== room.ownerSeat) return sendError(socket, "请等待房主开始下一局");
      if (room.players.some((player) => !player || (!player.bot && !player.connected))) return sendError(socket, "有玩家离线，暂时不能继续");
      if (!advanceMatch(room)) sendError(socket, "当前不能开始下一局");
      break;
    default: sendError(socket, "未知操作");
  }
}

wss.on("connection", (socket) => {
  send(socket, { type: "connected" });
  socket.on("message", (raw) => {
    let payload;
    try { payload = JSON.parse(raw.toString()); } catch { return sendError(socket, "消息格式错误"); }
    if (payload.type === "create") createRoom(socket, payload);
    else if (payload.type === "join") joinRoom(socket, payload);
    else if (payload.type === "reconnect") reconnectRoom(socket, payload);
    else if (payload.type === "action") handleAction(socket, payload);
    else sendError(socket, "未知消息");
  });
  socket.on("close", () => {
    const session = socket.session;
    if (!session) return;
    const room = rooms.get(session.roomCode);
    const player = room?.players[session.seat];
    if (!room || !player || player.socket !== socket) return;
    player.connected = false; player.socket = null; room.touchedAt = Date.now(); broadcastRoom(room);
  });
});

setInterval(() => {
  const expiry = Date.now() - 30 * 60 * 1000;
  for (const [code, room] of rooms) if (room.touchedAt < expiry && room.players.filter((player) => !player?.bot).every((player) => !player?.connected)) { clearRoomTimers(room); rooms.delete(code); }
}, 60_000).unref();

server.listen(PORT, HOST, () => console.log(`六合麻将服务已启动：http://localhost:${server.address().port}`));

module.exports = { server, wss, rooms };
