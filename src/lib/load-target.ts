/** The node a formulary item was loaded from: an RxNorm concept, one NDC, or a curated product set. */
export type LoadTarget =
	| { kind: 'concept'; rxcui: string }
	| { kind: 'package'; ndc: string }
	| { kind: 'set'; key: string };

/** The id a target is keyed by: its RxCUI, NDC or curated-set key. */
export const targetValue = (target: LoadTarget) =>
	target.kind === 'concept' ? target.rxcui : target.kind === 'package' ? target.ndc : target.key;
