export type HyperspaceWeatherType =
	| 'current'
	| 'storm'
	| 'tempest'


export interface PLDate {
	year: number;
	month: number;
	day: number;
}

const HYPERSPACE_EPOCH_YEAR = 250;
const WEATHER_TICK_DAYS = 7;

function isLeapYear(year: number): boolean {
	return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
	const lengths = [
		31,
		isLeapYear(year) ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31,
	];

	return lengths[month - 1] ?? 0;
}

export function plDateToDay(date: PLDate): number {
	if (date.year < HYPERSPACE_EPOCH_YEAR) {
		throw new Error('Date predates the hyperspace weather epoch.');
	}

	if (date.month < 1 || date.month > 12) {
		throw new Error('Invalid month.');
	}

	const maxDay = daysInMonth(date.year, date.month);

	if (date.day < 1 || date.day > maxDay) {
		throw new Error('Invalid day.');
	}

	let total = 0;

	for (let year = HYPERSPACE_EPOCH_YEAR; year < date.year; year++) {
		total += isLeapYear(year) ? 366 : 365;
	}

	for (let month = 1; month < date.month; month++) {
		total += daysInMonth(date.year, month);
	}

	total += date.day - 1;

	return total;
}

export function hashStringToSeed(input: string): number {
	let hash = 2166136261;

	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}

	return hash >>> 0;
}

