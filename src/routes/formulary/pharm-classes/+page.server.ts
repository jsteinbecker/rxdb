import { fail } from '@sveltejs/kit';
import { isUuid } from '$lib/pharm-class-rule-input';
import { prisma } from '$lib/server/prisma';
import { defaultScope } from '$lib/server/catalog-formulary';
import {
	countMatchesForRules,
	deleteRule,
	knownClasses,
	listRules,
	RuleInputError,
	upsertRule
} from '$lib/server/pharm-class-rule-store';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const scope = await defaultScope(prisma);
	const rules = await listRules(prisma, scope.id);
	return {
		scope: { id: scope.id, name: scope.name },
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
		if (!id) return fail(400, { message: 'No rule chosen.' });
		if (!isUuid(id)) return fail(404, { message: 'Rule not found.' });
		const mode = String(form.get('mode') ?? '');
		if (mode !== 'replace' && mode !== 'add' && mode !== 'suppress')
			return fail(400, { message: 'Choose replace, add or hide.' });
		const scopeId = (await defaultScope(prisma)).id;
		const rule = await prisma.pharmClassRule.findFirst({ where: { id, scopeId } });
		if (!rule) return fail(404, { message: 'Rule not found.' });
		try {
			await upsertRule(prisma, scopeId, {
				moietyKey: rule.moietyKey,
				moietyNames: rule.moietyNames,
				doseFormGroup: rule.doseFormGroup,
				route: rule.route,
				strengthKey: rule.strengthKey,
				mode,
				classes: form.getAll('classes').map(String),
				note: String(form.get('note') ?? '').trim() || null
			});
			return { pharmClassRuleSaved: true };
		} catch (cause) {
			if (cause instanceof RuleInputError) return fail(400, { message: cause.message });
			throw cause;
		}
	},
	pharmClassRuleDelete: async ({ request }) => {
		const id = String((await request.formData()).get('id') ?? '');
		if (!id) return fail(400, { message: 'No rule chosen.' });
		await deleteRule(prisma, (await defaultScope(prisma)).id, id);
		return { pharmClassRuleSaved: true };
	}
};
