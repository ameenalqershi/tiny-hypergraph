import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { RouteSearchDiagnostics } from "../../lib/prepared/RouteSearchDiagnostics"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

const onlyFirstRoute = () => {
  const f = createPreparedRoutingFixture()
  f.problem.routeCount = 1
  f.problem.routeStartPort = f.problem.routeStartPort.slice(0, 1)
  f.problem.routeEndPort = f.problem.routeEndPort.slice(0, 1)
  f.problem.routeNet = f.problem.routeNet.slice(0, 1)
  return f
}

test("instrumentation is opt-in, read-only and preserves the exact completed assignments", () => {
  const f = onlyFirstRoute()
  const beforeMask = Array.from(f.problem.portSectionMask)
  const control = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 4,
  })
  control.solve()
  const sampled = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 4,
    ROUTE_SEARCH_DIAGNOSTICS: true,
  })
  sampled.solve()
  expect(control.routeSearchDiagnostics).toBeUndefined()
  expect(sampled.solved).toBe(true)
  expect(sampled.failed).toBe(false)
  expect(sampled.state.regionSegments).toEqual(control.state.regionSegments)
  expect(sampled.state.portAssignment).toEqual(control.state.portAssignment)
  expect(Array.from(f.problem.portSectionMask)).toEqual(beforeMask)
  const probe = sampled.routeSearchDiagnostics?.snapshot(sampled.iterations)
  expect(probe?.completedRouteCount).toBe(1)
  expect(probe?.topRoutes[0]?.routeId).toBe(0)
  expect(probe?.topRoutes[0]?.succeeded).toBe(true)
  expect(probe?.topRoutes[0]?.windows).toHaveLength(1)
  expect(probe?.totalByReason.queuePop).toBeGreaterThan(0)
  expect(probe?.totalByReason.neighborScanned).toBeGreaterThan(0)
  expect(probe?.totalByReason.candidateQueued).toBeGreaterThan(0)
  expect(probe?.totalByReason.pathFound).toBe(1)
  expect(probe?.totalByWindowKind.unrestricted.queuePop).toBeUndefined()
})

test("window rollovers attribute local search cost separately from unrestricted fallback", () => {
  const f = onlyFirstRoute()
  const probe = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 0.001,
    LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS: 0,
    LOCAL_ROUTE_CORRIDOR_WINDOW_ITERATIONS: 2,
    ROUTE_SEARCH_DIAGNOSTICS: true,
  })
  probe.solve()
  expect(probe.solved).toBe(true)
  expect(probe.corridorStats.fullFallbacks).toBe(1)
  const record = probe.routeSearchDiagnostics!.snapshot(probe.iterations)
    .topRoutes[0]!
  expect(record.succeeded).toBe(true)
  expect(record.windows).toHaveLength(2)
  expect(record.windows[0]!.kind).toBe("local")
  expect(record.windows[1]!.kind).toBe("unrestricted")
  expect(record.windows[0]!.iterations).toBeGreaterThan(0)
  expect(record.windows[1]!.counts.queuePop).toBeGreaterThan(0)
  expect(record.windows[0]!.iterations + record.windows[1]!.iterations).toBe(
    record.iterations,
  )
})

test("diagnostic recording caps retained route history and does not infer success", () => {
  const d = new RouteSearchDiagnostics(2)
  for (let i = 0; i < 3; i++) {
    d.beginRoute(i, i * 100, null)
    d.record("candidateQueued")
    d.endRoute(i * 100 + 5 + i, i === 2)
  }
  const snapshot = d.snapshot(310)
  expect(snapshot.completedRouteCount).toBe(3)
  expect(snapshot.topRoutes).toHaveLength(2)
  expect(snapshot.topRoutes.map((r) => r.routeId)).toEqual([2, 1])
  expect(snapshot.topRoutes[0]!.succeeded).toBe(true)
  expect(snapshot.topRoutes[1]!.succeeded).toBe(false)
  expect(snapshot.totalByReason.candidateQueued).toBe(3)
})

test("unsupported dense graph records native frontier pops and neighbor decisions", () => {
  const f = onlyFirstRoute()
  // Three incident regions force the native general-incidence path.
  f.topology.incidentPortRegion[2]!.push(2)
  f.topology.regionIncidentPorts[2]!.push(2)
  const original = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 3,
  })
  const measured = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN: 3,
    ROUTE_SEARCH_DIAGNOSTICS: true,
  })
  original.solve()
  measured.solve()
  expect(original.solved).toBe(true)
  expect(measured.solved).toBe(true)
  expect(measured.state.regionSegments).toEqual(original.state.regionSegments)
  const records = measured.routeSearchDiagnostics!.snapshot(measured.iterations)
  expect(records.completedRouteCount).toBe(1)
  expect(records.totalByReason.queuePop).toBeGreaterThan(0)
  expect(records.totalByReason.neighborScanned).toBeGreaterThan(0)
  expect(records.totalByReason.pathFound).toBe(1)
})

test("diagnostics alone can observe unrestricted native routing without enabling locality", () => {
  const f = onlyFirstRoute()
  f.topology.incidentPortRegion[2]!.push(2)
  f.topology.regionIncidentPorts[2]!.push(2)
  const baseline = new PreparedPortPointRoutingSolver(
    f.topology,
    f.problem,
    f.options,
  )
  const measured = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    ROUTE_SEARCH_DIAGNOSTICS: true,
  })
  baseline.solve()
  measured.solve()
  expect(baseline.solved).toBe(true)
  expect(measured.solved).toBe(true)
  expect(measured.state.portAssignment).toEqual(baseline.state.portAssignment)
  expect(measured.state.regionSegments).toEqual(baseline.state.regionSegments)
  expect(measured.corridorStats.boundedRouteStarts).toBe(0)
  const stats = measured.routeSearchDiagnostics!.snapshot(measured.iterations)
  expect(stats.completedRouteCount).toBe(1)
  expect(stats.totalByWindowKind.unrestricted.queuePop).toBeGreaterThan(0)
  expect(stats.totalByWindowKind.local.queuePop).toBeUndefined()
})
