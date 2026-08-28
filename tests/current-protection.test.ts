import assert from "node:assert/strict";
import test from "node:test";
import { dseTopology } from "../app/dseTopology";
import {
  conductor,
  connection,
  currentSourcesFromDevices,
  graphConnectionDisplayLabel,
  graphEndpointDisplayLabel,
  graphEndpointOwnerLabels,
  isPurchasedDevice,
} from "../app/systemGraph";
import type {
  Cable,
  ConductorKind,
  CurrentSource,
  Device,
  DeviceKind,
  SystemGraph,
} from "../app/systemGraph";
import { buildSystemRuntime, verifyCurrentProtection } from "../app/systemGraphRuntime";

const wall = (x: number, y = 0.40) => ({
  space: "world" as const,
  surface: "wall" as const,
  position: [x, y, 0.020] as const,
});

const port = (id: string, kind: ConductorKind, face: "left" | "right" = "right") => (
  conductor(id, id, kind, face)
);

const device = (
  id: string,
  kind: DeviceKind,
  x: number,
  conductors: Device["conductors"],
  options: Partial<Device> = {},
): Device => ({
  id,
  label: `${id} equipment`,
  kind,
  size: [0.080, 0.080, 0.040],
  placement: wall(x),
  conductors,
  ...options,
});

const cable = (id: string, ampacityA: number, carriedChannels?: Cable["carriedChannels"]): Cable => ({
  id,
  label: `${id} cable`,
  cores: carriedChannels && carriedChannels.length > 1 ? carriedChannels.length : 1,
  outsideDiameterMm: 4,
  conductorSize: "test",
  sheath: carriedChannels && carriedChannels.length > 1 ? "white" : "single",
  ampacityA,
  carriedChannels,
});

const source = (
  id: string,
  endpoint: string,
  options: Partial<CurrentSource> = {},
): CurrentSource => ({
  id,
  label: `${id} source`,
  endpoint,
  channel: "positive",
  continuousCapacityA: 100,
  shortCircuitCurrentA: 100,
  verified: true,
  basis: "regulated-output",
  ...options,
});

const graph = (
  devices: readonly Device[],
  connections: SystemGraph["connections"],
  currentSources: readonly CurrentSource[],
  cables: readonly Cable[] = [cable("wide", 100), cable("target", 10)],
): SystemGraph => ({
  // Tests author the same terminal-owned source metadata as production, while
  // retaining the explicit graph inventory so malformed/omitted inventories
  // can still be exercised deliberately.
  ...(() => {
    const firstSourceByEndpoint = new Map<string, CurrentSource>();
    currentSources.forEach((candidate) => {
      if (!firstSourceByEndpoint.has(candidate.endpoint)) firstSourceByEndpoint.set(candidate.endpoint, candidate);
    });
    const terminalOwnedDevices = devices.map((candidate) => ({
      ...candidate,
      conductors: candidate.conductors.map((candidatePort) => {
        const terminalSource = firstSourceByEndpoint.get(`${candidate.id}.${candidatePort.id}`);
        if (!terminalSource) return candidatePort;
        const { endpoint: _endpoint, ...currentSource } = terminalSource;
        void _endpoint;
        return { ...candidatePort, currentSource };
      }),
    }));
    return { devices: terminalOwnedDevices };
  })(),
  id: "current-test",
  label: "Current verifier test",
  revision: "R28-test",
  connections,
  junctions: [],
  currentSources,
  cables,
});

const breaker = (id: string, x: number, ratedCurrentA: number, interruptRatingA = 1_000) => device(
  id,
  "breaker",
  x,
  [port("line", "positive", "left"), port("load", "positive")],
  {
    currentProtection: {
      kind: "breaker",
      ratedCurrentA,
      verified: true,
      interruptRatingA,
      terminalPairs: [["line", "load"]],
    },
  },
);

