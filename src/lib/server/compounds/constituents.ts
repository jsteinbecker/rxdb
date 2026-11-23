/**
 * What a compound constituent may be filled from. A constituent names a dosable
 * component (a drug given by one route: "Ampicillin IV") and may be pinned to one
 * of its formulary items ("NS 500 mL" for the diluent bag), and further to a
 * hand-picked subset of that item's NDCs ("non-DEHP-confirmed D5W bags only").
 * The packages the line can be pulled from are resolved down that chain and kept
 * as the slot's candidates.
 *
 * @module
 */
import type { Prisma, PrismaClient } from '../../../generated/client';
import { CompoundError } from './errors';

type Db = PrismaClient | Prisma.TransactionClient;

export interface Constraint {
	dosableComponentId: string;
	/** Only this formulary item; null admits every item of the component. */
	formularyItemId: string | null;
	/** Only these packages of `formularyItemId`; empty admits all of its packages. */
	packageIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A component's name as the builder shows it: "Ampicillin IV". */
export const componentLabel = (component: {
	displayName: string;
	nameOverride: string | null;
	route: string;
}) => `${component.nameOverride ?? component.displayName} ${component.route}`;

/** The live dosable components of a scope given by `route`, keyed by each of their formulary items. */
export async function componentsByItem(db: Db, scopeId: string, route: string | null) {
	const links = route
		? await db.dosableComponentItem.findMany({
				where: { retiredAt: null, dosableComponent: { scopeId, route, retiredAt: null } },
				select: {
					formularyItemId: true,
					dosableComponent: {
						select: { id: true, displayName: true, nameOverride: true, route: true }
					}
				}
			})
		: [];
	return new Map(
		links.map((link) => [
			link.formularyItemId,
			{ id: link.dosableComponent.id, name: componentLabel(link.dosableComponent) }
		])
	);
}

/**
 * The packages a constraint admits, in preference order (formulary item, then the
 * item's own package rank). Throws when the constraint does not fit the formulary.
 */
export async function resolveConstraint(
	db: Db,
	scopeId: string,
	constraint: Constraint
): Promise<string[]> {
	const { dosableComponentId, formularyItemId } = constraint;
	if (!UUID.test(dosableComponentId))
		throw new CompoundError('Choose a drug and route to add.', 400);
	const component = await db.dosableComponent.findFirst({
		where: { id: dosableComponentId, scopeId, retiredAt: null },
		select: {
			items: {
				where: { retiredAt: null },
				select: {
					formularyItemId: true,
					formularyItem: {
						select: {
							displayName: true,
							formularyItemPackages: {
								where: { validTo: null },
								orderBy: { preferenceRank: 'asc' },
								select: { packageId: true }
							}
						}
					}
				}
			}
		}
	});
	if (!component)
		throw new CompoundError('That drug and route is no longer on this formulary.', 404);
	const items = [...component.items].sort((a, b) =>
		a.formularyItem.displayName.localeCompare(b.formularyItem.displayName)
	);
	let packageIds: string[];
	if (formularyItemId) {
		const item = items.find((entry) => entry.formularyItemId === formularyItemId);
		if (!item)
			throw new CompoundError(
				'That formulary item is not one of this drug and route’s items.',
				409
			);
		packageIds = item.formularyItem.formularyItemPackages.map((link) => link.packageId);
		const subset = [...new Set(constraint.packageIds)];
		if (subset.length) {
			if (subset.some((packageId) => !packageIds.includes(packageId)))
				throw new CompoundError('Only NDCs of the chosen formulary item can be allowed.', 409);
			packageIds = packageIds.filter((packageId) => subset.includes(packageId));
		}
	} else {
		if (constraint.packageIds.length)
			throw new CompoundError('Choose a formulary item before narrowing to NDCs.', 400);
		packageIds = [
			...new Set(
				items.flatMap((item) =>
					item.formularyItem.formularyItemPackages.map((link) => link.packageId)
				)
			)
		];
	}
	if (!packageIds.length)
		throw new CompoundError('No package on the formulary fits that choice.', 409);
	return packageIds;
}

/**
 * Write a constraint onto a slot: its component, required item and NDC subset, and
 * the candidate packages they resolve to. Candidates that stay keep their vial
 * count and stated concentration.
 */
export async function writeConstraint(
	tx: Prisma.TransactionClient,
	scopeId: string,
	slotId: string,
	constraint: Constraint & { reason?: string | null }
) {
	const packageIds = await resolveConstraint(tx, scopeId, constraint);
	const subset = constraint.formularyItemId ? [...new Set(constraint.packageIds)] : [];
	await tx.formulaSlotPackageRestriction.deleteMany({ where: { slotId } });
	await tx.formulaSlot.update({
		where: { id: slotId },
		data: {
			dosableComponentId: constraint.dosableComponentId,
			formularyItemId: constraint.formularyItemId
		}
	});
	if (subset.length)
		await tx.formulaSlotPackageRestriction.create({
			data: {
				slotId,
				mode: 'manual',
				reason: constraint.reason?.trim() || null,
				packages: { create: subset.map((packageId) => ({ packageId, source: 'manual' })) }
			}
		});
	await tx.slotCandidate.deleteMany({ where: { slotId, packageId: { notIn: packageIds } } });
	const kept = new Set(
		(await tx.slotCandidate.findMany({ where: { slotId }, select: { packageId: true } })).map(
			(candidate) => candidate.packageId
		)
	);
	for (const [index, packageId] of packageIds.entries())
		if (kept.has(packageId))
			await tx.slotCandidate.update({
				where: { slotId_packageId: { slotId, packageId } },
				data: { preferenceRank: index + 1 }
			});
		else await tx.slotCandidate.create({ data: { slotId, packageId, preferenceRank: index + 1 } });
	return packageIds;
}
