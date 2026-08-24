import type { GraphData } from "../types";

export interface ShortestPathResult {
	path: string[];
	totalDistance: number;
}

export function findShortestPath(
	graph: GraphData,
	startId: string,
	endId: string,
): ShortestPathResult | null {
	const startIndex = graph.nodes.findIndex((n) => n.id === startId);
	const endIndex = graph.nodes.findIndex((n) => n.id === endId);

	if (startIndex === -1 || endIndex === -1) return null;

	const distances = new Array(graph.nodes.length).fill(Infinity);
	const previous = new Array<number | null>(graph.nodes.length).fill(null);
	const unvisited = new Set<number>();

	for (let i = 0; i < graph.nodes.length; i++) {
		unvisited.add(i);
	}

	distances[startIndex] = 0;

	while (unvisited.size > 0) {
		let current: number | null = null;
		let bestDistance = Infinity;

		for (const nodeIndex of unvisited) {
			if (distances[nodeIndex] < bestDistance) {
				bestDistance = distances[nodeIndex];
				current = nodeIndex;
			}
		}

		if (current === null) break;
		if (current === endIndex) break;

		unvisited.delete(current);

		for (const link of graph.links) {
			let neighbor: number | null = null;

			if (link.source === current) neighbor = link.target;
			else if (link.target === current) neighbor = link.source;

			if (neighbor === null || !unvisited.has(neighbor)) continue;

			const distance = link.distance ?? 1;
			const candidate = distances[current] + distance;

			if (candidate < distances[neighbor]) {
				distances[neighbor] = candidate;
				previous[neighbor] = current;
			}
		}
	}

	if (!Number.isFinite(distances[endIndex])) return null;

	const pathIndexes: number[] = [];
let cursor: number | null = endIndex;

while (cursor !== null) {
	pathIndexes.unshift(cursor);
	cursor = previous[cursor] ?? null;
}

const path = pathIndexes
	.map((i) => graph.nodes[i])
	.filter((node): node is NonNullable<typeof node> => node !== undefined)
	.map((node) => node.id);

return {
	path,
	totalDistance: distances[endIndex],
};
}