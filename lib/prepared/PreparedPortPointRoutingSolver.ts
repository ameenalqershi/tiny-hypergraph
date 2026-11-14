import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import type { TinyHyperGraphSolver, TinyHyperGraphSolverOptions } from "../core"
import { SelectiveReripTinyHyperGraphSolver } from "../selective-rerip-tiny-hyper-graph-solver"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "./SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { DenseRoutingWorkspace } from "./DenseRoutingWorkspace"
import { PreparedRoutingGeometry } from "./PreparedRoutingGeometry"
import { RouteSearchCorridor } from "./RouteSearchCorridor"
import { RouteSearchDiagnostics } from "./RouteSearchDiagnostics"

class PreparedFinalRouteSolver extends SelectiveReripTinyHyperGraphSolver {
  private readonly workspace: DenseRoutingWorkspace
  remainingReripBudget = 0

  constructor(
    topology: TinyHyperGraphSolver["topology"],
    problem: TinyHyperGraphSolver["problem"],
    options: TinyHyperGraphSolverOptions,
    geometry: PreparedRoutingGeometry,
  ) {
    super(topology, problem, options)
    this.workspace = new DenseRoutingWorkspace(geometry)
  }

  override _step(): void {
    if (!this.workspace.step(this)) super._step()
  }

  override onOutOfCandidates(): void {
    super.onOutOfCandidates()
    if (this.state.ripCount >= this.remainingReripBudget) {
      this.failed = true
      this.error = "Congestion-aware final routing exhausted its rerip budget"
    }
  }
}

export class PreparedPortPointRoutingSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  private readonly geometry = new PreparedRoutingGeometry(this.topology)
  private readonly workspace = new DenseRoutingWorkspace(this.geometry)
  private asyncRunning = false
  private readonly corridor?: RouteSearchCorridor
  private corridorRouteId?: number
  private corridorIterationStart = 0
  readonly corridorStats = {
    widened: 0,
    fullFallbacks: 0,
    boundedRouteStarts: 0,
  }

  constructor(
    topology: TinyHyperGraphSolver["topology"],
    problem: TinyHyperGraphSolver["problem"],
    options?: TinyHyperGraphSolverOptions,
  ) {
    super(topology, problem, options)
    if (options?.ROUTE_SEARCH_DIAGNOSTICS === true) {
      this.routeSearchDiagnostics = new RouteSearchDiagnostics()
    }
    if (options?.LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN !== undefined) {
      this.corridor = new RouteSearchCorridor({
        initialMargin: options.LOCAL_ROUTE_CORRIDOR_INITIAL_MARGIN,
        growthFactor: options.LOCAL_ROUTE_CORRIDOR_GROWTH_FACTOR,
        maxExpansions: options.LOCAL_ROUTE_CORRIDOR_MAX_EXPANSIONS,
        perWindowIterationBudget:
          options.LOCAL_ROUTE_CORRIDOR_WINDOW_ITERATIONS,
      })
    }
  }

  private startCorridor(routeId: number): void {
    this.corridorRouteId = routeId
    this.corridorIterationStart = this.iterations
    this.corridor?.start(
      this.getRouteStartPortId(routeId),
      this.getRouteEndPortId(routeId),
      this.topology.portX,
      this.topology.portY,
    )
    this.routeSearchPortPredicate = this.corridor?.isBounded
      ? (portId) =>
          this.corridor!.contains(
            portId,
            this.topology.portX,
            this.topology.portY,
          )
      : undefined
    this.routeSearchDiagnostics?.beginRoute(
      routeId,
      this.iterations,
      this.corridor?.currentMargin ?? null,
    )
    if (this.corridor?.isBounded) this.corridorStats.boundedRouteStarts++
  }

  /** Reset only the active tentative search, never an accepted route or global
   * assignment. Clearing the native heap invalidates all cached frontiers. */
  private restartCurrentRoute(): void {
    const routeId = this.state.currentRouteId
    if (routeId === undefined)
      throw new Error("No current route for corridor restart")
    const startPort = this.getRouteStartPortId(routeId)
    const startRegion = this.getStartingNextRegionId(routeId, startPort)
    if (startRegion === undefined)
      throw new Error("No starting region for corridor restart")
    const hop = this.getHopId(startPort, startRegion)
    this.state.candidateQueue.clear()
    this.resetCandidateBestCosts()
    this.setCandidateBestCost(hop, 0)
    this.state.candidateQueue.queue({
      hopId: hop,
      portId: startPort,
      nextRegionId: startRegion,
      f: 0,
      g: 0,
      h: 0,
    })
    this.state.goalPortId = this.getRouteEndPortId(routeId)
    this.corridorIterationStart = this.iterations
  }

  private widenAndRestart(): boolean {
    if (
      !this.corridor?.isBounded ||
      this.corridorRouteId !== this.state.currentRouteId ||
      (this.state.currentRouteId !== undefined &&
        this.partialRipRoutePlans.has(this.state.currentRouteId))
    )
      return false
    const widened = this.corridor.widen(
      this.topology.portX,
      this.topology.portY,
    )
    if (!widened) return false
    if (this.corridor.isBounded) this.corridorStats.widened++
    else {
      this.corridorStats.fullFallbacks++
      this.routeSearchPortPredicate = undefined
    }
    this.routeSearchDiagnostics?.nextWindow(
      this.iterations,
      this.corridor.currentMargin,
    )
    this.restartCurrentRoute()
    return true
  }

  override onPathFound(
    candidate: Parameters<TinyHyperGraphSolver["onPathFound"]>[0],
  ): void {
    this.routeSearchDiagnostics?.record("pathFound")
    this.routeSearchDiagnostics?.endRoute(this.iterations, true)
    super.onPathFound(candidate)
  }

  override onOutOfCandidates(): void {
    if (this.widenAndRestart()) return
    super.onOutOfCandidates()
  }

  override _step(): void {
    const routeId = this.state.currentRouteId
    const nextRoute = routeId ?? this.state.unroutedRoutes[0]
    if (nextRoute !== undefined && this.partialRipRoutePlans.has(nextRoute)) {
      // A partial-rip plan uses its own path geometry: never clip it.
      this.routeSearchPortPredicate = undefined
    } else if (
      this.corridor &&
      nextRoute !== undefined &&
      (routeId === undefined || nextRoute !== this.corridorRouteId)
    )
      this.startCorridor(nextRoute)
    const active =
      routeId !== undefined &&
      this.corridorRouteId === routeId &&
      !this.partialRipRoutePlans.has(routeId)
        ? this.corridor
        : undefined
    if (
      active?.isBounded &&
      this.iterations - this.corridorIterationStart >=
        active.perWindowIterationBudget
    ) {
      this.widenAndRestart()
      return
    }
    if (
      (routeId !== undefined && this.partialRipRoutePlans.has(routeId)) ||
      !this.workspace.step(this, active)
    )
      super._step()
  }

  protected override createGreedyFinalRouteSolver(
    options: TinyHyperGraphSolverOptions,
    attempt: number,
  ): TinyHyperGraphSolver {
    if (attempt >= 0)
      return super.createGreedyFinalRouteSolver(options, attempt)
    const solver = new PreparedFinalRouteSolver(
      this.topology,
      this.problem,
      {
        ...options,
        MAX_ITERATIONS: Math.max(
          options.MAX_ITERATIONS ?? 50_000,
          this.MAX_ITERATIONS * 2,
        ),
      },
      this.geometry,
    )
    solver.remainingReripBudget =
      this.costAwareFinalReripBudget - this.state.ripCount
    return solver
  }

  async solveAsync(
    runtime?: SolverRuntimeExecutor,
    stopAtIteration = Infinity,
  ): Promise<void> {
    if (this.asyncRunning)
      throw new Error("Prepared routing solveAsync is already running")
    this.asyncRunning = true
    try {
      if (
        runtime &&
        !this.solved &&
        !this.failed &&
        this.iterations < stopAtIteration
      )
        await this.geometry.prepareAsync(runtime)
      while (!this.solved && !this.failed && this.iterations < stopAtIteration)
        this.step()
    } catch (error) {
      this.failed = true
      this.error = `Prepared routing execution failed: ${error}`
      throw error
    } finally {
      this.asyncRunning = false
    }
  }
}
