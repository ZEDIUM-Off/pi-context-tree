import { createHash } from "node:crypto";
import path from "node:path";

export function toPosix(value: string): string {
	return value.split(path.sep).join("/");
}

export function stripAtPrefix(value: string): string {
	return value.startsWith("@") ? value.slice(1) : value;
}

export function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}