test("aggregate envelope sums independent sources but honors a common downstream cut", () => {
  const devices = [
    device("s1", "converter", 0.10, [port("out", "positive")]),
    device("s2", "converter", 0.10, [port("out", "positive")]),
    breaker("b1", 0.30, 10),
    breaker("b2", 0.30, 10),
    device("merge", "busbar", 0.50, [port("a", "positive", "left"), port("b", "positive", "left"), port("out", "positive")]),
    device("load", "load", 0.80, [port("positive", "positive", "left")]),
  ];
  const upstream = [
    connection("s1-line", "s1.out", "b1.line", "positive", "wide"),
    connection("s2-line", "s2.out", "b2.line", "positive", "wide"),
    connection("b1-merge", "b1.load", "merge.a", "positive", "wide"),
    connection("b2-merge", "b2.load", "merge.b", "positive", "wide"),
  ];
  const sources = [source("s1", "s1.out"), source("s2", "s2.out")];
  const withoutCommon = verifyCurrentProtection(graph(
    devices,
    [...upstream, connection("target", "merge.out", "load.positive", "positive", "target")],
    sources,
    [cable("wide", 100), cable("target", 15)],
  ));
  const combined = withoutCommon.connections.find((check) => check.connectionId === "target" && check.channel === "positive")!;
  assert.equal(combined.verifiedProtectionEnvelopeA, 20);
  assert.equal(combined.status, "incomplete");
  assert.ok(combined.protectionBySource.every((entry) => entry.verifiedBy.length === 1));

  const common = breaker("common", 0.65, 15);
  const withCommon = verifyCurrentProtection(graph(
    [...devices.filter((candidate) => candidate.id !== "load"), common, devices.at(-1)!],
    [
      ...upstream,
      connection("merge-common", "merge.out", "common.line", "positive", "wide"),
      connection("target", "common.load", "load.positive", "positive", "target"),
    ],
    sources,
    [cable("wide", 100), cable("target", 15)],
  ));
  const coordinated = withCommon.connections.find((check) => check.connectionId === "target" && check.channel === "positive")!;
  assert.equal(coordinated.verifiedProtectionEnvelopeA, 15);
  assert.equal(coordinated.status, "verified", JSON.stringify(coordinated));
});

test("sources on opposite conductor sides are compared, not incorrectly summed", () => {
  const report = verifyCurrentProtection(graph([
    device("leftSource", "converter", 0.10, [port("out", "positive")]),
    device("rightSource", "converter", 0.60, [port("out", "positive", "left")]),
  ], [connection("target", "leftSource.out", "rightSource.out", "positive", "target")], [
    source("left", "leftSource.out", {
      continuousCapacityA: 8,
      shortCircuitCurrentA: 8,
      inherentCurrentLimit: { currentLimitA: 8, verified: true },
    }),
    source("right", "rightSource.out", {
      continuousCapacityA: 8,
      shortCircuitCurrentA: 8,
      inherentCurrentLimit: { currentLimitA: 8, verified: true },
    }),
  ]));
  const check = report.connections.find((candidate) => candidate.connectionId === "target")!;
  assert.equal(check.prospectiveFaultCurrentA, 8);
  assert.equal(check.verifiedProtectionEnvelopeA, 8);
  assert.equal(check.status, "verified");
});

test("a collective parallel min-cut is valid per-source protection evidence", () => {
  const system = graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    device("split", "busbar", 0.25, [port("in", "positive", "left"), port("a", "positive"), port("b", "positive")]),
    breaker("leftBreaker", 0.40, 5),
    breaker("rightBreaker", 0.40, 5),
    device("merge", "busbar", 0.55, [port("a", "positive", "left"), port("b", "positive", "left"), port("out", "positive")]),
    device("load", "load", 0.75, [port("positive", "positive", "left")]),
  ], [
    connection("source-split", "source.out", "split.in", "positive", "wide"),
    connection("split-left", "split.a", "leftBreaker.line", "positive", "wide"),
    connection("split-right", "split.b", "rightBreaker.line", "positive", "wide"),
    connection("left-merge", "leftBreaker.load", "merge.a", "positive", "wide"),
    connection("right-merge", "rightBreaker.load", "merge.b", "positive", "wide"),
    connection("target", "merge.out", "load.positive", "positive", "target"),
  ], [source("source", "source.out")]);
  const check = verifyCurrentProtection(system).connections.find((candidate) => candidate.connectionId === "target")!;
  assert.equal(check.status, "verified");
  assert.equal(check.verifiedProtectionEnvelopeA, 10);
  assert.deepEqual(check.protectionBySource[0].verifiedBy, ["device:leftBreaker", "device:rightBreaker"]);
});

test("source-side leads remain unproved while downstream conductors are protected", () => {
  const system = graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    breaker("breaker", 0.35, 5),
    device("load", "load", 0.65, [port("positive", "positive", "left")]),
  ], [
    connection("source-lead", "source.out", "breaker.line", "positive", "target", { sourceLeadReason: "short protected installation" }),
    connection("downstream", "breaker.load", "load.positive", "positive", "target"),
  ], [source("source", "source.out")], [cable("target", 5)]);
  const report = verifyCurrentProtection(system);
  assert.equal(report.connections.find((check) => check.connectionId === "source-lead")?.status, "incomplete");
  assert.equal(report.connections.find((check) => check.connectionId === "downstream")?.status, "verified");
  assert.ok(report.warnings.some((issue) => issue.code === "unprotected-source-lead"));
});

