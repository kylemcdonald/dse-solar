import assert from "node:assert/strict";
import test from "node:test";
import {
  constraintDominates,
  nonDominatedFronts,
  preservesSafetyFindings,
  rankCandidates,
  SeededRandom,
  uniqueCandidates,
  type OptimizerCandidate,
} from "../scripts/layout-optimizer-core";

type Candidate = OptimizerCandidate<string, { label: string }>;

const candidate = (
  key: string,
  constraints: readonly number[],
  objectives: readonly number[],
  tieScore: number,
): Candidate => ({ key, genome: key, metrics: { label: key }, constraints, objectives, tieScore });

test("seeded optimizer randomness is byte-for-byte deterministic", () => {
  const sample = () => {
    const random = new SeededRandom(20260828);
    return JSON.stringify({
      values: Array.from({ length: 8 }, () => random.next()),
      order: random.shuffle(["a", "b", "c", "d", "e"]),
    });
  };
  assert.equal(sample(), sample());
});

test("feasible current layout dominates every all-worse invalid candidate", () => {
  const current = candidate("current", [0, 0, 0], [10, 10], 2);
  const overlap = candidate("overlap", [0, 1, 0], [1, 1], 1);
  const unsafeLead = candidate("unsafe-lead", [0, 0, 0.01], [1, 1], 0);
  assert.equal(constraintDominates(current, overlap), true);
  assert.equal(constraintDominates(current, unsafeLead), true);
  assert.equal(rankCandidates([overlap, current, unsafeLead])[0].key, "current");
});

test("Pareto selection never trades one protected objective for another", () => {
  const shorterTotal = candidate("shorter-total", [0, 0], [10, 8], 1);
  const shorterHighCurrent = candidate("shorter-high-current", [0, 0], [8, 10], 2);
  const worse = candidate("worse", [0, 0], [11, 11], 0);
  const front = nonDominatedFronts([worse, shorterHighCurrent, shorterTotal])[0];
  assert.deepEqual(front.map((entry) => entry.key), ["shorter-total", "shorter-high-current"]);
  assert.equal(constraintDominates(shorterTotal, shorterHighCurrent), false);
  assert.equal(constraintDominates(shorterHighCurrent, shorterTotal), false);
});

test("candidate deduplication and front ordering are deterministic", () => {
  const first = candidate("same", [0], [4], 4);
  const preferred = candidate("same", [0], [4], 2);
  const peer = candidate("peer", [0], [4], 1);
  assert.deepEqual(uniqueCandidates([first, peer, preferred]).map((entry) => entry.key), ["same", "peer"]);
  assert.deepEqual(rankCandidates([first, peer, preferred]).map((entry) => entry.key), ["peer", "same"]);
});

test("geometry proposals preserve baseline electrical findings and reject regressions", () => {
  const baseline = [
    { code: "conductor-overcurrent", connectionId: "orion-output", sourceIds: ["orion"] },
    { code: "device-overcurrent", deviceId: "mainPositiveBus", sourceIds: ["battery-b", "battery-a"] },
  ];
  const reorderedEquivalent = [
    { code: "device-overcurrent", deviceId: "mainPositiveBus", sourceIds: ["battery-a", "battery-b"] },
    { code: "conductor-overcurrent", connectionId: "orion-output", sourceIds: ["orion"] },
  ];
  const addedRegression = [
    ...reorderedEquivalent,
    { code: "unprotected-source-lead", connectionId: "new-lead", sourceIds: ["battery-a"] },
  ];
  const changedTarget = [
    reorderedEquivalent[0],
    { code: "conductor-overcurrent", connectionId: "different-output", sourceIds: ["orion"] },
  ];
  const changedChannel = [
    reorderedEquivalent[0],
    { ...reorderedEquivalent[1], channel: "negative" },
  ];
  assert.equal(preservesSafetyFindings(baseline, reorderedEquivalent), true);
  assert.equal(preservesSafetyFindings(baseline, addedRegression), false);
  assert.equal(preservesSafetyFindings(baseline, changedTarget), false);
  assert.equal(preservesSafetyFindings(baseline, changedChannel), false);
});
