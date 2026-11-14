import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { RouteSearchCorridor } from "../../lib/prepared/RouteSearchCorridor"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

test("corridor increases margin before falling back to unrestricted geometry", () => {
  const corridor = new RouteSearchCorridor({
    initialMargin: 1,
    growthFactor: 3,
    maxExpansions: 1,
  })
  const x = Float64Array.from([0, 7, 3]),
    y = Float64Array.from([0, 0, 4])
  corridor.start(0, 1, x, y)
  expect(corridor.contains(2, x, y)).toBe(false)
  expect(corridor.contains(0, x, y)).toBe(true)
  expect(corridor.widen(x, y)).toBe(true)
  expect(corridor.currentMargin).toBe(3)
  expect(corridor.contains(2, x, y)).toBe(false)
  expect(corridor.widen(x, y)).toBe(true)
  expect(corridor.isBounded).toBe(false)
  expect(corridor.contains(2, x, y)).toBe(true)
  expect(corridor.widen(x, y)).toBe(false)
})

test("invalid opt-in configurations fail fast rather than silently restricting routes", () => {
  expect(() => new RouteSearchCorridor({ initialMargin: -1 })).toThrow()
  expect(
    () => new RouteSearchCorridor({ initialMargin: 1, growthFactor: 1 }),
  ).toThrow()
  expect(
    () => new RouteSearchCorridor({ initialMargin: 1, maxExpansions: -1 }),
  ).toThrow()
})

function singleRouteFixture() {
  const fixture = createPreparedRoutingFixture()
  fixture.problem.routeCount = 1
  fixture.problem.routeStartPort = fixture.problem.routeStartPort.slice(0, 1)
  fixture.problem.routeEndPort = fixture.problem.routeEndPort.slice(0, 1)
  fixture.problem.routeNet = fixture.problem.routeNet.slice(0, 1)
  return fixture
}

test("opt-in margin enclosing all hops preserves native route output and assignments", () => {
  const f = singleRouteFixture()
  const maskBefore = Array.from(f.problem.portSectionMask)
  const baseline = new PreparedPortPointRoutingSolver(
    f.topology,
    f.problem,
    f.options,
  )
  baseline.solve()
  const candidate = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 3,
  })
  candidate.solve()
  expect(baseline.solved).toBe(true)
  expect(candidate.solved).toBe(true)
  expect(candidate.state.regionSegments).toEqual(baseline.state.regionSegments)
  expect(candidate.state.portAssignment).toEqual(baseline.state.portAssignment)
  expect(Array.from(f.problem.portSectionMask)).toEqual(maskBefore)
  expect(candidate.corridorStats.fullFallbacks).toBe(0)
})

test("blocked local corridor widens then returns to original unrestricted search", () => {
  const f = singleRouteFixture()
  const t = f.topology
  const start = f.problem.routeStartPort[0]!,
    end = f.problem.routeEndPort[0]!
  t.portY[start] = 0
  t.portY[end] = 0
  // Detour above the straight start-goal segment, outside the initial XY corridor.
  for (let p = 0; p < t.portCount; p++) {
    if (
      t.incidentPortRegion[p]?.some((r) => r <= 2) &&
      p !== start &&
      p !== end &&
      t.incidentPortRegion[p]!.length === 2
    )
      t.portY[p] = 2.5
  }
  for (let p = 0; p < t.portCount; p++) {
    for (
      let i = 0;
      i < Math.min(t.incidentPortRegion[p]?.length ?? 0, 2);
      i++
    ) {
      const r = t.incidentPortRegion[p]![i]!
      const a = Math.round(
        (Math.atan2(
          t.portY[p]! - t.regionCenterY[r]!,
          t.portX[p]! - t.regionCenterX[r]!,
        ) *
          18000) /
          Math.PI,
      )
      if (i === 0) t.portAngleForRegion1[p] = a
      else t.portAngleForRegion2![p] = a
    }
  }
  const originalMask = Array.from(f.problem.portSectionMask)
  const baseline = new PreparedPortPointRoutingSolver(t, f.problem, f.options)
  baseline.solve()
  expect(baseline.solved).toBe(true)
  const local = new PreparedPortPointRoutingSolver(t, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 0.05,
    LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS: 1,
    LOCAL_ROUTE_CORRIDOR_GROWTH_FACTOR: 2,
    LOCAL_ROUTE_CORRIDOR_WINDOW_ITERATIONS: 20,
  })
  local.solve()
  expect(local.solved).toBe(true)
  expect(local.corridorStats.fullFallbacks).toBeGreaterThan(0)
  expect(local.state.regionSegments).toEqual(baseline.state.regionSegments)
  expect(local.state.portAssignment).toEqual(baseline.state.portAssignment)
  expect(Array.from(f.problem.portSectionMask)).toEqual(originalMask)
  expect(local.state.unroutedRoutes).toHaveLength(0)
})

