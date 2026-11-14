/** Read-only, explicit opt-in search-frontier attribution. Never routes or filters. */
export type RouteSearchProbeReason =
  | "queuePop"
  | "candidateOutOfCorridor"
  | "staleCandidate"
  | "currentRegionReserved"
  | "neighborScanned"
  | "neighborOutOfCorridor"
  | "goalSeen"
  | "portMasked"
  | "closedHop"
  | "differentNetPortReservation"
  | "differentNetPortAssignment"
  | "differentNetRegionReservation"
  | "bestCostRejected"
  | "lowerBoundRejected"
  | "scoreRejected"
  | "candidateQueued"
  | "pathFound"

export type RouteSearchProbeCounts = Partial<
  Record<RouteSearchProbeReason, number>
>
export type RouteSearchProbeWindow = {
  kind: "local" | "unrestricted"
  widthMm: number | null
  startIteration: number
  endIteration: number
  iterations: number
  counts: RouteSearchProbeCounts
}
export type RouteSearchProbeRecord = {
  routeId: number
  startIteration: number
  endIteration: number
  iterations: number
  succeeded: boolean
  windows: RouteSearchProbeWindow[]
}

/** Cap memory: keep only the most expensive completed routes plus the active one. */
export class RouteSearchDiagnostics {
  private active?: RouteSearchProbeRecord
  readonly topRoutes: RouteSearchProbeRecord[] = []
  readonly totalByReason: RouteSearchProbeCounts = {}
  readonly totalByWindowKind: Record<
    "local" | "unrestricted",
    RouteSearchProbeCounts
  > = {
    local: {},
    unrestricted: {},
  }
  completedRouteCount = 0
  constructor(readonly keepTopRoutes = 24) {}
  record(reason: RouteSearchProbeReason): void {
    const route = this.active
    if (!route) return
    const window = route.windows[route.windows.length - 1]
    if (!window) return
    window.counts[reason] = (window.counts[reason] ?? 0) + 1
    this.totalByReason[reason] = (this.totalByReason[reason] ?? 0) + 1
    const totals = this.totalByWindowKind[window.kind]
    totals[reason] = (totals[reason] ?? 0) + 1
  }
  beginRoute(routeId: number, iteration: number, margin: number | null): void {
    if (this.active) this.endRoute(iteration, false)
    this.active = {
      routeId,
      startIteration: iteration,
      endIteration: iteration,
      iterations: 0,
      succeeded: false,
      windows: [this.createWindow(iteration, margin)],
    }
  }
  private createWindow(
    iteration: number,
    margin: number | null,
  ): RouteSearchProbeWindow {
    return {
      kind: margin === null ? "unrestricted" : "local",
      widthMm: margin,
      startIteration: iteration,
      endIteration: iteration,
      iterations: 0,
      counts: {},
    }
  }
  nextWindow(iteration: number, margin: number | null): void {
    if (!this.active) return
    const previous = this.active.windows[this.active.windows.length - 1]!
    previous.endIteration = iteration
    previous.iterations = iteration - previous.startIteration
    this.active.windows.push(this.createWindow(iteration, margin))
  }
  endRoute(iteration: number, succeeded: boolean): void {
    const active = this.active
    if (!active) return
    const last = active.windows[active.windows.length - 1]!
    last.endIteration = iteration
    last.iterations = iteration - last.startIteration
    active.endIteration = iteration
    active.iterations = iteration - active.startIteration
    active.succeeded = succeeded
    this.active = undefined
    this.completedRouteCount++
    this.topRoutes.push(active)
    this.topRoutes.sort((a, b) => b.iterations - a.iterations)
    if (this.topRoutes.length > this.keepTopRoutes) this.topRoutes.pop()
  }
  snapshot(iteration: number): {
    enabled: true
    totalByReason: RouteSearchProbeCounts
    totalByWindowKind: Record<"local" | "unrestricted", RouteSearchProbeCounts>
    completedRouteCount: number
    topRoutes: RouteSearchProbeRecord[]
    active: RouteSearchProbeRecord | null
  } {
    let active: RouteSearchProbeRecord | null = null
    if (this.active) {
      active = structuredClone(this.active)
      const last = active.windows[active.windows.length - 1]!
      last.endIteration = iteration
      last.iterations = iteration - last.startIteration
      active.endIteration = iteration
      active.iterations = iteration - active.startIteration
    }
    return {
      enabled: true,
      totalByReason: { ...this.totalByReason },
      totalByWindowKind: {
        local: { ...this.totalByWindowKind.local },
        unrestricted: { ...this.totalByWindowKind.unrestricted },
      },
      completedRouteCount: this.completedRouteCount,
      topRoutes: this.topRoutes.map((r) => ({
        ...r,
        windows: r.windows.map((w) => ({ ...w, counts: { ...w.counts } })),
      })),
      active,
    }
  }
}