test("Orion's 60 A hard fault limit does not masquerade as 30 A protection", () => {
  const system = graph([
    device("orion", "converter", 0.10, [port("out", "positive")]),
    device("load", "load", 0.50, [port("positive", "positive", "left")]),
  ], [connection("orion-output", "orion.out", "load.positive", "positive", "target")], [source(
    "orion",
    "orion.out",
    {
      continuousCapacityA: 30,
      peakCapacity: { currentA: 45, durationSeconds: 10 },
      shortCircuitCurrentA: 60,
      inherentCurrentLimit: { currentLimitA: 60, verified: true },
    },
  )], [cable("target", 30)]);
  const check = verifyCurrentProtection(system).connections.find((candidate) => candidate.connectionId === "orion-output")!;
  assert.equal(check.prospectiveFaultCurrentA, 60, JSON.stringify(check));
  assert.equal(check.verifiedProtectionEnvelopeA, 60);
  assert.equal(check.status, "incomplete");
});

test("returns require matching circuit identity and audit rated negative devices", () => {
  const devices = [
    device("source", "converter", 0.10, [port("out", "positive")]),
    breaker("breaker", 0.30, 10),
    device("negativeBus", "busbar", 0.45, [port("negative", "negative")], { currentRatingA: 5 }),
    device("load", "load", 0.65, [port("positive", "positive", "left"), port("negative", "negative", "left")]),
  ];
  const active = connection("active", "breaker.load", "load.positive", "positive", "active", { circuitId: "load-circuit" });
  const base = [connection("source-breaker", "source.out", "breaker.line", "positive", "wide"), active];
  const validReturn = connection("return", "negativeBus.negative", "load.negative", "negative", "return", {
    returnFor: "active",
    circuitId: "load-circuit",
  });
  const cables = [cable("wide", 100), cable("active", 10), cable("return", 5)];
  const report = verifyCurrentProtection(graph(devices, [...base, validReturn], [source("source", "source.out")], cables));
  assert.equal(report.connections.find((check) => check.connectionId === "return")?.status, "incomplete");
  assert.ok(report.errors.some((issue) => issue.code === "device-protection-incomplete" && issue.deviceId === "negativeBus"));
  assert.ok(report.devices.some((check) => check.deviceId === "negativeBus" && check.channel === "negative"));

  const unrelated = { ...validReturn, circuitId: "unrelated-circuit" };
  const mismatched = verifyCurrentProtection(graph(devices, [...base, unrelated], [source("source", "source.out")], cables));
  assert.ok(mismatched.errors.some((issue) => issue.code === "unpaired-return-conductor" && issue.connectionId === "return"));
});

test("returnFor cannot borrow protection from an unrelated load topology", () => {
  const baseDevices = [
    device("source", "converter", 0.10, [port("out", "positive")]),
    breaker("breaker", 0.30, 10),
    device("negativeBus", "busbar", 0.45, [port("negative", "negative")]),
    device("loadA", "load", 0.65, [port("positive", "positive", "left"), port("negative", "negative", "left")]),
    device("loadB", "load", 0.80, [port("negative", "negative", "left")]),
  ];
  const sourceSide = connection("source-breaker", "source.out", "breaker.line", "positive", "wide");
  const active = connection("active", "breaker.load", "loadA.positive", "positive", "target", { circuitId: "load-circuit" });
  const spoofedReturn = connection("return", "negativeBus.negative", "loadB.negative", "negative", "target", {
    returnFor: "active",
    circuitId: "load-circuit",
  });
  const spoofed = verifyCurrentProtection(graph(
    baseDevices,
    [sourceSide, active, spoofedReturn],
    [source("source", "source.out")],
  ));
  assert.ok(spoofed.errors.some((issue) => (
    issue.code === "unpaired-return-conductor" && issue.connectionId === "return"
  )));
  assert.equal(spoofed.connections.some((check) => check.connectionId === "return"), false);

  const sameLoadReturn = { ...spoofedReturn, to: "loadA.negative" };
  const sameLoad = verifyCurrentProtection(graph(
    baseDevices,
    [sourceSide, active, sameLoadReturn],
    [source("source", "source.out")],
  ));
  assert.equal(sameLoad.errors.some((issue) => (
    issue.code === "unpaired-return-conductor" && issue.connectionId === "return"
  )), false);
  assert.ok(sameLoad.connections.some((check) => check.connectionId === "return"));

  const positiveJoin = device("positiveJoin", "connector", 0.55, [port("through", "positive")], {
    presentation: "wire-join",
    attachment: { endpoint: "loadA.positive" },
  });
  const negativeJoin = device("negativeJoin", "connector", 0.55, [port("through", "negative")], {
    presentation: "wire-join",
    attachment: { endpoint: "loadA.negative" },
  });
  const joinedActive = { ...active, to: "positiveJoin.through" };
  const joinedReturn = { ...spoofedReturn, to: "negativeJoin.through" };
  const joined = verifyCurrentProtection(graph(
    [...baseDevices, positiveJoin, negativeJoin],
    [sourceSide, joinedActive, joinedReturn],
    [source("source", "source.out")],
  ));
  assert.equal(joined.errors.some((issue) => (
    issue.code === "unpaired-return-conductor" && issue.connectionId === "return"
  )), false);
  assert.ok(joined.connections.some((check) => check.connectionId === "return"));
});

