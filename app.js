"use strict";

const suits = ["万", "筒", "条"];
const honors = ["东", "南", "西", "北", "中", "发", "白"];
const names = ["你", "小六", "阿北", "老庄"];
const windNames = ["东", "南", "西", "北"];
const chineseNumbers = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const $ = (selector) => document.querySelector(selector);
const handElement = $("#hand");
const riverElements = [0, 1, 2, 3].map((player) => $(`#river-${player}`));
const discardButton = $("#discard-btn");
const huButton = $("#hu-btn");
const gangButton = $("#gang-btn");
const claimBox = $("#claim-controls");
let game;
let timer;
let match;

function makeWall() {
  const wall = [];
  suits.forEach((suit, suitIndex) => {
    for (let number = 1; number <= 9; number += 1) {
      for (let copy = 0; copy < 4; copy += 1) wall.push({ suit, suitIndex, number, id: `${suitIndex}-${number}-${copy}` });
    }
  });
  honors.forEach((suit, number) => {
    for (let copy = 0; copy < 4; copy += 1) wall.push({ suit, suitIndex: 3, number, id: `3-${number}-${copy}` });
  });
  for (let index = wall.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [wall[index], wall[randomIndex]] = [wall[randomIndex], wall[index]];
  }
  return wall;
}

const tileCode = (tile) => tile.suitIndex === 3 ? 27 + tile.number : tile.suitIndex * 9 + tile.number - 1;
const sortHand = (player) => game.hands[player].sort((a, b) => tileCode(a) - tileCode(b));
const nextPlayer = (player) => (player + 3) % 4;

function shuffledSeatWinds() {
  const dealer = Math.floor(Math.random() * 4);
  // 仅随机东家所在座位；门风必须依桌面座次连续排列，不能把四种风完全打乱。
  // 玩家索引按下、左、上、右排列。例如右家为东时，依次应为：右东、上南、左西、下北。
  return [0, 1, 2, 3].map((player) => (dealer - player + 4) % 4);
}

function startMatch(circles = 0) {
  match = {
    circles,
    totalHands: circles ? circles * 4 : 1,
    handIndex: 0,
    seatWinds: shuffledSeatWinds(),
    wins: [0, 0, 0, 0],
  };
  document.querySelectorAll(".mode-buttons button").forEach((button) => button.classList.toggle("active", Number(button.dataset.circles) === circles));
  startGame();
}

function currentCircleIndex() { return match.circles ? Math.floor(match.handIndex / 4) : 0; }

function updateMatchDisplay() {
  const circleIndex = currentCircleIndex();
  const circleWind = windNames[circleIndex % 4];
  const handInCircle = match.circles ? match.handIndex % 4 + 1 : 1;
  $("#round-label").textContent = `${circleWind}风圈 · 第${handInCircle}局`;
  $("#match-progress").textContent = match.circles
    ? `第 ${circleIndex + 1} / ${match.circles} 圈 · 本圈第 ${handInCircle} / 4 局 · ${circleWind}风圈`
    : `单局 · ${circleWind}风圈 · 门风随机`;
  match.seatWinds.forEach((wind, player) => {
    if (player === 0) $("#self-wind").textContent = `${windNames[wind]}家`;
    else $(`#wind-${player}`).textContent = windNames[wind];
  });
}

function startGame() {
  clearTimeout(timer);
  document.querySelector(".deal-layer")?.remove();
  const wall = makeWall();
  const hands = [[], [], [], []];
  for (let round = 0; round < 13; round += 1) for (let player = 0; player < 4; player += 1) hands[player].push(wall.pop());
  const dealer = match.seatWinds.indexOf(0);
  game = { wall, hands, melds: [[], [], [], []], river: [], turn: dealer, dealer, phase: "dealing", selected: null, last: null, over: false, drawnId: null, dealing: true };
  hands.forEach((_, player) => sortHand(player));
  try { $("#result-dialog").close(); } catch {}
  updateMatchDisplay();
  render();
  playDealAnimation();
}

