"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeWall, patternsFor, fanValue, fanTotal, winSettlement, gangSettlement } = require("../game-rules");

function tiles(spec) {
  let copy = 0;
  return spec.flatMap(([suitIndex, values]) => [...values].map((value) => ({
    suitIndex,
    number: suitIndex === 3 ? "东南西北中发白".indexOf(value) : Number(value),
    suit: suitIndex === 0 ? "万" : suitIndex === 1 ? "筒" : suitIndex === 2 ? "条" : value,
    id: `test-${copy++}`,
  })));
}

test("牌墙包含136张且每种牌四张", () => {
  const wall = makeWall();
  assert.equal(wall.length, 136);
  const types = new Map();
  wall.forEach((tile) => types.set(`${tile.suitIndex}-${tile.number}`, (types.get(`${tile.suitIndex}-${tile.number}`) || 0) + 1));
  assert.equal(types.size, 34);
  assert.ok([...types.values()].every((count) => count === 4));
});

test("识别缺一门和对对胡", () => {
  const hand = tiles([[0, "111222"], [1, "33344455"]]);
  const patterns = patternsFor(hand);
  assert.ok(patterns.includes("缺一门"));
  assert.ok(patterns.includes("对对胡"));
});

test("清一色固定四番", () => {
  const hand = tiles([[0, "12312345678955"]]);
  const patterns = patternsFor(hand);
  assert.ok(patterns.includes("清一色"));
  assert.equal(fanValue["清一色"], 4);
  assert.equal(fanTotal(patterns), 4);
});

test("红中刻与对对胡各计一番", () => {
  const hand = tiles([[3, "中中中"], [0, "11155"], [1, "222"], [2, "333"]]);
  const patterns = patternsFor(hand);
  assert.ok(patterns.includes("红中刻"));
  assert.ok(patterns.includes("对对胡"));
  assert.equal(fanTotal(patterns), 2);
});

test("圈风与门风相同时可以分别计番", () => {
  const hand = tiles([[3, "东东东"], [0, "12355"], [1, "123"], [2, "123"]]);
  const patterns = patternsFor(hand, [], null, { seatWind: 0, circleWind: 0 });
  assert.ok(patterns.includes("门风刻"));
  assert.ok(patterns.includes("圈风刻"));
  assert.equal(fanTotal(patterns), 2);
});

test("底数结算区分点炮、自摸、明杠和暗杠", () => {
  assert.deepEqual(winSettlement({ baseScore: 5, fan: 3, winner: 1, selfDraw: false, discarder: 3 }), { amount: 20, deltas: [0, 20, 0, -20] });
  assert.deepEqual(winSettlement({ baseScore: 2, fan: 2, winner: 0, selfDraw: true }), { amount: 4, deltas: [12, -4, -4, -4] });
  assert.deepEqual(gangSettlement({ baseScore: 2, winner: 2, source: 1 }), { amount: 10, deltas: [0, -10, 10, 0] });
  assert.deepEqual(gangSettlement({ baseScore: 1, winner: 3, concealed: true }), { amount: 5, deltas: [-5, -5, -5, 15] });
});