test("ordinary load wattage is not misclassified as a missing pass-through rating", () => {
  const system = graph([
    device("source", "converter", 0.10, [port("out", "positive")], { currentRatingA: 10 }),
    device("unratedLoad", "load", 0.60, [port("positive", "positive", "left")]),
  ], [connection("target", "source.out", "unratedLoad.positive", "positive", "target")], [source(
    "source",
    "source.out",
    {
      continuousCapacityA: 5,
      shortCircuitCurrentA: 5,
      inherentCurrentLimit: { currentLimitA: 5, verified: true },
    },
  )]);
  const report = verifyCurrentProtection(system);
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors));
  assert.equal(report.devices.some((check) => check.deviceId === "unratedLoad"), false);
  assert.equal(report.warnings.some((issue) => (
    issue.code === "missing-device-rating" && issue.deviceId === "unratedLoad"
  )), false);
  assert.equal(report.status, "verified");
});

test("metadata validation is fail-closed for sources, endpoints, pairs and multicore channels", () => {
  const wrongChannel = verifyCurrentProtection(graph([
    device("source", "converter", 0.10, [port("negative", "negative")]),
  ], [], [source("source", "source.negative")], []));
  assert.ok(wrongChannel.errors.some((issue) => issue.code === "invalid-current-metadata"));

  const duplicateSource = source("duplicate", "source.out");
  const duplicate = verifyCurrentProtection(graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
  ], [], [duplicateSource, { ...duplicateSource }], []));
  assert.equal(duplicate.errors.filter((issue) => issue.code === "invalid-current-metadata" && issue.sourceIds?.includes("duplicate")).length, 3);

  const contradictory = verifyCurrentProtection(graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
  ], [], [source("source", "source.out", {
    continuousCapacityA: 10,
    shortCircuitCurrentA: 20,
    inherentCurrentLimit: { currentLimitA: 5, verified: true },
  })], []));
  assert.ok(contradictory.errors.some((issue) => issue.code === "invalid-current-metadata" && issue.sourceIds?.includes("source")));

  const badEndpoint = verifyCurrentProtection(graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    device("negativeBus", "busbar", 0.40, [port("negative", "negative")]),
  ], [connection("bad-positive", "source.out", "negativeBus.negative", "positive", "target")], [source("source", "source.out")], [cable("target", 10)]));
  assert.ok(badEndpoint.errors.some((issue) => issue.code === "invalid-current-metadata" && issue.connectionId === "bad-positive"));

  const crossedProtector = verifyCurrentProtection(graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    device("badBreaker", "breaker", 0.40, [port("line", "positive", "left"), port("load", "negative")], {
      currentProtection: { kind: "breaker", ratedCurrentA: 5, verified: true, interruptRatingA: 100, terminalPairs: [["line", "load"]] },
    }),
  ], [connection("line", "source.out", "badBreaker.line", "positive", "target")], [source("source", "source.out")], [cable("target", 10)]));
  assert.ok(crossedProtector.errors.some((issue) => issue.code === "invalid-current-metadata" && issue.deviceId === "badBreaker"));

  const untypedMulticore = verifyCurrentProtection(graph([
    device("breakout", "connector", 0.10, [port("cable", "multicore")]),
    device("load", "load", 0.50, [port("cable", "multicore", "left")]),
  ], [connection("untyped", "breakout.cable", "load.cable", "multicore", "untyped")], [], [cable("untyped", 10)]));
  assert.ok(untypedMulticore.errors.some((issue) => issue.code === "invalid-current-metadata" && issue.connectionId === "untyped"));
});

