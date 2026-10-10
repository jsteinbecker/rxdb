import type { Handle } from '@sveltejs/kit';
import { logger } from '$lib/server/log';

const log = logger('http');

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
