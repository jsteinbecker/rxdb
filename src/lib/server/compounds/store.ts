/**
 * Persistence for compounds: create, rename, delete, add and remove components,
 * save lines, and lock a finished compound.
 *
 * @module
 */
import type { PrismaClient } from '../../../generated/client';
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
import { divide, fromNumber, type Rational } from '../../medication/rational';

/** A failure with a message fit to show the technician, and the status to send with it. */
export class CompoundError extends Error {
	constructor(
		message: string,
		readonly status = 400
	) {
		super(message);
	}
}

export type StoredLine = Omit<Line, 'label'> & { packageId: string };
export interface StoredCompound {
	id: string;
	name: string;
	status: string;
	locked: boolean;
	total: Rational | null;
	lines: StoredLine[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
					slotCandidates: { take: 1, select: { packageId: true, sourceConcMag: true } }
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
			role: slot.role as Role,
			doseUnit: slot.targetAmountUom ?? 'mg',
			conc,
			dose,
			volume
		};
	});

	return {
		id: formula.id,
		name: formula.name,
		status: formula.status,
		locked: formula.status !== 'draft',
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

export async function addComponent(
	db: PrismaClient,
	scopeId: string,
	id: string,
	input: { packageId: string; role: Role; conc: Rational | null; doseUnit: string }
) {
	await draftIn(db, scopeId, id);
	const linked = UUID.test(input.packageId)
		? await db.formularyItemPackage.findFirst({
				where: { packageId: input.packageId, validTo: null, formularyItem: { scopeId } },
				select: { packageId: true }
			})
		: null;
	if (!linked) throw new CompoundError('That package is not on this formulary.', 404);

	const last = await db.formulaSlot.aggregate({
		where: { formulaId: id },
		_max: { ordinal: true }
	});
	const conc = input.role === 'active' ? input.conc : null;
	await db.formulaSlot.create({
		data: {
			formulaId: id,
			role: input.role,
			ordinal: (last._max.ordinal ?? 0) + 1,
			targetAmountUom: input.doseUnit,
			volumeUom: VOLUME_UNIT,
			slotCandidates: {
				create: {
					packageId: input.packageId,
					sourceConcMag: conc ? decimalOf(conc) : null,
					sourceConcUom: conc ? `${input.doseUnit}/${VOLUME_UNIT}` : null
				}
			}
		}
	});
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
				slotCandidates: { take: 1, select: { packageId: true } }
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
		await db.compoundFormula.update({ where: { id }, data: { status: 'saved' } });
		return;
	}
	if (formula.status !== 'saved') throw new CompoundError('This compound is not saved.', 409);
	await db.compoundFormula.update({ where: { id }, data: { status: 'draft' } });
}
