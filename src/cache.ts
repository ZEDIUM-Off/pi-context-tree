import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CacheConfig } from "./schema.js";
import { sha256 } from "./util.js";

export { sha256 };

export function parseTtlMs(ttl = "14d"): number {
	const m = /^(\d+)(ms|s|m|h|d)$/.exec(ttl);
	if (!m) return 14 * 864e5;
	const n = Number(m[1]);
	return (
		n *
		({ ms: 1, s: 1e3, m: 6e4, h: 36e5, d: 864e5 } as const)[
			m[2] as "ms" | "s" | "m" | "h" | "d"
		]
	);
}

export async function readUrlCached(
	cwd: string,
	url: string,
	cache: CacheConfig | undefined,
	fetcher: typeof fetch,
): Promise<{ content: string; meta: unknown; warning?: string }> {
	if (!url.startsWith("https://"))
		throw new Error(`Only https URLs are allowed: ${url}`);
	const dir = path.join(cwd, ".pi/context-tree/cache/urls");
	await mkdir(dir, { recursive: true });
	const key = sha256(url);
	const metaPath = path.join(dir, `${key}.json`);
	const bodyPath = path.join(dir, `${key}.md`);
	const mode = cache?.mode ?? "ttl";
	const ttlMs = parseTtlMs(cache?.ttl ?? "14d");
	try {
		const meta = JSON.parse(await readFile(metaPath, "utf8")) as {
			fetchedAt: string;
		};
		const content = await readFile(bodyPath, "utf8");
		const fresh =
			mode === "manual" ||
			mode === "pinned" ||
			(mode === "ttl" && Date.now() - Date.parse(meta.fetchedAt) < ttlMs);
		if (fresh) return { content, meta };
	} catch {}
	try {
		const response = await fetcher(url);
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const text = await response.text();
		const meta = {
			url,
			fetchedAt: new Date().toISOString(),
			status: response.status,
			contentHash: sha256(text),
			ttl: cache?.ttl ?? "14d",
		};
		await writeFile(metaPath, JSON.stringify(meta, null, 2));
		await writeFile(bodyPath, text);
		return { content: text, meta };
	} catch (error) {
		if (cache?.fallback === "stale") {
			const meta = JSON.parse(await readFile(metaPath, "utf8"));
			const content = await readFile(bodyPath, "utf8");
			return {
				content,
				meta,
				warning: `Using stale cache for ${url}: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
		throw error;
	}
}
