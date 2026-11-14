import { expect, test } from "bun:test"
import { computeConservativeRegionRouteWitness as witness } from "../../lib/prepared/ConservativeRegionReachability"

// Deliberate detour: a direct middle region (1) is owned by POWER. The only
// GND path goes above the XY box via region 2 to region 3. The artificial
// multi-layer topology is a static overapproximation, not an actual via/drill.
function fixture() {
  const graph = {
    regionCount: 4,
    portCount: 6,
    regionIncidentPorts: [
      [0, 1, 3],
      [1, 2],
      [3, 4],
      [2, 4, 5],
    ],
    incidentPortRegion: [[0], [0, 1], [1, 3], [0, 2], [2, 3], [3]],
    portZ: Int32Array.from([0, 0, 0, 0, 3, 3]),
    portX: Float64Array.from([0, 1, 2, 0, 3, 3]),
    portY: Float64Array.from([0, 0, 0, 5, 5, 0]),
  }
  const restrictions = {
    regionNetId: Int32Array.from([-1, 1, -1, -1]),
    portSectionMask: Uint8Array.from([1, 1, 1, 1, 1, 1]),
    portEndpointReservationNetId: Int32Array.from([-1, -1, -1, -1, -1, -1]),
  }
  return { graph, restrictions, startPortId: 0, goalPortId: 5, netId: 0 }
}
test("unrestricted abstract graph finds a detour around a region reserved for another net", () => {
  const input = fixture()
  const result = witness(input)
  expect(result.status).toBe("reachable")
  expect(result.regionIds).toEqual([0, 2, 3])
  expect(result.transitPortIds).toEqual([0, 3, 4, 5])
  expect(result.visitedRegions).toBeLessThanOrEqual(3)
})
test("endpoint-only XY corridor cannot see a required detour; widening restores overapproximate reachability", () => {
  const input = fixture()
  const narrow = witness({
    ...input,
    isPortVisible: (port) => input.graph.portY[port]! <= 1,
  })
  expect(narrow.status).toBe("unreachable-in-window")
  const wide = witness({
    ...input,
    isPortVisible: (port) => input.graph.portY[port]! <= 6,
  })
  expect(wide.status).toBe("reachable")
  expect(wide.regionIds).toEqual([0, 2, 3])
})
test("fixed foreign-net port reservation blocks the only detour without claiming a physical short", () => {
  const input = fixture()
  input.restrictions.portEndpointReservationNetId[3] = 2
  expect(witness(input).status).toBe("unreachable-in-window")
})
test("section mask and fixed region ownership can only remove static region transitions", () => {
  const input = fixture()
  input.restrictions.portSectionMask[4] = 0
  expect(witness(input).status).toBe("unreachable-in-window")
  input.restrictions.portSectionMask[4] = 1
  input.restrictions.regionNetId[2] = 1
  expect(witness(input).status).toBe("unreachable-in-window")
})
test("budget or invalid source stays inconclusive rather than declaring unroutable", () => {
  const input = fixture()
  expect(witness({ ...input, maxVisitedRegions: 1 }).status).toBe(
    "inconclusive",
  )
  expect(witness({ ...input, startPortId: 999 }).status).toBe("inconclusive")
})
test("ignoring dynamic foreign port assignments remains a permissive overapproximation", () => {
  const input = fixture()
  // No runtime portAssignment array is used; downstream native search must
  // still enforce those assignments and physical trace intersections.
  const result = witness(input)
  expect(result.status).toBe("reachable")
})

test("the native prepared graph's successfully routed terminals are never declared unreachable by the static abstraction", async () => {
  const { createPreparedRoutingFixture } = await import(
    "../fixtures/createPreparedRoutingFixture"
  )
  const { PreparedPortPointRoutingSolver } = await import(
    "../../lib/prepared/PreparedPortPointRoutingSolver"
  )
  for (const routeId of [0, 1, 2, 3]) {
    const f = createPreparedRoutingFixture()
    f.problem.routeCount = 1
    f.problem.routeStartPort = Int32Array.from([
      f.problem.routeStartPort[routeId]!,
    ])
    f.problem.routeEndPort = Int32Array.from([f.problem.routeEndPort[routeId]!])
    f.problem.routeNet = Int32Array.from([f.problem.routeNet[routeId]!])
    const solver = new PreparedPortPointRoutingSolver(
      f.topology,
      f.problem,
      f.options,
    )
    solver.solve()
    expect(solver.solved).toBe(true)
    const result = witness({
      graph: f.topology,
      restrictions: {
        regionNetId: f.problem.regionNetId,
        portSectionMask: f.problem.portSectionMask,
      },
      startPortId: f.problem.routeStartPort[0]!,
      goalPortId: f.problem.routeEndPort[0]!,
      netId: f.problem.routeNet[0]!,
    })
    expect(result.status).toBe("reachable")
    expect(result.transitPortIds[0]).toBe(f.problem.routeStartPort[0])
    expect(result.transitPortIds.at(-1)).toBe(f.problem.routeEndPort[0])
  }
})

test("same-net reserved region remains passable whereas fixed foreign reservation blocks it", () => {
  const input = fixture()
  input.restrictions.regionNetId[2] = input.netId
  expect(witness(input).status).toBe("reachable")
  input.restrictions.regionNetId[2] = 7
  expect(witness(input).status).toBe("unreachable-in-window")
})

test("a missing or empty search budget is explicitly inconclusive, not an electrical result", () => {
  const input = fixture()
  expect(witness({ ...input, maxVisitedRegions: 0 }).status).toBe(
    "inconclusive",
  )
  expect(witness({ ...input, maxVisitedRegions: -3 }).status).toBe(
    "inconclusive",
  )
})
