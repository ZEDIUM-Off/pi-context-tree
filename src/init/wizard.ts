import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
	contextFileSchema,
	hookNameSchema,
	injectSchema,
	pathAwareHooks,
	pathlessHooks,
	stabilityStateSchema,
} from "../schema.js";
import { scanFileSystem } from "./fs-scan.js";
import { generateContextFiles } from "./generate-context.js";
import { loadLatestInitSession, persistInitSession } from "./session.js";
import { reviewPolishPhase } from "./tui/polish-review.js";
import { reviewReferencesPhase } from "./tui/references-review.js";
import { reviewRulesPhase } from "./tui/rules-review.js";
import { reviewScopesPhase } from "./tui/scopes-review.js";
import type { InitPhase, InitSession } from "./types.js";

const detectedTechSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	category: z.enum([
		"language",
		"framework",
		"tool",
		"test",
		"build",
		"runtime",
	]),
	confidence: z.enum(["high", "medium", "low"]),
	evidence: z.array(z.string()).default([]),
	enabled: z.boolean().default(true),
});

const referenceProposalSchema = z.object({
	techId: z.string().min(1),
	scopePath: z.string().min(1),
	title: z.string().min(1),
	url: z.string().min(1),
	kind: z.enum(["context7", "url"]),
	reason: z.string().min(1),
	query: z.string().min(1),
	libraryName: z.string().min(1),
	libraryId: z.string().optional(),
	commands: z.array(z.string()).default([]),
	enabled: z.boolean().default(false),
});

const ruleProposalSchema = z.object({
	path: z.string().min(1),
	title: z.string().min(1),
	kind: z.enum(["skill", "rule", "doc"]),
	reason: z.string().min(1),
	mode: z.union([
		z.object({ type: z.literal("ref") }),
		z.object({ type: z.literal("lines"), ranges: z.array(z.string()).min(1) }),
	]),
	enabled: z.boolean().default(true),
});

const hookProposalSchema = z
	.object({
		on: hookNameSchema,
		match: z.array(z.string().min(1)).min(1).optional(),
		inject: z.array(injectSchema).min(1),
	})
	.refine((value) => !pathAwareHooks.has(value.on) || value.match, {
		message: "path-aware hooks require match[]",
		path: ["match"],
	})
	.refine((value) => !pathlessHooks.has(value.on) || !value.match, {
		message: "pathless hooks must not define match[]",
		path: ["match"],
	})
	.refine(
		(value) =>
			!value.match || value.match.some((pattern) => !pattern.startsWith("!")),
		{
			message: "match must contain at least one positive glob",
			path: ["match"],
		},
	);

const scopeProposalSchema = z.object({
	path: z.string().min(1),
	label: z.string().min(1),
	reason: z.string().min(1),
	confidence: z.enum(["high", "medium", "low"]),
	enabled: z.boolean().default(true),
	stability: z.object({
		state: stabilityStateSchema,
		summary: z.string().min(1),
	}),
	hooks: z.array(hookProposalSchema),
});

const initPhaseSubmitSchema = z.object({
	phase: z.enum(["technology", "rules", "references", "scopes", "stability"]),
	technologies: z.array(detectedTechSchema).optional(),
	rules: z.array(ruleProposalSchema).optional(),
	references: z.array(referenceProposalSchema).optional(),
	scopes: z.array(scopeProposalSchema).optional(),
	notes: z.array(z.string()).optional(),
});

const initPhases = [
	"scan",
	"technology",
	"rules",
	"scopes",
	"references",
	"preview",
] as const satisfies readonly InitPhase[];
const submitPhases = [
	"technology",
	"rules",
	"scopes",
	"references",
] as const satisfies readonly InitPhase[];

type ActionLabel = string;

