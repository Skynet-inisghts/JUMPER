import test from "node:test";
import assert from "node:assert/strict";
import { scoreOf } from "../.jumper-build/score/score.js";
import { bandOf, labelOf } from "../.jumper-build/score/scale.js";

const base = { holding: 0.5, firstMinuteKept: 50, smartSupply: 1, sniperSupply: 10, exitPressure: 2, bundleSupply: 0, devState: "clean" };
const range = (n) => Array.from({ length: n }, (_, i) => i);

test("monotone in holding: firmer real holders never lower the score", () => {
  for (const kept of [null, 0, 40, 100]) {
    let last = -1;
    for (const h of range(101)) {
      const s = scoreOf({ ...base, firstMinuteKept: kept, holding: h / 100 });
      assert.ok(s >= last, `holding ${h} kept ${kept}: ${s} < ${last}`);
      last = s;
    }
  }
});

test("a first minute with too few real buyers is neutral, never a zero", () => {
  const neutral = scoreOf({ ...base, firstMinuteKept: null, holding: 0.8 });
  const zero = scoreOf({ ...base, firstMinuteKept: 0, holding: 0.8 });
  assert.ok(neutral > zero);
});

test("sniped supply and exit pressure only subtract", () => {
  for (const key of ["sniperSupply", "exitPressure"]) {
    let last = 101;
    for (const v of range(60)) {
      const s = scoreOf({ ...base, holding: 0.9, [key]: v });
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
  assert.equal(scoreOf({ ...base, holding: 0, firstMinuteKept: 0, smartSupply: 0, sniperSupply: 90, exitPressure: 50, devState: "dumped" }), 0);
  assert.equal(scoreOf({ ...base, holding: 1, firstMinuteKept: 100, smartSupply: 50, sniperSupply: 0, exitPressure: 0 }), 100);
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
