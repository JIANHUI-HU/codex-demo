"use strict";

const $ = (selector) => document.querySelector(selector);
const windNames = ["东", "南", "西", "北"];
const chineseNumbers = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const storageKey = "liuhe-online-session";
const nameKey = "liuhe-online-name";
const handElement = $("#online-hand");
const riverElements = [0, 1, 2, 3].map((seat) => $(`#online-river-${seat}`));
let socket;
let roomState = null;
let selectedTileId = null;
let selectedCircles = 0;
let reconnectTimer;
let lastPhase = null;
let shownResultKey = null;

function websocketUrl() {
  const configured = new URLSearchParams(location.search).get("server");
  if (configured) return configured;
  if (location.protocol === "file:") return "ws://localhost:3000/ws";
  return `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`;
}
function savedSession() { try { return JSON.parse(localStorage.getItem(storageKey)); } catch { return null; } }
function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) { showToast("尚未连接到联机服务器"); return false; }
  socket.send(JSON.stringify(message)); return true;
}
function setConnection(status, text) {
  const element = $("#connection-state"); element.className = `connection-state ${status}`; element.textContent = text;
  document.querySelector(".online-game")?.classList.toggle("disconnected", status !== "connected");
}

function connect() {
  clearTimeout(reconnectTimer);
  setConnection("", "连接中");
  socket = new WebSocket(websocketUrl());
  socket.onopen = () => {
    setConnection("connected", "已连接");
    const session = savedSession();
    if (session?.roomCode && session?.token) send({ type: "reconnect", ...session });
  };
  socket.onmessage = (event) => {
    let message;
    try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === "session") {
      localStorage.setItem(storageKey, JSON.stringify({ roomCode: message.roomCode, token: message.token }));
      return;
    }
    if (message.type === "state") { applyState(message); return; }
    if (message.type === "error") {
      showToast(message.message);
      if (/失效|无效/.test(message.message)) { localStorage.removeItem(storageKey); roomState = null; showLobbyEntry(); }
    }
  };
  socket.onclose = () => { setConnection("offline", "已断线"); reconnectTimer = setTimeout(connect, 2200); };
  socket.onerror = () => setConnection("offline", "连接失败");
}

function applyState(nextState) {
  const previousPhase = lastPhase;
  roomState = nextState;
  if (nextState.roomStatus === "waiting") renderWaitingRoom();
  else renderOnlineGame();
  lastPhase = nextState.game?.phase || null;
  if (nextState.game?.phase === "dealing" && previousPhase !== "dealing") {
    try { $("#online-result-dialog").close(); } catch {}
    shownResultKey = null;
    playDealAnimation(nextState.game.dealer);
  }
  if (nextState.game?.phase === "finished") showResult(nextState);
}

function showLobbyEntry() {
  $("#lobby").hidden = false; $("#lobby-entry").hidden = false; $("#waiting-room").hidden = true; $("#online-table").hidden = true;
}
function renderWaitingRoom() {
  $("#lobby").hidden = false; $("#lobby-entry").hidden = true; $("#waiting-room").hidden = false; $("#online-table").hidden = true;
  $("#room-code").textContent = roomState.roomCode;
  const list = $("#waiting-players"); list.replaceChildren();
  roomState.players.forEach((player, index) => {
    const item = document.createElement("li"); item.dataset.seat = index === 0 ? "我" : index === 1 ? "左" : index === 2 ? "对" : "右";
    if (!player) { item.className = "empty"; item.textContent = "等待加入"; }
    else { item.classList.toggle("offline", !player.connected); item.innerHTML = `<span>${escapeHtml(player.name)}${index === 0 ? "（你）" : ""}</span>${player.owner ? "<em>房主</em>" : ""}`; }
    list.append(item);
  });
  const ready = roomState.connectedCount === 4;
  $("#waiting-hint").textContent = ready ? "四位玩家已到齐" : `已加入 ${roomState.connectedCount}/4，等待牌友加入…`;
  const startButton = $("#start-online-game"); startButton.hidden = !roomState.isOwner; startButton.disabled = !ready; startButton.textContent = ready ? "开始牌局" : "四人到齐后开始";
}

function tileCode(tile) { return tile.suitIndex === 3 ? 27 + tile.number : tile.suitIndex * 9 + tile.number - 1; }
function tileFace(tile) {
  if (tile.suitIndex === 0) return `<div class="wan"><strong>${chineseNumbers[tile.number]}</strong><span>萬</span></div>`;
  if (tile.suitIndex === 1) return `<div class="dots n${tile.number}">${Array(tile.number).fill("<i></i>").join("")}</div>`;
  if (tile.suitIndex === 2) return tile.number === 1 ? `<div class="bird"><i></i><b>竹</b></div>` : `<div class="bams n${tile.number}">${Array(tile.number).fill("<i></i>").join("")}</div>`;
  return `<div class="honor h${tile.number}">${tile.suit}</div>`;
}
function createTile(tile, small = false) {
  const button = document.createElement("button"); button.className = `tile s${tile.suitIndex}${small ? " small" : ""}`; button.dataset.id = tile.id; button.innerHTML = `<div class="tile-inset">${tileFace(tile)}</div>`; return button;
}

