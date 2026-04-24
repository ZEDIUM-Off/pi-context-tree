import { readFile } from "node:fs/promises";
import path from "node:path";
import fg from "fast-glob";
import { minimatch } from "minimatch";
import { contextFileSchema, type ContextFile } from "./context-schema.js";

export type ContextScope = {
  configPath: string;
  dir: string;
  config: ContextFile;
};

export type ResolvedInclude = {
  scope: ContextScope;
  path: string;
  absolutePath: string;
  kind: string;
  sections?: string[];
  required: boolean;
  reason?: string;
};

export type ExplainResult = {
  targetPath: string;
  matched: ContextScope[];
  skipped: Array<{ scope: ContextScope; reason: string }>;
  includes: ResolvedInclude[];
};

export async function scanContextTree(cwd: string): Promise<ContextScope[]> {
  const files = await fg("**/CONTEXT.json", {
    cwd,
    absolute: true,
    dot: true,
    ignore: ["node_modules/**", ".git/**", ".pi/**"],
  });

  const scopes: ContextScope[] = [];

  for (const file of files.sort()) {
    const raw = await readFile(file, "utf8");
    const parsed = contextFileSchema.parse(JSON.parse(raw));
    scopes.push({
      configPath: file,
      dir: path.dirname(file),
      config: parsed,
    });
  }

  return scopes.sort((a, b) => {
    const depth = relativeDepth(cwd, a.dir) - relativeDepth(cwd, b.dir);
    if (depth !== 0) return depth;
    return a.config.priority - b.config.priority;
  });
}

export function explainPath(cwd: string, scopes: ContextScope[], targetPath: string): ExplainResult {
  const absoluteTarget = path.resolve(cwd, stripAtPrefix(targetPath));
  const relativeTarget = toPosix(path.relative(cwd, absoluteTarget));
  const matched: ContextScope[] = [];
  const skipped: Array<{ scope: ContextScope; reason: string }> = [];

  for (const scope of scopes) {
    const relativeScopeDir = toPosix(path.relative(cwd, scope.dir)) || ".";
    const inScope = relativeScopeDir === "." || relativeTarget === relativeScopeDir || relativeTarget.startsWith(`${relativeScopeDir}/`);

    if (!inScope) {
      skipped.push({ scope, reason: "outside scope directory" });
      continue;
    }

    const relativeToScope = toPosix(path.relative(scope.dir, absoluteTarget));
    const applies = scope.config.applies.some((pattern) => minimatch(relativeToScope, pattern, { dot: true }));

    if (!applies) {
      skipped.push({ scope, reason: "applies glob did not match" });
      continue;
    }

    matched.push(scope);
  }

  const includes = resolveIncludes(matched);

  return { targetPath: relativeTarget, matched, skipped, includes };
}

export function resolveIncludes(scopes: ContextScope[]): ResolvedInclude[] {
  const seen = new Set<string>();
  const includes: ResolvedInclude[] = [];

  for (const scope of scopes) {
    for (const include of scope.config.context.include) {
      const absolutePath = path.resolve(scope.dir, stripAtPrefix(include.path));
      const key = `${absolutePath}#${(include.sections ?? ["Full file"]).join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      includes.push({
        scope,
        path: include.path,
        absolutePath,
        kind: include.kind,
        required: include.required,
        ...(include.sections ? { sections: include.sections } : {}),
        ...(include.reason ? { reason: include.reason } : {}),
      });
    }
  }

  return includes;
}

export function formatExplain(cwd: string, result: ExplainResult): string {
  const lines: string[] = [];
  lines.push(`Context tree explain: ${result.targetPath}`);
  lines.push("");
  lines.push("Matched scopes:");
  if (result.matched.length === 0) {
    lines.push("- none");
  } else {
    for (const scope of result.matched) {
      lines.push(`- ${toPosix(path.relative(cwd, scope.configPath))} priority=${scope.config.priority}`);
    }
  }
  lines.push("");
  lines.push("Includes:");
  if (result.includes.length === 0) {
    lines.push("- none");
  } else {
    for (const include of result.includes) {
      const rel = toPosix(path.relative(cwd, include.absolutePath));
      const sections = include.sections?.length ? ` sections=${include.sections.join(", ")}` : "";
      const required = include.required ? " required" : "";
      lines.push(`- ${rel} kind=${include.kind}${required}${sections}`);
    }
  }

  return lines.join("\n");
}

function stripAtPrefix(value: string): string {
  return value.startsWith("@") ? value.slice(1) : value;
}

function relativeDepth(cwd: string, dir: string): number {
  const rel = path.relative(cwd, dir);
  if (!rel) return 0;
  return rel.split(path.sep).length;
}

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}
