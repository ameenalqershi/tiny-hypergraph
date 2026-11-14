import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

function singleRouteFixture(native = false) {
  const f = createPreparedRoutingFixture()
  f.problem.routeCount = 1
  f.problem.routeStartPort = f.problem.routeStartPort.slice(0, 1)
  f.problem.routeEndPort = f.problem.routeEndPort.slice(0, 1)
  f.problem.routeNet = f.problem.routeNet.slice(0, 1)
  if (native) {
    f.topology.incidentPortRegion[2]!.push(2)
    f.topology.regionIncidentPorts[2]!.push(2)
  }
  return f
}

const options = {
  LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 0.01,
  LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS: 0,
  LOCAL_ROUTE_CORRIDOR_WINDOW_ITERATIONS: 1,
}

test("a hard-capped weighted preview falls back to native exact A* on dense path without mutating masks", () => {
  const f = singleRouteFixture()
  const maskBefore = Array.from(f.problem.portSectionMask)
  const base = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    ...options,
  })
  const weighted = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    ...options,
    LOCAL_ROUTE_WEIGHTED_FALLBACK_FACTOR: 64,
    LOCAL_ROUTE_WEIGHTED_FALLBACK_ITERATIONS: 1,
  })
  base.solve()
  weighted.solve()
  expect(base.solved).toBe(true)
  expect(weighted.solved).toBe(true)
  expect(weighted.weightedFallbackStats).toEqual({
    attempted: 1,
    solved: 0,
    returnedToExact: 1,
  })
  expect(weighted.corridorStats.fullFallbacks).toBe(1)
  expect(weighted.state.regionSegments).toEqual(base.state.regionSegments)
  expect(weighted.state.portAssignment).toEqual(base.state.portAssignment)
  expect(Array.from(f.problem.portSectionMask)).toEqual(maskBefore)
})

test("weighted unrestricted search succeeds before its cap on native general-incidence topology", () => {
  const f = singleRouteFixture(true)
  const solver = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    ...options,
    LOCAL_ROUTE_WEIGHTED_FALLBACK_FACTOR: 64,
    LOCAL_ROUTE_WEIGHTED_FALLBACK_ITERATIONS: 3000,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.weightedFallbackStats.attempted).toBe(1)
  expect(solver.weightedFallbackStats.solved).toBe(1)
  expect(solver.weightedFallbackStats.returnedToExact).toBe(0)
  expect(solver.state.unroutedRoutes).toHaveLength(0)
})

test("unsatisfiable source remains unsatisfiable after bounded guide AND full unrestricted native search", () => {
  const f = singleRouteFixture()
  f.problem.portSectionMask.fill(0)
  const solver = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    ...options,
    STATIC_REACHABILITY_PRECHECK: false,
    MAX_ITERATIONS: 10000,
    LOCAL_ROUTE_WEIGHTED_FALLBACK_FACTOR: 32,
    LOCAL_ROUTE_WEIGHTED_FALLBACK_ITERATIONS: 12,
  })
  solver.solve()
  expect(solver.solved).toBe(false)
  expect(solver.weightedFallbackStats.attempted).toBe(1)
  expect(solver.weightedFallbackStats.returnedToExact).toBe(1)
  expect(
    solver.state.regionSegments.every((regions) => regions.length === 0),
  ).toBe(true)
})

test("invalid weighted factors and budgets fail fast, and default route behavior is unchanged", () => {
  const f = singleRouteFixture()
  for (const factor of [0, -1, NaN, Infinity]) {
    expect(
      () =>
        new PreparedPortPointRoutingSolver(f.topology, f.problem, {
          ...f.options,
          ...options,
          LOCAL_ROUTE_WEIGHTED_FALLBACK_FACTOR: factor,
        }),
    ).toThrow()
  }
  expect(
    () =>
      new PreparedPortPointRoutingSolver(f.topology, f.problem, {
        ...f.options,
        LOCAL_ROUTE_WEIGHTED_FALLBACK_FACTOR: 64,
      }),
  ).toThrow()
  expect(
    () =>
      new PreparedPortPointRoutingSolver(f.topology, f.problem, {
        ...f.options,
        ...options,
        LOCAL_ROUTE_WEIGHTED_FALLBACK_FACTOR: 64,
        LOCAL_ROUTE_WEIGHTED_FALLBACK_ITERATIONS: -1,
      }),
  ).toThrow()
  const disabled = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    ...options,
  })
  disabled.solve()
  expect(disabled.solved).toBe(true)
  expect(disabled.weightedFallbackStats.attempted).toBe(0)
})
