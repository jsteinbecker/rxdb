import { error, fail, redirect } from '@sveltejs/kit';
import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import { formularyRows } from '$lib/server/formulary-view';
import { packageTitle } from '$lib/package-title';
import {
	addComponent,
	CompoundError,
	deleteCompound,
	loadCompound,
	removeComponent,
	renameCompound,
	saveLines,
	setSaved
} from '$lib/server/compound-store';
import { packageConcentration, parseLinesPayload, type Role } from '$lib/compound-builder';
import { parseRational, serializeRational } from '$lib/rational';
import type { Actions, PageServerLoad } from './$types';

/** Run a store call; a CompoundError becomes a notice, anything else is a real failure. */
async function run(work: () => Promise<unknown>) {
	try {
		await work();
	} catch (cause) {
		if (cause instanceof CompoundError) return fail(cause.status, { message: cause.message });
		throw cause;
	}
}

export const load: PageServerLoad = async ({ params }) => {
	const scope = await defaultScope(prisma);
	let compound;
	try {
		compound = await loadCompound(prisma, scope.id, params.id);
	} catch (cause) {
		if (cause instanceof CompoundError) error(cause.status, cause.message);
		throw cause;
	}
	const rows = await formularyRows(prisma, scope.id);
	const byPackage = new Map(rows.map((row) => [row.packageId, row]));
	const title = (packageId: string) => {
		const row = byPackage.get(packageId);
		return row ? packageTitle(row) : 'Package no longer on the formulary';
	};
	return {
		scope: { id: scope.id, name: scope.name },
		compound: {
			...compound,
			lines: compound.lines.map((line) => ({ ...line, label: title(line.packageId) }))
		},
		candidates: rows.map((row) => {
			const found = packageConcentration(row.ingredients);
			return {
				packageId: row.packageId,
				ndc: row.ndc,
				title: packageTitle(row),
				conc: found ? serializeRational(found.conc) : null,
				doseUnit: found?.doseUnit ?? null
			};
		})
	};
};

export const actions: Actions = {
	rename: async ({ params, request }) => {
		const name = (await request.formData()).get('name');
		const scope = await defaultScope(prisma);
		return run(() => renameCompound(prisma, scope.id, params.id, typeof name === 'string' ? name : ''));
	},
	add: async ({ params, request }) => {
		const data = await request.formData();
		let picked: { packageId?: unknown; conc?: unknown; doseUnit?: unknown } = {};
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
				packageId: typeof picked.packageId === 'string' ? picked.packageId : '',
				role,
				conc: conc && conc.n > 0 ? conc : null,
				doseUnit: typeof picked.doseUnit === 'string' && picked.doseUnit ? picked.doseUnit : 'mg'
			})
		);
	},
	saveLines: async ({ params, request }) => {
		const payload = parseLinesPayload((await request.formData()).get('payload'));
		if ('error' in payload) return fail(400, { message: payload.error });
		const scope = await defaultScope(prisma);
		return run(() => saveLines(prisma, scope.id, params.id, payload));
	},
	remove: async ({ params, request }) => {
		const slotId = (await request.formData()).get('slotId');
		const scope = await defaultScope(prisma);
		return run(() => removeComponent(prisma, scope.id, params.id, typeof slotId === 'string' ? slotId : ''));
	},
	setSaved: async ({ params, request }) => {
		const saved = (await request.formData()).get('saved') === 'true';
		const scope = await defaultScope(prisma);
		return run(() => setSaved(prisma, scope.id, params.id, saved));
	},
	delete: async ({ params }) => {
		const scope = await defaultScope(prisma);
		const failed = await run(() => deleteCompound(prisma, scope.id, params.id));
		if (failed) return failed;
		redirect(303, '/compounds');
	}
};
