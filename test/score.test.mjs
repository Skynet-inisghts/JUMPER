import test from "node:test";
import assert from "node:assert/strict";
import { scoreOf } from "../.jumper-build/score/score.js";
import { bandOf, labelOf } from "../.jumper-build/score/scale.js";

const base = { hold: 40, gone: 30, firstMinuteKept: 50, smartSupply: 3, sniperSupply: 10, exitPressure: 2, bundleSupply: 0, devState: "clean" };
const range = (n) => Array.from({ length: n }, (_, i) => i);

test("monotone in holding: more supply held never lowers the score", () => {
  for (const gone of [0, 10, 40, 80]) {
    let last = -1;
    for (const hold of range(101 - gone)) {
      const s = scoreOf({ ...base, gone, hold });
      assert.ok(s >= last, `hold ${hold} gone ${gone}: ${s} < ${last}`);
      last = s;
    }
  }
});

test("sniped supply and exit pressure only subtract", () => {
  for (const key of ["sniperSupply", "exitPressure"]) {
    let last = 101;
    for (const v of range(60)) {
      const s = scoreOf({ ...base, hold: 70, gone: 5, [key]: v });
      assert.ok(s <= last, `${key} ${v}: ${s} > ${last}`);
      last = s;
    }
  }
});

test("smart supply only adds", () => {
  let last = -1;
  for (const v of range(30)) {
    const s = scoreOf({ ...base, smartSupply: v });
    assert.ok(s >= last);
    last = s;
  }
});

test("score stays inside 0..100", () => {
  assert.equal(scoreOf({ ...base, hold: 0, gone: 100, firstMinuteKept: 0, smartSupply: 0, sniperSupply: 90, exitPressure: 50, devState: "dumped" }), 0);
  assert.equal(scoreOf({ ...base, hold: 100, gone: 0, firstMinuteKept: 100, smartSupply: 50, sniperSupply: 0, exitPressure: 0 }), 100);
});

test("the web scale: 0-34 TORN, 35-69 PATCHED, 70-100 TAUT", () => {
  assert.equal(bandOf(34).band, "TORN");
  assert.equal(bandOf(35).band, "PATCHED");
  assert.equal(bandOf(69).band, "PATCHED");
  assert.equal(bandOf(70).band, "TAUT");
  assert.equal(bandOf(0).verdict, "DO NOT TOUCH");
  assert.equal(bandOf(50).verdict, "HANDLE WITH CARE");
  assert.equal(bandOf(99).verdict, "SAFE TO WALK IN");
  assert.deepEqual([0, 20, 40, 60, 80, 95].map(labelOf), ["TORN", "LOOSE", "PATCHED", "HOLDING", "TAUT", "SILK"]);
});
