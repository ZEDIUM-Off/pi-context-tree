import { contextFileSchema } from "../schema.js";
import type { InitPhase, InitSession } from "./types.js";
import { generatedPreviewSchema } from "./phase-schemas.js";

export function phaseValue(session: InitSession, phase: InitPhase): unknown {
	if (phase === "scan") return session.scan;
	if (phase === "technology") return session.technologies;
	if (phase === "references") return session.references;
	if (phase === "rules") return session.rules;
	if (phase === "scopes" || phase === "stability") return session.scopes;
	if (phase === "preview") return session.generatedFiles;
	return session;
}

export function setPhaseValue(
	session: InitSession,
	phase: InitPhase,
	value: unknown,
): void {
	if (phase === "technology")
		session.technologies = value as InitSession["technologies"];
	else if (phase === "references")
		session.references = value as InitSession["references"];
	else if (phase === "rules") session.rules = value as InitSession["rules"];
	else if (phase === "scopes" || phase === "stability")
		session.scopes = value as InitSession["scopes"];
	else if (phase === "preview")
		session.generatedFiles = value as InitSession["generatedFiles"];
}

export function validatePhase(phase: InitPhase, value: unknown): void {
	if (phase !== "preview") return;
	const files = generatedPreviewSchema.parse(value);
	for (const file of files)
		if (file.kind === "context") contextFileSchema.parse(file.config);
}
