import type { App } from 'obsidian';
import { Component, debounce } from 'obsidian';
import type { GraphData, NamedShip } from '../types';
import { buildGraph } from './buildGraph';
import { seedPosition, seedRadius } from './seed';
import { normalize } from 'path';

/**
 * 唯一读 metadataCache 的模块。
 * 持有 GraphData + 坐标数组；重建时按 id 保留旧坐标（身份保持合并），
 * 布局只需低温重热，星系不爆炸。
 */
export class GraphStore extends Component {
	data: GraphData = { nodes: [], links: [] };
	/** x,y,z × nodes.length，布局引擎原地写，渲染器只读 */
	positions = new Float32Array(0);

	private includeUnresolved = false;
	private includeOrphans = true;
	private nodeCap: number | null = null;
	private linkCap: number | null = null;
	private onChanged: (() => void) | null = null;

	constructor(private app: App) {
		super();
	}

	/** dataChanged 在防抖重建完成后触发（调用方负责 reheat + 重建渲染缓冲） */
	init(includeUnresolved: boolean, includeOrphans: boolean, onChanged: () => void): void {
		this.includeUnresolved = includeUnresolved;
		this.includeOrphans = includeOrphans;
		this.onChanged = onChanged;
		const rebuildSoon = debounce(() => this.rebuild(true), 800, true);
		this.registerEvent(this.app.metadataCache.on('resolved', rebuildSoon));
		this.registerEvent(this.app.vault.on('rename', rebuildSoon));
		this.registerEvent(this.app.vault.on('modify', rebuildSoon));
		this.registerEvent(this.app.vault.on('delete', rebuildSoon));
	}

	async ensureCacheReady(): Promise<void> {
		if (Object.keys(this.app.metadataCache.resolvedLinks).length > 0) return;
		await new Promise<void>((resolve) => {
			this.registerEvent(this.app.metadataCache.on('resolved', () => resolve()));
		});
	}

	setIncludeUnresolved(v: boolean): void {
		if (v === this.includeUnresolved) return;
		this.includeUnresolved = v;
		this.rebuild(true);
	}

	getIncludeUnresolved(): boolean {
		return this.includeUnresolved;
	}

	/** 质量档位的节点/链接帽；变化时重建（保坐标） */
	setCaps(nodeCap: number | null, linkCap: number | null): void {
		if (nodeCap === this.nodeCap && linkCap === this.linkCap) return;
		this.nodeCap = nodeCap;
		this.linkCap = linkCap;
		this.rebuild(true);
	}

	setIncludeOrphans(v: boolean): void {
		if (v === this.includeOrphans) return;
		this.includeOrphans = v;
		this.rebuild(true);
	}

	
	preservePositions = true
	rebuild(preservePositions: boolean): void {
		const files = this.app.vault.getMarkdownFiles()
		.filter((f) => {
			const cache = this.app.metadataCache.getFileCache(f);
			return cache?.frontmatter?.type === "star";
		})
		.map((f) => {
			const cache = this.app.metadataCache.getFileCache(f);
			
			return {
				path: f.path,
				basename: f.basename,
				size: f.stat.size,
				owner: cache?.frontmatter?.owner,
				security: cache?.frontmatter?.security,
				fleets: normalizeFleetCounts(cache?.frontmatter?.fleets),
				namedShips: normalizeNamedShips(cache?.frontmatter?.namedShips),
				links: normalizeLinks(cache?.frontmatter?.links),
			};
		});
		const next = buildGraph(files, this.app.metadataCache.resolvedLinks, this.app.metadataCache.unresolvedLinks, {
			includeUnresolved: this.includeUnresolved,
			includeOrphans: this.includeOrphans,
			nodeCap: this.nodeCap,
			linkCap: this.linkCap,
		});

		const oldIndexById = new Map<string, number>();
		if (preservePositions) {
			this.data.nodes.forEach((n, i) => oldIndexById.set(n.id, i));
		}
		const oldPositions = this.positions;

		const radius = seedRadius(next.nodes.length);
		const positions = new Float32Array(next.nodes.length * 3);
		next.nodes.forEach((n, i) => {
			const oi = oldIndexById.get(n.id);
			if (oi !== undefined && oi * 3 + 2 < oldPositions.length) {
				positions[i * 3] = oldPositions[oi * 3] ?? 0;
				positions[i * 3 + 1] = oldPositions[oi * 3 + 1] ?? 0;
				positions[i * 3 + 2] = oldPositions[oi * 3 + 2] ?? 0;
			} else {
				const [x, y, z] = seedPosition(n.id, radius);
				positions[i * 3] = x;
				positions[i * 3 + 1] = y;
				positions[i * 3 + 2] = z;
			}
		});

		this.data = next;
		this.positions = positions;

		this.checkReciprocalLinks();

		this.onChanged?.();
	}
	private checkReciprocalLinks(): void {
	const prefix = 'zGalaxy View Star Pages/Republic Territory/';

	const resolvedLinks = this.app.metadataCache.resolvedLinks;

	for (const [sourcePath, targets] of Object.entries(resolvedLinks)) {
		if (!sourcePath.startsWith(prefix)) continue;

		for (const targetPath of Object.keys(targets)) {
			if (!targetPath.startsWith(prefix)) continue;

			const reverseTargets = resolvedLinks[targetPath];

			if (!reverseTargets || !(sourcePath in reverseTargets)) {
				console.warn(
					`[GalaxyView] Missing reciprocal link. Add ${sourcePath} -> ${targetPath}`
				);
			}
		}
	}
	}
}
function normalizeNamedShips(value: unknown): NamedShip[] {
	if (!Array.isArray(value)) return [];

	const ships: NamedShip[] = [];

	for (const item of value) {
		if (!item || typeof item !== 'object' || Array.isArray(item)) continue;

		const record = item as Record<string, unknown>;

		const name =
			typeof record.name === 'string'
				? record.name.trim()
				: '';

		const type =
			typeof record.type === 'string'
				? record.type.trim().toLowerCase()
				: '';

		if (name && type) {
			ships.push({ name, type });
		}
	}

	return ships;
}


function normalizeLinks(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

	const out: Record<string, number> = {};

	for (const [key, raw] of Object.entries(value)) {
		const n = typeof raw === 'number' ? raw : Number(raw);
		if (Number.isFinite(n)) out[key.trim()] = n;
	}

	return out;


}
function normalizeFleetCounts(value: unknown): Record<string, number> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

	const out: Record<string, number> = {};

	for (const [rawKey, rawValue] of Object.entries(value)) {
		const key = rawKey.trim().toUpperCase();
		const count = typeof rawValue === 'number' ? rawValue : Number(rawValue);

		if (!key) continue;
		if (!Number.isFinite(count)) continue;
		if (count <= 0) continue;

		out[key] = Math.floor(count);
	}

	return out;
}