test("terminal-owned supply inventory catches an omitted source on an already energized island", () => {
  const supplies = [
    source("primary", "primary.out"),
    source("omitted", "omitted.out", { continuousCapacityA: 5, shortCircuitCurrentA: 5 }),
  ];
  const complete = graph([
    device("primary", "converter", 0.10, [port("out", "positive")]),
    device("omitted", "converter", 0.20, [port("out", "positive")]),
    device("bus", "busbar", 0.40, [port("first", "positive", "left"), port("second", "positive", "left")]),
  ], [
    connection("primary-bus", "primary.out", "bus.first", "positive", "wide"),
    connection("omitted-bus", "omitted.out", "bus.second", "positive", "wide"),
  ], supplies);
  const malformed = { ...complete, currentSources: complete.currentSources.filter((candidate) => candidate.id !== "omitted") };
  const report = verifyCurrentProtection(malformed);
  assert.ok(report.errors.some((issue) => (
    issue.code === "invalid-current-metadata"
    && issue.sourceIds?.includes("omitted")
    && issue.endpoint === "omitted.out"
  )));
});

test("production supply inventory is derived from terminals and includes bidirectional/converter outputs", () => {
  assert.deepEqual(dseTopology.currentSources, currentSourcesFromDevices(dseTopology.devices));
  assert.equal(dseTopology.currentSources.length, 10);
  assert.equal(
    dseTopology.currentSources.find((candidate) => candidate.id === "multiplus-dc-charger-source")?.endpoint,
    "multiPlus.dcPositive",
  );
  assert.equal(
    dseTopology.currentSources.find((candidate) => candidate.id === "unifi-converter-output-source")?.endpoint,
    "unifiPower.usbA",
  );
});

test("topology-generated terminal-join continuity is traversed but not misreported as an authored circuit", () => {
  const topologyLinks = new Set(dseTopology.connections.filter((candidate) => (
    candidate.topologyRole === "terminal-join"
  )).map((candidate) => candidate.id));
  assert.ok(topologyLinks.size > 0);
  const report = verifyCurrentProtection(dseTopology);
  assert.equal([...report.errors, ...report.warnings].some((issue) => (
    issue.connectionId !== undefined && topologyLinks.has(issue.connectionId)
  )), false);
  const generatorIssues = report.warnings.filter((issue) => (
    issue.code === "unprotected-source-lead" && issue.connectionId === "generator-white-cable"
  ));
  assert.deepEqual(generatorIssues.map((issue) => issue.channel).toSorted(), ["ac-line", "ac-neutral"]);

  const forgedSkip = graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    device("load", "load", 0.60, [port("positive", "positive", "left")]),
  ], [connection("forged", "source.out", "load.positive", "positive", "target", { topologyRole: "terminal-join" })], [
    source("source", "source.out"),
  ]);
  const forgedReport = verifyCurrentProtection(forgedSkip);
  assert.ok(forgedReport.errors.some((issue) => (
    issue.code === "invalid-current-metadata" && issue.connectionId === "forged"
  )));
  assert.ok(forgedReport.connections.some((check) => check.connectionId === "forged"));
});

test("typed source assemblies trace legitimate series conductors and reject malformed body paths", () => {
  const batteryMember = (id: string, x: number, terminalPair: readonly [string, string]) => device(
    id,
    "battery",
    x,
    [port("positive", "positive"), port("negative", "negative")],
    {
      currentSourceAssemblyPaths: [{
        assemblyId: "battery-string",
        activeChannel: "positive",
        terminalPair,
      }],
    },
  );
  const connections = [
    connection("series", "lower.positive", "upper.negative", "positive", "wide", { seriesLink: true }),
    connection("midpoint-tap", "lower.positive", "load.positive", "positive", "target"),
  ];
  const valid = verifyCurrentProtection(graph([
    batteryMember("lower", 0.10, ["positive", "negative"]),
    batteryMember("upper", 0.25, ["positive", "negative"]),
    device("load", "load", 0.60, [port("positive", "positive", "left")]),
  ], connections, [source("string", "upper.positive")], [cable("wide", 100), cable("target", 10)]));
  assert.equal(valid.errors.some((issue) => issue.code === "untraced-active-conductor"), false);
  assert.deepEqual(
    valid.connections.filter((check) => ["series", "midpoint-tap"].includes(check.connectionId))
      .map((check) => check.connectionId).toSorted(),
    ["midpoint-tap", "series"],
  );

  const malformed = verifyCurrentProtection(graph([
    batteryMember("lower", 0.10, ["positive", "negative"]),
    batteryMember("upper", 0.25, ["positive", "missing"]),
    device("load", "load", 0.60, [port("positive", "positive", "left")]),
  ], connections, [source("string", "upper.positive")], [cable("wide", 100), cable("target", 10)]));
  assert.ok(malformed.errors.some((issue) => (
    issue.code === "invalid-current-metadata" && issue.deviceId === "upper"
  )));
  assert.ok(malformed.errors.some((issue) => (
    issue.code === "untraced-active-conductor" && issue.connectionId === "series"
  )));
  assert.equal(malformed.connections.some((check) => check.connectionId === "series"), false);
});