export function createSeededRandom(seed: number): () => number {
	let state = seed >>> 0;

	return () => {
		state += 0x6D2B79F5;

		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function createHyperlaneSeed(
	day: number,
	systemAId: string,
	systemBId: string,
): number {
	const [first, second] = [systemAId, systemBId].sort();

	return hashStringToSeed(
		`${day}:${first}:${second}`
	);
}
export function weatherTickForDay(day: number): number {
	return Math.floor(day / WEATHER_TICK_DAYS);
}

export function weatherTickStartDay(tick: number): number {
	return tick * WEATHER_TICK_DAYS;
}
export interface HyperspaceCurrent {
	type: 'current';
	originSystemId: string;
destinationSystemId: string;
strength: number; // -100 to 100; sign indicates direction
    startDay: number;
    endDay: number;
}

export function generateCurrentDurationDays(random: () => number): number {
	const roll = random();

	if (roll < 0.50) {
		// 1–7 days
		return 1 + Math.floor(random() * 7);
	}

	if (roll < 0.80) {
		// 8–30 days
		return 8 + Math.floor(random() * 23);
	}

	if (roll < 0.95) {
		// 31–90 days
		return 31 + Math.floor(random() * 60);
	}

	// 91–180 days
	return 91 + Math.floor(random() * 90);
}

export function generateCurrentStrength(random: () => number): number {
	const magnitude = 1 + Math.floor(random() * 100);
	const direction = random() < 0.5 ? -1 : 1;

	return magnitude * direction;
}

export type CurrentStrengthClass =
	| 'Weak'
	| 'Moderate'
	| 'Strong'
	| 'Intense'
	| 'Mighty';

export function classifyCurrentStrength(
	strength: number,
): CurrentStrengthClass {
	const magnitude = Math.abs(strength);

	if (magnitude < 20) return 'Weak';
	if (magnitude < 40) return 'Moderate';
	if (magnitude < 60) return 'Strong';
	if (magnitude < 80) return 'Intense';

	return 'Mighty';
}

export function describeCurrentForSystem(
	current: HyperspaceCurrent,
	systemId: string,
	systemNameById: (id: string) => string,
): string {
	const flowsCanonicalDirection = current.strength > 0;

	const fromId = flowsCanonicalDirection
		? current.originSystemId
		: current.destinationSystemId;

	const toId = flowsCanonicalDirection
		? current.destinationSystemId
		: current.originSystemId;

	const strengthClass = classifyCurrentStrength(current.strength);

	if (systemId === toId) {
		return `${strengthClass} current inbound from ${systemNameById(fromId)}`;
	}

	if (systemId === fromId) {
		return `${strengthClass} current outbound to ${systemNameById(toId)}`;
	}

	return `${strengthClass} current`;
}

export function shouldGenerateCurrent(random: () => number): boolean {
	const roll = 1 + Math.floor(random() * 12);
	return roll === 12;
}



export function createCurrentForTick(
	systemAId: string,
	systemBId: string,
	tick: number,
): HyperspaceCurrent | null {
	const tickStartDay = weatherTickStartDay(tick);

	const seed = createHyperlaneSeed(
		tick,
		systemAId,
		systemBId,
	);

	const random = createSeededRandom(seed);

	if (!shouldGenerateCurrent(random)) return null;

	const startOffset = Math.floor(random() * WEATHER_TICK_DAYS);
	const startDay = tickStartDay + startOffset;

	const duration = generateCurrentDurationDays(random);
const strength = generateCurrentStrength(random);

const originSystemId =
	systemAId.localeCompare(systemBId) <= 0
		? systemAId
		: systemBId;

const destinationSystemId =
	originSystemId === systemAId
		? systemBId
		: systemAId;

	return {
	type: 'current',
	originSystemId,
	destinationSystemId,
	strength,
	startDay,
	endDay: startDay + duration - 1,
};
}
export function getActiveCurrentForLane(
	systemAId: string,
	systemBId: string,
	day: number,
): HyperspaceCurrent | null {
	const currentTick = weatherTickForDay(day);

	let occupiedUntilDay = -1;

	for (let tick = 0; tick <= currentTick; tick++) {
		const candidate = createCurrentForTick(
			systemAId,
			systemBId,
			tick,
		);

		if (!candidate) continue;

		// A new current cannot begin while an accepted current
		// is still occupying this hyperlane.
		if (candidate.startDay <= occupiedUntilDay) {
			continue;
		}

		occupiedUntilDay = candidate.endDay;

		if (
			candidate.startDay <= day &&
			candidate.endDay >= day
		) {
			return candidate;
		}
	}

	return null;
}

export interface ActiveHyperlaneCurrent {
	linkIndex: number;
	current: HyperspaceCurrent;
}

export function getActiveCurrentsForGraph(
	graph: import('../types').GraphData,
	day: number,
): ActiveHyperlaneCurrent[] {
	const activeCurrents: ActiveHyperlaneCurrent[] = [];
	const seenLanes = new Set<string>();

	for (let linkIndex = 0; linkIndex < graph.links.length; linkIndex++) {
		const link = graph.links[linkIndex];
		if (!link) continue;

		const sourceNode = graph.nodes[link.source];
		const targetNode = graph.nodes[link.target];

		if (!sourceNode || !targetNode) continue;
		if (sourceNode.unresolved || targetNode.unresolved) continue;

        if (
	!isRepublicSystem(sourceNode) &&
	!isRepublicSystem(targetNode)
) {
	continue;
}

        const laneKey = [sourceNode.id, targetNode.id]
	.sort()
	.join('::');

if (seenLanes.has(laneKey)) continue;
seenLanes.add(laneKey);

		const current = getActiveCurrentForLane(
			sourceNode.id,
			targetNode.id,
			day,
		);

		if (!current) continue;

		activeCurrents.push({
			linkIndex,
			current,
		});
	}

	return activeCurrents;
}

export type StormStrengthClass =
	| 'Light'
	| 'Unsettled'
	| 'Disturbed'
	| 'Raging'
	| 'Extreme'
	| 'Maelstrom';

export interface HyperspaceStorm {
	type: 'storm';
	centerSystemId: string;
	strength: number; // 1–100; 100 = Maelstrom
	startDay: number;
	endDay: number;
}

export function classifyStormStrength(
	strength: number,
): StormStrengthClass {
	if (strength === 100) return 'Maelstrom';
	if (strength < 20) return 'Light';
	if (strength < 40) return 'Unsettled';
	if (strength < 60) return 'Disturbed';
	if (strength < 80) return 'Raging';

	return 'Extreme';
}

export function shouldGenerateStorm(
	random: () => number,
): boolean {
	const roll = 1 + Math.floor(random() * 35);
	return roll === 35;
}

export function generateStormStrength(
	random: () => number,
): number {
	return 1 + Math.floor(random() * 100);
}

function createSystemWeatherSeed(
	tick: number,
	systemId: string,
): number {
	return hashStringToSeed(
		`${tick}:${systemId}:storm`
	);
}

export function createStormForTick(
	systemId: string,
	tick: number,
): HyperspaceStorm | null {
	const tickStartDay = weatherTickStartDay(tick);

	const random = createSeededRandom(
		createSystemWeatherSeed(tick, systemId),
	);

	if (!shouldGenerateStorm(random)) return null;

	const startOffset = Math.floor(
		random() * WEATHER_TICK_DAYS,
	);

	const startDay = tickStartDay + startOffset;

	const duration = generateCurrentDurationDays(random);
	const strength = generateStormStrength(random);

	return {
		type: 'storm',
		centerSystemId: systemId,
		strength,
		startDay,
		endDay: startDay + duration - 1,
	};
}

export function getActiveStormForSystem(
	systemId: string,
	day: number,
): HyperspaceStorm | null {
	const currentTick = weatherTickForDay(day);

	let occupiedUntilDay = -1;

	for (let tick = 0; tick <= currentTick; tick++) {
		const candidate = createStormForTick(
			systemId,
			tick,
		);

		if (!candidate) continue;

		if (candidate.startDay <= occupiedUntilDay) {
			continue;
		}

		occupiedUntilDay = candidate.endDay;

		if (
			candidate.startDay <= day &&
			candidate.endDay >= day
		) {
			return candidate;
		}
	}

	return null;
}

export function isRepublicSystem(
	node: import('../types').GraphNode,
): boolean {
	return (
		typeof node.owner === 'string' &&
		node.owner.trim().toLowerCase() === 'republic'
	);
}

export interface ActiveHyperspaceStorm {
	systemIndex: number;
	storm: HyperspaceStorm;
}

export function getActiveStormsForGraph(
	graph: import('../types').GraphData,
	day: number,
): ActiveHyperspaceStorm[] {
	const activeStorms: ActiveHyperspaceStorm[] = [];

	for (
		let systemIndex = 0;
		systemIndex < graph.nodes.length;
		systemIndex++
	) {
		const node = graph.nodes[systemIndex];

		if (!node || node.unresolved) continue;

		/*
		 * Republic systems are directly observable.
		 * Foreign systems are observable only when they share
		 * a hyperlane with a Republic system.
		 */
		const observable =
			isRepublicSystem(node) ||
			graph.links.some((link) => {
				if (
					link.source !== systemIndex &&
					link.target !== systemIndex
				) {
					return false;
				}

				const otherIndex =
					link.source === systemIndex
						? link.target
						: link.source;

				const otherNode =
					graph.nodes[otherIndex];

				return (
					!!otherNode &&
					!otherNode.unresolved &&
					isRepublicSystem(otherNode)
				);
			});

		if (!observable) continue;

		const storm = getActiveStormForSystem(
			node.id,
			day,
		);

		if (!storm) continue;

		activeStorms.push({
			systemIndex,
			storm,
		});
	}

	return activeStorms;
}

export interface HyperspaceTempest {
	type: 'tempest';
	systemAId: string;
	systemBId: string;
}

export type HyperspaceWeather =
	| HyperspaceCurrent
	| HyperspaceStorm
	| HyperspaceTempest;