function playDealAnimation() {
  const currentGame = game;
  const felt = document.querySelector(".felt");
  const layer = document.createElement("div");
  layer.className = "deal-layer";
  layer.innerHTML = `<div class="deal-stack"><i></i><i></i><i></i></div><div class="deal-caption">正在发牌</div>`;
  felt.append(layer);
  const width = felt.clientWidth;
  const height = felt.clientHeight;
  const destinations = [
    { x: 0, y: height * 0.36, rotation: 0 },
    { x: -width * 0.39, y: 0, rotation: 90 },
    { x: 0, y: -height * 0.35, rotation: 180 },
    { x: width * 0.39, y: 0, rotation: -90 },
  ];
  for (let index = 0; index < 52; index += 1) {
    const player = (game.dealer - index + 52) % 4;
    const destination = destinations[player];
    const card = document.createElement("i");
    card.className = "deal-card";
    card.style.setProperty("--deal-x", `${destination.x}px`);
    card.style.setProperty("--deal-y", `${destination.y}px`);
    card.style.setProperty("--deal-r", `${destination.rotation}deg`);
    card.style.setProperty("--deal-delay", `${index * 38}ms`);
    layer.append(card);
  }
  timer = setTimeout(() => {
    if (game !== currentGame) return;
    layer.classList.add("finishing");
    game.dealing = false;
    game.phase = "turn";
    render();
    setTimeout(() => layer.remove(), 260);
    timer = setTimeout(beginTurn, 320);
  }, 52 * 38 + 380);
}

function countsOf(hand) {
  const counts = Array(34).fill(0);
  hand.forEach((tile) => { counts[tileCode(tile)] += 1; });
  return counts;
}

function canFormMelds(counts) {
  const first = counts.findIndex(Boolean);
  if (first < 0) return true;
  if (counts[first] >= 3) {
    counts[first] -= 3;
    if (canFormMelds(counts)) { counts[first] += 3; return true; }
    counts[first] += 3;
  }
  if (first < 27 && first % 9 < 7 && counts[first + 1] && counts[first + 2]) {
    counts[first] -= 1; counts[first + 1] -= 1; counts[first + 2] -= 1;
    if (canFormMelds(counts)) { counts[first] += 1; counts[first + 1] += 1; counts[first + 2] += 1; return true; }
    counts[first] += 1; counts[first + 1] += 1; counts[first + 2] += 1;
  }
  return false;
}

function isStandardWin(hand) {
  if (hand.length % 3 !== 2) return false;
  const counts = countsOf(hand);
  for (let index = 0; index < 34; index += 1) {
    if (counts[index] < 2) continue;
    counts[index] -= 2;
    if (canFormMelds(counts)) return true;
    counts[index] += 2;
  }
  return false;
}

function isAllSequences(hand) {
  const base = countsOf(hand);
  for (let pair = 0; pair < 27; pair += 1) {
    if (base[pair] < 2) continue;
    const counts = [...base]; counts[pair] -= 2;
    let valid = counts.slice(27).every((value) => !value);
    for (let index = 0; index < 27 && valid; index += 1) {
      while (counts[index]) {
        if (index % 9 > 6 || !counts[index + 1] || !counts[index + 2]) { valid = false; break; }
        counts[index] -= 1; counts[index + 1] -= 1; counts[index + 2] -= 1;
      }
    }
    if (valid) return true;
  }
  return false;
}

function patternsFor(player, extraTile = null) {
  const hand = extraTile ? [...game.hands[player], extraTile] : game.hands[player];
  if (!isStandardWin(hand)) return [];
  const exposed = game.melds[player];
  const allTiles = [...hand, ...exposed.flatMap((meld) => meld.tiles)];
  const codes = allTiles.map(tileCode);
  const hasHonor = codes.some((code) => code >= 27);
  const numeric = codes.filter((code) => code < 27);
  const suitSet = new Set(numeric.map((code) => Math.floor(code / 9)));
  const patterns = [];
  if (!hasHonor && exposed.every((meld) => meld.type === "吃") && isAllSequences(hand)) patterns.push("平胡");
  if (!hasHonor && numeric.every((code) => code % 9 && code % 9 !== 8)) patterns.push("断幺");
  if (!hasHonor && suitSet.size <= 2) patterns.push("缺一门");
  const counts = countsOf(hand);
  if (exposed.every((meld) => meld.type !== "吃") && counts.filter((value) => value >= 3).length + exposed.length >= 4) patterns.push("对对胡");
  if (!hasHonor && suitSet.size === 1) patterns.push("清一色");
  if (hasHonor && suitSet.size === 1) patterns.push("混一色");
  return patterns;
}

