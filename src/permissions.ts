import path from "node:path";
import { minimatch } from "minimatch";
import { toPosix } from "./util.js";

export type ScopeGuardMode = "allow" | "ask" | "block";
export type ScopeGuardConfig = {
	enabled?: boolean;
	mode?: ScopeGuardMode;
	nonInteractive?: "allow" | "block";
	allow?: string[];
	block?: string[];
};
export type ScopeDecision = {
	action: "allow" | "ask" | "block";
	reason: string;
};

export function decideScopeAccess(input: {
	cwd: string;
	scopeDir: string;
	targetPath: string;
	config?: ScopeGuardConfig;
	interactive?: boolean;
	sessionAllows?: string[];
}): ScopeDecision {
	const config = input.config ?? {};
	if (config.enabled === false)
		return { action: "allow", reason: "scope guard disabled" };
	const mode = config.mode ?? "ask";
	const relToCwd = toPosix(
		path.relative(input.cwd, path.resolve(input.cwd, input.targetPath)),
	);
	const relToScope = toPosix(
		path.relative(input.scopeDir, path.resolve(input.cwd, input.targetPath)),
	);
	const matches = (patterns?: string[]) =>
		(patterns ?? []).some(
			(p) =>
				minimatch(relToCwd, p, { dot: true }) ||
				minimatch(relToScope, p, { dot: true }),
		);
	if (matches(config.block))
		return { action: "block", reason: "blocked by scopeGuard.block" };
	if (matches(config.allow) || matches(input.sessionAllows))
		return { action: "allow", reason: "allowed by scope guard pattern" };
	const inScope = !relToScope.startsWith("..") && relToScope !== "..";
	if (inScope) return { action: "allow", reason: "inside scope" };
	if (mode === "allow")
		return { action: "allow", reason: "scope guard allow mode" };
	if (mode === "block") return { action: "block", reason: "outside scope" };
	if (input.interactive === false)
		return {
			action: config.nonInteractive === "allow" ? "allow" : "block",
			reason: "non-interactive outside scope",
		};
	return { action: "ask", reason: "outside scope" };
}