function renderMelds() {
  const selfRoot = $("#online-my-melds"); selfRoot.replaceChildren();
  (roomState.players[0]?.melds || []).forEach((meld) => {
    const group = document.createElement("div"); group.className = "meld";
    meld.tiles.forEach((tile) => group.append(createTile(tile, true)));
    const label = document.createElement("span"); label.textContent = meld.type; group.append(label); selfRoot.append(group);
  });
  for (let seat = 1; seat < 4; seat += 1) {
    const root = $(`#online-melds-${seat}`); root.replaceChildren();
    (roomState.players[seat]?.melds || []).forEach((meld) => {
      const group = document.createElement("div"); group.className = "opponent-meld";
      meld.tiles.forEach((tile) => { const face = createTile(tile, true); face.disabled = true; group.append(face); }); root.append(group);
    });
  }
}

function renderOnlineGame() {
  const { game, match: matchState, players } = roomState;
  $("#lobby").hidden = true; $("#online-table").hidden = false;
  document.querySelector(".online-game").classList.toggle("dealing", game.dealing);
  $("#table-room-code").textContent = `房间 ${roomState.roomCode}`;
  const circleWind = windNames[matchState.circleWind];
  $("#match-progress").textContent = roomState.circles ? `第 ${matchState.circleIndex + 1}/${roomState.circles} 圈 · 本圈第 ${matchState.handInCircle}/4 局` : "单局 · 门风随机";
  $("#online-round-label").textContent = `${circleWind}风圈 · 第${matchState.handInCircle}局`;
  $("#online-wall-count").textContent = game.wallCount;
  $("#self-name").textContent = players[0]?.name || "你";
  $("#online-self-wind").textContent = `${windNames[players[0]?.seatWind ?? 0]}家`;
  for (let seat = 1; seat < 4; seat += 1) {
    const player = players[seat]; const element = $(`#online-player-${seat}`);
    element.querySelector("b").textContent = player ? windNames[player.seatWind] : "·";
    element.querySelector("p strong").textContent = player?.name || "空位";
    element.querySelector("p span").textContent = player ? `${player.handCount} 张${player.connected ? "" : " · 离线"}` : "";
    element.querySelector("p em").textContent = player?.melds.map((meld) => meld.type).join(" · ") || "";
    element.classList.toggle("active", game.turn === seat && !game.over && !game.dealing);
  }
  renderMelds();
  handElement.replaceChildren();
  game.hand.forEach((tile) => {
    const face = createTile(tile); face.classList.toggle("drawn", tile.id === game.drawnId); face.classList.toggle("selected", tile.id === selectedTileId);
    face.onclick = () => { if (!game.legal.discard) return; selectedTileId = selectedTileId === tile.id ? null : tile.id; renderOnlineGame(); };
    handElement.append(face);
  });
  if (!game.hand.some((tile) => tile.id === selectedTileId)) selectedTileId = null;
  $("#online-hand-status").textContent = game.dealing ? "发牌中" : `${game.hand.length} 张`;
  riverElements.forEach((river) => river.replaceChildren());
  game.river.forEach((discard) => { const face = createTile(discard.tile, true); face.disabled = true; riverElements[discard.player].append(face); });
  $("#online-discard-btn").disabled = !game.legal.discard || !selectedTileId;
  $("#online-gang-btn").disabled = !game.legal.gang;
  $("#online-hu-btn").disabled = !game.legal.hu || game.phase === "claim";
  const claimBox = $("#online-claim-controls"); claimBox.hidden = !game.legal.pass;
  $("#online-peng-btn").disabled = !game.legal.peng; $("#online-ming-gang-btn").disabled = !game.legal.gang; $("#online-dian-hu-btn").disabled = !game.legal.hu;
  const turnPlayer = players[game.turn]?.name || "牌友";
  $("#online-turn-label").textContent = game.dealing ? "正在发牌…" : game.over ? "本局结束" : game.phase === "claim" && game.legal.pass ? "请碰、杠、胡，或过牌" : game.turn === 0 ? "轮到你出牌" : `等待 ${turnPlayer} 出牌…`;
}

function playDealAnimation(dealer) {
  const felt = document.querySelector(".online-game .felt");
  felt.querySelector(".deal-layer")?.remove();
  const layer = document.createElement("div"); layer.className = "deal-layer"; layer.innerHTML = `<div class="deal-stack"><i></i><i></i><i></i></div><div class="deal-caption">正在发牌</div>`; felt.append(layer);
  const width = felt.clientWidth; const height = felt.clientHeight;
  const destinations = [{ x: 0, y: height * .36, r: 0 }, { x: -width * .39, y: 0, r: 90 }, { x: 0, y: -height * .35, r: 180 }, { x: width * .39, y: 0, r: -90 }];
  for (let index = 0; index < 52; index += 1) {
    const destination = destinations[(dealer + index) % 4]; const card = document.createElement("i"); card.className = "deal-card";
    card.style.setProperty("--deal-x", `${destination.x}px`); card.style.setProperty("--deal-y", `${destination.y}px`); card.style.setProperty("--deal-r", `${destination.r}deg`); card.style.setProperty("--deal-delay", `${index * 38}ms`); layer.append(card);
  }
  setTimeout(() => { layer.classList.add("finishing"); setTimeout(() => layer.remove(), 260); }, 2360);
}

