/**
 * The strength display rules a formulary scope names its items with.
 *
 * @module
 */
import type { PrismaClient } from '../../../generated/client';
import { parseSettings } from '../../formulary/settings';
import type { StrengthStyleRule } from '../../medication/strength-style';

/** The strength display rules a formulary scope names its items with. */
export async function scopeStrengthStyles(
	db: PrismaClient,
	scopeId: string
): Promise<StrengthStyleRule[]> {
	const scope = await db.scope.findUnique({ where: { id: scopeId }, select: { settings: true } });
	return parseSettings(scope?.settings).strengthStyles;
}
