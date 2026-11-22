import { error, fail, redirect } from '@sveltejs/kit';
import { prisma } from '#lib/server/infrastructure/database.ts';
import { defaultScope, loadedItems, localNamesOf } from '#lib/server/formulary/membership.ts';
import { formularyRows } from '#lib/server/formulary/read.ts';
import { packageTitle } from '#lib/catalog/package-title.ts';
import { applyStrengthStyles } from '#lib/medication/strength-style.ts';
import { parseSettings } from '#lib/formulary/settings.ts';
import {
	addComponent,
	CompoundError,
	deleteCompound,
	loadCompound,
	removeComponent,
	saveLines,
	setRoute,
	setSaved,
	setVialPrep
} from '#lib/server/compounds/store.ts';
import { refreshCompoundName } from '#lib/server/compounds/naming.ts';
import {
	packageConcentration,
	parseLinesPayload,
	type Role
} from '#lib/compounds/compound-builder.ts';
import { parseRational, serializeRational } from '#lib/medication/rational.ts';
import { genericName, injectionRoutes, vialContent } from '#lib/compounds/generic-components.ts';
import { loadPackageSnapshots } from '#lib/server/catalog/snapshot-store.ts';
import { sameConsensusStep, vialPrepConsensus } from '#lib/compounds/vial-prep-consensus.ts';
import type { Actions, PageServerLoad } from './$types';

/** Run a store call; a CompoundError becomes a notice, anything else is a real failure. */
async function run(work: () => Promise<unknown>, id?: string) {
	try {
		await work();
		// Components changed: the name follows them.
		if (id) await refreshCompoundName(prisma, id);
	} catch (cause) {
		if (cause instanceof CompoundError) return fail(cause.status, { message: cause.message });
		throw cause;
	}
}

/** The compound, its formulary rows, and the vial preparation consensus for each active item. */
async function analyze(scopeId: string, id: string, settings: unknown) {
	let compound;
	try {
		compound = await loadCompound(prisma, scopeId, id);
	} catch (cause) {
		if (cause instanceof CompoundError) error(cause.status, cause.message);
		throw cause;
	}
	const rows = await formularyRows(prisma, scopeId, localNamesOf(await loadedItems(prisma, scopeId)));
	const byPackage = new Map(rows.map((row) => [row.packageId, row]));
	const styles = parseSettings(settings).strengthStyles;
	const shownTitle = (row: (typeof rows)[number]) => applyStrengthStyles(packageTitle(row), styles);
	// Every package the formulary item admits may be pulled to make this
	// compound, so preparation is analyzed across all of them, not just the one picked.
	const activeItems = [
		...new Set(
			compound.lines.flatMap((line) =>
				line.role === 'active'
					? line.packageIds.flatMap((packageId) => {
							const item = byPackage.get(packageId)?.formularyItemId;
							return item ? [item] : [];
						})
					: []
			)
		)
	];
	const allowed = rows.filter((row) => activeItems.includes(row.formularyItemId));
	const snapshots = await loadPackageSnapshots(
		prisma,
		allowed.map((row) => row.ndc),
		{ withoutLabel: true }
	);
	const vialPrep = activeItems.map((itemId) => {
		const members = allowed.filter((row) => row.formularyItemId === itemId);
		const lines = compound.lines.filter((line) =>
			line.packageIds.some((packageId) => byPackage.get(packageId)?.formularyItemId === itemId)
		);
		const consensus = vialPrepConsensus(
			members.map((row) => {
				const item = snapshots.get(row.ndc)?.item;
				return {
					packageId: row.packageId,
					ndc: row.ndc,
					title: shownTitle(row),
					isDryFill: item ? item.isDryFill : null,
					reconstitution: item?.reconstitution ?? []
				};
			}),
			// The route picks between label steps that differ by route.
			compound.route
		);
		const adopted = lines.find((line) => line.vialPrep)?.vialPrep ?? null;
		const steps = consensus.status === 'not-needed' ? [] : consensus.steps;
		return {
			itemId,
			item: members[0].formularyItem,
			slotIds: lines.map((line) => line.slotId),
			consensus,
			adopted,
			// Labels re-read since adoption may no longer agree on the stored step.
			adoptedCurrent: adopted ? steps.some((step) => sameConsensusStep(step, adopted.step)) : null
		};
	});
	return { compound, rows, byPackage, shownTitle, vialPrep };
}

