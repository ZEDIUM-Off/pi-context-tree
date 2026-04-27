import assert from "node:assert/strict";
import { test } from "node:test";
import { decideScopeAccess } from "../src/permissions.js";

const base = {
	cwd: "/repo",
	scopeDir: "/repo/src/billing",
	targetPath: "src/billing/a.ts",
};

test("scope guard allows inside scope", () => {
	assert.equal(decideScopeAccess(base).action, "allow");
});

test("scope guard asks outside scope by default", () => {
	assert.equal(
		decideScopeAccess({ ...base, targetPath: "src/auth/a.ts" }).action,
		"ask",
	);
});

test("block wins over allow", () => {
	assert.equal(
		decideScopeAccess({
			...base,
			targetPath: ".env",
			config: { allow: ["**/*"], block: [".env"] },
		}).action,
		"block",
	);
});

test("allow patterns and non-interactive fallback", () => {
	assert.equal(
		decideScopeAccess({
			...base,
			targetPath: "src/shared/x.ts",
			config: { allow: ["src/shared/**"] },
		}).action,
		"allow",
	);
	assert.equal(
		decideScopeAccess({
			...base,
			targetPath: "src/auth/a.ts",
			interactive: false,
		}).action,
		"block",
	);
});