function tileFace(tile) {
  if (tile.suitIndex === 0) return `<div class="wan"><strong>${chineseNumbers[tile.number]}</strong><span>萬</span></div>`;
  if (tile.suitIndex === 1) return `<div class="dots n${tile.number}">${Array(tile.number).fill("<i></i>").join("")}</div>`;
  if (tile.suitIndex === 2) {
    if (tile.number === 1) return `<div class="bird"><i></i><b>竹</b></div>`;
    return `<div class="bams n${tile.number}">${Array(tile.number).fill("<i></i>").join("")}</div>`;
  }
  return `<div class="honor h${tile.number}">${tile.suit}</div>`;
}

function createTile(tile, small = false) {
  const button = document.createElement("button");
  button.className = `tile s${tile.suitIndex}${small ? " small" : ""}`;
  button.dataset.id = tile.id;
  button.setAttribute("aria-label", tile.suitIndex === 3 ? tile.suit : `${tile.number}${tile.suit}`);
  button.innerHTML = `<div class="tile-inset">${tileFace(tile)}</div>`;
  return button;
}

const sameCount = (player, tile) => game.hands[player].filter((owned) => tileCode(owned) === tileCode(tile)).length;
function claimsFor(player, tile) {
  return { hu: patternsFor(player, tile).length > 0, gang: sameCount(player, tile) >= 3, peng: sameCount(player, tile) >= 2 };
}

function renderMelds() {
  const root = $("#my-melds"); root.replaceChildren();
  game.melds[0].forEach((meld) => {
    const group = document.createElement("div"); group.className = "meld";
    meld.tiles.forEach((tile) => group.append(createTile(tile, true)));
    const label = document.createElement("span"); label.textContent = meld.type; group.append(label); root.append(group);
  });
  for (let player = 1; player < 4; player += 1) {
    $(`#player-${player} em`).textContent = game.melds[player].map((meld) => meld.type).join(" · ");
    const exposedRoot = $(`#melds-${player}`); exposedRoot.replaceChildren();
    game.melds[player].forEach((meld) => {
      const group = document.createElement("div"); group.className = "opponent-meld";
      meld.tiles.forEach((tile) => { const face = createTile(tile, true); face.disabled = true; group.append(face); });
      exposedRoot.append(group);
    });
  }
}

function render() {
  document.querySelector(".game").classList.toggle("dealing", game.dealing);
  handElement.replaceChildren();
  game.hands[0].forEach((tile) => {
    const button = createTile(tile);
    button.classList.toggle("drawn", tile.id === game.drawnId);
    button.classList.toggle("selected", tile.id === game.selected);
    button.onclick = () => {
      if (game.turn !== 0 || game.phase !== "discard") return;
      game.selected = game.selected === tile.id ? null : tile.id; render();
    };
    handElement.append(button);
  });
  riverElements.forEach((river) => river.replaceChildren());
  game.river.forEach((discard) => {
    const button = createTile(discard.tile, true); button.disabled = true; riverElements[discard.player].append(button);
  });
  renderMelds();
  for (let player = 1; player < 4; player += 1) {
    const element = $(`#player-${player}`); element.classList.toggle("active", game.turn === player && !game.over && !game.dealing); element.querySelector("span").textContent = game.dealing ? "发牌中" : `${game.hands[player].length} 张`;
  }
  $("#wall-count").textContent = game.wall.length;
  $("#hand-status").textContent = game.dealing ? "发牌中" : `${game.hands[0].length} 张`;
  discardButton.disabled = game.over || game.turn !== 0 || game.phase !== "discard" || !game.selected;
  huButton.disabled = game.over || game.turn !== 0 || game.phase !== "discard" || !patternsFor(0).length;
  gangButton.disabled = game.over || game.turn !== 0 || game.phase !== "discard" || findConcealedGang(0) < 0;
  claimBox.hidden = game.phase !== "claim" || game.turn !== 0;
  if (!claimBox.hidden) {
    const claims = claimsFor(0, game.last.tile);
    $("#peng-btn").disabled = !claims.peng; $("#ming-gang-btn").disabled = !claims.gang; $("#dian-hu-btn").disabled = !claims.hu;
  }
  $("#turn-label").textContent = game.dealing ? "正在发牌…" : game.over ? "本局结束" : game.phase === "claim" ? `${names[game.turn]}可以响应` : game.turn ? `${names[game.turn]}正在思考…` : game.phase === "discard" ? "请选择一张打出" : "正在自动摸牌…";
}

