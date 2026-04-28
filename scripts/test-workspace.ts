import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	disableRemoteContextTree,
	readSettings,
	writeSettings,
} from "./pi-settings.js";

const repoRoot = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"..",
);
const workspaceRoot = path.join(repoRoot, ".test-workspaces");
const source = process.argv[2];
const extraArgs = process.argv.slice(3);

if (!source) {
	console.error("Usage: pnpm test:workspace <giturl|local-path> [pi args...]");
	process.exit(1);
}

const localPath = path.resolve(process.cwd(), source);
const target = isDirectory(localPath)
	? localPath
	: await cloneOrUpdateWorkspace(source);

await disableRemoteContextTreeForWorkspace(target);
console.log(`launching pi in ${target}`);
console.log(`extension: ${repoRoot}`);
await run("pi", ["-e", repoRoot, ...extraArgs], target, true);

async function cloneOrUpdateWorkspace(gitUrl: string): Promise<string> {
	const name = workspaceName(gitUrl);
	const target = path.join(workspaceRoot, name);
	await mkdir(workspaceRoot, { recursive: true });

	if (!existsSync(target)) {
		await run("git", ["clone", gitUrl, target], repoRoot);
	} else {
		console.log(`workspace exists: ${target}`);
		console.log("pulling latest default branch...");
		await run("git", ["-C", target, "pull", "--ff-only"], repoRoot);
	}
	return target;
}

async function disableRemoteContextTreeForWorkspace(
	cwd: string,
): Promise<void> {
	const settingsPath = path.join(cwd, ".pi", "settings.json");
	const settings = await readSettings(settingsPath);
	await writeSettings(settingsPath, disableRemoteContextTree(settings));
	console.log(`disabled remote Context Tree package in ${settingsPath}`);
}

function isDirectory(filePath: string): boolean {
	try {
		return statSync(filePath).isDirectory();
	} catch {
		return false;
	}
}

function workspaceName(url: string): string {
	const cleaned = url
		.replace(/\.git$/, "")
		.replace(/[:/]+/g, "-")
		.replace(/[^a-zA-Z0-9._-]/g, "-")
		.replace(/^-+|-+$/g, "");
	return cleaned || "workspace";
}

function run(
	command: string,
	args: string[],
	cwd: string,
	inherit = false,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd,
			stdio: inherit ? "inherit" : ["ignore", "inherit", "inherit"],
			env: process.env,
		});
		child.on("error", reject);
		child.on("exit", (code, signal) => {
			if (code === 0) resolve();
			else
				reject(
					new Error(
						`${command} ${args.join(" ")} failed with ${signal ?? code}`,
					),
				);
		});
	});
}
