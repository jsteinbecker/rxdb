<script lang="ts">
	import { onMount } from 'svelte';
	import type { JobSnapshot } from '$lib/server/jobs';

	/** Poll fast while something runs (or was just started), slowly otherwise. */
	const FAST_MS = 600;
	const IDLE_MS = 5000;
	const WAKE_WINDOW_MS = 4000;

	let jobs = $state<JobSnapshot[]>([]);
	let dismissed = $state(new Set<string>());
	let expanded = $state(true);
	let now = $state(Date.now());
	let wokeAt = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;

	const visible = $derived(jobs.filter((job) => !dismissed.has(job.id)));
	const running = $derived(visible.filter((job) => job.status === 'running'));

	async function poll() {
		clearTimeout(timer);
		try {
			const response = await fetch('/api/v1/jobs', { cache: 'no-store' });
			if (response.ok) jobs = ((await response.json()) as { jobs: JobSnapshot[] }).jobs;
		} catch {
			// Server restarting; keep the last snapshot.
		}
		now = Date.now();
		const busy = jobs.some((job) => job.status === 'running') || now - wokeAt < WAKE_WINDOW_MS;
		if (!document.hidden || busy) timer = setTimeout(poll, busy ? FAST_MS : IDLE_MS);
	}

	function wake() {
		wokeAt = Date.now();
		// Let the request reach the server before the first look.
		clearTimeout(timer);
		timer = setTimeout(poll, 150);
	}

	onMount(() => {
		void poll();
		const tick = setInterval(() => (now = Date.now()), 500);
		// Any form action may start a refresh; watch closely after one is submitted.
		const onSubmit = () => wake();
		const onVisible = () => !document.hidden && void poll();
		window.addEventListener('jobs:watch', wake);
		document.addEventListener('submit', onSubmit, true);
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			clearTimeout(timer);
			clearInterval(tick);
			window.removeEventListener('jobs:watch', wake);
			document.removeEventListener('submit', onSubmit, true);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	function duration(ms: number) {
		const s = Math.max(0, Math.round(ms / 1000));
		return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
	}

	/** Fraction done: whole items, plus a share for steps finished within the current one. */
	function fraction(job: JobSnapshot) {
		if (job.status !== 'running') return 1;
		const STEPS_PER_ITEM = 4;
		const stepsInItem = Math.min(job.steps.filter((s) => s.endedAt).length % STEPS_PER_ITEM, STEPS_PER_ITEM - 1);
		return Math.min(0.97, (job.done + stepsInItem / STEPS_PER_ITEM) / Math.max(job.total, 1));
	}

	/** Time-left estimate from average seconds per finished item (batch jobs only). */
	function eta(job: JobSnapshot) {
		if (job.status !== 'running' || job.total < 2 || job.done < 1) return null;
		const per = (now - job.startedAt) / job.done;
		return duration(per * (job.total - job.done));
	}

	/** A plain-language hint about why the current step takes as long as it does. */
	function insight(job: JobSnapshot) {
		const step = job.steps.at(-1);
		if (job.status !== 'running' || !step) return null;
		const elapsed = now - step.startedAt;
		if (/Re-fetching|Collecting/.test(step.label) && elapsed > 4000)
			return 'Each package is checked against several public sources, which are rate-limited — this is usually the slowest step.';
		if (/^Looking up/.test(step.label) && elapsed > 3000) return 'Waiting on RxNav to respond.';
		if (/Linking/.test(step.label) && elapsed > 3000) return 'Writing package facts and labels to the catalog.';
		if (job.failures.length) return `${job.failures.length} item${job.failures.length === 1 ? '' : 's'} failed so far; the rest continue.`;
		return null;
	}

	function dismiss(id: string) {
		dismissed = new Set([...dismissed, id]);
	}
</script>

{#if visible.length}
	<aside class="overlay" aria-live="polite" aria-label="Server operations">
		<header>
			<button type="button" class="toggle" onclick={() => (expanded = !expanded)} aria-expanded={expanded}>
				{#if running.length}
					<span class="spinner" aria-hidden="true"></span>
					{running.length} operation{running.length === 1 ? '' : 's'} running
				{:else}
					Operations finished
				{/if}
				<span class="chev" class:open={expanded} aria-hidden="true">▾</span>
			</button>
		</header>
		{#if expanded}
			<ul>
				{#each visible as job (job.id)}
					{@const tip = insight(job)}
					{@const left = eta(job)}
					<li class={job.status}>
						<div class="title">
							<strong>{job.title}</strong>
							{#if job.status !== 'running'}
								<button type="button" class="close" aria-label="Dismiss" onclick={() => dismiss(job.id)}>×</button>
							{/if}
						</div>
						<div class="track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(fraction(job) * 100)}>
							<span style:width="{fraction(job) * 100}%"></span>
						</div>
						<p class="stage">
							{#if job.status === 'running'}
								{job.stage}{#if job.item && job.total > 1}<span class="muted"> · {job.item}</span>{/if}
							{:else if job.status === 'done'}
								✓ Done{#if job.failures.length} with {job.failures.length} failure{job.failures.length === 1 ? '' : 's'}{/if}
							{:else}
								✕ {job.failures.at(-1) ?? 'Failed'}
							{/if}
						</p>
						<p class="meta">
							{#if job.total > 1}{Math.min(job.done + (job.status === 'running' ? 1 : 0), job.total)} of {job.total} · {/if}
							{duration((job.endedAt ?? now) - job.startedAt)} elapsed{#if left} · ~{left} left{/if}
						</p>
						{#if job.notes.length}
							<ul class="notes">
								{#each job.notes.slice(-3) as note, i (i)}<li>{note}</li>{/each}
							</ul>
						{/if}
						{#if tip}<p class="tip">💡 {tip}</p>{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</aside>
{/if}

<style>
	.overlay {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 1100;
		width: min(340px, calc(100vw - 32px));
		max-height: 60vh;
		overflow: auto;
		background: #fff;
		color: #18212f;
		border: 1px solid #dfe4ec;
		border-radius: 10px;
		box-shadow: 0 10px 30px rgba(24, 33, 47, 0.18);
		font-size: 13px;
		animation: rise 0.2s ease;
	}
	@keyframes rise {
		from { transform: translateY(8px); opacity: 0; }
	}
	header { border-bottom: 1px solid #eef1f5; }
	.toggle {
		all: unset;
		box-sizing: border-box;
		width: 100%;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.chev { margin-left: auto; transition: transform 0.15s; transform: rotate(-90deg); }
	.chev.open { transform: none; }
	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid #c9d6ea;
		border-top-color: #3464a5;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
	}
	@keyframes spin { to { transform: rotate(360deg); } }
	ul { list-style: none; margin: 0; padding: 0; }
	.overlay > ul > li { padding: 10px 12px; border-top: 1px solid #eef1f5; }
	.overlay > ul > li:first-child { border-top: 0; }
	.title { display: flex; align-items: start; gap: 8px; }
	.title strong { font-weight: 600; line-height: 1.3; }
	.close { all: unset; margin-left: auto; cursor: pointer; color: #6b7686; font-size: 16px; line-height: 1; }
	.track { height: 5px; margin: 8px 0 6px; background: #eef1f5; border-radius: 3px; overflow: hidden; }
	.track span {
		display: block;
		height: 100%;
		background: linear-gradient(90deg, #204f91, #3464a5 55%, #7aa7e0);
		transition: width 0.5s ease;
	}
	.running .track span { background-size: 200% 100%; animation: shimmer 1.6s linear infinite; }
	@keyframes shimmer { to { background-position: -200% 0; } }
	.done .track span { background: #2f8a57; }
	.failed .track span { background: #c0392b; }
	p { margin: 2px 0; }
	.stage { color: #18212f; }
	.failed .stage { color: #b03a2e; }
	.muted, .meta { color: #6b7686; }
	.meta { font-size: 12px; }
	.notes { margin-top: 4px; color: #45505f; font-size: 12px; }
	.notes li::before { content: '· '; }
	.tip { margin-top: 6px; padding: 6px 8px; background: #f3f6fb; border-radius: 6px; color: #45505f; font-size: 12px; }
</style>