export async function runInitWizard(
	pi: any,
	ctx: any,
	resume = false,
): Promise<void> {
	let existing = await loadLatestInitSession(ctx.cwd);
	if (existing && !resume) {
		const choice = await ctx.ui.select?.("Context Tree init session found", [
			"Resume existing init",
			"Reset and start new init",
			"Cancel",
		]);
		if (!choice || choice === "Cancel") return;
		resume = choice === "Resume existing init";
		if (!resume) existing = undefined;
	}

	if (!resume) {
		const ok = await ctx.ui.confirm?.(
			"Context Tree init",
			`Scan ${ctx.cwd} and ask agent to build editable CONTEXT.json proposals?`,
		);
		if (!ok) return;
	}

	const session: InitSession =
		resume && existing
			? existing
			: {
					id: new Date().toISOString().replaceAll(":", "-"),
					cwd: ctx.cwd,
					phase: "scan",
					technologies: [],
					references: [],
					rules: [],
					scopes: [],
					generatedFiles: [],
					feedback: [],
				};

	if (!session.scan) session.scan = await scanFileSystem(ctx.cwd);
	await persistInitSession(session);
	let currentPhase = resume ? session.phase : "scan";
	while (currentPhase !== "success") {
		await preparePhase(session, currentPhase, pi);
		const result = await phaseLoop(pi, ctx, session, currentPhase);
		if (result === "finish") return finishManualInit(ctx, session);
		if (result === "cancel") return;
		if (result === "back") {
			currentPhase = previousPhase(currentPhase);
			session.phase = currentPhase;
			await persistInitSession(session);
			continue;
		}
		currentPhase = nextPhase(currentPhase);
		if (currentPhase === "success") break;
	}

	if (session.generatedFiles.length === 0)
		session.generatedFiles = await generateContextFiles(
			session,
			packageVersion(pi),
		);

	const write = await ctx.ui.confirm?.(
		"Write CONTEXT files?",
		session.generatedFiles
			.map((file) => `${file.action} ${file.path}`)
			.join("\n"),
	);
	if (!write) return;
	for (const file of session.generatedFiles) {
		const full = path.join(ctx.cwd, file.path);
		await mkdir(path.dirname(full), { recursive: true });
		const content =
			file.kind === "context"
				? `${JSON.stringify(file.config, null, "\t")}\n`
				: (file.content ?? "");
		await writeFile(full, content, "utf8");
	}
	await persistInitSession(session);
	ctx.ui.notify("Context Tree init complete.", "info");
	const next = await ctx.ui.select?.("Next step", [
		"Continue contextualization in current session",
		"Finalize and start fresh session",
	]);
	if (next === "Continue contextualization in current session") {
		await pi.sendUserMessage(
			"Context Tree init completed. Help refine generated CONTEXT.json scopes, hooks, stability, and docs. Start by reviewing generated files and proposing improvements.",
		);
	} else if (next === "Finalize and start fresh session") {
		ctx.ui.notify(
			"Start new Pi session to load new CONTEXT.json state.",
			"info",
		);
	}
}

async function preparePhase(
	session: InitSession,
	phase: InitPhase,
	pi: any,
): Promise<void> {
	if (!session.scan) throw new Error("Init scan missing.");
	if (phase === "preview")
		session.generatedFiles = await generateContextFiles(
			session,
			packageVersion(pi),
		);
}

function phaseIndex(phase: InitPhase): number {
	const index = initPhases.findIndex((item) => item === phase);
	return index < 0 ? 0 : index;
}

async function phaseLoop(
	pi: any,
	ctx: any,
	session: InitSession,
	phase: InitPhase,
): Promise<"next" | "back" | "cancel" | "finish"> {
	session.phase = phase;
	if (phase === "rules") return rulesPhaseLoop(pi, ctx, session);
	if (phase === "scopes") return scopesPhaseLoop(pi, ctx, session);
	if (phase === "references") return referencesPhaseLoop(pi, ctx, session);
	if (phase === "preview") return polishPhaseLoop(pi, ctx, session);
	while (true) {
		ctx.ui.setWidget?.("context-tree-init", undefined);
		const action = (await ctx.ui.select?.(
			initMenuTitle(session, phase),
			phaseActions(session, phase),
		)) as ActionLabel | undefined;
		if (!action || action === "Cancel") return "cancel";
		if (action === "Back") return "back";
		if (action === "Finish without agent analysis") return "finish";
		if (action === "Continue with agent analysis (uses tokens)") {
			const ok = await ctx.ui.confirm?.(
				"Agent analysis uses tokens",
				"Next step will ask current agent session to inspect this workspace and propose Context Tree setup. Token use cannot be known in advance. Continue?",
			);
			if (!ok) return "finish";
			await persistInitSession(session);
			await requestAgentAnalysis(pi, ctx, session);
			return "cancel";
		}
		if (action === "Accept step") {
			const next = nextPhase(phase);
			session.phase = next;
			await persistInitSession(session);
			if (shouldRequestAgentForPhase(next)) {
				await requestAgentAnalysis(pi, ctx, session);
				return "cancel";
			}
			return "next";
		}
		if (action === "Advanced: edit JSON") {
			await editPhaseJson(ctx, session, phase);
			await persistInitSession(session);
			continue;
		}
		return sendRevisionRequest(pi, ctx, session, phase);
	}
}