export const load: PageServerLoad = async ({ params }) => {
	const scope = await defaultScope(prisma);
	const { compound, rows, byPackage, shownTitle, vialPrep } = await analyze(
		scope.id,
		params.id,
		scope.settings
	);
	const title = (packageId: string) => {
		const row = byPackage.get(packageId);
		return row ? shownTitle(row) : 'Package no longer on the formulary';
	};
	/** A generic line is named for its drug and route ("Ampicillin IV"); a single package by its title. */
	const lineLabel = (packageIds: string[]) => {
		if (packageIds.length < 2) return title(packageIds[0] ?? '');
		const row = byPackage.get(packageIds[0]);
		const name = row ? genericName(row.ingredients) : null;
		return name ? `${name}${compound.route ? ` ${compound.route}` : ''}` : title(packageIds[0]);
	};
	const vialsOf = (packageIds: string[]) =>
		packageIds.flatMap((packageId) => {
			const row = byPackage.get(packageId);
			const content = row ? vialContent(row.ingredients) : null;
			return row && content
				? [
						{
							packageId,
							ndc: row.ndc,
							title: shownTitle(row),
							amount: serializeRational(content.amount),
							unit: content.unit
						}
					]
				: [];
		});
	return {
		vialPrep,
		scope: { id: scope.id, name: scope.name },
		compound: {
			...compound,
			lines: compound.lines.map((line) => ({
				...line,
				label: lineLabel(line.packageIds),
				vials: vialsOf(line.packageIds)
			}))
		},
		candidates: rows.map((row) => {
			const found = packageConcentration(row.ingredients);
			const content = vialContent(row.ingredients);
			return {
				generic: genericName(row.ingredients),
				routes: injectionRoutes(row.routes),
				vial: content ? serializeRational(content.amount) : null,
				vialUnit: content?.unit ?? null,
				packageId: row.packageId,
				itemId: row.formularyItemId,
				item: row.formularyItem,
				rank: row.preferenceRank,
				ndc: row.ndc,
				title: shownTitle(row),
				conc: found ? serializeRational(found.conc) : null,
				doseUnit: found?.doseUnit ?? null
			};
		})
	};
};

export const actions: Actions = {
	add: async ({ params, request }) => {
		const data = await request.formData();
		let picked: { packageId?: unknown; packageIds?: unknown; conc?: unknown; doseUnit?: unknown } = {};
		try {
			picked = JSON.parse(String(data.get('candidate')));
		} catch {
			return fail(400, { message: 'Choose a package to add.' });
		}
		const role: Role = data.get('role') === 'diluent' ? 'diluent' : 'active';
		const conc = parseRational(picked.conc);
		const scope = await defaultScope(prisma);
		return run(() =>
			addComponent(prisma, scope.id, params.id, {
				packageIds: Array.isArray(picked.packageIds)
					? picked.packageIds.filter((value): value is string => typeof value === 'string')
					: typeof picked.packageId === 'string'
						? [picked.packageId]
						: [],
				role,
				conc: conc && conc.n > 0 ? conc : null,
				doseUnit: typeof picked.doseUnit === 'string' && picked.doseUnit ? picked.doseUnit : 'mg'
			}),
			params.id
		);
	},
	saveLines: async ({ params, request }) => {
		const payload = parseLinesPayload((await request.formData()).get('payload'));
		if ('error' in payload) return fail(400, { message: payload.error });
		const scope = await defaultScope(prisma);
		return run(() => saveLines(prisma, scope.id, params.id, payload), params.id);
	},
	remove: async ({ params, request }) => {
		const slotId = (await request.formData()).get('slotId');
		const scope = await defaultScope(prisma);
		return run(() => removeComponent(prisma, scope.id, params.id, typeof slotId === 'string' ? slotId : ''), params.id);
	},
	setSaved: async ({ params, request }) => {
		const saved = (await request.formData()).get('saved') === 'true';
		const scope = await defaultScope(prisma);
		return run(() => setSaved(prisma, scope.id, params.id, saved));
	},
	setRoute: async ({ params, request }) => {
		const route = (await request.formData()).get('route');
		const scope = await defaultScope(prisma);
		return run(() => setRoute(prisma, scope.id, params.id, route));
	},
	adoptVialPrep: async ({ params, request }) => {
		const data = await request.formData();
		const itemId = String(data.get('itemId') ?? '');
		const index = Number(data.get('step'));
		const scope = await defaultScope(prisma);
		const { compound, vialPrep } = await analyze(scope.id, params.id, scope.settings);
		if (!compound.route)
			return fail(409, { message: 'Choose a route before adopting a vial preparation step.' });
		const entry = vialPrep.find((candidate) => candidate.itemId === itemId);
		if (!entry) return fail(404, { message: 'That component no longer exists.' });
		const result = entry.consensus;
		// Recomputed here: only a step the labels agree on now can be adopted.
		const step = result.status === 'not-needed' ? undefined : result.steps[index];
		if (!step || result.status === 'not-needed')
			return fail(409, { message: 'The labels no longer agree on that step. Reload and try again.' });
		return run(() =>
			setVialPrep(prisma, scope.id, params.id, entry.slotIds, {
				step,
				ndcs: result.voters.map((pkg) => pkg.ndc),
				adoptedAt: new Date().toISOString()
			})
		);
	},
	clearVialPrep: async ({ params, request }) => {
		const slotIds = (await request.formData()).getAll('slotId').map(String);
		const scope = await defaultScope(prisma);
		return run(() => setVialPrep(prisma, scope.id, params.id, slotIds, null));
	},
	delete: async ({ params }) => {
		const scope = await defaultScope(prisma);
		const failed = await run(() => deleteCompound(prisma, scope.id, params.id));
		if (failed) return failed;
		redirect(303, '/compounds');
	}
};
