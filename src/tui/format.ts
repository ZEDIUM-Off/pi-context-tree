export function formatNumber(value: number): string {
	return new Intl.NumberFormat("en", {
		notation: value >= 10_000 ? "compact" : "standard",
	}).format(value);
}

export function short(value: string): string {
	return value.length > 12 ? value.slice(0, 12) : value;
}

export function padCell(value: string, width: number): string {
	return (
		value.length > width ? `${value.slice(0, width - 1)}…` : value
	).padEnd(width, " ");
}

export function osc8(uri: string, label: string): string {
	return `\u001B]8;;${uri}\u0007${label}\u001B]8;;\u0007`;
}

export function shortenUrl(value: string): string {
	try {
		const url = new URL(value);
		const file = url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname;
		return `${url.hostname}/…/${file}`;
	} catch {
		return value.length > 72 ? `${value.slice(0, 71)}…` : value;
	}
}

export function padAnsi(value: string, width: number): string {
	const clipped = truncateAnsi(value, width);
	return clipped + " ".repeat(Math.max(0, width - visibleAnsiWidth(clipped)));
}

function truncateAnsi(value: string, width: number): string {
	return visibleAnsiWidth(value) <= width
		? value
		: `${stripAnsi(value).slice(0, Math.max(0, width - 1))}…`;
}

export function visibleAnsiWidth(value: string): number {
	return stripAnsi(value).length;
}

function stripAnsi(value: string): string {
	const esc = String.fromCharCode(27);
	const bel = String.fromCharCode(7);
	const sgr = new RegExp(`${esc}\\[[0-9;]*m`, "g");
	const osc8 = new RegExp(`${esc}]8;;.*?${bel}`, "g");
	return value.replace(sgr, "").replace(osc8, "");
}

export function countLines(value: string): number {
	return value ? value.split(/\r\n|\r|\n/).length : 0;
}

export function estimateTokens(value: string): number {
	return Math.ceil(value.length / 4);
}
