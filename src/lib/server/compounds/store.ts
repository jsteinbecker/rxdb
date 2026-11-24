/**
 * Persistence for compounds: create, rename, delete, add and remove components,
 * save lines, and lock a finished compound.
 *
 * @module
 */
import { Prisma, type PrismaClient } from '../../../generated/client';
import { parseAdoptedVialPrep, type AdoptedVialPrep } from '../../compounds/vial-prep-consensus';
import {
	decimalOf,
	fromMixed,
	parseCompoundName,
	toMixed,
	VOLUME_UNIT,
	type Line,
	type LinesPayload,
	type Role
} from '../../compounds/compound-builder';
import { uniqueName } from '../../compounds/compound-naming';
import { divide, fromNumber, type Rational } from '../../medication/rational';
import { INJECTION_ROUTES, type ReconstitutionRoute } from '../../labels/reconstitution-terms';

import { CompoundError } from './errors';
import {
	componentLabel,
	resolveConstraint,
	writeConstraint,
	type Constraint
} from './constituents';

export { CompoundError };

export type StoredLine = Omit<Line, 'label'> & {
	/** The line's preferred package; the first of `packageIds`. */
	packageId: string;
	/** Every package the line may be filled from, in preference order. A generic line has several. */
	packageIds: string[];
	/** The picked vial combination: vials pulled per package; empty when none is picked. */
	vialCounts: { packageId: string; count: number }[];
	vialPrep: AdoptedVialPrep | null;
	/** The drug + route the line draws from ("Ampicillin IV"); null for lines made before components. */
	component: { id: string; label: string } | null;
	/** The formulary item the line is pinned to; null admits every item of the component. */
	formularyItemId: string | null;
	/** The hand-picked NDC subset of `formularyItemId`, and why; null when not narrowed. */
	restriction: { reason: string | null; packageIds: string[] } | null;
};
export interface StoredCompound {
	id: string;
	name: string;
	status: string;
	locked: boolean;
	/** Route of administration, entered by hand; null until chosen. */
	route: ReconstitutionRoute | null;
	total: Rational | null;
	lines: StoredLine[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isRoute = (value: unknown): value is ReconstitutionRoute =>
	(INJECTION_ROUTES as readonly string[]).includes(value as string);
const code = (error: unknown) => (error as { code?: string } | null)?.code;

const DEFAULTS = {
	kind: 'sterile',
	budCategory: 'unassigned',
	defaultStorage: 'controlled_room'
} as const;

async function formulaIn(db: PrismaClient, scopeId: string, id: string) {
	const formula = UUID.test(id)
		? await db.compoundFormula.findFirst({
				where: { id, scopeId },
				select: { id: true, status: true }
			})
		: null;
	if (!formula) throw new CompoundError('That compound does not exist.', 404);
	return formula;
}

async function draftIn(db: PrismaClient, scopeId: string, id: string) {
	const formula = await formulaIn(db, scopeId, id);
	if (formula.status !== 'draft')
		throw new CompoundError('This compound is saved. Edit it to unlock it first.', 409);
	return formula;
}

const duplicate = (name: string) =>
	new CompoundError(`A compound named "${name}" already exists.`, 409);

export async function listCompounds(db: PrismaClient, scopeId: string) {
	const rows = await db.compoundFormula.findMany({
		where: { scopeId },
		orderBy: { name: 'asc' },
		select: { id: true, name: true, status: true, _count: { select: { formulaSlots: true } } }
	});
	return rows.map((row) => ({
		id: row.id,
		name: row.name,
		status: row.status,
		components: row._count.formulaSlots
	}));
}

export async function loadCompound(
	db: PrismaClient,
	scopeId: string,
	id: string
): Promise<StoredCompound> {
	await formulaIn(db, scopeId, id);
	const formula = await db.compoundFormula.findFirstOrThrow({
		where: { id, scopeId },
		select: {
			id: true,
			name: true,
			status: true,
			route: true,
			totalVolumeWhole: true,
			totalVolumeNum: true,
			totalVolumeDen: true,
			formulaSlots: {
				orderBy: { ordinal: 'asc' },
				select: {
					id: true,
					role: true,
					targetAmountWhole: true,
					targetAmountNum: true,
					targetAmountDen: true,
					targetAmountUom: true,
					volumeWhole: true,
					volumeNum: true,
					volumeDen: true,
					vialPrep: true,
					formularyItemId: true,
					dosableComponent: {
						select: { id: true, displayName: true, nameOverride: true, route: true }
					},
					packageRestriction: {
						select: { reason: true, packages: { select: { packageId: true } } }
					},
					slotCandidates: {
						orderBy: { preferenceRank: 'asc' },
						select: { packageId: true, sourceConcMag: true, vialCount: true }
					}
				}
			}
		}
	});

	const lines: StoredLine[] = formula.formulaSlots.map((slot) => {
		const dose = fromMixed({
			whole: slot.targetAmountWhole,
			num: slot.targetAmountNum,
			den: slot.targetAmountDen
		});
		const volume = fromMixed({
			whole: slot.volumeWhole,
			num: slot.volumeNum,
			den: slot.volumeDen
		});
		const candidate = slot.slotCandidates[0];
		// Dose and volume are exact, so their quotient is the exact concentration;
		// the stored decimal only stands in when one of them is not set yet.
		const stored = candidate?.sourceConcMag ? fromNumber(Number(candidate.sourceConcMag)) : null;
		const conc = slot.role === 'diluent' ? null : dose && volume ? divide(dose, volume) : stored;
		return {
			slotId: slot.id,
			packageId: candidate?.packageId ?? '',
			packageIds: slot.slotCandidates.map((entry) => entry.packageId),
			vialCounts: slot.slotCandidates.flatMap((entry) =>
				entry.vialCount ? [{ packageId: entry.packageId, count: entry.vialCount }] : []
			),
			role: slot.role as Role,
			doseUnit: slot.targetAmountUom ?? 'mg',
			conc,
			dose,
			volume,
			vialPrep: parseAdoptedVialPrep(slot.vialPrep),
			component: slot.dosableComponent
				? { id: slot.dosableComponent.id, label: componentLabel(slot.dosableComponent) }
				: null,
			formularyItemId: slot.formularyItemId,
			restriction: slot.packageRestriction
				? {
						reason: slot.packageRestriction.reason,
						packageIds: slot.packageRestriction.packages.map((entry) => entry.packageId)
					}
				: null
		};
	});

	return {
		id: formula.id,
		name: formula.name,
		status: formula.status,
		locked: formula.status !== 'draft',
		route: isRoute(formula.route) ? formula.route : null,
		total: fromMixed({
			whole: formula.totalVolumeWhole,
			num: formula.totalVolumeNum,
			den: formula.totalVolumeDen
		}),
		lines
	};
}

export async function createCompound(db: PrismaClient, scopeId: string, name: string) {
	const parsed = parseCompoundName(name);
	if ('error' in parsed) throw new CompoundError(parsed.error);
	try {
		const created = await db.compoundFormula.create({
			data: { scopeId, name: parsed.name, ...DEFAULTS },
			select: { id: true }
		});
		return created.id;
	} catch (error) {
		if (code(error) === 'P2002') throw duplicate(parsed.name);
		throw error;
	}
}

/** Give a compound `base` as its name, suffixed " (2)", " (3)"… when another compound has it. */
export async function applyCompoundName(
	db: PrismaClient,
	scopeId: string,
	id: string,
	base: string
) {
	const others = await db.compoundFormula.findMany({
		where: { scopeId, id: { not: id }, name: { startsWith: base } },
		select: { name: true }
	});
	const name = uniqueName(base, new Set(others.map((other) => other.name)));
	await db.compoundFormula.update({ where: { id }, data: { name } });
	return name;
}

export async function renameCompound(db: PrismaClient, scopeId: string, id: string, name: string) {
	const parsed = parseCompoundName(name);
	if ('error' in parsed) throw new CompoundError(parsed.error);
	await draftIn(db, scopeId, id);
	try {
		await db.compoundFormula.update({ where: { id }, data: { name: parsed.name } });
	} catch (error) {
		if (code(error) === 'P2002') throw duplicate(parsed.name);
		throw error;
	}
}

export async function deleteCompound(db: PrismaClient, scopeId: string, id: string) {
	await draftIn(db, scopeId, id);
	try {
		await db.compoundFormula.delete({ where: { id } });
	} catch (error) {
		if (code(error) === 'P2003')
			throw new CompoundError('This compound has build plans and cannot be deleted.', 409);
		throw error;
	}
}

/**
 * Add a constituent: a drug + route, optionally pinned to one of its formulary
 * items and a subset of that item's NDCs. Its candidate packages are resolved
 * from that choice.
 */
export async function addComponent(
	db: PrismaClient,
	scopeId: string,
	id: string,
	input: Constraint & {
		role: Role;
		conc: Rational | null;
		doseUnit: string;
		reason?: string | null;
	}
) {
	await draftIn(db, scopeId, id);
	const conc = input.role === 'active' ? input.conc : null;
	// Checked before anything is written, so a choice that does not fit adds no line.
	const packageIds = await resolveConstraint(db, scopeId, input);
	const volume = input.role === 'diluent' ? await definedVolume(db, packageIds) : null;
	await db.$transaction(async (tx) => {
		const last = await tx.formulaSlot.aggregate({
			where: { formulaId: id },
			_max: { ordinal: true }
		});
		const slot = await tx.formulaSlot.create({
			data: {
				formulaId: id,
				role: input.role,
				ordinal: (last._max.ordinal ?? 0) + 1,
				targetAmountUom: input.doseUnit,
				volumeUom: VOLUME_UNIT,
				...(volume && {
					volumeWhole: volume.whole,
					volumeNum: volume.num,
					volumeDen: volume.den
				})
			},
			select: { id: true }
		});
		const [preferred] = await writeConstraint(tx, scopeId, slot.id, input);
		// The stated concentration belongs to the preferred package.
		if (conc)
			await tx.slotCandidate.update({
				where: { slotId_packageId: { slotId: slot.id, packageId: preferred } },
				data: { sourceConcMag: decimalOf(conc), sourceConcUom: `${input.doseUnit}/${VOLUME_UNIT}` }
			});
	});
}

/**
 * The one volume every allowed package holds (a 100 mL bag of NS), in mL, from its
 * container's labeled fill or else its nominal volume. Null when any package has no
 * volume or they disagree, so the line is left for the user to fill.
 */
async function definedVolume(db: PrismaClient, packageIds: string[]) {
	const specs = await db.containerSpec.findMany({
		where: { packageId: { in: packageIds } },
		select: {
			labeledFillMag: true,
			labeledFillUom: true,
			nominalVolumeMag: true,
			nominalVolumeUom: true
		}
	});
	if (specs.length !== packageIds.length) return null;
	const volumes = new Set(
		specs.map((spec) =>
			spec.labeledFillMag != null && spec.labeledFillUom === VOLUME_UNIT
				? spec.labeledFillMag.toString()
				: spec.nominalVolumeMag != null && spec.nominalVolumeUom === VOLUME_UNIT
					? spec.nominalVolumeMag.toString()
					: null
		)
	);
	if (volumes.size !== 1) return null;
	const [only] = volumes;
	const value = only == null ? NaN : Number(only);
	return Number.isFinite(value) && value > 0 ? toMixed(fromNumber(value)) : null;
}

/**
 * Pin a constituent to one formulary item and optionally a subset of its NDCs, or
 * loosen it back to any item of its drug + route.
 */
export async function setConstraint(
	db: PrismaClient,
	scopeId: string,
	id: string,
	slotId: string,
	input: { formularyItemId: string | null; packageIds: string[]; reason: string | null }
) {
	await draftIn(db, scopeId, id);
	const slot = UUID.test(slotId)
		? await db.formulaSlot.findFirst({
				where: { id: slotId, formulaId: id },
				select: { dosableComponentId: true }
			})
		: null;
	if (!slot) throw new CompoundError('That component no longer exists.', 404);
	if (!slot.dosableComponentId)
		throw new CompoundError(
			'Remove and re-add this component to choose its drug and route first.',
			409
		);
	const dosableComponentId = slot.dosableComponentId;
	await db.$transaction((tx) =>
		writeConstraint(tx, scopeId, slotId, { dosableComponentId, ...input })
	);
}

/** Replace every line's dose, volume and concentration, and the total, in one transaction. */
export async function saveLines(
	db: PrismaClient,
	scopeId: string,
	id: string,
	payload: LinesPayload
) {
	await draftIn(db, scopeId, id);
	await db.$transaction(async (tx) => {
		// Checked again inside the transaction: a save racing this one must not land on a locked compound.
		const current = await tx.compoundFormula.findFirst({
			where: { id, scopeId },
			select: { status: true }
		});
		if (current?.status !== 'draft')
			throw new CompoundError('This compound is saved. Edit it to unlock it first.', 409);
		const slots = await tx.formulaSlot.findMany({
			where: { formulaId: id },
			select: {
				id: true,
				role: true,
				targetAmountUom: true,
				slotCandidates: { take: 1, orderBy: { preferenceRank: 'asc' }, select: { packageId: true } }
			}
		});
		const byId = new Map(slots.map((slot) => [slot.id, slot]));

		for (const line of payload.lines) {
			const slot = byId.get(line.slotId);
			if (!slot)
				throw new CompoundError(
					'A component no longer exists. Reload the page and try again.',
					409
				);
			const dose = toMixed(line.dose);
			const volume = toMixed(line.volume);
			await tx.formulaSlot.update({
				where: { id: slot.id },
				data: {
					targetAmountWhole: dose.whole,
					targetAmountNum: dose.num,
					targetAmountDen: dose.den,
					volumeWhole: volume.whole,
					volumeNum: volume.num,
					volumeDen: volume.den
				}
			});
			const candidate = slot.slotCandidates[0];
			if (candidate && slot.role === 'active')
				await tx.slotCandidate.update({
					where: { slotId_packageId: { slotId: slot.id, packageId: candidate.packageId } },
					data: {
						sourceConcMag: line.conc ? decimalOf(line.conc) : null,
						sourceConcUom: line.conc ? `${slot.targetAmountUom ?? 'mg'}/${VOLUME_UNIT}` : null
					}
				});
		}

		const total = toMixed(payload.total);
		await tx.compoundFormula.update({
			where: { id },
			data: {
				totalVolumeWhole: total.whole,
				totalVolumeNum: total.num,
				totalVolumeDen: total.den,
				totalVolumeUom: payload.total ? VOLUME_UNIT : null
			}
		});
	});
}

export async function removeComponent(
	db: PrismaClient,
	scopeId: string,
	id: string,
	slotId: string
) {
	await draftIn(db, scopeId, id);
	const { count } = UUID.test(slotId)
		? await db.formulaSlot.deleteMany({ where: { id: slotId, formulaId: id } })
		: { count: 0 };
	if (count === 0) throw new CompoundError('That component no longer exists.', 404);
}

/** Lock a draft as finished, or unlock a saved compound for editing. */
export async function setSaved(db: PrismaClient, scopeId: string, id: string, saved: boolean) {
	const formula = await formulaIn(db, scopeId, id);
	if (saved) {
		if (formula.status !== 'draft') throw new CompoundError('This compound is already saved.', 409);
		const components = await db.formulaSlot.count({ where: { formulaId: id } });
		if (!components) throw new CompoundError('Add a component before saving.', 409);
		const { route } = await db.compoundFormula.findFirstOrThrow({
			where: { id },
			select: { route: true }
		});
		if (!isRoute(route)) throw new CompoundError('Choose a route before saving.', 409);
		await db.compoundFormula.update({ where: { id }, data: { status: 'saved' } });
		return;
	}
	if (formula.status !== 'saved') throw new CompoundError('This compound is not saved.', 409);
	await db.compoundFormula.update({ where: { id }, data: { status: 'draft' } });
}

/**
 * Set the compound's route. Adopted vial preparation steps stay stored, but the
 * page flags any the labels no longer agree on for the new route.
 */
export async function setRoute(db: PrismaClient, scopeId: string, id: string, route: unknown) {
	if (!isRoute(route)) throw new CompoundError(`Choose a route: ${INJECTION_ROUTES.join(', ')}.`);
	await draftIn(db, scopeId, id);
	await db.compoundFormula.update({ where: { id }, data: { route } });
}

/**
 * Adopt a vial preparation step into components, or clear it (`prep` null).
 * Only a draft takes it: a saved compound's procedure is fixed.
 */
export async function setVialPrep(
	db: PrismaClient,
	scopeId: string,
	id: string,
	slotIds: string[],
	prep: AdoptedVialPrep | null
) {
	await draftIn(db, scopeId, id);
	const ids = slotIds.filter((slotId) => UUID.test(slotId));
	const { count } = ids.length
		? await db.formulaSlot.updateMany({
				where: { id: { in: ids }, formulaId: id },
				data: { vialPrep: prep ? (prep as unknown as Prisma.InputJsonValue) : Prisma.DbNull }
			})
		: { count: 0 };
	if (count === 0) throw new CompoundError('That component no longer exists.', 404);
}

/**
 * Record the vial combination picked for a component: how many vials of each of
 * its packages are pulled. Packages left out pull none; an empty list clears the pick.
 */
export async function setVialCounts(
	db: PrismaClient,
	scopeId: string,
	id: string,
	slotId: string,
	picks: { packageId: string; count: number }[]
) {
	await draftIn(db, scopeId, id);
	const slot = UUID.test(slotId)
		? await db.formulaSlot.findFirst({
				where: { id: slotId, formulaId: id },
				select: { slotCandidates: { select: { packageId: true } } }
			})
		: null;
	if (!slot) throw new CompoundError('That component no longer exists.', 404);
	const known = new Set(slot.slotCandidates.map((candidate) => candidate.packageId));
	const counts = new Map<string, number>();
	for (const pick of picks) {
		if (
			!known.has(pick.packageId) ||
			!Number.isInteger(pick.count) ||
			pick.count < 1 ||
			pick.count > 99
		)
			throw new CompoundError(
				'That vial combination no longer fits this component. Reload and try again.',
				409
			);
		counts.set(pick.packageId, pick.count);
	}
	await db.$transaction(
		[...known].map((packageId) =>
			db.slotCandidate.update({
				where: { slotId_packageId: { slotId, packageId } },
				data: { vialCount: counts.get(packageId) ?? null }
			})
		)
	);
}
