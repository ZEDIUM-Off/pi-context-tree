import type { InitPhase, InitSession } from "./types.js";
import { phaseValue } from "./phase-values.js";

export function agentAnalysisPrompt(session: InitSession): string {
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

export function revisionPrompt(
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
