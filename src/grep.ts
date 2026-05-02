import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";

export type GrepBackend = "rg" | "grep" | "js";

export type GrepFileResult = {
	matched: boolean;
	backend: GrepBackend;
	warning?: string;
};

let detectedBackend: GrepBackend | undefined;

function commandExists(command: string): Promise<boolean> {
	return new Promise((resolve) => {
		const child = spawn(command, ["--version"], { stdio: "ignore" });
		child.on("error", () => resolve(false));
		child.on("close", (code) => resolve(code === 0));
	});
}

async function detectBackend(): Promise<GrepBackend> {
	if (detectedBackend) return detectedBackend;
	if (await commandExists("rg")) detectedBackend = "rg";
	else if (await commandExists("grep")) detectedBackend = "grep";
	else detectedBackend = "js";
	return detectedBackend;
}

function runQuiet(command: string, args: string[]): Promise<{ code: number | null; error?: string }> {
	return new Promise((resolve) => {
		const child = spawn(command, args, { stdio: "ignore" });
		child.on("error", (error) => resolve({ code: null, error: error.message }));
		child.on("close", (code) => resolve({ code }));
	});
}

async function grepWithJs(file: string, pattern: string, maxBytes?: number): Promise<GrepFileResult> {
	const raw = await readFile(file);
	const content = raw.subarray(0, maxBytes ?? raw.length).toString("utf8");
	return { matched: new RegExp(pattern, "m").test(content), backend: "js" };
}

async function grepWithBackend(backend: Exclude<GrepBackend, "js">, file: string, pattern: string): Promise<GrepFileResult> {
	const args = backend === "rg"
		? ["--quiet", "--regexp", pattern, "--", file]
		: ["-E", "-q", "--", pattern, file];
	const result = await runQuiet(backend, args);
	if (result.code === 0) return { matched: true, backend };
	if (result.code === 1) return { matched: false, backend };
	const fallback = await grepWithJs(file, pattern);
	return {
		...fallback,
		warning: `${backend} failed for pattern ${JSON.stringify(pattern)}${result.error ? `: ${result.error}` : ""}; used JS fallback`,
	};
}

export async function grepFile(input: { file: string; pattern: string; maxBytes?: number; backend?: GrepBackend }): Promise<GrepFileResult> {
	const backend = input.backend ?? await detectBackend();
	if (backend === "js" || input.maxBytes) return grepWithJs(input.file, input.pattern, input.maxBytes);
	return grepWithBackend(backend, input.file, input.pattern);
}

export function resetGrepBackendForTests(): void {
	detectedBackend = undefined;
}
