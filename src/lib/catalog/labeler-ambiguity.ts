/**
 * Labeler submission ambiguities.
 *
 * Labelers routinely submit a number that is true of something other than what
 * the directory field means: the salt's mass where the moiety's belongs, the
 * diluent added where the final volume belongs, the container's capacity where
 * the fill belongs. Correcting such a value is an ordinary override of that one
 * field, but the reason it was wrong is the same every time, so the correction
 * can name the pattern. A kind says which fields it can explain and what else
 * follows from the pattern (how the labeled volume is to be read).
 *
 * @module
 */

export type AmbiguityKind = 'salt-basis' | 'diluent-as-final' | 'capacity-as-final';

/** Stored on each override a correction wrote, so the page can say why. */
export type AmbiguityTag = { kind: AmbiguityKind; note: string | null };

type KindDefinition = {
	label: string;
	/** Shown beside the field being corrected. */
	explanation: string;
	appliesTo: (key: string) => boolean;
	/** Other values that follow from the pattern, whatever the label says. */
	companions: Record<string, string>;
};

const isStrength = (key: string) => /^details\.spl\.ingredients\.\d+\.strength$/.test(key);
const isFinalVolume = (key: string) => key === 'resolvedVolume.finalVolumeMl';

export const AMBIGUITY_KINDS: Record<AmbiguityKind, KindDefinition> = {
	'salt-basis': {
		label: 'Salt form measured, not the active moiety',
		explanation:
			'The labeler stated the strength of the salt where the active moiety’s belongs. Enter the moiety strength.',
		appliesTo: isStrength,
		companions: {}
	},
	'diluent-as-final': {
		label: 'Diluent amount written as the final volume',
		explanation:
			'The labeled volume is the diluent to add, not what the vial holds once reconstituted. Enter the true final volume; the labeled volume will be read as the diluent.',
		appliesTo: isFinalVolume,
		companions: { 'resolvedVolume.meaning': 'diluent' }
	},
	'capacity-as-final': {
		label: 'Container capacity written as the final volume',
		explanation:
			'The labeled volume is what the container can hold, not what it holds once filled. Enter the true final volume; the labeled volume will be read as capacity.',
		appliesTo: isFinalVolume,
		companions: { 'resolvedVolume.meaning': 'capacity' }
	}
};

export const isAmbiguityKind = (value: unknown): value is AmbiguityKind =>
	typeof value === 'string' && Object.hasOwn(AMBIGUITY_KINDS, value);

/** The ambiguities that can explain a wrong value at `key`. */
export const ambiguityKindsFor = (key: string): AmbiguityKind[] =>
	(Object.keys(AMBIGUITY_KINDS) as AmbiguityKind[]).filter((kind) =>
		AMBIGUITY_KINDS[kind].appliesTo(key)
	);
