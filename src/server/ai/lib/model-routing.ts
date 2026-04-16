/**
 * Shared helpers for model-route ordering.
 */
import { weightedShuffle } from "@/server/lib/weighted-shuffle";

interface RouteCarrier {
  route: {
    priority: number;
    weight: number;
  };
}

/**
 * Order routes by priority ASC, then weighted-random within the same priority band.
 * Weight 0 excludes a route from the weighted pool when positive-weight siblings exist.
 */
export function orderRoutesByPriorityAndWeight<T extends RouteCarrier>(routes: T[]): T[] {
  const groups = new Map<number, T[]>();

  for (const route of routes) {
    const group = groups.get(route.route.priority);
    if (group) group.push(route);
    else groups.set(route.route.priority, [route]);
  }

  return [...groups.keys()]
    .sort((a, b) => a - b)
    .flatMap((priority) =>
      weightedShuffle(groups.get(priority) ?? [], ({ route }) => route.weight ?? 1),
    );
}
