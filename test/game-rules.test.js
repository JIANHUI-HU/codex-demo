"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { makeWall, patternsFor, fanValue } = require("../game-rules");

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
  assert.ok(patternsFor(hand).includes("清一色"));
  assert.equal(fanValue["清一色"], 4);
});
