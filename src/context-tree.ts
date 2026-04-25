import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import {
    contextFileSchema,
    type CacheConfig,
    type ContextBlock,
    type ContextFile,
    type ExtractConfig,
    type InjectObject,
    type Operation,
} from "./context-schema.js";
export type { Operation } from "./context-schema.js";

export type ContextScope = {
    configPath: string;
    dir: string;
    basePath: string;
    config: ContextFile;
};
export type NormalizedSource = InjectObject & {
    absolutePath?: string;
    owner: ContextScope;
    contextId: string;
    block: ContextBlock;
    cache?: CacheConfig;
};
export type LoadedSource = NormalizedSource & {
    content: string;
    sourceId: string;
    warnings: string[];
    cacheMeta?: unknown;
};
export type Bundle = {
    targetPath: string;
    operation: Operation;
    bundleHash: string;
    contextIds: string[];
    sources: LoadedSource[];
    warnings: string[];
};
export type ExplainResult = {
    targetPath: string;
    operation: Operation;
    matched: Array<{
        scope: ContextScope;
        block: ContextBlock;
        contextId: string;
    }>;
    sources: NormalizedSource[];
    warnings: string[];
};

export function toPosix(value: string): string {
    return value.split(path.sep).join("/");
}
export function stripAtPrefix(value: string): string {
    return value.startsWith("@") ? value.slice(1) : value;
}
export function sha256(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export async function scanContextParents(
    cwd: string,
    targetPath = ".",
): Promise<ContextScope[]> {
    const targetAbs = path.resolve(cwd, stripAtPrefix(targetPath));
    const statPath =
        targetAbs.endsWith("CONTEXT.json") || path.extname(targetAbs)
            ? path.dirname(targetAbs)
            : targetAbs;
    const relParts = toPosix(path.relative(cwd, statPath))
        .split("/")
        .filter(Boolean);
    const dirs = [cwd];
    let cur = cwd;
    for (const part of relParts) {
        cur = path.join(cur, part);
        dirs.push(cur);
    }
    const scopes: ContextScope[] = [];
    for (const dir of dirs) {
        const configPath = path.join(dir, "CONTEXT.json");
        try {
            const raw = await readFile(configPath, "utf8");
            const json = JSON.parse(raw) as unknown;
            const config = contextFileSchema.parse(json);
            scopes.push({
                configPath,
                dir,
                basePath: toPosix(path.relative(cwd, dir)) || ".",
                config,
            });
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            // Invalid parent CONTEXT.json files are reported by /context-tree validate.
            // Do not break unrelated tool execution while user is fixing config.
            continue;
        }
    }
    return scopes;
}

export type ScanAllResult = {
    scopes: ContextScope[];
    errors: Array<{ configPath: string; message: string }>;
};

export async function scanAllContextTree(cwd: string): Promise<ScanAllResult> {
    const { readdir } = await import("node:fs/promises");
    const scopes: ContextScope[] = [];
    const errors: Array<{ configPath: string; message: string }> = [];

    async function walk(dir: string): Promise<void> {
        let entries: Dirent[];
        try {
            entries = await readdir(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (
                entry.name === "node_modules" ||
                entry.name === ".git" ||
                entry.name === ".pi"
            )
                continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
                continue;
            }
            if (entry.isFile() && entry.name === "CONTEXT.json") {
                try {
                    const raw = await readFile(full, "utf8");
                    const config = contextFileSchema.parse(JSON.parse(raw));
                    scopes.push({
                        configPath: full,
                        dir: path.dirname(full),
                        basePath:
                            toPosix(path.relative(cwd, path.dirname(full))) ||
                            ".",
                        config,
                    });
                } catch (error) {
                    errors.push({
                        configPath: full,
                        message:
                            error instanceof Error
                                ? error.message
                                : String(error),
                    });
                }
            }
        }
    }

    await walk(cwd);
    scopes.sort((a, b) => a.basePath.localeCompare(b.basePath));
    errors.sort((a, b) => a.configPath.localeCompare(b.configPath));
    return { scopes, errors };
}

export function contextId(
    scope: ContextScope,
    block: Pick<ContextBlock, "match" | "operations">,
): string {
    return sha256(
        JSON.stringify({
            basePath: scope.basePath,
            match: block.match,
            operations: [...block.operations].sort(),
        }),
    );
}

export function operationMatches(
    operations: Operation[],
    operation: Operation,
): boolean {
    return operations.includes("*") || operations.includes(operation);
}

export function matchGlobs(patterns: string[], relativePath: string): boolean {
    const pos = patterns.filter((p) => !p.startsWith("!"));
    const neg = patterns
        .filter((p) => p.startsWith("!"))
        .map((p) => p.slice(1));
    if (pos.length === 0) return false;
    return (
        pos.some((p) => minimatch(relativePath, p, { dot: true })) &&
        !neg.some((p) => minimatch(relativePath, p, { dot: true }))
    );
}

export function explainPath(
    cwd: string,
    scopes: ContextScope[],
    targetPath: string,
    operation: Operation = "agent_start",
): ExplainResult {
    const absoluteTarget = path.resolve(cwd, stripAtPrefix(targetPath));
    const relativeTarget = toPosix(path.relative(cwd, absoluteTarget));
    const matched: ExplainResult["matched"] = [];
    const sources: NormalizedSource[] = [];
    const warnings: string[] = [];

    for (const scope of scopes) {
        const relativeToScope = toPosix(
            path.relative(scope.dir, absoluteTarget),
        );
        if (relativeToScope.startsWith("..")) continue;
        for (const block of scope.config.context) {
            if (!operationMatches(block.operations, operation)) continue;
            if (!matchGlobs(block.match, relativeToScope || ".")) continue;
            const id = contextId(scope, block);
            matched.push({ scope, block, contextId: id });
            for (const source of block.inject)
                sources.push(normalizeInject(source, scope, block, id));
        }
    }
    return {
        targetPath: relativeTarget,
        operation,
        matched,
        sources: dedupeSources(sources),
        warnings,
    };
}

function normalizeInject(
    input: string | InjectObject,
    owner: ContextScope,
    block: ContextBlock,
    id: string,
): NormalizedSource {
    const obj: InjectObject =
        typeof input === "string"
            ? input.startsWith("http://") || input.startsWith("https://")
                ? { type: "url", url: input, required: false }
                : { type: "file", path: input, required: false }
            : input;
    const cache = {
        ...(owner.config.defaults?.cache ?? {}),
        ...(block.cache ?? {}),
        ...(obj.cache ?? {}),
    } as CacheConfig;
    if (obj.type === "file") {
        const absolutePath = path.resolve(owner.dir, stripAtPrefix(obj.path));
        return { ...obj, owner, block, contextId: id, absolutePath, cache };
    }
    return { ...obj, owner, block, contextId: id, cache };
}

function dedupeSources(sources: NormalizedSource[]): NormalizedSource[] {
    const seen = new Set<string>();
    return sources.filter((s) => {
        const key =
            s.type === "file"
                ? `${s.absolutePath}:${JSON.stringify(s.extract ?? {})}`
                : `${s.url}:${JSON.stringify(s.extract ?? {})}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

export async function buildBundle(
    cwd: string,
    explain: ExplainResult,
    options: { fetcher?: typeof fetch } = {},
): Promise<Bundle> {
    const loaded: LoadedSource[] = [];
    const warnings = [...explain.warnings];
    const absoluteTarget = path.resolve(cwd, stripAtPrefix(explain.targetPath));
    for (const source of explain.sources) {
        if (
            explain.operation === "read" &&
            source.type === "file" &&
            source.absolutePath === absoluteTarget
        ) {
            warnings.push(
                `Skipped self-injection for read target: ${explain.targetPath}`,
            );
            continue;
        }
        try {
            loaded.push(await loadSource(cwd, source, options));
        } catch (error) {
            const message =
                error instanceof Error ? error.message : String(error);
            if (source.required) throw new Error(message);
            warnings.push(message);
        }
    }
    const hashInput = loaded
        .map((s) => `${s.sourceId}\n${s.content}`)
        .join("\n---\n");
    return {
        targetPath: explain.targetPath,
        operation: explain.operation,
        contextIds: [...new Set(explain.matched.map((m) => m.contextId))],
        sources: loaded,
        warnings,
        bundleHash: sha256(hashInput),
    };
}

async function loadSource(
    cwd: string,
    source: NormalizedSource,
    options: { fetcher?: typeof fetch },
): Promise<LoadedSource> {
    if (source.type === "file") {
        if (!source.absolutePath)
            throw new Error("file source missing absolutePath");
        const rel = toPosix(path.relative(cwd, source.absolutePath));
        if (rel.startsWith(".."))
            throw new Error(`Path escapes repo: ${source.path}`);
        const raw = await readFile(source.absolutePath, "utf8");
        return {
            ...source,
            content: extractContent(raw, source.extract),
            sourceId: rel,
            warnings: [],
        };
    }
    const cached = await readUrlCached(
        cwd,
        source.url,
        source.cache,
        options.fetcher ?? fetch,
    );
    return {
        ...source,
        content: extractContent(cached.content, source.extract),
        sourceId: source.url,
        warnings: cached.warning ? [cached.warning] : [],
        cacheMeta: cached.meta,
    };
}

export function extractContent(raw: string, extract?: ExtractConfig): string {
    if (!extract) return raw;
    const parts: Array<{ title: string; body: string; note?: string }> = [];
    const add = (title: string, body: string, note?: string) => {
        const part: { title: string; body: string; note?: string } = {
            title,
            body,
        };
        if (note !== undefined) part.note = note;
        parts.push(part);
    };
    for (const section of extract.sections ?? [])
        add(`# section:${section}`, extractSection(raw, section));
    const lines =
        typeof extract.lines === "string"
            ? [extract.lines]
            : (extract.lines ?? []);
    for (const range of lines)
        add(`# lines:${range}`, extractLines(raw, range));
    for (const marker of extract.markers ?? [])
        add(`# marker:${marker}`, extractMarker(raw, marker));
    for (const seg of extract.segments ?? []) {
        if (seg.marker)
            add(
                `# marker:${seg.marker}`,
                extractMarker(raw, seg.marker),
                seg.note,
            );
        if (seg.lines)
            add(`# lines:${seg.lines}`, extractLines(raw, seg.lines), seg.note);
        if (seg.section)
            add(
                `# section:${seg.section}`,
                extractSection(raw, seg.section),
                seg.note,
            );
    }
    if (parts.length === 0) return raw;
    return parts
        .map(
            (p) =>
                `${p.title}${p.note ? `\nAgent note: ${p.note}` : ""}\n${p.body.trimEnd()}`,
        )
        .join("\n\n");
}

export function extractLines(raw: string, range: string): string {
    const match = /^(\d+)-(\d+)$/.exec(range) ?? /^(\d+)$/.exec(range);
    if (!match) throw new Error(`Invalid line range: ${range}`);
    const start = Number(match[1]);
    const end = Number(match[2] ?? match[1]);
    if (start < 1 || end < start)
        throw new Error(`Invalid line range: ${range}`);
    return raw
        .split(/\r?\n/)
        .slice(start - 1, end)
        .join("\n");
}

export function extractSection(raw: string, section: string): string {
    const lines = raw.split(/\r?\n/);
    const start = lines.findIndex(
        (line) =>
            /^#{1,6}\s+/.test(line) &&
            line.replace(/^#{1,6}\s+/, "").trim() === section,
    );
    if (start < 0) throw new Error(`Missing section: ${section}`);
    const startLine = lines[start] ?? "";
    const level = /^#+/.exec(startLine)?.[0].length ?? 1;
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        const line = lines[i] ?? "";
        const m = /^#{1,6}\s+/.exec(line);
        if (m && m[0].trim().length <= level) {
            end = i;
            break;
        }
    }
    return lines.slice(start, end).join("\n");
}

export function extractMarker(raw: string, marker: string): string {
    const startRe = new RegExp(
        `(?:context-tree:start)\\s+${escapeRegExp(marker)}\\b`,
    );
    const endRe = new RegExp(
        `(?:context-tree:end)\\s+${escapeRegExp(marker)}\\b`,
    );
    const lines = raw.split(/\r?\n/);
    const start = lines.findIndex((line) => startRe.test(line));
    if (start < 0) throw new Error(`Missing marker: ${marker}`);
    const end = lines.findIndex(
        (line, index) => index > start && endRe.test(line),
    );
    if (end < 0) throw new Error(`Missing marker end: ${marker}`);
    return lines.slice(start + 1, end).join("\n");
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTtlMs(ttl = "14d"): number {
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

async function readUrlCached(
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

export function renderBundle(bundle: Bundle): string {
    const lines = [
        `# Context Tree Bundle`,
        "",
        `Target: \`${bundle.targetPath}\``,
        `Operation: \`${bundle.operation}\``,
        `Bundle: \`${bundle.bundleHash}\``,
        "",
        "## Loaded sources",
    ];
    for (const source of bundle.sources) lines.push(`- ${source.sourceId}`);
    if (bundle.warnings.length) {
        lines.push("", "## Warnings", ...bundle.warnings.map((w) => `- ${w}`));
    }
    for (const source of bundle.sources)
        lines.push(
            "",
            `## Source: ${source.sourceId}`,
            "",
            source.content.trimEnd(),
        );
    return lines.join("\n");
}

export function formatExplain(cwd: string, result: ExplainResult): string {
    const lines = [
        `Context tree explain: ${result.targetPath}`,
        `Operation: ${result.operation}`,
        "",
        "Matched contexts:",
    ];
    if (!result.matched.length) lines.push("- none");
    for (const match of result.matched)
        lines.push(
            `- ${toPosix(path.relative(cwd, match.scope.configPath))} id=${match.contextId.slice(0, 12)} match=${JSON.stringify(match.block.match)} operations=${JSON.stringify(match.block.operations)}`,
        );
    lines.push("", "Inject sources:");
    if (!result.sources.length) lines.push("- none");
    for (const source of result.sources)
        lines.push(
            `- ${source.type === "file" ? toPosix(path.relative(cwd, source.absolutePath ?? "")) : source.url}${source.required ? " required" : ""}`,
        );
    return lines.join("\n");
}

export function parsePromptPaths(prompt: string): string[] {
    const found = new Set<string>();
    for (const m of prompt.matchAll(/@([\w./-]+\.[\w]+)/g)) found.add(m[1]!);
    for (const m of prompt.matchAll(
        /(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|md|json|py|go|rs))/g,
    ))
        found.add(m[1]!);
    return [...found];
}
