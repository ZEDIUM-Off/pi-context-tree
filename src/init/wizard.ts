import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionContextLike, PiMessagingLike } from "../pi/types.js";
import { requestAgentAnalysis, sendRevisionRequest } from "./agent-requests.js";
import { scanFileSystem } from "./fs-scan.js";
import { generateContextFiles } from "./generate-context.js";
import { editPhaseJson } from "./manual-edit.js";
import {
	initPhases,
	nextPhase,
	phaseIndex,
	previousPhase,
	shouldRequestAgentForPhase,
} from "./phase-machine.js";

export { reviewInitProposal, submitInitPhase } from "./phase-submit.js";

import { loadLatestInitSession, persistInitSession } from "./session.js";
import { reviewPolishPhase } from "./tui/polish-review.js";
import { reviewReferencesPhase } from "./tui/references-review.js";
import { reviewRulesPhase } from "./tui/rules-review.js";
import { reviewScopesPhase } from "./tui/scopes-review.js";
import type { InitPhase, InitSession } from "./types.js";

type ActionLabel = string;
type PhaseLoopResult = "next" | "back" | "cancel" | "finish";
type ProposalReviewAction =
	| "accept"
	| "advanced"
	| "revise"
	| "back"
	| "cancel";

export async function runInitWizard(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
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

	const session = await initSession(ctx.cwd, resume ? existing : undefined);
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

	await writeGeneratedFiles(pi, ctx, session);
}

async function initSession(
	cwd: string,
	existing?: InitSession,
): Promise<InitSession> {
	const session: InitSession = existing ?? {
		id: new Date().toISOString().replaceAll(":", "-"),
		cwd,
		phase: "scan",
		technologies: [],
		references: [],
		rules: [],
		scopes: [],
		generatedFiles: [],
		feedback: [],
	};
	if (!session.scan) session.scan = await scanFileSystem(cwd);
	await persistInitSession(session);
	return session;
}

async function preparePhase(
	session: InitSession,
	phase: InitPhase,
	pi: PiMessagingLike,
): Promise<void> {
	if (!session.scan) throw new Error("Init scan missing.");
	if (phase === "preview")
		session.generatedFiles = await generateContextFiles(
			session,
			packageVersion(pi),
		);
}

async function phaseLoop(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
	phase: InitPhase,
): Promise<PhaseLoopResult> {
	session.phase = phase;
	if (phase === "rules") return rulesPhaseLoop(pi, ctx, session);
	if (phase === "scopes") return scopesPhaseLoop(pi, ctx, session);
	if (phase === "references") return referencesPhaseLoop(pi, ctx, session);
	if (phase === "preview") return polishPhaseLoop(pi, ctx, session);
	return menuPhaseLoop(pi, ctx, session, phase);
}

async function menuPhaseLoop(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
	phase: InitPhase,
): Promise<PhaseLoopResult> {
	while (true) {
		ctx.ui.setWidget?.("context-tree-init", undefined);
		const action = (await ctx.ui.select?.(
			initMenuTitle(session, phase),
			phaseActions(phase),
		)) as ActionLabel | undefined;
		if (!action || action === "Cancel") return "cancel";
		if (action === "Back") return "back";
		if (action === "Finish without agent analysis") return "finish";
		if (action === "Continue with agent analysis (uses tokens)")
			return confirmAgentAnalysis(pi, ctx, session);
		if (action === "Accept step")
			return acceptMenuPhase(pi, ctx, session, phase);
		if (action === "Advanced: edit JSON") {
			await editPhaseJson(ctx, session, phase);
			await persistInitSession(session);
			continue;
		}
		return sendRevisionRequest(pi, ctx, session, phase);
	}
}

async function confirmAgentAnalysis(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<PhaseLoopResult> {
	const ok = await ctx.ui.confirm?.(
		"Agent analysis uses tokens",
		"Next step will ask current agent session to inspect this workspace and propose Context Tree setup. Token use cannot be known in advance. Continue?",
	);
	if (!ok) return "finish";
	await persistInitSession(session);
	await requestAgentAnalysis(pi, ctx, session);
	return "cancel";
}

async function acceptMenuPhase(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
	phase: InitPhase,
): Promise<PhaseLoopResult> {
	const next = nextPhase(phase);
	session.phase = next;
	await persistInitSession(session);
	if (shouldRequestAgentForPhase(next)) {
		await requestAgentAnalysis(pi, ctx, session);
		return "cancel";
	}
	return "next";
}

async function rulesPhaseLoop(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<PhaseLoopResult> {
	return proposalTablePhaseLoop(pi, ctx, session, "rules", reviewRulesPhase);
}

async function scopesPhaseLoop(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<PhaseLoopResult> {
	return proposalTablePhaseLoop(pi, ctx, session, "scopes", reviewScopesPhase);
}

async function referencesPhaseLoop(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<PhaseLoopResult> {
	return proposalTablePhaseLoop(
		pi,
		ctx,
		session,
		"references",
		reviewReferencesPhase,
	);
}

async function polishPhaseLoop(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<PhaseLoopResult> {
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
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
	phase: InitPhase,
	review: (
		ctx: ExtensionContextLike,
		session: InitSession,
	) => Promise<ProposalReviewAction>,
): Promise<PhaseLoopResult> {
	while (true) {
		const action = await review(ctx, session);
		await persistInitSession(session);
		if (action === "accept") return acceptMenuPhase(pi, ctx, session, phase);
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

function phaseActions(phase: InitPhase): string[] {
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

function initMenuTitle(session: InitSession, phase: InitPhase): string {
	const index = Math.max(0, phaseIndex(phase));
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

async function writeGeneratedFiles(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<void> {
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
	await offerNextStep(pi, ctx);
}

async function offerNextStep(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
): Promise<void> {
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

async function finishManualInit(
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<void> {
	await persistInitSession(session);
	ctx.ui.setWidget?.("context-tree-init", undefined);
	ctx.ui.notify(
		"Context Tree init stopped before agent analysis. No CONTEXT.json written. See README.md/docs/schema.md to define CONTEXT.json manually, then run /ct-validate.",
		"info",
	);
}

function packageVersion(pi: PiMessagingLike): string | undefined {
	return pi.packageJson?.version;
}
