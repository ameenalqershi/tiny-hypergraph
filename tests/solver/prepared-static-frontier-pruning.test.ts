import { expect, test } from "bun:test"
import { PreparedPortPointRoutingSolver } from "../../lib/prepared/PreparedPortPointRoutingSolver"
import { createPreparedRoutingFixture } from "../fixtures/createPreparedRoutingFixture"

const make = (native = false) => {
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

test("immutable mask exclusions are removed once per owned frontier, with exact routing parity", () => {
  const f = make(true)
  const t = f.topology
  let masked = 0
  for (let port = 0; port < t.portCount; port++) {
    if (
      t.incidentPortRegion[port]?.length > 1 &&
      port !== f.problem.routeStartPort[0] &&
      port !== f.problem.routeEndPort[0]
    ) {
      if (port % 3 === 2) {
        f.problem.portSectionMask[port] = 0
        masked++
      }
    }
  }
  expect(masked).toBeGreaterThan(0)
  const originalMasks = Array.from(f.problem.portSectionMask)
  const common = {
    ...f.options,
    OWNED_REGIONAL_HOP_FRONTIER: true,
    STATIC_REACHABILITY_PRECHECK: false,
  }
  const base = new PreparedPortPointRoutingSolver(t, f.problem, common)
  const fast = new PreparedPortPointRoutingSolver(t, f.problem, {
    ...common,
    PRUNE_STATIC_FRONTIER_REJECTIONS: true,
  })
  base.solve()
  fast.solve()
  expect(base.solved).toBe(true)
  expect(fast.solved).toBe(true)
  expect(fast.state.regionSegments).toEqual(base.state.regionSegments)
  expect(fast.state.portAssignment).toEqual(base.state.portAssignment)
  expect(fast.staticFrontierPruningStats.portMask).toBeGreaterThan(0)
  expect(Array.from(f.problem.portSectionMask)).toEqual(originalMasks)
})

test("disabled default preserves prior original native behavior", () => {
  const f = make()
  const solver = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...f.options,
    OWNED_REGIONAL_HOP_FRONTIER: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(
    Object.values(solver.staticFrontierPruningStats).every((x) => x === 0),
  ).toBe(true)
})

test("pruned and unpruned paths remain deterministic for fixed section masks and costs", () => {
  for (let modulus of [2, 3, 4, 5, 6]) {
    const f = make()
    for (let port = 0; port < f.topology.portCount; port++)
      if (
        port % modulus === modulus - 1 &&
        f.topology.incidentPortRegion[port]!.length === 2
      )
        f.problem.portSectionMask[port] = 0
    const options = {
      ...f.options,
      OWNED_REGIONAL_HOP_FRONTIER: true,
      STATIC_REACHABILITY_PRECHECK: false,
    }
    const base = new PreparedPortPointRoutingSolver(
      f.topology,
      f.problem,
      options,
    )
    const opt = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
      ...options,
      PRUNE_STATIC_FRONTIER_REJECTIONS: true,
    })
    base.solve()
    opt.solve()
    expect(opt.solved).toBe(base.solved)
    expect(opt.failed).toBe(base.failed)
    expect(opt.state.regionSegments).toEqual(base.state.regionSegments)
    expect(opt.state.portAssignment).toEqual(base.state.portAssignment)
  }
})

test("two competing nets re-invalidate cached frontier exclusions after route changes", () => {
  const f = createPreparedRoutingFixture()
  f.problem.routeCount = 2
  f.problem.routeStartPort = Int32Array.from([
    f.problem.routeStartPort[0]!,
    f.problem.routeStartPort[1]!,
  ])
  f.problem.routeEndPort = Int32Array.from([
    f.problem.routeEndPort[0]!,
    f.problem.routeEndPort[1]!,
  ])
  f.problem.routeNet = Int32Array.from([17, 18])
  const options = {
    ...f.options,
    OWNED_REGIONAL_HOP_FRONTIER: true,
    STATIC_REACHABILITY_PRECHECK: false,
    ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
    MAX_ITERATIONS: 100000,
  }
  const baseline = new PreparedPortPointRoutingSolver(
    f.topology,
    f.problem,
    options,
  )
  const cached = new PreparedPortPointRoutingSolver(f.topology, f.problem, {
    ...options,
    PRUNE_STATIC_FRONTIER_REJECTIONS: true,
  })
  baseline.solve()
  cached.solve()
  expect(cached.solved).toBe(baseline.solved)
  expect(cached.failed).toBe(baseline.failed)
  expect(cached.state.regionSegments).toEqual(baseline.state.regionSegments)
  expect(cached.state.portAssignment).toEqual(baseline.state.portAssignment)
  expect(cached.iterations).toBe(baseline.iterations)
})
