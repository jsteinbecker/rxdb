import { json } from '@sveltejs/kit';
import { listJobs } from '$lib/server/jobs';
import type { RequestHandler } from './$types';

/** GET /api/v1/jobs — long-running server operations, running and just finished. */
export const GET: RequestHandler = () =>
	json({ jobs: listJobs() }, { headers: { 'cache-control': 'no-store' } });