async function sendRevisionRequest(
	pi: any,
	ctx: any,
	session: InitSession,
	phase: InitPhase,
): Promise<"cancel"> {
	const feedback = await ctx.ui.editor?.("Tell agent what should change", "");
	if (!feedback) return "cancel";
	session.feedback.push({
		phase,
		message: feedback,
		createdAt: new Date().toISOString(),
	});
	await persistInitSession(session);
	if (ctx.isIdle?.()) {
		await pi.sendUserMessage(revisionPrompt(session, phase, feedback));
	} else {
		await pi.sendUserMessage(revisionPrompt(session, phase, feedback), {
			deliverAs: "steer",
		});
	}
	ctx.ui.notify(
		"Feedback sent to agent. Wizard paused; proposal tool will reopen this step when ready.",
		"info",
	);
	return "cancel";
}

async function editPhaseJson(
	ctx: any,
	session: InitSession,
	phase: InitPhase,
): Promise<void> {
	const current = phaseValue(session, phase);
	const edited = await ctx.ui.editor?.(
		`Edit ${phase} JSON`,
		JSON.stringify(current, null, "\t"),
	);
	if (!edited) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(edited);
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
		return;
	}
	try {
		validatePhase(phase, parsed);
		setPhaseValue(session, phase, parsed);
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
	}
}

function phaseValue(session: InitSession, phase: InitPhase): unknown {
	if (phase === "scan") return session.scan;
	if (phase === "technology") return session.technologies;
	if (phase === "references") return session.references;
	if (phase === "rules") return session.rules;
	if (phase === "scopes" || phase === "stability") return session.scopes;
	if (phase === "preview") return session.generatedFiles;
	return session;
}

function setPhaseValue(
	session: InitSession,
	phase: InitPhase,
	value: unknown,
): void {
	if (phase === "technology")
		session.technologies = value as InitSession["technologies"];
	else if (phase === "references")
		session.references = value as InitSession["references"];
	else if (phase === "rules") session.rules = value as InitSession["rules"];
	else if (phase === "scopes" || phase === "stability")
		session.scopes = value as InitSession["scopes"];
	else if (phase === "preview")
		session.generatedFiles = value as InitSession["generatedFiles"];
}

function validatePhase(phase: InitPhase, value: unknown): void {
	if (phase === "preview") {
		const files = z
			.array(
				z
					.object({ kind: z.string(), config: contextFileSchema.optional() })
					.passthrough(),
			)
			.parse(value);
		for (const file of files)
			if (file.kind === "context") contextFileSchema.parse(file.config);
	}
}

function phaseActions(_session: InitSession, phase: InitPhase): string[] {
	if (phase === "scan")
		return [
			"Continue with agent analysis (uses tokens)",
			"Finish without agent analysis",
			"Advanced: edit JSON",
			"Cancel",
		];
	return [
		"Accept step",
		"Advanced: edit JSON",
		"Reject + comment / revise",
		"Back",
		"Cancel",
	];
}

async function rulesPhaseLoop(
	pi: any,
	ctx: any,
	session: InitSession,
): Promise<"next" | "back" | "cancel" | "finish"> {
	return proposalTablePhaseLoop(pi, ctx, session, "rules", reviewRulesPhase);
}

