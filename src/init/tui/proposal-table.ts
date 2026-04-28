import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
} from "@mariozechner/pi-tui";

export type ProposalTableAction<TAction extends string> =
	| { type: "action"; action: TAction }
	| { type: "open"; index: number };

export type ProposalTableColumn<TRow> = {
	title: string;
	width: number;
	render: (row: TRow, index: number, theme: any) => string;
	href?: (row: TRow, index: number) => string | undefined;
};

export type ProposalTableActionRow<TAction extends string> = {
	label: string;
	action: TAction;
};

export type ProposalTableOptions<TRow, TAction extends string> = {
	title: string;
	rows: TRow[];
	isEnabled: (row: TRow) => boolean;
	setEnabled: (row: TRow, enabled: boolean) => void;
	columns: ProposalTableColumn<TRow>[];
	actions: ProposalTableActionRow<TAction>[];
	pageSize?: number;
	progress?: string;
};

export async function showProposalTable<TRow, TAction extends string>(
	ctx: any,
	options: ProposalTableOptions<TRow, TAction>,
): Promise<ProposalTableAction<TAction>> {
	const custom = ctx.ui.custom as <T>(
		factory: (
			tui: any,
			theme: any,
			kb: any,
			done: (value: T) => void,
		) => unknown,
	) => Promise<T>;
	return custom<ProposalTableAction<TAction>>(
		(tui, theme, _kb, done) => new ProposalTable(options, theme, tui, done),
	);
}

class ProposalTable<TRow, TAction extends string> {
	private page = 0;
	private selected = 0;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private readonly pageSize: number;

	constructor(
		private readonly options: ProposalTableOptions<TRow, TAction>,
		private readonly theme: any,
		private readonly tui: any,
		private readonly done: (value: ProposalTableAction<TAction>) => void,
	) {
		this.pageSize = options.pageSize ?? 10;
	}

	handleInput(data: string): void {
		const rows = this.rowCount();
		if (matchesKey(data, Key.escape)) {
			this.doneAction(this.options.actions.at(-1)?.action);
			return;
		}
		if (matchesKey(data, Key.left)) {
			this.movePage(-1);
			return;
		}
		if (matchesKey(data, Key.right)) {
			this.movePage(1);
			return;
		}
		if (matchesKey(data, Key.up)) {
			this.selected = Math.max(0, this.selected - 1);
			this.refresh();
			return;
		}
		if (matchesKey(data, Key.down)) {
			this.selected = Math.min(rows - 1, this.selected + 1);
			this.refresh();
			return;
		}
		if (data === "a" || data === "A") {
			this.setAll(!this.allVisibleEnabled());
			return;
		}
		if (matchesKey(data, Key.space)) {
			const row = this.selectedRow();
			if (row) {
				this.options.setEnabled(row.row, !this.options.isEnabled(row.row));
				this.refresh();
			}
			return;
		}
		if (matchesKey(data, Key.enter)) this.activate();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const lines: string[] = [];
		const add = (line: string) => lines.push(truncateToWidth(line, width));
		const totalPages = this.totalPages();
		const enabled = this.options.rows.filter((row) =>
			this.options.isEnabled(row),
		).length;
		add(this.theme.fg("accent", this.options.title));
		if (this.options.progress) add(this.options.progress);
		add(
			`Page ${this.page + 1}/${totalPages} · ${enabled}/${this.options.rows.length} enabled · ←/→ page · ↑/↓ row · space toggle · a all page · enter edit/action`,
		);
		add(this.border("top"));
		add(this.header());
		add(this.border("mid"));
		for (const row of this.visibleRows()) add(this.renderDataRow(row));
		add(this.border("bottom"));
		add("");
		for (const action of this.actionRows()) add(this.renderActionRow(action));
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private visibleRows(): Array<{
		row: TRow;
		index: number;
		screenRow: number;
	}> {
		const start = this.page * this.pageSize;
		return this.options.rows
			.slice(start, start + this.pageSize)
			.map((row, offset) => ({
				row,
				index: start + offset,
				screenRow: offset,
			}));
	}

	private actionRows(): Array<{
		label: string;
		action: TAction;
		screenRow: number;
	}> {
		const base = this.visibleRows().length;
		return this.options.actions.map((action, offset) => ({
			...action,
			screenRow: base + offset,
		}));
	}

	private renderDataRow(row: {
		row: TRow;
		index: number;
		screenRow: number;
	}): string {
		const on = this.options.isEnabled(row.row)
			? this.theme.fg("success", "☑")
			: this.theme.fg("dim", "☐");
		const cells = [
			on,
			String(row.index + 1).padEnd(5),
			...this.options.columns.map((column) => {
				const label = cell(
					column.render(row.row, row.index, this.theme),
					column.width,
				);
				const href = column.href?.(row.row, row.index);
				return href ? hyperlink(href, label) : label;
			}),
		];
		const line = `│ ${cells.join(" │ ")} │`;
		return this.selected === row.screenRow
			? this.theme.bg("selectedBg", line)
			: line;
	}

	private renderActionRow(row: {
		label: string;
		action: TAction;
		screenRow: number;
	}): string {
		const selected = this.selected === row.screenRow;
		const line = `${selected ? "▶" : " "} ${row.label}`;
		return selected ? this.theme.fg("accent", line) : line;
	}

	private header(): string {
		return `│ On│ #     │ ${this.options.columns.map((column) => cell(column.title, column.width)).join(" │ ")} │`;
	}

	private border(kind: "top" | "mid" | "bottom"): string {
		const left = kind === "top" ? "┌" : kind === "mid" ? "├" : "└";
		const mid = kind === "top" ? "┬" : kind === "mid" ? "┼" : "┴";
		const right = kind === "top" ? "┐" : kind === "mid" ? "┤" : "┘";
		return `${left}───${mid}───────${mid}${this.options.columns.map((column) => "─".repeat(column.width + 2)).join(mid)}${right}`;
	}

	private rowCount(): number {
		return this.visibleRows().length + this.actionRows().length;
	}

	private selectedRow(): { row: TRow; index: number } | undefined {
		const visible = this.visibleRows();
		const row =
			this.selected < visible.length ? visible[this.selected] : undefined;
		return row ? { row: row.row, index: row.index } : undefined;
	}

	private activate(): void {
		const row = this.selectedRow();
		if (row) {
			this.done({ type: "open", index: row.index });
			return;
		}
		const action = this.actionRows().find(
			(item) => item.screenRow === this.selected,
		)?.action;
		this.doneAction(action);
	}

	private doneAction(action: TAction | undefined): void {
		if (action) this.done({ type: "action", action });
	}

	private movePage(delta: number): void {
		this.page = Math.max(0, Math.min(this.totalPages() - 1, this.page + delta));
		this.selected = 0;
		this.refresh();
	}

	private allVisibleEnabled(): boolean {
		return this.visibleRows().every((row) => this.options.isEnabled(row.row));
	}

	private setAll(enabled: boolean): void {
		for (const row of this.visibleRows())
			this.options.setEnabled(row.row, enabled);
		this.refresh();
	}

	private totalPages(): number {
		return Math.max(1, Math.ceil(this.options.rows.length / this.pageSize));
	}

	private refresh(): void {
		this.invalidate();
		this.tui.requestRender();
	}
}

export function cell(value: string, width: number): string {
	const short = truncateToWidth(value, width, "…");
	return short + " ".repeat(Math.max(0, width - visibleWidth(short)));
}

export function hyperlink(url: string, label: string): string {
	return `\u001B]8;;${url}\u001B\\${label}\u001B]8;;\u001B\\`;
}
