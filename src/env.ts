/**
 * The environment variables the app reads through `$app/env/private`. SvelteKit 3
 * exposes only the variables declared here.
 *
 * @module
 */
import { defineEnvVars } from '@sveltejs/kit/env';

/** An optional variable: unset reads as undefined. */
const optional = { schema: (value: string | undefined) => value };

export const variables = defineEnvVars({
	/** Self-hosted PostgreSQL connection string. */
	DATABASE_URL: {},
	/** openFDA keys; requests rotate through every one that is set. */
	OPENFDA_API_KEY: optional,
	OPENFDA_API_KEY1: optional,
	OPENFDA_API_KEY2: optional
});