test("unsupported dense workspace still applies corridor to native search and safely falls back", () => {
  const f = singleRouteFixture()
  f.topology.incidentPortRegion[2]!.push(2)
  f.topology.regionIncidentPorts[2]!.push(2)
  const t = f.topology
  const start = f.problem.routeStartPort[0]!,
    end = f.problem.routeEndPort[0]!
  t.portY[start] = 0
  t.portY[end] = 0
  for (let port = 0; port < t.portCount; port++) {
    if (
      t.incidentPortRegion[port]?.some((r) => r <= 2) &&
      port !== start &&
      port !== end &&
      t.incidentPortRegion[port]!.length >= 2
    )
      t.portY[port] = 2.5
    for (
      let i = 0;
      i < Math.min(t.incidentPortRegion[port]?.length ?? 0, 2);
      i++
    ) {
      const r = t.incidentPortRegion[port]![i]!
      const angle = Math.round(
        (Math.atan2(
          t.portY[port]! - t.regionCenterY[r]!,
          t.portX[port]! - t.regionCenterX[r]!,
        ) *
          18000) /
          Math.PI,
      )
      if (i === 0) t.portAngleForRegion1[port] = angle
      else t.portAngleForRegion2![port] = angle
    }
  }
  const baseline = new PreparedPortPointRoutingSolver(t, f.problem, f.options)
  baseline.solve()
  const adapted = new PreparedPortPointRoutingSolver(t, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 0.05,
    LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS: 0,
    LOCAL_ROUTE_CORRIDOR_WINDOW_ITERATIONS: 12,
  })
  adapted.solve()
  expect(baseline.solved).toBe(true)
  expect(adapted.solved).toBe(true)
  expect(adapted.corridorStats.fullFallbacks).toBe(1)
  expect(adapted.state.regionSegments).toEqual(baseline.state.regionSegments)
  expect(adapted.state.portAssignment).toEqual(baseline.state.portAssignment)
})

test("intermediate widening can recover route without unrestricted fallback", () => {
  const f = singleRouteFixture()
  const t = f.topology
  const start = f.problem.routeStartPort[0]!,
    goal = f.problem.routeEndPort[0]!
  t.portY[start] = 0
  t.portY[goal] = 0
  for (let i = 0; i < t.portCount; i++) {
    if (
      i !== start &&
      i !== goal &&
      t.incidentPortRegion[i]?.some((r) => r <= 2) &&
      t.incidentPortRegion[i]!.length >= 2
    )
      t.portY[i] = 2.5
    for (
      let slot = 0;
      slot < Math.min(t.incidentPortRegion[i]?.length ?? 0, 2);
      slot++
    ) {
      const region = t.incidentPortRegion[i]![slot]!
      const angle = Math.round(
        (Math.atan2(
          t.portY[i]! - t.regionCenterY[region]!,
          t.portX[i]! - t.regionCenterX[region]!,
        ) *
          18000) /
          Math.PI,
      )
      if (slot === 0) t.portAngleForRegion1[i] = angle
      else t.portAngleForRegion2![i] = angle
    }
  }
  const reference = new PreparedPortPointRoutingSolver(t, f.problem, f.options)
  reference.solve()
  const candidate = new PreparedPortPointRoutingSolver(t, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 0.05,
    LOCAL_ROUTE_CORRIDOR_GROWTH_FACTOR: 100,
    LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS: 2,
    LOCAL_ROUTE_CORRIDOR_WINDOW_ITERATIONS: 15,
  })
  candidate.solve()
  expect(reference.solved).toBe(true)
  expect(candidate.solved).toBe(true)
  expect(candidate.corridorStats.widened).toBe(1)
  expect(candidate.corridorStats.fullFallbacks).toBe(0)
  expect(candidate.state.regionSegments).toEqual(reference.state.regionSegments)
})