test("typed current domains pair structural returns and remain fail-closed when incomplete", () => {
  const domainPort = (id: string, kind: "positive" | "negative", role: "active" | "return") => ({
    ...port(id, kind),
    currentDomain: { id: "main-dc", role },
  });
  const domainGraph = (includeActiveAnchor: boolean) => graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    device("positiveBus", "busbar", 0.30, [includeActiveAnchor
      ? domainPort("positive", "positive", "active")
      : port("positive", "positive")]),
    device("negativeBus", "busbar", 0.30, [domainPort("negative", "negative", "return")]),
    device("load", "load", 0.60, [port("negative", "negative", "left")]),
  ], [
    connection("active", "source.out", "positiveBus.positive", "positive", "wide"),
    connection("return", "negativeBus.negative", "load.negative", "negative", "target"),
  ], [source("source", "source.out")]);

  const valid = verifyCurrentProtection(domainGraph(true));
  assert.equal(valid.errors.some((issue) => (
    issue.code === "unpaired-return-conductor" && issue.connectionId === "return"
  )), false);
  const returnCheck = valid.connections.find((check) => check.connectionId === "return")!;
  assert.deepEqual(returnCheck.pairedActiveEndpointIds, ["positiveBus.positive"]);
  assert.equal(returnCheck.pairedActiveConnectionId, undefined);

  const incomplete = verifyCurrentProtection(domainGraph(false));
  assert.ok(incomplete.errors.some((issue) => issue.code === "invalid-current-metadata"));
  assert.ok(incomplete.errors.some((issue) => (
    issue.code === "unpaired-return-conductor" && issue.connectionId === "return"
  )));
  assert.equal(incomplete.connections.some((check) => check.connectionId === "return"), false);
});

test("production source assemblies and current-domain anchors remove only topology false errors", () => {
  const expectedConnections = [
    "battery-a-series",
    "battery-b-series",
    "pv-a-series",
    "pv-b-series",
    "balancer-a-mid",
    "balancer-b-mid",
    "balancer-a-negative",
    "balancer-b-negative",
    "shunt-negative-bus",
  ];
  const report = verifyCurrentProtection(dseTopology);
  assert.deepEqual(report.errors.filter((issue) => (
    issue.code === "untraced-active-conductor" || issue.code === "unpaired-return-conductor"
  )), []);
  expectedConnections.forEach((connectionId) => assert.ok(
    report.connections.some((check) => check.connectionId === connectionId),
    `${connectionId} must receive a real protection check`,
  ));
  const shuntReturn = report.connections.find((check) => check.connectionId === "shunt-negative-bus")!;
  assert.deepEqual(shuntReturn.pairedActiveEndpointIds, [
    "mainPositiveBus.post1",
    "mainPositiveBus.post2",
    "mainPositiveBus.post3",
    "mainPositiveBus.post4",
  ]);
  assert.equal(shuntReturn.status, "incomplete", "structural pairing must not manufacture OCP credit");
});

