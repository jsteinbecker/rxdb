/**
 * Product forms: the formulary's packages grouped by base ingredient(s) and
 * label dose form, with the routes each form is labeled for and the vial
 * preparation its labels state per route.
 *
 * Keyed on the label's dose form, not RxNorm's: RxNorm files a ceftriaxone
 * powder vial and a ready solution alike as "Injection", and their preparation
 * differs. Base ingredients are the label's active moieties (CEFEPIME
 * HYDROCHLORIDE → CEFEPIME); an electrolyte keeps its own name, since SODIUM
 * CATION is no name for sodium chloride.
 *
 * Pure: the build step ($lib/server/catalog/product-form-store.ts) loads the
 * packages and writes the result.
 *
 * @module
 */
import { isFormOf, sameSubstance, scdStrengths, withoutHydration } from '../labels/spl-strength-checks';
import { RECONSTITUTION_ROUTES, type ReconstitutionRoute } from '../labels/reconstitution-terms';
import { vialPrepVariants, type ConsensusStep } from '../compounds/vial-prep-consensus';
import type { ProseReconstitution } from '../labels/dry-fill-volume';

export interface ProductFormInput {
	packageId: string;
	ndc: string;
	/** Label (SPL) dose form, as imported or corrected. */
	doseForm: string | null;
	/** The package's SCD, when linked. */
	scd: { id: string; name: string } | null;
	/** Label active ingredients with their moieties; empty when the label gave none. */
	actives: { name: string; moieties: { name: string }[] }[];
	/** Listing ingredient names, used when the label gave no actives. */
	listed: string[];
	/** Listed routes of administration ("INTRAVENOUS"). */
	routes: string[];
	isDryFill: boolean | null;
	reconstitution: readonly ProseReconstitution[];
}

export interface ProductFormStrengthOut {
	scdId: string;
	/** Base ingredient this strength is for. */
	ingredient: string;
	/** The salt the SCD states it as, when not the base. */
	basisIngredient: string | null;
	value: number;
	unit: string;
	per: number;
	perUnit: string;
}

export interface ProductFormRouteOut {
	route: ReconstitutionRoute;
	/** Steps the labels state for the route, most-stated first. */
	preps: { step: ConsensusStep; agreeing: number; stating: number }[];
}

export interface ProductFormOut {
	/** Base ingredient names, upper case, sorted. */
	ingredients: string[];
	doseForm: string;
	packageIds: string[];
	strengths: ProductFormStrengthOut[];
	routes: ProductFormRouteOut[];
}

export interface ProductFormBuild {
	forms: ProductFormOut[];
	/** Packages left out, and why. */
	skipped: { ndc: string; reason: string }[];
}

const LISTED_ROUTE: Record<string, ReconstitutionRoute> = {
	INTRAVENOUS: 'IV',
	INTRAMUSCULAR: 'IM',
	SUBCUTANEOUS: 'SC',
	ORAL: 'PO'
};

/** `AMOXICILLIN ANHYDROUS` → `AMOXICILLIN`. */
const display = (name: string) => withoutHydration(name).toUpperCase();

/** The base ingredient of one label active: its single moiety when it is a salt or hydrate of it. */
export function baseIngredient(active: { name: string; moieties: { name: string }[] }): string {
	const [moiety, ...more] = active.moieties;
	return display(moiety && !more.length && isFormOf(active.name, moiety.name) ? moiety.name : active.name);
}

export function buildProductForms(packages: readonly ProductFormInput[]): ProductFormBuild {
	const skipped: ProductFormBuild['skipped'] = [];
	const groups = new Map<string, { ingredients: string[]; doseForm: string; members: ProductFormInput[] }>();
	const named = packages.map((pkg) =>
		pkg.actives.length ? pkg.actives.map(baseIngredient) : pkg.listed.map(display)
	);
	const toBase = foldSalts(new Set(named.flat()));
	for (const [index, pkg] of packages.entries()) {
		const ingredients = [...new Set(named[index].filter(Boolean).map(toBase))].sort();
		const doseForm = pkg.doseForm?.trim().toLowerCase();
		if (!ingredients.length) { skipped.push({ ndc: pkg.ndc, reason: 'no ingredients' }); continue; }
		if (!doseForm) { skipped.push({ ndc: pkg.ndc, reason: 'no dose form' }); continue; }
		const key = `${ingredients.join('|')}#${doseForm}`;
		const group = groups.get(key) ?? groups.set(key, { ingredients, doseForm, members: [] }).get(key)!;
		group.members.push(pkg);
	}
	const forms = [...groups.values()].map(({ ingredients, doseForm, members }) => ({
		ingredients,
		doseForm,
		packageIds: members.map((pkg) => pkg.packageId),
		strengths: strengthsOf(ingredients, members),
		routes: routesOf(members)
	}));
	forms.sort((a, b) => a.ingredients.join().localeCompare(b.ingredients.join()) || a.doseForm.localeCompare(b.doseForm));
	return { forms, skipped };
}

/**
 * A label that codes no moiety leaves its salt as the name (HYDROCODONE
 * BITARTRATE) where the other labels give the base (HYDROCODONE). A name that is
 * another name plus one counterion word is folded into it.
 */
function foldSalts(names: Set<string>): (name: string) => string {
	return (name) => {
		const base = [...names].find((other) => {
			if (other === name || !name.startsWith(`${other} `)) return false;
			return name.slice(other.length).trim().split(/\s+/).length === 1;
		});
		return base ?? name;
	};
}

/** Each SCD's strengths, attributed to the base ingredient they are a form of. */
function strengthsOf(ingredients: string[], members: readonly ProductFormInput[]): ProductFormStrengthOut[] {
	const seen = new Map<string, ProductFormStrengthOut>();
	for (const { scd } of members) {
		if (!scd) continue;
		for (const rx of scdStrengths(scd.name)) {
			const base = ingredients.find((name) => sameSubstance(name, rx.name)) ??
				ingredients.find((name) => isFormOf(rx.name, name));
			if (!base) continue;
			seen.set(`${scd.id}|${base}`, {
				scdId: scd.id,
				ingredient: base,
				basisIngredient: sameSubstance(base, rx.name) ? null : rx.name.toUpperCase(),
				value: rx.value,
				unit: rx.unit,
				per: rx.per,
				perUnit: rx.perUnit ?? '1'
			});
		}
	}
	return [...seen.values()];
}

/** Routes the packages are listed or labeled for, each with the steps its labels state. */
function routesOf(members: readonly ProductFormInput[]): ProductFormRouteOut[] {
	const routes = new Set<ReconstitutionRoute>();
	for (const pkg of members) {
		for (const listed of pkg.routes) {
			const route = LISTED_ROUTE[listed.trim().toUpperCase()];
			if (route) routes.add(route);
		}
		for (const row of pkg.reconstitution) for (const route of row.routes ?? []) routes.add(route);
	}
	const variants = vialPrepVariants(
		members.map((pkg) => ({
			packageId: pkg.packageId,
			ndc: pkg.ndc,
			title: pkg.ndc,
			isDryFill: pkg.isDryFill,
			reconstitution: pkg.reconstitution
		}))
	);
	return RECONSTITUTION_ROUTES.filter((route) => routes.has(route)).map((route) => {
		const group = variants.status === 'stated' ? variants.groups.find((g) => g.route === route) : undefined;
		return {
			route,
			preps: (group?.variants ?? []).map((v) => ({ step: v.step, agreeing: v.ndcs.length, stating: v.of }))
		};
	});
}
