"use strict";

const suits = ["万", "筒", "条"];
const honors = ["东", "南", "西", "北", "中", "发", "白"];
const fanValue = { "平胡": 1, "断幺": 1, "缺一门": 1, "对对胡": 1, "混一色": 1, "清一色": 4 };

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
const sortTiles = (tiles) => tiles.sort((a, b) => tileCode(a) - tileCode(b));
function countsOf(hand) { const counts = Array(34).fill(0); hand.forEach((tile) => { counts[tileCode(tile)] += 1; }); return counts; }

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

function patternsFor(hand, melds = [], extraTile = null) {
  const concealed = extraTile ? [...hand, extraTile] : [...hand];
  if (!isStandardWin(concealed)) return [];
  const allTiles = [...concealed, ...melds.flatMap((meld) => meld.tiles)];
  const codes = allTiles.map(tileCode);
  const hasHonor = codes.some((code) => code >= 27);
  const numeric = codes.filter((code) => code < 27);
  const suitSet = new Set(numeric.map((code) => Math.floor(code / 9)));
  const patterns = [];
  if (!hasHonor && melds.length === 0 && isAllSequences(concealed)) patterns.push("平胡");
  if (!hasHonor && numeric.every((code) => code % 9 && code % 9 !== 8)) patterns.push("断幺");
  if (!hasHonor && suitSet.size <= 2) patterns.push("缺一门");
  const counts = countsOf(concealed);
  if (counts.filter((value) => value >= 3).length + melds.length >= 4) patterns.push("对对胡");
  if (!hasHonor && suitSet.size === 1) patterns.push("清一色");
  if (hasHonor && suitSet.size === 1) patterns.push("混一色");
  return patterns;
}

function fanTotal(patterns) { return patterns.reduce((total, pattern) => total + (fanValue[pattern] || 1), 0); }

module.exports = { makeWall, tileCode, sortTiles, countsOf, isStandardWin, patternsFor, fanValue, fanTotal };
