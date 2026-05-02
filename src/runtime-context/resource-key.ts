import path from "node:path";
import { stripAtPrefix } from "../util.js";

export type ResourceKey = `file:${string}` | `url:${string}`;

/** Canonicalizes a file source path into a runtime resource key. */
export function fileResourceKey(input: { sourcePath: string; scopeDir: string; rootDir: string }): ResourceKey {
	const rootRelative = input.sourcePath.startsWith("@");
	const baseDir = rootRelative ? input.rootDir : input.scopeDir;
	const sourcePath = rootRelative ? stripAtPrefix(input.sourcePath).replace(/^\//, "") : input.sourcePath;
	return `file:${path.resolve(baseDir, sourcePath)}`;
}

/** Canonicalizes URL identity without making semantic assumptions about remote content. */
export function canonicalUrl(input: string): string {
	const url = new URL(input);
	url.protocol = url.protocol.toLowerCase();
	url.hostname = url.hostname.toLowerCase();
	url.hash = "";
	if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
	url.search = new URLSearchParams([...url.searchParams.entries()].sort(([a], [b]) => a.localeCompare(b))).toString();
	return url.toString();
}

/** Canonicalizes a URL source into a runtime resource key. */
export function urlResourceKey(url: string): ResourceKey {
	return `url:${canonicalUrl(url)}`;
}
