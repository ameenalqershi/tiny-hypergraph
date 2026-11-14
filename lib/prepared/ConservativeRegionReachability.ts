/**
 * A conservative STATIC region-graph reachability witness for a single route.
 * A successful witness DOES NOT prove copper routability or electrical contact.
 * A negative result inside a caller's exact port visibility set is only useful
 * for deciding whether to enlarge that search window; it must never become a
 * global "unroutable" decision or bypass native A-star search or DRC.
 *
 * This abstraction intentionally ignores dynamic assignments, segment
 * intersections, congestion and layer-change feasibility: it can yield false
 * positives but is designed to avoid false negatives for native graph paths.
 */
export type ConservativeRegionGraph = {
  regionCount: number
  portCount: number
  regionIncidentPorts: ReadonlyArray<readonly number[]>
  incidentPortRegion: ReadonlyArray<readonly number[]>
}
export type ConservativeRegionRestrictions = {
  /** RegionNetId -1 = unreserved; all other IDs designate the owning net. */
  regionNetId: ArrayLike<number>
  portSectionMask: ArrayLike<number>
  portEndpointReservationNetId?: ArrayLike<number>
}
export type ConservativeRegionRouteWitness = {
  status: "reachable" | "unreachable-in-window" | "inconclusive"
  scannedPorts: number
  visitedRegions: number
  regionIds: number[]
  transitPortIds: number[]
}
export function computeConservativeRegionRouteWitness(params: {
  graph: ConservativeRegionGraph
  restrictions: ConservativeRegionRestrictions
  startPortId: number
  goalPortId: number
  netId: number
  isPortVisible?: (portId: number) => boolean
  maxVisitedRegions?: number
}): ConservativeRegionRouteWitness {
  const { graph, restrictions: p, startPortId, goalPortId, netId } = params
  const { regionCount, portCount } = graph
  const empty = (
    status: ConservativeRegionRouteWitness["status"],
    scannedPorts = 0,
    visitedRegions = 0,
  ): ConservativeRegionRouteWitness => ({
    status,
    scannedPorts,
    visitedRegions,
    regionIds: [],
    transitPortIds: [],
  })
  if (
    !Number.isInteger(startPortId) ||
    !Number.isInteger(goalPortId) ||
    startPortId < 0 ||
    goalPortId < 0 ||
    startPortId >= portCount ||
    goalPortId >= portCount
  ) {
    return empty("inconclusive")
  }
  if (startPortId === goalPortId)
    return {
      status: "reachable",
      scannedPorts: 0,
      visitedRegions: 0,
      regionIds: [],
      transitPortIds: [startPortId],
    }
  const budget = params.maxVisitedRegions ?? regionCount
  if (!Number.isInteger(budget) || budget < 1) return empty("inconclusive")
  const visible = (port: number) =>
    port === startPortId ||
    port === goalPortId ||
    (params.isPortVisible?.(port) ?? true)
  const permittedRegion = (region: number) =>
    Number.isInteger(region) &&
    region >= 0 &&
    region < regionCount &&
    (p.regionNetId[region] === -1 || p.regionNetId[region] === netId)
  const permittedPort = (port: number) => {
    if (port === startPortId) return true
    if (port < 0 || port >= portCount || !visible(port)) return false
    if (port !== goalPortId && p.portSectionMask[port] === 0) return false
    const reservation = p.portEndpointReservationNetId?.[port] ?? -1
    return reservation !== -2 && (reservation === -1 || reservation === netId)
  }
  const visited = new Uint8Array(regionCount)
  const previous = new Int32Array(regionCount).fill(-1)
  const crossedPort = new Int32Array(regionCount).fill(-1)
  const queue = new Int32Array(regionCount)
  let head = 0,
    tail = 0
  for (const region of graph.incidentPortRegion[startPortId] ?? []) {
    if (!permittedRegion(region) || visited[region]) continue
    visited[region] = 1
    previous[region] = -2
    queue[tail++] = region
  }
  let scannedPorts = 0
  let visitedRegions = 0
  while (head < tail) {
    if (visitedRegions >= budget)
      return empty("inconclusive", scannedPorts, visitedRegions)
    const region = queue[head++]!
    visitedRegions++
    for (const port of graph.regionIncidentPorts[region] ?? []) {
      scannedPorts++
      if (!permittedPort(port)) continue
      if (port === goalPortId) {
        const regions = [region]
        const transit: number[] = []
        let cursor = region
        while (previous[cursor] !== -2) {
          const parent = previous[cursor]!
          if (parent < 0)
            return empty("inconclusive", scannedPorts, visitedRegions)
          transit.unshift(crossedPort[cursor]!)
          regions.unshift(parent)
          cursor = parent
        }
        return {
          status: "reachable",
          scannedPorts,
          visitedRegions,
          regionIds: regions,
          transitPortIds: [startPortId, ...transit, goalPortId],
        }
      }
      for (const next of graph.incidentPortRegion[port] ?? []) {
        if (!permittedRegion(next) || visited[next]) continue
        visited[next] = 1
        previous[next] = region
        crossedPort[next] = port
        queue[tail++] = next
      }
    }
  }
  return empty("unreachable-in-window", scannedPorts, visitedRegions)
}
