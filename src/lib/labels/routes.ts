/**
 * Reading routes of administration from product names, dose-form labels and label
 * prose, folded into one route vocabulary.
 *
 * @module
 */

/** Route words in short product names and dosage-form labels. */
export function routesFromProductText(text: string): string[] {
	const routes: [RegExp, string][] = [
		[/\b(?:intravenous|\bIV\b)\b/i, 'INTRAVENOUS'],
		[/\b(?:intramuscular|\bIM\b)\b/i, 'INTRAMUSCULAR'],
		[/\b(?:subcutaneous|\bSC\b|\bSQ\b)\b/i, 'SUBCUTANEOUS'],
		[/\binjection\s*,\s*powder\s*,?\s*for\s+solution\b/i, 'INJECTION'],
		[/\b(?:oral(?:\s+(?:use|administration))?|by mouth|per os|\bPO\b)\b/i, 'ORAL'],
		[/\b(?:topical|cutaneous|transdermal|onto the skin)\b/i, 'TOPICAL'],
		[/\b(?:intranasal|nasal\s+(?:spray|solution|gel|drops|administration|route|use))\b/i, 'NASAL'],
		[/\b(?:inhalation|inhaled|nebuliz(?:ed|ation))\b/i, 'RESPIRATORY (INHALATION)'],
		[
			/\b(?:ophthalmic\s+(?:solution|suspension|ointment|gel|drops|administration|route|use)|into the eye|ocular\s+(?:administration|route|use))\b/i,
			'OPHTHALMIC'
		],
		[/\b(?:otic|into the ear)\b/i, 'OTIC'],
		[
			/\b(?:rectal\s+(?:suppository|enema|solution|cream|gel|administration|route|use)|per rectum)\b/i,
			'RECTAL'
		],
		[
			/\b(?:vaginal\s+(?:tablet|cream|gel|insert|suppository|administration|route|use)|intravaginal)\b/i,
			'VAGINAL'
		],
		[/\b(?:buccal|oromucosal)\b/i, 'BUCCAL'],
		[/\bsublingual\b/i, 'SUBLINGUAL'],
		[/\bintradermal\b/i, 'INTRADERMAL'],
		[/\bintrathecal\b/i, 'INTRATHECAL'],
		[/\bintra-?articular\b/i, 'INTRA-ARTICULAR'],
		[/\bintraperitoneal\b/i, 'INTRAPERITONEAL'],
		[/\b(?:intraocular\s+(?:injection|administration|route|use)|into the eye)\b/i, 'INTRAOCULAR'],
		[/\burethral\s+(?:gel|solution|administration|route|use)\b/i, 'URETHRAL']
	];
	return routes.flatMap(([pattern, route]) => (pattern.test(text) ? [route] : []));
}

/** Route statements in long label prose. Incidental mentions of a body site,
 * infection, or another medicine do not establish how this product is given. */
