import { Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import type { ThemeLike, TuiHostLike } from "../../pi/types.js";

export type VisualRange = {
	startLine: number;
	startChar: number;
	endLine: number;
	endChar: number;
};

export function parseVisualRange(
	raw: string | undefined,
	fileLines: string[],
): VisualRange {
	const maxLine = Math.max(1, fileLines.length);
	const match = raw?.match(/^(\d+)(?::(\d+))?-(\d+)(?::(\d+))?$/);
	const startLine = clamp(Number(match?.[1] ?? 1), 1, maxLine);
	const endLine = clamp(Number(match?.[3] ?? startLine), startLine, maxLine);
	return {
		startLine,
		startChar: clamp(
			Number(match?.[2] ?? 1),
			1,
			lineLength(fileLines, startLine),
		),
		endLine,
		endChar: clamp(
			Number(match?.[4] ?? lineLength(fileLines, endLine)),
			1,
			lineLength(fileLines, endLine),
		),
	};
}

export function formatVisualRange(range: VisualRange): string {
	return `${range.startLine}:${range.startChar}-${range.endLine}:${range.endChar}`;
}

function lineLength(fileLines: string[], line: number): number {
	return Math.max(1, (fileLines[line - 1] ?? "").length + 1);
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

export class RuleRangePicker {
	private endpoint: "start" | "end" = "start";
	private selectedRange = 0;
	private cachedWidth: number | undefined;
	private cachedLines: string[] | undefined;

	constructor(
		private readonly fileLines: string[],
		private readonly ranges: VisualRange[],
		private readonly theme: ThemeLike,
		private readonly tui: TuiHostLike,
		private readonly done: (value: VisualRange[] | undefined) => void,
	) {}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape)) return this.cancel();
		if (matchesKey(data, Key.enter)) return this.save();
		if (matchesKey(data, Key.tab)) return this.toggleEndpoint();
		if (matchesKey(data, Key.shift("tab"))) return this.prevRange();
		if (data === "n" || data === "N") return this.addRange();
		if (data === "d" || data === "D") return this.deleteRange();
		if (matchesKey(data, Key.up)) return this.bump(-1, 0);
		if (matchesKey(data, Key.down)) return this.bump(1, 0);
		if (matchesKey(data, Key.left)) return this.bump(0, -1);
		if (matchesKey(data, Key.right)) return this.bump(0, 1);
		if (/^\d$/.test(data)) return this.appendDigit(Number(data));
		if (matchesKey(data, Key.backspace)) return this.popDigit();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const lines: string[] = [];
		const add = (line: string) => lines.push(truncateToWidth(line, width));
		add(this.theme.fg("accent", "Rule range picker"));
		add(
			`range ${this.selectedRange + 1}/${this.ranges.length}: ${this.ranges.map(formatVisualRange).join(" | ")}`,
		);
		add(
			this.theme.fg(
				"dim",
				"tab start/end • shift+tab range • n new • d delete • ↑↓ line • ←→ char • digits line • enter save • esc cancel",
			),
		);
		add(`editing ${this.theme.fg("accent", this.endpoint)} endpoint`);
		add("");
		const current = this.current();
		const start = Math.max(1, current.startLine - 8);
		const end = Math.min(this.fileLines.length, current.endLine + 8);
		for (let lineNo = start; lineNo <= end; lineNo++)
			add(this.renderFileLine(lineNo));
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}
	private refresh(): void {
		this.invalidate();
		this.tui.requestRender();
	}
	private cancel(): void {
		this.done(undefined);
	}
	private save(): void {
		this.done(this.ranges.map((range) => this.normalized(range)));
	}
	private current(): VisualRange {
		return this.ranges[this.selectedRange] ?? this.ranges[0]!;
	}
	private toggleEndpoint(): void {
		this.endpoint = this.endpoint === "start" ? "end" : "start";
		this.refresh();
	}
	private prevRange(): void {
		this.selectedRange =
			(this.selectedRange + this.ranges.length - 1) % this.ranges.length;
		this.refresh();
	}
	private addRange(): void {
		const cur = this.current();
		this.ranges.push({ ...cur });
		this.selectedRange = this.ranges.length - 1;
		this.refresh();
	}
	private deleteRange(): void {
		if (this.ranges.length > 1) this.ranges.splice(this.selectedRange, 1);
		this.selectedRange = Math.min(this.selectedRange, this.ranges.length - 1);
		this.refresh();
	}

	private bump(lineDelta: number, charDelta: number): void {
		const range = this.current();
		if (this.endpoint === "start") {
			range.startLine += lineDelta;
			range.startChar += charDelta;
		} else {
			range.endLine += lineDelta;
			range.endChar += charDelta;
		}
		this.normalized(range);
		this.refresh();
	}
	private appendDigit(digit: number): void {
		const range = this.current();
		if (this.endpoint === "start")
			range.startLine = clamp(
				range.startLine * 10 + digit,
				1,
				this.fileLines.length,
			);
		else
			range.endLine = clamp(
				range.endLine * 10 + digit,
				1,
				this.fileLines.length,
			);
		this.normalized(range);
		this.refresh();
	}
	private popDigit(): void {
		const range = this.current();
		if (this.endpoint === "start")
			range.startLine = Math.max(1, Math.floor(range.startLine / 10));
		else range.endLine = Math.max(1, Math.floor(range.endLine / 10));
		this.normalized(range);
		this.refresh();
	}
	private normalized(range: VisualRange): VisualRange {
		const maxLine = Math.max(1, this.fileLines.length);
		range.startLine = clamp(range.startLine, 1, maxLine);
		range.endLine = clamp(range.endLine, 1, maxLine);
		if (range.endLine < range.startLine) range.endLine = range.startLine;
		range.startChar = clamp(
			range.startChar,
			1,
			lineLength(this.fileLines, range.startLine),
		);
		range.endChar = clamp(
			range.endChar,
			1,
			lineLength(this.fileLines, range.endLine),
		);
		return range;
	}
	private renderFileLine(lineNo: number): string {
		const raw = this.fileLines[lineNo - 1] ?? "";
		const prefix = this.theme.fg("dim", `${String(lineNo).padStart(4)} │ `);
		const covering = this.ranges.filter(
			(range) => lineNo >= range.startLine && lineNo <= range.endLine,
		);
		if (covering.length === 0) return prefix + this.theme.fg("dim", raw);
		let rendered = "";
		for (let i = 0; i < raw.length; i++) {
			const included = covering.some((range) => {
				const start = lineNo === range.startLine ? range.startChar - 1 : 0;
				const end = lineNo === range.endLine ? range.endChar - 1 : raw.length;
				return i >= start && i < end;
			});
			const char = raw[i] ?? "";
			rendered += included
				? this.theme.fg("success", char)
				: this.theme.fg("dim", char);
		}
		return prefix + rendered;
	}
}
