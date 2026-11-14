# Issue #2868 — Conservative region-level detour preflight (standalone experiment)

**Status: 2026-11-14 experimental library utility only; NOT connected to production routing.** This branch contains a typed, read-only `computeConservativeRegionRouteWitness` BFS over existing `regionIncidentPorts` and `incidentPortRegion`, with source/goal route IDs and fixed net region reservations. It **does not modify a route, copper/via/pour geometry, global port masks, candidate costs or DRC**.

## Motivation grounded in exact original-board evidence

In the full, SHA-verified original six-layer #2868 fixture (684 source connections, 3,809 obstacles), the previous experimental 3/9/27-mm corridor/search fallback at the unchanged 8M global graph-iteration cap still fails with 893 graph routes waiting. Native candidate-level counters proved that 38 unrestricted fallback searches consumed 6,591,536 of 7,982,887 candidate queue pops (**82.57%**), and 150,361,967 of 187,946,546 neighbor scans (**80.0%**). None of that proves every source net physically connected; no full-board strict/relaxed DRC was run after a completed PCB.

This standalone region-graph preflight is a possible way to **avoid expensive LOCAL search windows proven topologically disconnected** before exact route search. It is not itself a replacement for route A* or a proof that every returned region skeleton is physically realizable.

## Overapproximation and limitations

- Traverses only areas whose **static** `regionNetId` is `-1` (unreserved) or equals the active source net ID. Honors `portSectionMask` and the fixed `portEndpointReservationNetId` sentinels `-1` (unreserved), `-2` (conflicting), `netId` (same net). Ignores `portSectionMask` on terminal goal, matching native route semantics.
- **Deliberately ignores** dynamic `portAssignment`, route-region crossing geometry, copper overlaps, pad/via drill/annulus, layer-transition geometry, and congestion costs. This permits **false positives**, not intended false negatives, for actual port graph paths. The `portZ` value is not proof of a physical via.
- For route ID, visibility predicate, or graph limitations unknown to the caller, it returns `inconclusive`; for a visited bounded static region graph with no path it returns `unreachable-in-window`, **NOT** `unroutable` and **NOT** a PCB/DRC result.
- If this were integrated into route search, only `unreachable-in-window` would authorize skipping a *specific bounded window*; it must expand to a larger window or run the original unrestricted solver. **Never reject the required source connection based on abstract reachability.**
- A reported `reachable` witness means a **possible graph-region skeleton** (`regionIds` and `transitPortIds`) that may guide a future search tube. The exact native graph search and post-routing checks remain mandatory.
- A preflight on a massive board can itself cost O(number of regions + incident ports); do not assume a win without measured benchmark on the graph built from the *unchanged original input*. Passing synthetic cases does not justify auto-enabling this algorithm.

## Deterministic unit evidence

`bun test tests/solver/conservative-region-reachability.test.ts` passes nine focused tests. Adversarial cases verify: (a) when a different-net region blocks the direct path, a multi-layer abstract detour exists outside the narrow XY box, (b) expanding the window reveals the detour, (c) fixed foreign-net port reservation correctly blocks the detour, (d) static section masks and owner IDs are preserved, (e) low computational budgets return `inconclusive`, and (f) every successfully routed source/goal pair from the actual four-module prepared-routing fixture is classified as statically `reachable`, never falsely rejected.

The synthetic graph is **not** the original #2868 board: it is a four-region adversarial counterexample for window locality. No physical trace shapes, copper pours or DRC are generated. This prototype has no claims of 684-source completion, reduced original-board runtime, or elimination of the 38 unrestricted fallback searches.

## Integration gating (not done)

1. Validate overapproximate reachability against real serialized `tiny-hypergraph` graph topology, including multi-incidence ports, source-only and goal-only ports, fixed-region and fixed-port reservations, and every source–goal pair accepted by native solver.
2. Run the preflight **only** at local-window entry. On `unreachable-in-window`, consider the next larger corridor with unchanged effective native constraints and **full unbounded search as final fallback**. On `reachable` or `inconclusive`, invoke unchanged native A*.
3. Benchmark actual preflight wall time, memory and saved neighbor/queue operations against the exact full original board, not just the one-pair control. Reject the change if preflight overhead or false negatives dominate.
4. Require zero strict/default/relaxed DRC, complete source-to-PCB connectivity and all 684 source connections on original SHA before any production PR claiming fix.

## 2026-11-14 original-board full qualification verdict: **do not enable**

A subsequent opt-in integration was implemented in an **independent** Pipeline9 research branch, preserving the native exact unbounded A* fallback. See the [full original-board measured negative result](https://github.com/ameenalqershi/tscircuit-autorouter/blob/experiment/2868-region-preflight-integration-20261114/docs/issue2868-static-preflight-full-board-negative-result.md) and machine-readable A/B receipt. On the exact original SHA of 684 source connections / 3,809 obstacles / six layers, **1,791 region-preflight calls all returned reachable**; **zero** bounded routing windows were bypassed. The preflight introduced 14,799,962 additional region-port incidence scans, while **all 8 million graph iterations, 7,982,887 candidate pops, 187,946,546 neighbor scans, 38 unrestricted fallbacks, route-1710 failure and 893 queued routes matched the no-preflight baseline exactly**. No completed-board DRC was reached. A one-pair derived, exact-SHA control retained zero DRC/missing/disconnected source terminals and identical output copper.

**Decision:** preserve this library utility and disabled-by-default flag only for research; the specific static-reachability preflight has been **falsified as a #2868 performance remedy**. No upstream production merge or issue-fix claim. Future work should concentrate on the cost-aware A* candidate frontier, not more region-only BFS or arbitrary iteration-cap increases. The preceding “Integration gating (not done)” section is historical pre-integration planning; the completed experimental integration yielded this negative measured conclusion.