export function routesFromLabelText(text: string): string[] {
	const routes: [RegExp, string][] = [
		[
			/\b(?:by mouth|per os|orally administered|administer(?:ed)? orally|for oral use|oral administration)\b/i,
			'ORAL'
		],
		[
			/\b(?:intravenously|by intravenous (?:infusion|injection)|intravenous (?:administration|infusion|injection|use|route))\b/i,
			'INTRAVENOUS'
		],
		[
			/\b(?:intramuscularly|by intramuscular injection|intramuscular (?:administration|injection|use|route))\b/i,
			'INTRAMUSCULAR'
		],
		[
			/\b(?:subcutaneously|by subcutaneous injection|subcutaneous (?:administration|injection|use|route))\b/i,
			'SUBCUTANEOUS'
		],
		[
			/\b(?:apply|applied|administer(?:ed)?|use)\b.{0,50}\b(?:topically|to the skin|onto the skin)\b|\bfor topical use\b/i,
			'TOPICAL'
		],
		[
			/\b(?:intranasally|administer(?:ed)? intranasally|for intranasal use|nasal administration|into (?:the )?nostrils)\b/i,
			'NASAL'
		],
		[
			/\b(?:inhaled|inhalation|nebuliz(?:ed|ation)|administer(?:ed)? by inhalation)\b/i,
			'RESPIRATORY (INHALATION)'
		],
		[
			/\b(?:ophthalmic administration|for ophthalmic use|administer(?:ed)? into (?:the )?eye|instill(?:ed)? into (?:the )?eye)\b/i,
			'OPHTHALMIC'
		],
		[
			/\b(?:otic administration|for otic use|administer(?:ed)? into (?:the )?ear|instill(?:ed)? into (?:the )?ear)\b/i,
			'OTIC'
		],
		[
			/\b(?:rectally|per rectum|rectal administration|for rectal use|administer(?:ed)? rectally)\b/i,
			'RECTAL'
		],
		[
			/\b(?:vaginally|intravaginally|vaginal administration|for vaginal use|administer(?:ed)? vaginally)\b/i,
			'VAGINAL'
		],
		[/\b(?:buccally|administer(?:ed)? buccally|for buccal use)\b/i, 'BUCCAL'],
		[/\b(?:sublingually|administer(?:ed)? sublingually|for sublingual use)\b/i, 'SUBLINGUAL'],
		[/\bintradermally\b/i, 'INTRADERMAL'],
		[/\bintrathecally\b/i, 'INTRATHECAL'],
		[/\bintra-?articularly\b/i, 'INTRA-ARTICULAR'],
		[/\bintraperitoneally\b/i, 'INTRAPERITONEAL'],
		[/\bintraocularly\b/i, 'INTRAOCULAR'],
		[/\b(?:for|via|by)\s+(?:the\s+)?urethral\s+(?:route|administration|use)\b/i, 'URETHRAL']
	];
	return routes.flatMap(([pattern, route]) => (pattern.test(text) ? [route] : []));
}

/** Fold the common FDA/RxNav spellings into one route vocabulary while
 * retaining unfamiliar provider values for review instead of dropping them. */
export function normalizeRoutes(values: string[]): string[] {
	const aliases: [RegExp, string][] = [
		[/^(?:INTRAVENOUS|IV|INTRAVENOUS INFUSION)$/i, 'INTRAVENOUS'],
		[/^(?:INTRAMUSCULAR|IM)$/i, 'INTRAMUSCULAR'],
		[/^(?:SUBCUTANEOUS|SUBCUTAN|SC|SQ)$/i, 'SUBCUTANEOUS'],
		[/^(?:ORAL|BY MOUTH|PER OS|PO)$/i, 'ORAL'],
		[/^(?:TOPICAL|CUTANEOUS|TRANSDERMAL)$/i, 'TOPICAL'],
		[/^(?:NASAL|INTRANASAL)$/i, 'NASAL'],
		[
			/^(?:RESPIRATORY \(INHALATION\)|INHALATION|INHALATIONAL|INHALATION ROUTE)$/i,
			'RESPIRATORY (INHALATION)'
		],
		[/^(?:OPHTHALMIC|OCULAR)$/i, 'OPHTHALMIC'],
		[/^(?:OTIC|AURICULAR)$/i, 'OTIC'],
		[/^(?:RECTAL|PER RECTUM)$/i, 'RECTAL'],
		[/^(?:VAGINAL|INTRAVAGINAL)$/i, 'VAGINAL'],
		[/^(?:BUCCAL|OROMUCOSAL)$/i, 'BUCCAL'],
		[/^SUBLINGUAL$/i, 'SUBLINGUAL'],
		[/^INTRADERMAL$/i, 'INTRADERMAL'],
		[/^INTRATHECAL$/i, 'INTRATHECAL'],
		[/^INTRA[- ]?ARTICULAR$/i, 'INTRA-ARTICULAR']
	];
	const normalized = new Map<string, string>();
	for (const raw of values) {
		const value = raw.trim().replace(/\s+/g, ' ');
		if (!value) continue;
		const canonical = aliases.find(([pattern]) => pattern.test(value))?.[1] ?? value.toUpperCase();
		if (!normalized.has(canonical.toUpperCase()))
			normalized.set(canonical.toUpperCase(), canonical);
	}
	return [...normalized.values()];
}