function showResult(state) {
  const result = state.game.result;
  if (!result) return;
  const key = `${state.match.handIndex}-${result.kind}-${result.winner}`;
  if (shownResultKey === key) return;
  shownResultKey = key;
  const dialog = $("#online-result-dialog");
  if (result.kind === "draw") { $("#online-result-eyebrow").textContent = "牌墙摸尽"; $("#online-result-title").textContent = "流局"; }
  else {
    const winnerName = result.winner === 0 ? "你" : state.players[result.winner]?.name || result.winnerName;
    $("#online-result-eyebrow").textContent = `${winnerName}${result.selfDraw ? "自摸" : "接炮"}`;
    $("#online-result-title").textContent = result.patterns.join(" · ") || "和牌";
  }
  const hand = $("#online-result-hand"); hand.replaceChildren(); result.hand.forEach((tile) => { const face = createTile(tile); face.disabled = true; hand.append(face); });
  const melds = $("#online-result-melds"); melds.replaceChildren(); result.melds.forEach((meld) => { const group = document.createElement("div"); group.className = "result-meld"; meld.tiles.forEach((tile) => { const face = createTile(tile, true); face.disabled = true; group.append(face); }); const label = document.createElement("span"); label.textContent = meld.type; group.append(label); melds.append(group); });
  $("#online-result-patterns").innerHTML = result.kind === "draw" ? "<span>本局无人和牌</span>" : result.patterns.map((pattern) => `<span>${pattern}</span>`).join("") + `<span>共 ${result.fan} 番</span>`;
  const next = $("#online-next-btn"); next.disabled = !state.isOwner; next.textContent = state.isOwner ? (state.match.handIndex + 1 >= state.match.totalHands ? "再开一场" : "下一局") : "等待房主开始下一局";
  setTimeout(() => { if (!dialog.open) dialog.showModal(); }, 150);
}

function escapeHtml(text) { const div = document.createElement("div"); div.textContent = text; return div.innerHTML; }
function showToast(message) { const toast = $("#online-toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 1800); }

$("#nickname").value = localStorage.getItem(nameKey) || "";
const queryRoom = new URLSearchParams(location.search).get("room"); if (queryRoom) $("#room-code-input").value = queryRoom.toUpperCase();
document.querySelectorAll(".online-mode-buttons button").forEach((button) => { button.onclick = () => { selectedCircles = Number(button.dataset.circles); document.querySelectorAll(".online-mode-buttons button").forEach((item) => item.classList.toggle("active", item === button)); }; });
$("#create-room").onclick = () => { const name = $("#nickname").value.trim(); if (!name) return showToast("请先输入称呼"); localStorage.setItem(nameKey, name); localStorage.removeItem(storageKey); send({ type: "create", name, circles: selectedCircles }); };
$("#join-room").onclick = () => { const name = $("#nickname").value.trim(), roomCode = $("#room-code-input").value.trim().toUpperCase(); if (!name || roomCode.length !== 6) return showToast("请输入称呼和六位房间号"); localStorage.setItem(nameKey, name); localStorage.removeItem(storageKey); send({ type: "join", name, roomCode }); };
$("#copy-room-code").onclick = async () => { const invite = `${location.origin}${location.pathname}?room=${roomState.roomCode}`; try { await navigator.clipboard.writeText(location.protocol === "file:" ? roomState.roomCode : invite); showToast("邀请信息已复制"); } catch { showToast(`房间号：${roomState.roomCode}`); } };
$("#start-online-game").onclick = () => send({ type: "action", action: "start" });
$("#online-discard-btn").onclick = () => { if (selectedTileId) send({ type: "action", action: "discard", tileId: selectedTileId }); };
$("#online-gang-btn").onclick = () => send({ type: "action", action: "gang" });
$("#online-hu-btn").onclick = () => send({ type: "action", action: "hu" });
$("#online-peng-btn").onclick = () => send({ type: "action", action: "peng" });
$("#online-ming-gang-btn").onclick = () => send({ type: "action", action: "mingGang" });
$("#online-dian-hu-btn").onclick = () => send({ type: "action", action: "dianHu" });
$("#online-pass-btn").onclick = () => send({ type: "action", action: "pass" });
$("#online-sort-btn").onclick = () => { roomState?.game?.hand.sort((a, b) => tileCode(a) - tileCode(b)); if (roomState) { roomState.game.drawnId = null; renderOnlineGame(); } };
$("#online-next-btn").onclick = () => send({ type: "action", action: "next" });

showLobbyEntry();
connect();
