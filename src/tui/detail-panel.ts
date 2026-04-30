import type { CustomUi, TuiHostLike } from "../pi/types.js";
import { panelColors } from "./colors.js";
import { colorDetailLine, renderDetailLines } from "./detail-lines.js";
import { padAnsi, visibleAnsiWidth } from "./format.js";
import type { TuiState } from "./types.js";

export async function showDetailPanel(
	ctx: { ui: { custom?: unknown; setEditorText?: (text: string) => void } },
	state: TuiState,
): Promise<void> {
	if (typeof ctx.ui.custom !== "function") return;
	const custom = ctx.ui.custom as CustomUi;
	let selected = 0;
	await custom<void>(
		(tui: TuiHostLike, theme, _kb, done: (value: void) => void) => ({
			render(width: number) {
				const popupWidth = Math.max(48, Math.min(110, width - 4));
				const innerWidth = popupWidth - 2;
				const c = panelColors(theme);
				const raw = renderDetailLines(state, selected)
					.filter((line) => !line.startsWith("╔") && !line.startsWith("╚"))
					.map((line) => colorDetailLine(line, c));
				const lines = raw.slice(0, 34);
				const title = ` ${c.title("Context Tree Inspector")} ${c.dim("scope/session/injection")}`;
				const top = framedTitle(title, innerWidth, c.border);
				const body = lines.map(
					(line) =>
						c.border("│") + padAnsi(` ${line}`, innerWidth) + c.border("│"),
				);
				const footer = `${c.hint("↑↓")} scope  ${c.hint("o")} copy config URI  ${c.hint("q/esc")} close`;
				return [
					top,
					c.border("│") + " ".repeat(innerWidth) + c.border("│"),
					...body,
					c.border("├" + "─".repeat(innerWidth) + "┤"),
					c.border("│") + padAnsi(` ${footer}`, innerWidth) + c.border("│"),
					c.border(`╰${"─".repeat(innerWidth)}╯`),
				];
			},
			invalidate() {},
			handleInput(data: string) {
				if (data === "\u001b[A") selected = Math.max(0, selected - 1);
				else if (data === "\u001b[B")
					selected = Math.min((state.scopes?.length ?? 1) - 1, selected + 1);
				else if (data === "\u001b" || data === "q") return done();
				else if (data === "o")
					ctx.ui.setEditorText?.(
						`file://${state.scopes?.[selected]?.configPath ?? ""}`,
					);
				tui.requestRender();
			},
		}),
		{
			overlay: true,
			overlayOptions: {
				width: "92%",
				maxHeight: "88%",
				anchor: "center",
				margin: 1,
			},
		},
	);
}

function framedTitle(
	title: string,
	width: number,
	border: (text: string) => string,
): string {
	const titleWidth = visibleAnsiWidth(title);
	const fill = Math.max(0, width - titleWidth);
	const left = Math.floor(fill / 2);
	return (
		border("╭" + "─".repeat(left)) +
		title +
		border("─".repeat(fill - left) + "╮")
	);
}