function drawTile(player) {
  if (!game.wall.length) { finishDraw(); return false; }
  const drawn = game.wall.pop(); game.hands[player].push(drawn); game.drawnId = player === 0 ? drawn.id : null; return true;
}

function beginTurn() {
  if (game.over) return;
  game.phase = "drawing"; render();
  if (!drawTile(game.turn)) return;
  game.phase = "discard"; render();
  if (game.turn !== 0) {
    if (patternsFor(game.turn).length) { timer = setTimeout(() => finishGame(game.turn, null), 400); return; }
    timer = setTimeout(botDiscard, 650);
  }
}

function discardTile(player, tile) {
  game.hands[player] = game.hands[player].filter((owned) => owned.id !== tile.id);
  sortHand(player);
  game.river.push({ player, tile }); game.last = { from: player, tile }; game.selected = null; game.drawnId = null; render(); timer = setTimeout(checkResponses, 250);
}

function checkResponses() {
  const { from, tile } = game.last;
  if (from !== 0) {
    const claims = claimsFor(0, tile);
    if (claims.hu || claims.gang || claims.peng) { game.turn = 0; game.phase = "claim"; render(); return; }
  }
  for (let distance = 1; distance < 4; distance += 1) {
    const player = (from - distance + 4) % 4;
    if (player !== 0 && claimsFor(player, tile).hu) { finishGame(player, tile); return; }
  }
  botClaimOrNext();
}

function botClaimOrNext() {
  const { from, tile } = game.last;
  for (let distance = 1; distance < 4; distance += 1) {
    const player = (from - distance + 4) % 4;
    if (player === 0) continue;
    const claims = claimsFor(player, tile);
    if (claims.gang) { claim(player, "杠"); return; }
    if (claims.peng && Math.random() < 0.6) { claim(player, "碰"); return; }
  }
  game.turn = nextPlayer(from); game.phase = "turn"; render(); timer = setTimeout(beginTurn, 450);
}

function takeLastDiscard() { return game.river.pop().tile; }
function removeCodes(player, codes) {
  return codes.map((code) => { const index = game.hands[player].findIndex((tile) => tileCode(tile) === code); return game.hands[player].splice(index, 1)[0]; });
}
function claim(player, type, option = null) {
  const incoming = takeLastDiscard();
  const incomingCode = tileCode(incoming);
  const needed = type === "吃" ? option : Array(type === "碰" ? 2 : 3).fill(incomingCode);
  game.melds[player].push({ type, tiles: [...removeCodes(player, needed), incoming] });
  game.turn = player; game.phase = type === "杠" ? "turn" : "discard"; game.drawnId = null; sortHand(player); render();
  if (type === "杠") timer = setTimeout(beginTurn, 400); else if (player !== 0) timer = setTimeout(botDiscard, 550);
}
function passClaim() { game.phase = "wait"; render(); botClaimOrNext(); }

function botDiscard() {
  const player = game.turn;
  const counts = countsOf(game.hands[player]);
  const candidates = game.hands[player].map((tile) => {
    const code = tileCode(tile); let value = counts[code] * 2;
    if (code < 27) { if (counts[code - 1]) value += 1; if (counts[code + 1]) value += 1; if (counts[code - 2]) value += 0.5; if (counts[code + 2]) value += 0.5; }
    return { tile, value: value + Math.random() * 0.3 };
  }).sort((a, b) => a.value - b.value);
  discardTile(player, candidates[0].tile);
}

function findConcealedGang(player) { return countsOf(game.hands[player]).findIndex((count) => count === 4); }
function concealedGang() {
  const code = findConcealedGang(0); if (code < 0) return;
  game.melds[0].push({ type: "暗杠", tiles: removeCodes(0, [code, code, code, code]) }); game.phase = "turn"; game.drawnId = null; render(); timer = setTimeout(beginTurn, 350);
}

