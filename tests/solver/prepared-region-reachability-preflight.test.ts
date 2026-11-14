import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

function singleRoute() {
  const f = createPreparedRoutingFixture()
  f.problem.routeCount = 1
  f.problem.routeStartPort = f.problem.routeStartPort.slice(0, 1)
  f.problem.routeEndPort = f.problem.routeEndPort.slice(0, 1)
  f.problem.routeNet = f.problem.routeNet.slice(0, 1)
  return f
}

test("an abstractly impossible narrow corridor is skipped without changing the eventual exact path", () => {
  const f = singleRoute()
  // Every crossing between regions 0 and 1 lies outside both 0.01 and 0.03mm windows.
  for (let port = 0; port < f.topology.portCount; port++) {
    if (
      f.topology.incidentPortRegion[port]?.includes(0) &&
      f.topology.incidentPortRegion[port]?.includes(1)
    ) {
      f.topology.portY[port] = 5
    }
  }
  const maskBefore = Array.from(f.problem.portSectionMask)
  const cfg = {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 0.01,
    LOCAL_ROUTE_CORRIDOR_GROWTH_FACTOR: 3,
    LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS: 2,
    LOCAL_ROUTE_CORRIDOR_WINDOW_ITERATIONS: 5000,
  }
  const control = new PreparedPortPointRoutingSolver(f.topology, f.problem, cfg)
  const measured = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...cfg,
    LOCAL_ROUTE_CORRIDOR_REGION_PREFLIGHT: true,
    ROUTE_SEARCH_DIAGNOSTICS: true,
  })
  control.solve()
  measured.solve()
  expect(control.solved).toBe(true)
  expect(measured.solved).toBe(true)
  expect(measured.state.regionSegments).toEqual(control.state.regionSegments)
  expect(measured.state.portAssignment).toEqual(control.state.portAssignment)
  expect(Array.from(f.problem.portSectionMask)).toEqual(maskBefore)
  expect(
    measured.preflightStats.unreachableWindowsSkipped,
  ).toBeGreaterThanOrEqual(1)
  expect(measured.preflightStats.scannedPorts).toBeGreaterThan(0)
  expect(
    measured.routeSearchDiagnostics?.snapshot(measured.iterations)
      .completedRouteCount,
  ).toBe(1)
})

test("reachable same-net local corridor keeps the same exact output with opt-in preflight", () => {
  const f = singleRoute()
  const cfg = { ...f.options, LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 10 }
  const a = new PreparedPortPointRoutingSolver(f.topology, f.problem, cfg)
  const b = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...cfg,
    LOCAL_ROUTE_CORRIDOR_REGION_PREFLIGHT: true,
  })
  a.solve()
  b.solve()
  expect(a.solved).toBe(true)
  expect(b.solved).toBe(true)
  expect(b.state.regionSegments).toEqual(a.state.regionSegments)
  expect(b.preflightStats.unreachableWindowsSkipped).toBe(0)
  expect(b.preflightStats.reachable).toBeGreaterThan(0)
})

test("globally unconnected topology stays failed even after full fallback; no fabricated route", () => {
  const f = singleRoute()
  for (const port of f.topology.regionIncidentPorts[1]!)
    f.problem.portSectionMask[port] = 0
  const cfg = {
    ...f.options,
    MAX_ITERATIONS: 15000,
    STATIC_REACHABILITY_PRECHECK: false,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 0.1,
    LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS: 0,
    LOCAL_ROUTE_CORRIDOR_REGION_PREFLIGHT: true,
  }
  const solver = new PreparedPortPointRoutingSolver(f.topology, f.problem, cfg)
  solver.solve()
  expect(solver.preflightStats.unreachableWindowsSkipped).toBeGreaterThan(0)
  expect(solver.corridorStats.fullFallbacks).toBeGreaterThan(0)
  expect(solver.solved).toBe(false)
  expect(solver.state.regionSegments.every((segs) => segs.length === 0)).toBe(
    true,
  )
})

test("preflight without an explicit bounded-corridor experiment fails fast", () => {
  const f = singleRoute()
  expect(
    () =>
      new PreparedPortPointRoutingSolver(f.topology, f.problem, {
        ...f.options,
        LOCAL_ROUTE_CORRIDOR_REGION_PREFLIGHT: true,
      }),
  ).toThrow("Region preflight requires an enabled route corridor")
})

test("disabled preflight does not allocate or scan the additional topology", () => {
  const f = singleRoute()
  const solver = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 10,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.preflightStats.checks).toBe(0)
  expect(solver.preflightStats.scannedPorts).toBe(0)
})