test("invalid, unverified and interrupt-unproved protectors never receive verified credit", () => {
  const protectedSystem = (protection: NonNullable<SystemGraph["connections"][number]["currentProtection"]>) => graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    device("load", "load", 0.60, [port("positive", "positive", "left")]),
  ], [connection("target", "source.out", "load.positive", "positive", "target", { currentProtection: protection })], [
    source("source", "source.out", { continuousCapacityA: 5, shortCircuitCurrentA: 50 }),
  ], [cable("target", 10)]);

  const invalid = verifyCurrentProtection(protectedSystem({
    kind: "fuse", ratedCurrentA: 0, interruptRatingA: 100, verified: true,
  })).connections.find((candidate) => candidate.connectionId === "target")!;
  assert.equal(invalid.status, "incomplete");
  assert.deepEqual(invalid.protectionBySource[0].verifiedBy, []);
  assert.deepEqual(invalid.protectionBySource[0].provisionalBy, []);

  const unverified = verifyCurrentProtection(protectedSystem({
    kind: "fuse", ratedCurrentA: 5, interruptRatingA: 100, verified: false,
  })).connections.find((candidate) => candidate.connectionId === "target")!;
  assert.equal(unverified.status, "provisional");
  assert.deepEqual(unverified.protectionBySource[0].verifiedBy, []);
  assert.deepEqual(unverified.protectionBySource[0].provisionalBy, ["connection:target"]);

  const missingInterrupt = verifyCurrentProtection(protectedSystem({
    kind: "fuse", ratedCurrentA: 5, verified: true,
  })).connections.find((candidate) => candidate.connectionId === "target")!;
  assert.equal(missingInterrupt.status, "provisional");
  assert.deepEqual(missingInterrupt.protectionBySource[0].verifiedBy, []);
  assert.deepEqual(missingInterrupt.protectionBySource[0].provisionalBy, ["connection:target"]);

  const insufficientInterruptReport = verifyCurrentProtection(protectedSystem({
    kind: "fuse", ratedCurrentA: 5, interruptRatingA: 10, verified: true,
  }));
  const insufficientInterrupt = insufficientInterruptReport.connections.find((candidate) => candidate.connectionId === "target")!;
  assert.equal(insufficientInterrupt.status, "provisional");
  assert.deepEqual(insufficientInterrupt.protectionBySource[0].verifiedBy, []);
  assert.ok(insufficientInterruptReport.errors.some((issue) => (
    issue.code === "interrupt-rating-insufficient" && issue.connectionId === "target"
  )));

  const unresolvedFaultReport = verifyCurrentProtection(graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    device("load", "load", 0.60, [port("positive", "positive", "left")]),
  ], [connection("target", "source.out", "load.positive", "positive", "target", {
    currentProtection: { kind: "fuse", ratedCurrentA: 5, interruptRatingA: 6_000, verified: true },
  })], [source("source", "source.out", {
    continuousCapacityA: 5,
    shortCircuitCurrentA: "unbounded",
  })], [cable("target", 10)]));
  assert.ok(unresolvedFaultReport.warnings.some((issue) => (
    issue.code === "fault-current-unresolved" && issue.connectionId === "target"
  )));
  assert.equal(unresolvedFaultReport.errors.some((issue) => (
    issue.code === "interrupt-rating-insufficient" && issue.connectionId === "target"
  )), false);
});

test("interrupt ratings and explicit device body ratings are independently enforced", () => {
  const interruptSystem = graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    breaker("breaker", 0.35, 5, 10),
    device("load", "load", 0.65, [port("positive", "positive", "left")]),
  ], [
    connection("source-breaker", "source.out", "breaker.line", "positive", "wide"),
    connection("target", "breaker.load", "load.positive", "positive", "target"),
  ], [source("source", "source.out", { shortCircuitCurrentA: 100 })]);
  const interruptReport = verifyCurrentProtection(interruptSystem);
  assert.ok(interruptReport.errors.some((issue) => issue.code === "interrupt-rating-insufficient" && issue.deviceId === "breaker"));
  assert.equal(interruptReport.warnings.some((issue) => issue.code === "missing-device-rating" && issue.deviceId === "breaker"), false);
  assert.equal(interruptReport.devices.some((check) => check.deviceId === "breaker"), false);

  const bodySystem = graph([
    device("source", "converter", 0.10, [port("out", "positive")]),
    device("bus", "busbar", 0.55, [port("in", "positive", "left")], { currentRatingA: 100 }),
  ], [connection("feed", "source.out", "bus.in", "positive", "wide")], [source("source", "source.out", {
    continuousCapacityA: 120,
    shortCircuitCurrentA: 120,
    inherentCurrentLimit: { currentLimitA: 120, verified: true },
  })], [cable("wide", 120)]);
  const bodyReport = verifyCurrentProtection(bodySystem);
  assert.ok(bodyReport.errors.some((issue) => issue.code === "device-protection-incomplete" && issue.deviceId === "bus" && issue.ratingA === 100));
});

test("automatic naming preserves channel and direction through multicore topology", () => {
  assert.equal(graphEndpointDisplayLabel(dseTopology, "internetSplit.starlink"), "To Starlink Mini");
  assert.equal(graphEndpointDisplayLabel(dseTopology, "internetSplit.unifi"), "To UniFi 24 V to 5 V USB-A converter");
  assert.equal(
    graphEndpointDisplayLabel(dseTopology, "servicePenetration.starlinkPowerInside"),
    "To Starlink Mini",
  );
  const starlinkPositive = dseTopology.connections.find((candidate) => candidate.id === "internet-starlink-positive")!;
  assert.equal(
    graphConnectionDisplayLabel(dseTopology, starlinkPositive),
    "Six-gang service switch panel → Starlink Mini · Positive",
  );
});

