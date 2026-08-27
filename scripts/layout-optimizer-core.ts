export type OptimizerCandidate<TGenome, TMetrics> = {
  key: string;
  genome: TGenome;
  metrics: TMetrics;
  constraints: readonly number[];
  objectives: readonly number[];
  tieScore: number;
};

export type SafetyFindingIdentity = {
  code: string;
  connectionId?: string;
  deviceId?: string;
  endpoint?: string;
  channel?: string;
  sourceIds?: readonly string[];
};

export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }

  next() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state / 0x1_0000_0000;
  }

  integer(maximum: number) {
    if (!Number.isInteger(maximum) || maximum <= 0) {
      throw new Error(`Random integer maximum must be a positive integer; received ${maximum}.`);
    }
    return Math.floor(this.next() * maximum);
  }

  shuffle<T>(source: readonly T[]) {
    const values = [...source];
    for (let index = values.length - 1; index > 0; index -= 1) {
      const other = this.integer(index + 1);
      [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
  }
}

const noWorseAndBetter = (first: readonly number[], second: readonly number[]) => (
  first.every((value, index) => value <= second[index])
  && first.some((value, index) => value < second[index])
);

const feasible = (constraints: readonly number[]) => constraints.every((value) => value <= 0);

/**
 * Deb-style constraint domination without collapsing independent hard gates
 * into a weighted score. Feasible candidates dominate infeasible candidates;
 * otherwise constraints or objectives must improve without a regression.
 */
export function constraintDominates<TGenome, TMetrics>(
  first: OptimizerCandidate<TGenome, TMetrics>,
  second: OptimizerCandidate<TGenome, TMetrics>,
) {
  const firstFeasible = feasible(first.constraints);
  const secondFeasible = feasible(second.constraints);
  if (firstFeasible !== secondFeasible) return firstFeasible;
  if (!firstFeasible) return noWorseAndBetter(first.constraints, second.constraints);
  return noWorseAndBetter(first.objectives, second.objectives);
}

export function uniqueCandidates<TGenome, TMetrics>(
  candidates: readonly OptimizerCandidate<TGenome, TMetrics>[],
) {
  const byKey = new Map<string, OptimizerCandidate<TGenome, TMetrics>>();
  candidates.forEach((candidate) => {
    const previous = byKey.get(candidate.key);
    if (!previous || candidate.tieScore < previous.tieScore) byKey.set(candidate.key, candidate);
  });
  return [...byKey.values()];
}

export function nonDominatedFronts<TGenome, TMetrics>(
  source: readonly OptimizerCandidate<TGenome, TMetrics>[],
) {
  const remaining = uniqueCandidates(source);
  const fronts: Array<Array<OptimizerCandidate<TGenome, TMetrics>>> = [];
  while (remaining.length > 0) {
    const front = remaining.filter((candidate, index) => !remaining.some((other, otherIndex) => (
      index !== otherIndex && constraintDominates(other, candidate)
    ))).toSorted((first, second) => first.tieScore - second.tieScore || first.key.localeCompare(second.key));
    if (front.length === 0) throw new Error("Pareto sort failed to make progress.");
    fronts.push(front);
    const keys = new Set(front.map((candidate) => candidate.key));
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (keys.has(remaining[index].key)) remaining.splice(index, 1);
    }
  }
  return fronts;
}

export function rankCandidates<TGenome, TMetrics>(
  source: readonly OptimizerCandidate<TGenome, TMetrics>[],
) {
  return nonDominatedFronts(source).flat();
}

/** Stable electrical-finding identity for geometry-only proposal gates. The
 * human message is deliberately excluded so editorial changes cannot hide a
 * changed code, target, or contributing source set. */
export function safetyFindingSignatures(findings: readonly SafetyFindingIdentity[]) {
  return findings.map((finding) => JSON.stringify({
    code: finding.code,
    connectionId: finding.connectionId ?? null,
    deviceId: finding.deviceId ?? null,
    endpoint: finding.endpoint ?? null,
    channel: finding.channel ?? null,
    sourceIds: [...(finding.sourceIds ?? [])].toSorted(),
  })).toSorted();
}

export function preservesSafetyFindings(
  baseline: readonly SafetyFindingIdentity[],
  candidate: readonly SafetyFindingIdentity[],
) {
  const baselineSignatures = safetyFindingSignatures(baseline);
  const candidateSignatures = safetyFindingSignatures(candidate);
  return baselineSignatures.length === candidateSignatures.length
    && baselineSignatures.every((signature, index) => signature === candidateSignatures[index]);
}
