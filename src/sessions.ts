export const contextTreeSessionCustomType = "context-tree-session";
export function sessionKickoff(path: string, prompt: string): string {
	return prompt || `Work in scoped Context Tree session for ${path}.`;
}