test("automatic naming expands approved stacks, remote join owners and coherent multicore endpoints", () => {
  const stacked = graphEndpointDisplayLabel(dseTopology, "mainPositiveBus.post4");
  assert.equal(
    stacked,
    "Connected to Secondary 24 V positive bus · 100 A / SmartSolar cutoff · 120 A / Victron SmartShunt IP65 500 A",
  );
  assert.doesNotMatch(stacked, /\+\d+$/);

  assert.equal(
    graphEndpointDisplayLabel(dseTopology, "smartShunt.batteryMinus"),
    "Connected to Battery 1 · string A lower / Battery 3 · string B lower",
  );
  assert.equal(
    graphEndpointDisplayLabel(dseTopology, "join-battery1-negative.device"),
    "Battery 1 · string A lower → Victron SmartShunt IP65 500 A / Victron battery balancer A · Negative",
  );

  for (const [endpointId, expected] of [
    ["multiAcInBreakout.cable", "To Victron MultiPlus-II 24/3000"],
    ["acInputCableBreakout.cable", "To Victron MultiPlus-II 24/3000"],
    ["multiAcOutBreakout.cable", "To AC-out 10 A Type A RCBO + SPD"],
    ["acOutputCableBreakout.cable", "From Victron MultiPlus-II 24/3000"],
  ] as const) {
    assert.equal(graphEndpointDisplayLabel(dseTopology, endpointId), expected, endpointId);
  }
  assert.deepEqual(
    graphEndpointOwnerLabels(dseTopology, "multiAcInBreakout.cable", new Set(["ac-input-white-cable"])),
    ["Victron MultiPlus-II 24/3000"],
  );
  const acInputCable = dseTopology.connections.find((candidate) => candidate.id === "ac-input-white-cable")!;
  assert.equal(
    graphConnectionDisplayLabel(dseTopology, acInputCable),
    "Protected AC-in cable breakout → Victron MultiPlus-II 24/3000 · Multicore",
  );
});

test("automatic names preserve real owners, semantic fallbacks and distinct attached join arms", () => {
  assert.equal(graphEndpointDisplayLabel(dseTopology, "generator.line"), "To AC-in 10 A Type A RCBO + SPD");
  assert.equal(graphEndpointDisplayLabel(dseTopology, "toolOutlet.line"), "From AC-out 10 A Type A RCBO + SPD");
  assert.equal(graphEndpointDisplayLabel(dseTopology, "serviceSplit.room"), "To Indoor-light wall switch");
  assert.equal(
    graphEndpointDisplayLabel(dseTopology, "secondaryNegativeBus.post2"),
    "To Victron Orion-Tr Smart 24/12-30",
  );
  assert.equal(
    graphEndpointDisplayLabel(dseTopology, "secondaryPositiveBus.post5"),
    "To Victron Ekrano GX",
  );
  assert.match(graphEndpointDisplayLabel(dseTopology, "ekrano.positive"), /Secondary 24 V positive bus/);
  assert.match(graphEndpointDisplayLabel(dseTopology, "usbOrion.positiveIn"), /Orion input/);
  assert.equal(
    graphEndpointDisplayLabel(dseTopology, "join-battery1-negative.through"),
    "Battery 1 · string A lower → Victron SmartShunt IP65 500 A · Negative",
  );
  assert.equal(
    graphEndpointDisplayLabel(dseTopology, "join-battery3-negative.through"),
    "Battery 3 · string B lower → Victron SmartShunt IP65 500 A · Negative",
  );
  const unnamed = dseTopology.connections.find((candidate) => candidate.id === "ekrano-positive")!;
  assert.equal(unnamed.label, undefined);
  assert.equal(
    graphConnectionDisplayLabel(dseTopology, unnamed),
    "Secondary 24 V positive bus · 100 A → Victron Ekrano GX · Positive",
  );
});

test("resolved unnamed routes and procurement state are graph-derived", () => {
  const tiny = graph([
    device("source", "converter", 0.20, [port("out", "positive")]),
    device("load", "load", 0.60, [port("in", "positive", "left")], { currentRatingA: 10 }),
  ], [connection("unnamed", "source.out", "load.in", "positive", "target")], [source("source", "source.out", {
    continuousCapacityA: 10,
    shortCircuitCurrentA: 10,
    inherentCurrentLimit: { currentLimitA: 10, verified: true },
  })], [cable("target", 10)]);
  assert.equal(buildSystemRuntime(tiny).routeById.get("unnamed")?.label, "source equipment → load equipment · Positive");

  for (const id of ["acInputProtection", "acOutputProtection"]) {
    const protection = dseTopology.devices.find((candidate) => candidate.id === id)!;
    assert.equal(protection.status, "hold");
    assert.equal(isPurchasedDevice(protection), true);
    assert.match(protection.holdReason ?? "", /B0CRKNJSRH 10 A candidates/);
  }
});
