import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import type { ThemeLike, TuiHostLike } from "../../pi/types.js";
import {
	border,
	header,
	renderActionRow,
	renderDataRow,
	type ProposalTableColumn,
	type VisibleActionRow,
	type VisibleProposalRow,
} from "./proposal-table-render.js";

export type ProposalTableAction<TAction extends string> =
	| { type: "action"; action: TAction }
	| { type: "open"; index: number };

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

export class ProposalTable<TRow, TAction extends string> {
	private page = 0;
	private selected = 0;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;
	private readonly pageSize: number;

	constructor(
		private readonly options: ProposalTableOptions<TRow, TAction>,
		private readonly theme: ThemeLike,
		private readonly tui: TuiHostLike,
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
		add(border("top", this.options.columns));
		add(header(this.options.columns));
		add(border("mid", this.options.columns));
		for (const row of this.visibleRows()) {
			add(
				renderDataRow(
					row,
					this.options.columns,
					this.theme,
					this.selected === row.screenRow,
					this.options.isEnabled,
				),
			);
		}
		add(border("bottom", this.options.columns));
		add("");
		for (const action of this.actionRows())
			add(
				renderActionRow(action, this.theme, this.selected === action.screenRow),
			);
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	private visibleRows(): VisibleProposalRow<TRow>[] {
		const start = this.page * this.pageSize;
		return this.options.rows
			.slice(start, start + this.pageSize)
			.map((row, offset) => ({
				row,
				index: start + offset,
				screenRow: offset,
			}));
	}

	private actionRows(): VisibleActionRow<TAction>[] {
		const base = this.visibleRows().length;
		return this.options.actions.map((action, offset) => ({
			...action,
			screenRow: base + offset,
		}));
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
