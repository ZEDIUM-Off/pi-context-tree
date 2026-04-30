import type { ThemeLike } from "../pi/types.js";
import type { SessionSummary } from "./types.js";

export function panelColors(themeInput?: unknown) {
	const theme = isThemeLike(themeInput) ? themeInput : undefined;
	const ansi = (code: string, text: string) =>
		theme ? `\u001b[${code}m${text}\u001b[0m` : text;
	const fg = (name: string, code: string) => (text: string) =>
		theme?.fg ? theme.fg(name, text) : ansi(code, text);
	return {
		border: fg("borderAccent", "36"),
		title: (text: string) =>
			theme?.bold ? fg("accent", "36")(theme.bold(text)) : ansi("1;36", text),
		success: fg("success", "32"),
		warning: fg("warning", "33"),
		error: fg("error", "31"),
		accent: fg("accent", "36"),
		muted: fg("muted", "2"),
		dim: fg("dim", "2"),
		hint: (text: string) => ansi("3;2", text),
	};
}

export type PanelColors = ReturnType<typeof panelColors>;

export function sessionColor(
	mode: SessionSummary["mode"],
	c: PanelColors,
): (text: string) => string {
	if (mode === "main") return c.success;
	if (mode === "branch") return c.warning;
	return c.dim;
}

function isThemeLike(value: unknown): value is ThemeLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { fg?: unknown }).fg === "function" &&
		typeof (value as { bg?: unknown }).bg === "function"
	);
}
