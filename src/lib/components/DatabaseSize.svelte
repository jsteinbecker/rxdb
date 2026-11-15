<script lang="ts">
	type Size = { bytes: number; tables: { name: string; bytes: number }[]; at: string };

	let size = $state<Size | null>(null);
	let previous = $state<number | null>(null);
	let error = $state(false);

	const format = (bytes: number) => {
		const units = ['B', 'KB', 'MB', 'GB', 'TB'];
		let value = Math.abs(bytes);
		let unit = 0;
		while (value >= 1024 && unit < units.length - 1) {
			value /= 1024;
			unit++;
		}
		return `${bytes < 0 ? '−' : ''}${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
	};

	async function refresh() {
		if (document.hidden) return;
		try {
			const response = await fetch('/api/v1/database-size', { cache: 'no-store' });
			if (!response.ok) throw new Error(String(response.status));
			const next: Size = await response.json();
			previous = size?.bytes ?? null;
			size = next;
			error = false;
		} catch {
			error = true;
		}
	}

	$effect(() => {
		refresh();
		const timer = setInterval(refresh, 5000);
		document.addEventListener('visibilitychange', refresh);
		return () => {
			clearInterval(timer);
			document.removeEventListener('visibilitychange', refresh);
		};
	});

	const delta = $derived(size && previous !== null ? size.bytes - previous : 0);
</script>

<section class="card" aria-labelledby="db-size-heading">
	<h2 id="db-size-heading">Database size</h2>
	{#if size}
		<p class="total" aria-live="polite">
			{format(size.bytes)}
			{#if delta}<span class="delta">{delta > 0 ? '+' : ''}{format(delta)}</span>{/if}
		</p>
		<ul class="tables">
			{#each size.tables as table (table.name)}
				<li><span>{table.name}</span><span>{format(table.bytes)}</span></li>
			{/each}
		</ul>
		<p class="small">
			Updated {new Date(size.at).toLocaleTimeString()} · refreshes every 5 seconds
			{#if error}· last refresh failed{/if}
		</p>
	{:else if error}
		<p class="small">The database size could not be read.</p>
	{:else}
		<p class="small">Measuring…</p>
	{/if}
</section>

<style>
	.card {
		border: 1px solid #e3e8ee;
		border-radius: 0.75rem;
		background: white;
		padding: 1.25rem;
		margin: 1.25rem 0;
	}
	h2 {
		margin: 0 0 0.75rem;
		font-size: 1.05rem;
	}
	.total {
		font-size: 1.5rem;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		margin: 0.25rem 0 0.5rem;
	}
	.delta {
		font-size: 0.85rem;
		font-weight: 400;
		opacity: 0.7;
		margin-left: 0.5rem;
	}
	.tables {
		list-style: none;
		padding: 0;
		margin: 0 0 0.5rem;
		font-variant-numeric: tabular-nums;
	}
	.tables li {
		display: flex;
		justify-content: space-between;
		gap: 1rem;
	}
	.small {
		font-size: 0.85rem;
		opacity: 0.7;
		margin: 0;
	}
</style>