test("deterministic multi-route variations terminate without losing source routes or mutating masks", () => {
  for (const margin of [0.01, 0.2, 1, 3]) {
    for (const maxExpansions of [0, 1, 2]) {
      const f = createPreparedRoutingFixture()
      const before = Array.from(f.problem.portSectionMask)
      const candidate = new PreparedPortPointRoutingSolver(
        f.topology,
        f.problem,
        {
          ...f.options,
          LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: margin,
          LOCAL_ROUTE_CORRIDOR_GROWTH_FACTOR: 3,
          LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS: maxExpansions,
          LOCAL_ROUTE_CORRIDOR_WINDOW_ITERATIONS: 100,
        },
      )
      candidate.solve()
      expect(candidate.solved).toBe(true)
      expect(candidate.failed).toBe(false)
      expect(candidate.state.unroutedRoutes).toHaveLength(0)
      expect(candidate.state.currentRouteId).toBeUndefined()
      expect(Array.from(f.problem.portSectionMask)).toEqual(before)
      const completed = new Set(
        candidate.state.regionSegments.flatMap((s) => s.map((seg) => seg[0])),
      )
      expect(completed.size).toBe(f.problem.routeCount)
    }
  }
})

test("a truly disconnected source stays unconnected after every corridor fallback", () => {
  const f = singleRouteFixture()
  const { topology, problem } = f
  for (let port = 0; port < topology.portCount; port++) {
    const regions = topology.incidentPortRegion[port] ?? []
    if (regions.length >= 2 && regions.some((region) => region <= 2))
      problem.portSectionMask[port] = 0
  }
  const initialMask = Array.from(problem.portSectionMask)
  const original = new PreparedPortPointRoutingSolver(
    topology,
    problem,
    f.options,
  )
  original.solve()
  const adaptive = new PreparedPortPointRoutingSolver(topology, problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 0.1,
    LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS: 2,
    LOCAL_ROUTE_CORRIDOR_GROWTH_FACTOR: 5,
    LOCAL_ROUTE_CORRIDOR_WINDOW_ITERATIONS: 20,
  })
  adaptive.solve()
  expect(original.solved).toBe(false)
  expect(adaptive.solved).toBe(false)
  expect(adaptive.state.regionSegments).toEqual(original.state.regionSegments)
  expect(adaptive.state.portAssignment).toEqual(original.state.portAssignment)
  expect(Array.from(problem.portSectionMask)).toEqual(initialMask)
})

test("a requeued route with the same ID receives a fresh local search epoch", () => {
  const f = singleRouteFixture()
  const solver = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 1,
  })
  // A global rerip may requeue the most recent ID before any other route starts.
  // This stale metadata is intentionally injected to test route-epoch renewal.
  ;(solver as unknown as { corridorRouteId: number }).corridorRouteId = 0
  solver.step()
  expect(solver.corridorStats.boundedRouteStarts).toBe(1)
  expect(solver.state.currentRouteId).toBe(0)
})
