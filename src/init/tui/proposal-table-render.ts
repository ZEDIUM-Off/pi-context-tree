import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

export type ProposalTableColumn<TRow> = {
	title: string;
	width: number;
	render: (row: TRow, index: number, theme: TableTheme) => string;
	href?: (row: TRow, index: number) => string | undefined;
};

export type VisibleProposalRow<TRow> = {
	row: TRow;
	index: number;
	screenRow: number;
};

export type VisibleActionRow<TAction extends string> = {
	label: string;
	action: TAction;
	screenRow: number;
};

export function renderDataRow<TRow, TTheme extends TableTheme>(
	row: VisibleProposalRow<TRow>,
	columns: ProposalTableColumn<TRow>[],
	theme: TTheme,
	selected: boolean,
	isEnabled: (row: TRow) => boolean,
): string {
	const on = isEnabled(row.row)
		? theme.fg("success", "☑")
		: theme.fg("dim", "☐");
	const cells = [
		on,
		String(row.index + 1).padEnd(5),
		...columns.map((column) => {
			const label = cell(
				column.render(row.row, row.index, theme),
				column.width,
			);
			const href = column.href?.(row.row, row.index);
			return href ? hyperlink(href, label) : label;
		}),
	];
	const line = `│ ${cells.join(" │ ")} │`;
	return selected ? theme.bg("selectedBg", line) : line;
}

export function renderActionRow<
	TAction extends string,
	TTheme extends TableTheme,
>(row: VisibleActionRow<TAction>, theme: TTheme, selected: boolean): string {
	const line = `${selected ? "▶" : " "} ${row.label}`;
	return selected ? theme.fg("accent", line) : line;
}

export function header<TRow>(columns: ProposalTableColumn<TRow>[]): string {
	return `│ On│ #     │ ${columns.map((column) => cell(column.title, column.width)).join(" │ ")} │`;
}

export function border<TRow>(
	kind: "top" | "mid" | "bottom",
	columns: ProposalTableColumn<TRow>[],
): string {
	const left = kind === "top" ? "┌" : kind === "mid" ? "├" : "└";
	const mid = kind === "top" ? "┬" : kind === "mid" ? "┼" : "┴";
	const right = kind === "top" ? "┐" : kind === "mid" ? "┤" : "┘";
	return `${left}───${mid}───────${mid}${columns.map((column) => "─".repeat(column.width + 2)).join(mid)}${right}`;
}

export function cell(value: string, width: number): string {
	const short = truncateToWidth(value, width, "…");
	return short + " ".repeat(Math.max(0, width - visibleWidth(short)));
}

export function hyperlink(url: string, label: string): string {
	return `\u001B]8;;${url}\u001B\\${label}\u001B]8;;\u001B\\`;
}

export type TableTheme = {
	fg: (color: string, text: string) => string;
	bg: (color: string, text: string) => string;
};