async function scopesPhaseLoop(
	pi: any,
	ctx: any,
	session: InitSession,
): Promise<"next" | "back" | "cancel" | "finish"> {
	return proposalTablePhaseLoop(pi, ctx, session, "scopes", reviewScopesPhase);
}

async function referencesPhaseLoop(
	pi: any,
	ctx: any,
	session: InitSession,
): Promise<"next" | "back" | "cancel" | "finish"> {
	return proposalTablePhaseLoop(
		pi,
		ctx,
		session,
		"references",
		reviewReferencesPhase,
	);
}

async function polishPhaseLoop(
	pi: any,
	ctx: any,
	session: InitSession,
): Promise<"next" | "back" | "cancel" | "finish"> {
	while (true) {
		const action = await reviewPolishPhase(ctx, session);
		await persistInitSession(session);
		if (action === "write") return "next";
		if (action === "advanced") {
			await editPhaseJson(ctx, session, "preview");
			await persistInitSession(session);
			continue;
		}
		if (action === "revise")
			return sendRevisionRequest(pi, ctx, session, "preview");
		if (action === "back") return "back";
		return "cancel";
	}
}

async function proposalTablePhaseLoop(
	pi: any,
	ctx: any,
	session: InitSession,
	phase: InitPhase,
	review: (
		ctx: any,
		session: InitSession,
	) => Promise<"accept" | "advanced" | "revise" | "back" | "cancel">,
): Promise<"next" | "back" | "cancel" | "finish"> {
	while (true) {
		const action = await review(ctx, session);
		await persistInitSession(session);
		if (action === "accept") {
			const next = nextPhase(phase);
			session.phase = next;
			await persistInitSession(session);
			if (shouldRequestAgentForPhase(next)) {
				await requestAgentAnalysis(pi, ctx, session);
				return "cancel";
			}
			return "next";
		}
		if (action === "advanced") {
			await editPhaseJson(ctx, session, phase);
			await persistInitSession(session);
			continue;
		}
		if (action === "revise")
			return sendRevisionRequest(pi, ctx, session, phase);
		if (action === "back") return "back";
		return "cancel";
	}
}

function initMenuTitle(session: InitSession, phase: InitPhase): string {
	const phaseIndex = initPhases.findIndex((item) => item === phase);
	const index = Math.max(0, phaseIndex);
	const progress = `${index + 1}/${initPhases.length}`;
	const bar = progressBar(index + 1, initPhases.length);
	const lines = [
		`Context Tree Init  ${bar}  ${progress}`,
		`phase: ${phase}`,
		phaseHelp(phase),
		`files: ${session.scan?.stats.fileCount ?? 0}`,
		`tech: ${
			session.technologies
				.filter((tech) => tech.enabled)
				.map((tech) => tech.name)
				.join(", ") || "none"
		}`,
		`refs: ${session.references.filter((ref) => ref.enabled).length}`,
		`rules: ${session.rules.filter((rule) => rule.enabled).length}`,
		`scopes: ${
			session.scopes
				.filter((scope) => scope.enabled)
				.map((scope) => scope.path)
				.join(", ") || "none"
		}`,
		`feedback: ${session.feedback.length}`,
	];
	return lines.join("\n");
}

