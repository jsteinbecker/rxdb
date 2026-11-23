import { fail, isHttpError } from '@sveltejs/kit';
import { isUuid } from '#lib/formulary/pharm-class-rule-input.ts';
import { prisma } from '#lib/server/infrastructure/database.ts';
import { defaultScope } from '#lib/server/formulary/membership.ts';
import { parseSettings } from '#lib/formulary/settings.ts';
import {
	countMatchesForRules,
	deleteRule,
	knownClasses,
	listRules,
	RuleInputError,
	upsertRule
} from '#lib/server/curation/pharm-class-rule-store.ts';
import { toNdc11 } from '#lib/catalog/ndc.ts';
import { syncExternalPackages } from '#lib/server/catalog/sync.ts';
import { pharmClassRulesFor } from '#lib/server/catalog/package-detail.ts';
import { packageClassKey } from '#lib/formulary/pharm-class-key.ts';
import { scopeOptions } from '#lib/formulary/pharm-class-scope-options.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
	const scope = await defaultScope(prisma);
	const rules = await listRules(prisma, scope.id);
	// `?ndc=` starts a new rule: the scope choices come from that package's class key.
	const ndcParam = url.searchParams.get('ndc')?.trim() ?? '';
	const ndc = ndcParam ? toNdc11(ndcParam) : null;
	let newRule: {
		ndc: string;
		error: string | null;
		rules: ReturnType<typeof pharmClassRulesFor> | null;
	} | null = null;
	if (ndcParam && !ndc) newRule = { ndc: ndcParam, error: 'Invalid NDC.', rules: null };
	else if (ndc) {
		const [item] = await syncExternalPackages([ndc]);
		newRule = item
			? { ndc, error: null, rules: pharmClassRulesFor(scope.id, item) }
			: { ndc, error: 'No package data available for that NDC.', rules: null };
	}
	return {
		newRule,
		scope: { id: scope.id, name: scope.name },
		settings: parseSettings(scope.settings),
		rules: rules.map((rule) => ({
			id: rule.id,
			moietyNames: rule.moietyNames,
			doseFormGroup: rule.doseFormGroup,
			route: rule.route,
			strengthKey: rule.strengthKey,
			mode: rule.mode,
			classes: rule.classes,
			note: rule.note
		})),
		// Streamed: counting matches scans the cached snapshots, so the table renders without it.
		matches: countMatchesForRules(prisma, rules).then((counts) =>
			rules.map((rule) => counts.get(rule.id) ?? { count: 0, capped: false })
		),
		known: knownClasses(prisma)
	};
};

export const actions: Actions = {
	/** Edits a rule's mode, classes and note; its key is the stored one, never client-supplied. */
	pharmClassRule: async ({ request }) => {
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const mode = String(form.get('mode') ?? '');
		if (mode !== 'replace' && mode !== 'add' && mode !== 'suppress')
			return fail(400, { action: 'pharmClassRule', message: 'Choose replace, add or hide.' });
		const scopeId = (await defaultScope(prisma)).id;
		const classes = form.getAll('classes').map(String);
		const note = String(form.get('note') ?? '').trim() || null;
		if (!id) return createFromNdc(scopeId, form, mode, classes, note);
		if (!isUuid(id)) return fail(404, { action: 'pharmClassRule', message: 'Rule not found.' });
		const rule = await prisma.pharmClassRule.findFirst({ where: { id, scopeId } });
		if (!rule) return fail(404, { action: 'pharmClassRule', message: 'Rule not found.' });
		try {
			await upsertRule(prisma, scopeId, {
				moietyKey: rule.moietyKey,
				moietyNames: rule.moietyNames,
				doseFormGroup: rule.doseFormGroup,
				route: rule.route,
				strengthKey: rule.strengthKey,
				mode,
				classes,
				note
			});
			return { pharmClassRuleSaved: true };
		} catch (cause) {
			if (cause instanceof RuleInputError)
				return fail(400, { action: 'pharmClassRule', message: cause.message });
			throw cause;
		}
	},
	pharmClassRuleDelete: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { action: 'pharmClassRuleDelete', message: 'No rule chosen.' });
		try {
			await deleteRule(prisma, (await defaultScope(prisma)).id, id);
		} catch (cause) {
			// A stale list (the rule is already gone) is not an error: the refreshed list shows the outcome.
			if (isHttpError(cause, 404))
				return { pharmClassRuleSaved: true, notice: 'That rule was already deleted.' };
			throw cause;
		}
		return { pharmClassRuleSaved: true };
	}
};

/** A new rule keyed by an NDC's class key at the chosen scope; the key is derived server-side. */
async function createFromNdc(
	scopeId: string,
	form: FormData,
	mode: 'replace' | 'add' | 'suppress',
	classes: string[],
	note: string | null
) {
	const ndc = toNdc11(String(form.get('ndc') ?? ''));
	if (!ndc) return fail(400, { action: 'pharmClassRule', message: 'No rule or NDC chosen.' });
	const [item] = await syncExternalPackages([ndc]);
	if (!item) return fail(404, { action: 'pharmClassRule', message: 'No package data available.' });
	const classKey = packageClassKey(item);
	const option = scopeOptions(classKey).find((candidate) => candidate.id === form.get('scope'));
	if (!option)
		return fail(400, { action: 'pharmClassRule', message: 'Choose where the rule applies.' });
	try {
		await upsertRule(prisma, scopeId, {
			moietyKey: classKey.moietyKey,
			moietyNames: classKey.moietyNames,
			doseFormGroup: option.doseFormGroup,
			route: option.route,
			strengthKey: option.strengthKey,
			mode,
			classes,
			note
		});
		return { pharmClassRuleSaved: true };
	} catch (cause) {
		if (cause instanceof RuleInputError)
			return fail(400, { action: 'pharmClassRule', message: cause.message });
		throw cause;
	}
}
