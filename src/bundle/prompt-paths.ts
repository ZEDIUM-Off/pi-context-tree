export function parsePromptPaths(prompt: string): string[] {
	const found = new Set<string>();
	for (const m of prompt.matchAll(/@([\w./-]+\.[\w]+)/g))
		if (m[1]) found.add(m[1]);
	for (const m of prompt.matchAll(
		/(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|md|json|py|go|rs))/g,
	))
		if (m[1]) found.add(m[1]);
	return [...found];
}