function progressBar(done: number, total: number): string {
	const width = 14;
	const filled = Math.round((done / total) * width);
	return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function phaseHelp(phase: InitPhase): string {
	if (phase === "scan")
		return "warning: next step may use agent analysis and unknown token budget";
	if (phase === "technology")
		return "review detected stack before rule discovery";
	if (phase === "rules") return "review existing repo rules/skills to reuse";
	if (phase === "references") return "review optional Context7 doc proposals";
	if (phase === "scopes")
		return "review proposed path-scoped CONTEXT.json layout";
	return "polish generated CONTEXT.json files before final write confirmation";
}

async function requestAgentAnalysis(
	pi: any,
	ctx: any,
	session: InitSession,
): Promise<void> {
	ctx.ui.notify(
		"Agent analysis requested in current session. Wizard paused; proposal tool will reopen review when ready.",
		"info",
	);
	const options = ctx.isIdle?.() ? undefined : { deliverAs: "followUp" };
	await pi.sendUserMessage(agentAnalysisPrompt(session), options);
}

function agentAnalysisPrompt(session: InitSession): string {
	return `Context Tree init agent analysis requested for current workspace.

Human approved possible token usage. Human choices stay authoritative. Do not write files.

Session id: ${session.id}
Workspace: ${session.cwd}
Current phase: ${session.phase}
Files scanned: ${session.scan?.stats.fileCount ?? 0}
Directories scanned: ${session.scan?.stats.dirCount ?? 0}

Accepted draft snapshot:
${acceptedDraftSnapshot(session)}

Phase task:
${phaseAgentTask(session.phase)}

Submit this phase with ct_init_submit_phase. Tool schema is authoritative.

For scopes[].hooks, output exact Context Tree schema only:
- on: session:start, agent:start, tool:read, tool:edit, tool:write, tool:grep, tool:find, tool:ls, tool:bash, session:spawn, or subagent:spawn.
- Never output legacy names: read, edit, write, agent_start, operations, or *.
- tool:* and *:spawn hooks require match[] with at least one positive glob.
- session:start and agent:start must not include match[].
- inject[] entries must be strings or typed objects: { type:"file", path:"./...", mode:{ type:"ref" } } or { type:"url", url:"https://...", mode:{ type:"ref" } }.
- Context7 docs belong in phase=references. If using Context7 as url inject, use https://context7.com/org/project, never context7:org/project.

If inspection reveals useful later-phase details, also submit those phases; they will be saved as drafts without advancing human review order. Avoid broad docs injection. Prefer existing repo rules/skills and precise Context7 proposals only.`;
}

function acceptedDraftSnapshot(session: InitSession): string {
	const parts = [
		`technologies: ${
			session.technologies
				.filter((tech) => tech.enabled)
				.map((tech) => tech.id)
				.join(", ") || "none"
		}`,
		`rules: ${
			session.rules
				.filter((rule) => rule.enabled)
				.map((rule) => rule.path)
				.join(", ") || "none"
		}`,
		`references: ${
			session.references
				.filter((ref) => ref.enabled)
				.map((ref) => ref.title)
				.join(", ") || "none"
		}`,
		`scopes: ${
			session.scopes
				.filter((scope) => scope.enabled)
				.map((scope) => scope.path)
				.join(", ") || "none"
		}`,
	];
	return parts.join("\n");
}

function phaseAgentTask(phase: InitPhase): string {
	if (phase === "scan")
		return "Inspect existing repo files as needed. Identify technologies first and submit phase=technology.";
	if (phase === "technology")
		return "Review stack evidence from package manifests, configs, and project docs. Submit phase=technology.";
	if (phase === "rules")
		return "Review repo-specific rules, skills, AGENTS/CONTEXT docs, Cursor/Claude/OpenCode guidance, and scoped conventions. Submit phase=rules with reusable rule/doc/skill sources only.";
	if (phase === "scopes")
		return "Review directory structure and accepted rules. Propose narrow path-scoped CONTEXT.json files and hooks first, so later docs references can target correct scopes. Submit phase=scopes.";
	if (phase === "references")
		return "Review accepted technologies and scopes, then propose precise Context7 or URL references per scope. Prefer libraries where docs help future work: Medusa, Nuxt, Vue, shadcn-vue, Reka UI, Tailwind, Storybook, Vitest, etc. Submit phase=references.";
	return "Review generated preview and polish before write.";
}

export async function submitInitPhase(ctx: any, input: unknown): Promise<void> {
	const session = await loadLatestInitSession(ctx.cwd);
	if (!session) throw new Error("No init session found. Run /ct-init first.");
	const parsed = initPhaseSubmitSchema.parse(input);
	const expected = expectedSubmitPhase(session.phase);
	const isCurrentPhaseSubmission = parsed.phase === expected;
	if (parsed.phase === "technology")
		session.technologies = parsed.technologies ?? [];
	else if (parsed.phase === "rules") session.rules = parsed.rules ?? [];
	else if (parsed.phase === "references")
		session.references = (parsed.references ?? []).map((ref) => {
			const { libraryId, ...rest } = ref;
			return libraryId ? { ...rest, libraryId } : rest;
		});
	else if (parsed.phase === "scopes" || parsed.phase === "stability")
		session.scopes = (parsed.scopes ?? []).map((scope) => ({
			...scope,
			hooks: scope.hooks.map((hook) => {
				const { match, ...rest } = hook;
				return match ? { ...rest, match } : rest;
			}),
		}));
	if (isCurrentPhaseSubmission) session.phase = parsed.phase;
	session.feedback.push({
		phase: parsed.phase,
		message: `agent phase submitted${isCurrentPhaseSubmission ? "" : expected ? ` (saved out of order; current expected phase is ${expected})` : ` (saved while wizard phase is ${session.phase})`}:\n${JSON.stringify(parsed, null, 2)}`,
		createdAt: new Date().toISOString(),
	});
	session.generatedFiles = [];
	await persistInitSession(session);
}

function expectedSubmitPhase(
	current: InitPhase,
): (typeof submitPhases)[number] | undefined {
	if (current === "scan") return "technology";
	if (submitPhases.includes(current as (typeof submitPhases)[number]))
		return current as (typeof submitPhases)[number];
	return undefined;
}

function nextPhase(phase: InitPhase): InitPhase {
	const index = phaseIndex(phase);
	return initPhases[index + 1] ?? "success";
}

function previousPhase(phase: InitPhase): InitPhase {
	const index = phaseIndex(phase);
	return initPhases[Math.max(index - 1, 0)] ?? "scan";
}

function shouldRequestAgentForPhase(phase: InitPhase): boolean {
	return submitPhases.includes(phase as (typeof submitPhases)[number]);
}

async function finishManualInit(ctx: any, session: InitSession): Promise<void> {
	await persistInitSession(session);
	ctx.ui.setWidget?.("context-tree-init", undefined);
	ctx.ui.notify(
		"Context Tree init stopped before agent analysis. No CONTEXT.json written. See README.md/docs/schema.md to define CONTEXT.json manually, then run /ct-validate.",
		"info",
	);
}

function revisionPrompt(
	session: InitSession,
	phase: InitPhase,
	feedback: string,
): string {
	const phaseSummary = summarizePhaseForRevision(session, phase);
	return `Context Tree init revision requested. Human feedback is authoritative.

Phase: ${phase}
New human feedback:
${feedback}

Current phase snapshot:
${phaseSummary}

Revise only this phase unless human feedback explicitly asks for other phases. Use ct_init_submit_phase. Do not write files. Do not ask human to paste slash commands.`;
}

function summarizePhaseForRevision(
	session: InitSession,
	phase: InitPhase,
): string {
	if (phase === "technology") {
		const technologies = session.technologies.map((tech) => tech.id).join(", ");
		return technologies
			? `technology ids: ${technologies}`
			: "no technologies yet";
	}
	if (phase === "rules") {
		const rules = session.rules.map((rule) => rule.path).join(", ");
		return rules ? `rule paths: ${rules}` : "no rules yet";
	}
	if (phase === "references") {
		const references = session.references.map((ref) => ref.title).join(", ");
		return references ? `references: ${references}` : "no references yet";
	}
	if (phase === "scopes" || phase === "stability") {
		const scopes = session.scopes.map((scope) => scope.path).join(", ");
		return scopes ? `scope paths: ${scopes}` : "no scopes yet";
	}
	return JSON.stringify(phaseValue(session, phase), null, 2);
}

export async function reviewInitProposal(
	ctx: any,
	proposal: string,
): Promise<void> {
	const session = await loadLatestInitSession(ctx.cwd);
	if (!session)
		return ctx.ui.notify(
			"No init session found. Run /ct-init first.",
			"warning",
		);
	const edited = await ctx.ui.editor?.("Review agent init proposal", proposal);
	if (!edited) return;
	session.feedback.push({
		phase: session.phase,
		message: `agent proposal reviewed:\n${edited}`,
		createdAt: new Date().toISOString(),
	});
	await persistInitSession(session);
	ctx.ui.notify(
		"Agent proposal saved to init feedback. Use /ct-init --resume to continue.",
		"info",
	);
}

function packageVersion(pi: any): string | undefined {
	return pi?.packageJson?.version;
}
