import type { ExtractConfig } from "./schema.js";

export function extractContent(raw: string, extract?: ExtractConfig): string {
	if (!extract) return raw;
	const parts: Array<{ title: string; body: string; note?: string }> = [];
	const add = (title: string, body: string, note?: string) => {
		const part: { title: string; body: string; note?: string } = {
			title,
			body,
		};
		if (note !== undefined) part.note = note;
		parts.push(part);
	};
	for (const section of extract.sections ?? [])
		add(`# section:${section}`, extractSection(raw, section));
	const lines =
		typeof extract.lines === "string" ? [extract.lines] : (extract.lines ?? []);
	for (const range of lines) add(`# lines:${range}`, extractLines(raw, range));
	for (const marker of extract.markers ?? [])
		add(`# marker:${marker}`, extractMarker(raw, marker));
	for (const seg of extract.segments ?? []) {
		if (seg.marker)
			add(`# marker:${seg.marker}`, extractMarker(raw, seg.marker), seg.note);
		if (seg.lines)
			add(`# lines:${seg.lines}`, extractLines(raw, seg.lines), seg.note);
		if (seg.section)
			add(
				`# section:${seg.section}`,
				extractSection(raw, seg.section),
				seg.note,
			);
	}
	if (parts.length === 0) return raw;
	return parts
		.map(
			(p) =>
				`${p.title}${p.note ? `\nAgent note: ${p.note}` : ""}\n${p.body.trimEnd()}`,
		)
		.join("\n\n");
}

export function extractLines(raw: string, range: string): string {
	const match = /^(\d+)-(\d+)$/.exec(range) ?? /^(\d+)$/.exec(range);
	if (!match) throw new Error(`Invalid line range: ${range}`);
	const start = Number(match[1]);
	const end = Number(match[2] ?? match[1]);
	if (start < 1 || end < start) throw new Error(`Invalid line range: ${range}`);
	return raw
		.split(/\r?\n/)
		.slice(start - 1, end)
		.join("\n");
}

export function extractSection(raw: string, section: string): string {
	const lines = raw.split(/\r?\n/);
	const start = lines.findIndex(
		(line) =>
			/^#{1,6}\s+/.test(line) &&
			line.replace(/^#{1,6}\s+/, "").trim() === section,
	);
	if (start < 0) throw new Error(`Missing section: ${section}`);
	const startLine = lines[start] ?? "";
	const level = /^#+/.exec(startLine)?.[0].length ?? 1;
	let end = lines.length;
	for (let i = start + 1; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const m = /^#{1,6}\s+/.exec(line);
		if (m && m[0].trim().length <= level) {
			end = i;
			break;
		}
	}
	return lines.slice(start, end).join("\n");
}

export function extractMarker(raw: string, marker: string): string {
	const startRe = new RegExp(
		`(?:context-tree:start)\\s+${escapeRegExp(marker)}\\b`,
	);
	const endRe = new RegExp(
		`(?:context-tree:end)\\s+${escapeRegExp(marker)}\\b`,
	);
	const lines = raw.split(/\r?\n/);
	const start = lines.findIndex((line) => startRe.test(line));
	if (start < 0) throw new Error(`Missing marker: ${marker}`);
	const end = lines.findIndex(
		(line, index) => index > start && endRe.test(line),
	);
	if (end < 0) throw new Error(`Missing marker end: ${marker}`);
	return lines.slice(start + 1, end).join("\n");
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
