import type { ExternalPackage } from './catalog-providers';
export function packageFixture(overrides: Partial<ExternalPackage> = {}): ExternalPackage {
	return {
		ndc: '25021018101',
		description: '1 VIAL in 1 CARTON / 152 mL in 1 VIAL',
		doseForm: 'INJECTION, POWDER, FOR SOLUTION',
		doseFormCorrection: null,
		brandName: 'Example',
		genericName: 'Example',
		labelerName: 'Example',
		labelerCode: '25021',
		productCode: '25021-181',
		ingredients: [
			{ name: 'PIPERACILLIN SODIUM', strength: '36 g/152mL' },
			{ name: 'TAZOBACTAM SODIUM', strength: '4.5 g/152mL' }
		],
		rxcuiStatus: 'ACTIVE',
		splSetId: null,
		splTitle: null,
		splXml: null,
		labelIngredients: [],
		details: null,
		evidence: [],
		listed: true,
		marketingEndDate: null,
		splPresent: true,
		isVeterinary: false,
		complete: true,
		size: null,
		unitOfUseCorrection: null,
		isMultiDose: null,
		isDryFill: true,
		reconstitution: [],
		resolvedVolume: null,
		...overrides
	};
}
