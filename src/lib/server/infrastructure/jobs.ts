/**
 * Tracked background jobs: long-running server operations report stages, notes and
 * batch progress that the job overlay polls.
 *
 * @module
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

/** One step a long-running server operation has finished or is working on. */
export type JobStep = { label: string; startedAt: number; endedAt: number | null };

export type JobSnapshot = {
	id: string;
	title: string;
	/** Items done / total, when the job works through a list (batch refresh). */
	done: number;
	total: number;
	/** What the job is doing right now, and on which item. */
	stage: string;
	item: string | null;
	steps: JobStep[];
	notes: string[];
	failures: string[];
	startedAt: number;
	endedAt: number | null;
	status: 'running' | 'done' | 'failed';
};

type Job = JobSnapshot;

/** Survives dev-server HMR reloads of this module. */
const registry: Map<string, Job> = ((globalThis as { __rxdbJobs?: Map<string, Job> }).__rxdbJobs ??=
	new Map());
const current = new AsyncLocalStorage<Job>();
const KEEP_FINISHED_MS = 15_000;

function prune() {
	const now = Date.now();
	for (const [id, job] of registry)
		if (job.endedAt && now - job.endedAt > KEEP_FINISHED_MS) registry.delete(id);
}

/** Run `work` as a tracked job; progress calls inside it land on this job. */
export async function trackJob<T>(
	title: string,
	work: () => Promise<T>,
	{ total = 1 }: { total?: number } = {}
): Promise<T> {
	prune();
	const job: Job = {
		id: randomUUID(),
		title,
		done: 0,
		total,
		stage: 'Starting',
		item: null,
		steps: [],
		notes: [],
		failures: [],
		startedAt: Date.now(),
		endedAt: null,
		status: 'running'
	};
	registry.set(job.id, job);
	try {
		const result = await current.run(job, work);
		finishStep(job);
		job.status = job.failures.length && job.failures.length >= job.total ? 'failed' : 'done';
		job.stage = job.status === 'failed' ? 'Failed' : 'Finished';
		return result;
	} catch (error) {
		finishStep(job);
		job.status = 'failed';
		job.stage = 'Failed';
		job.failures.push(error instanceof Error ? error.message : String(error));
		throw error;
	} finally {
		job.done = Math.max(job.done, job.status === 'done' ? job.total : job.done);
		job.endedAt = Date.now();
	}
}

function finishStep(job: Job) {
	const last = job.steps.at(-1);
	if (last && last.endedAt === null) last.endedAt = Date.now();
}

/** Mark the current job's stage; a no-op outside a tracked job. */
export function jobStage(stage: string) {
	const job = current.getStore();
	if (!job) return;
	finishStep(job);
	job.stage = stage;
	job.steps.push({ label: stage, startedAt: Date.now(), endedAt: null });
	if (job.steps.length > 40) job.steps.splice(0, job.steps.length - 40);
}

/** Record a fact worth surfacing (e.g. how many packages were found). */
export function jobNote(note: string) {
	const job = current.getStore();
	if (!job) return;
	job.notes.push(note);
	if (job.notes.length > 8) job.notes.shift();
}

/** Advance a batch job to its next item. */
export function jobItem(item: string, index: number) {
	const job = current.getStore();
	if (!job) return;
	job.item = item;
	job.done = index;
}

export function jobFailure(message: string) {
	current.getStore()?.failures.push(message);
}

export function listJobs(): JobSnapshot[] {
	prune();
	return [...registry.values()].map((job) => structuredClone(job));
}
