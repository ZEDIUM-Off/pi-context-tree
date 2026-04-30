import type { TuiApi } from "../tui.js";

export type NotifyLevel = "info" | "warning" | "error";

export type ThemeLike = {
	fg: (color: string, text: string) => string;
	bg: (color: string, text: string) => string;
	bold?: (text: string) => string;
	italic?: (text: string) => string;
	strikethrough?: (text: string) => string;
};

export type TuiHostLike = {
	requestRender: () => void;
};

export type KeybindingsLike = unknown;

export type CustomUiFactory<TResult> = (
	tui: TuiHostLike,
	theme: unknown,
	keybindings: KeybindingsLike,
	done: (value: TResult) => void,
) => unknown;

export type CustomUi = <TResult>(
	factory: CustomUiFactory<TResult>,
	options?: {
		overlay?: boolean;
		overlayOptions?: Record<string, unknown>;
	},
) => Promise<TResult>;

export type UiLike = Omit<TuiApi, "theme"> & {
	theme?: unknown;
	select?: (title: string, options: string[]) => Promise<string | undefined>;
	confirm?: (title: string, message: string) => Promise<boolean>;
	input?: (title: string, initial?: string) => Promise<string | undefined>;
	editor?: (title: string, initial: string) => Promise<string | undefined>;
	custom?: unknown;
	setEditorText?: (text: string) => void;
};

export type SessionManagerLike = {
	getBranch?: () => unknown[];
	getEntries?: () => unknown[];
	getLeafId?: () => string | null | undefined;
	getSessionFile?: () => string | null | undefined;
	getSessionId?: () => string | null | undefined;
};

export type ExtensionContextLike = {
	cwd: string;
	ui: UiLike;
	hasUI?: boolean;
	sessionManager: SessionManagerLike;
	isIdle?: () => boolean;
	sendUserMessage?: (
		content: string,
		options?: { deliverAs: "steer" | "followUp" },
	) => Promise<void> | void;
};

export type OptionalSessionContext = {
	ui: TuiApi;
	sessionManager?: SessionManagerLike;
};

export type PiMessagingLike = {
	sendUserMessage: (
		content: string,
		options?: { deliverAs: "steer" | "followUp" },
	) => Promise<void> | void;
	packageJson?: { version?: string };
};