const fanValue = { "平胡": 1, "断幺": 1, "缺一门": 1, "对对胡": 1, "混一色": 1, "清一色": 4 };
function isLastMatchHand() { return match.handIndex + 1 >= match.totalHands; }
function configureResultAction() {
  const button = $("#play-again");
  if (!match.circles) button.textContent = "再来一局";
  else if (isLastMatchHand()) button.textContent = `再开${match.circles}圈`;
  else button.textContent = "下一局";
}

function finishGame(player, extraTile) {
  if (game.over) return;
  game.over = true;
  match.wins[player] += 1;
  const patterns = patternsFor(player, extraTile);
  const outcome = extraTile ? (player ? `${names[player]} 接炮` : "你接炮和牌") : (player ? `${names[player]} 自摸` : "恭喜自摸");
  $("#result-eyebrow").textContent = `${outcome}${match.circles && isLastMatchHand() ? " · 赛程完成" : ""}`;
  $("#result-title").textContent = patterns.join(" · ") || "和牌";
  const resultHand = $("#result-hand"); resultHand.replaceChildren();
  const revealedHand = extraTile ? [...game.hands[player], extraTile] : [...game.hands[player]];
  revealedHand.sort((a, b) => tileCode(a) - tileCode(b)).forEach((tile) => { const face = createTile(tile); face.disabled = true; resultHand.append(face); });
  const resultMelds = $("#result-melds"); resultMelds.replaceChildren();
  game.melds[player].forEach((meld) => {
    const group = document.createElement("div"); group.className = "result-meld";
    meld.tiles.forEach((tile) => { const face = createTile(tile, true); face.disabled = true; group.append(face); });
    const label = document.createElement("span"); label.textContent = meld.type; group.append(label); resultMelds.append(group);
  });
  $("#result-patterns").innerHTML = patterns.map((pattern) => `<span>${pattern} +${fanValue[pattern] || 1}番</span>`).join("");
  configureResultAction();
  render(); timer = setTimeout(() => $("#result-dialog").showModal(), 200);
}

function finishDraw() {
  if (game.over) return;
  game.over = true;
  $("#result-eyebrow").textContent = match.circles && isLastMatchHand() ? "牌墙摸尽 · 赛程完成" : "牌墙摸尽";
  $("#result-title").textContent = "流局";
  $("#result-hand").replaceChildren();
  $("#result-melds").replaceChildren();
  $("#result-patterns").innerHTML = "<span>本局无人和牌</span>";
  configureResultAction();
  render(); timer = setTimeout(() => $("#result-dialog").showModal(), 200);
}

function advanceMatch() {
  if (!match.circles || isLastMatchHand()) { startMatch(match.circles); return; }
  match.handIndex += 1;
  match.seatWinds = match.seatWinds.map((wind) => (wind + 3) % 4);
  startGame();
}
function showToast(message) { const toast = $("#toast"); toast.textContent = message; toast.classList.add("show"); setTimeout(() => toast.classList.remove("show"), 1500); }

discardButton.onclick = () => { const tile = game.hands[0].find((owned) => owned.id === game.selected); if (tile) discardTile(0, tile); };
huButton.onclick = () => finishGame(0, null);
gangButton.onclick = concealedGang;
$("#peng-btn").onclick = () => claim(0, "碰");
$("#ming-gang-btn").onclick = () => claim(0, "杠");
$("#dian-hu-btn").onclick = () => finishGame(0, game.last.tile);
$("#pass-btn").onclick = passClaim;
$("#sort-btn").onclick = () => { sortHand(0); game.drawnId = null; render(); showToast("已整理手牌"); };
$("#restart-btn").onclick = startGame;
$("#play-again").onclick = advanceMatch;
document.querySelectorAll(".mode-buttons button").forEach((button) => { button.onclick = () => startMatch(Number(button.dataset.circles)); });
const rulesDialog = $("#rules-dialog");
$("#rules-btn").onclick = () => rulesDialog.showModal();
$("#close-rules").onclick = () => rulesDialog.close();
startMatch(0);
