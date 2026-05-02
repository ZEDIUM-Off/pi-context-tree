export type PromptFileReference = {
	raw: string;
	path: string;
	index: number;
};

const trailingPunctuationRe = /[.,;:!?]+$/;

/** Extracts only explicit Pi-style @file references. Plain path mentions are ignored. */
export function parsePromptFileReferences(prompt: string): PromptFileReference[] {
	const found = new Map<string, PromptFileReference>();
	for (const match of prompt.matchAll(/@([^\s"'`()[\]{}<>]+)/g)) {
		const raw = match[0];
		const candidate = match[1]?.replace(trailingPunctuationRe, "");
		if (!candidate || candidate.endsWith("/")) continue;
		const normalized = candidate.replace(/^\.\//, "");
		if (!normalized || found.has(normalized)) continue;
		found.set(normalized, { raw, path: normalized, index: match.index ?? -1 });
	}
	return [...found.values()];
}

export function parsePromptPaths(prompt: string): string[] {
	return parsePromptFileReferences(prompt).map((ref) => ref.path);
}
