/** Optional route-scoped spatial pruning. This filters candidates, not copper
 * geometry or permanent problem masks. Full-graph search is the final fallback. */
export class RouteSearchCorridor {
  readonly initialMargin: number
  readonly growthFactor: number
  readonly maxExpansions: number
  readonly perWindowIterationBudget: number
  private bounds?: { minX: number; maxX: number; minY: number; maxY: number }
  private startPortId = -1
  private goalPortId = -1
  private margin = 0
  private expansions = 0
  private unbounded = true

  constructor(options: {
    initialMargin: number
    growthFactor?: number
    maxExpansions?: number
    perWindowIterationBudget?: number
  }) {
    if (!Number.isFinite(options.initialMargin) || options.initialMargin <= 0)
      throw new Error(
        "RouteSearchCorridor: initialMargin must be positive and finite",
      )
    this.initialMargin = options.initialMargin
    this.growthFactor = options.growthFactor ?? 3
    this.maxExpansions = options.maxExpansions ?? 2
    this.perWindowIterationBudget = options.perWindowIterationBudget ?? 8000
    if (
      !Number.isFinite(this.growthFactor) ||
      this.growthFactor <= 1 ||
      !Number.isInteger(this.maxExpansions) ||
      this.maxExpansions < 0 ||
      !Number.isInteger(this.perWindowIterationBudget) ||
      this.perWindowIterationBudget < 1
    )
      throw new Error(
        "RouteSearchCorridor: invalid growth/expansion/budget options",
      )
  }

  get isBounded() {
    return !this.unbounded
  }
  get windowNumber() {
    return this.expansions
  }
  get currentMargin() {
    return this.unbounded ? null : this.margin
  }

  start(
    startPortId: number,
    goalPortId: number,
    x: Float64Array,
    y: Float64Array,
  ): void {
    this.startPortId = startPortId
    this.goalPortId = goalPortId
    if (
      [x[startPortId], x[goalPortId], y[startPortId], y[goalPortId]].some(
        (v) => !Number.isFinite(v),
      )
    ) {
      this.unbounded = true
      this.bounds = undefined
      return
    }
    this.expansions = 0
    this.margin = this.initialMargin
    this.unbounded = false
    this.setBounds(x, y)
  }

  private setBounds(x: Float64Array, y: Float64Array) {
    this.bounds = {
      minX: Math.min(x[this.startPortId]!, x[this.goalPortId]!) - this.margin,
      maxX: Math.max(x[this.startPortId]!, x[this.goalPortId]!) + this.margin,
      minY: Math.min(y[this.startPortId]!, y[this.goalPortId]!) - this.margin,
      maxY: Math.max(y[this.startPortId]!, y[this.goalPortId]!) + this.margin,
    }
  }

  contains(port: number, x: Float64Array, y: Float64Array): boolean {
    if (this.unbounded || port === this.startPortId || port === this.goalPortId)
      return true
    const b = this.bounds!
    return (
      x[port]! >= b.minX &&
      x[port]! <= b.maxX &&
      y[port]! >= b.minY &&
      y[port]! <= b.maxY
    )
  }

  /** Returns false only when full search has already been enabled. */
  widen(x: Float64Array, y: Float64Array): boolean {
    if (this.unbounded) return false
    if (this.expansions >= this.maxExpansions) {
      this.unbounded = true
      this.bounds = undefined
    } else {
      this.expansions++
      this.margin *= this.growthFactor
      this.setBounds(x, y)
    }
    return true
  }
}
