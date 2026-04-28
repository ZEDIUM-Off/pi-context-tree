import type { StandardReviewAction } from "./phase-review.js";

export const standardReviewActions: Array<{
	label: string;
	action: StandardReviewAction;
}> = [
	{ label: "Accept step", action: "accept" },
	{ label: "Advanced: edit JSON", action: "advanced" },
	{ label: "Reject + comment / revise", action: "revise" },
	{ label: "Back", action: "back" },
	{ label: "Cancel", action: "cancel" },
];
