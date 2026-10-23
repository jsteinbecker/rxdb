import type { Handle, ServerInit } from '@sveltejs/kit';
import { logger } from "$lib/server/infrastructure/log";
import { prisma } from "$lib/server/infrastructure/database";
import { reconcileFormularyEligibility } from "$lib/server/catalog/entity-store";
import { fdaApiKeysFrom, setFdaApiKeys } from './lib/server/providers/transport';
import { env } from '$env/dynamic/private';

// openFDA requests rotate through every configured key when one is rate limited.
setFdaApiKeys(fdaApiKeysFrom(env));

const log = logger('http');

/**
 * Exclusion rules live in code, so a restart is when they can change: recheck every
 * formulary package against its stored evidence in the background.
 */
export const init: ServerInit = () => {
	const eligibility = logger('eligibility');
	reconcileFormularyEligibility(prisma)
		.then(({ checked, excluded }) =>
			eligibility.info(`${checked} formulary packages checked; ${excluded.length} excluded`, {
				excluded
			})
		)
		.catch((error) => eligibility.error('formulary eligibility sweep failed', { error }));
};

/** Logs every incoming request with its response status and duration. */
export const handle: Handle = async ({ event, resolve }) => {
	const started = performance.now();
	const { method } = event.request;
	const path = event.url.pathname + event.url.search;
	try {
		const response = await resolve(event);
		const ms = Math.round(performance.now() - started);
		const line = `${response.status} ${method} ${path} ${ms}ms`;
		if (response.status >= 500) log.error(line);
		else if (response.status >= 400) log.warn(line);
		else log.info(line);
		return response;
	} catch (caught) {
		log.error(`✗ ${method} ${path} ${Math.round(performance.now() - started)}ms`, { error: caught });
		throw caught;
	}
};
