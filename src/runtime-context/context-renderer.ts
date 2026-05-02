import { activeInjectionStack, type ActiveInjectionRegistry } from "./active-injection-registry.js";
import { renderContextStack } from "./providers.js";
import type { ResourceRegistry } from "./resource-registry.js";

const activeStackRe = /<!-- context-tree:active-stack:start[\s\S]*?<!-- context-tree:active-stack:end -->/g;
const legacyBundleRe = /(?:\n---\n\n)?# Context Tree Bundle[\s\S]*?(?=\n\n---\n\n# Context Tree Bundle|\n\n[A-Z][^\n]{0,80}:|$)/g;

function stripText(value: string): string {
	return value.replace(activeStackRe, "").replace(legacyBundleRe, "").trimEnd();
}

export function stripLegacyContextTreeBlocks<T>(messages: readonly T[]): T[] {
	return messages.map((message) => {
		if (!message || typeof message !== "object") return message;
		const copy = { ...(message as Record<string, unknown>) };
		const content = copy.content;
		if (typeof content === "string") copy.content = stripText(content);
		else if (Array.isArray(content)) copy.content = content.map((part) => {
			if (!part || typeof part !== "object") return part;
			const partCopy = { ...(part as Record<string, unknown>) };
			if (partCopy.type === "text" && typeof partCopy.text === "string") partCopy.text = stripText(partCopy.text);
			return partCopy;
		});
		return copy as T;
	});
}

export async function appendActiveContextMessage<T>(input: { messages: readonly T[]; cwd: string; resources: ResourceRegistry; activeInjections: ActiveInjectionRegistry; warnings?: readonly string[] }): Promise<T[]> {
	const cleaned = stripLegacyContextTreeBlocks(input.messages);
	const stack = activeInjectionStack(input.activeInjections);
	if (!stack.length) return cleaned;
	const rendered = await renderContextStack({ cwd: input.cwd, resources: input.resources, entries: stack, params: stack.map((entry) => entry.param), ...(input.warnings ? { warnings: input.warnings } : {}) });
	if (!rendered) return cleaned;
	return [
		...cleaned,
		{
			role: "custom",
			customType: "context-tree-active-stack",
			content: rendered.content,
			display: false,
			details: { provider: rendered.provider, tokenEstimate: rendered.tokenEstimate, warnings: rendered.warnings },
			timestamp: Date.now(),
		} as T,
	];
}
