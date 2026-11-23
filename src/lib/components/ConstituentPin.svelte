<!--
@component
How rigid one compound constituent is. By default a line may be filled from any
formulary item of its drug + route ("Ampicillin IV"). It can be pinned to one item
("NS 500 mL" for the diluent bag), and then to a hand-picked subset of that item's
NDCs with a reason ("non-DEHP confirmed"). Posts to the page's `pin` action.
-->
<script lang="ts">
	import { enhance } from '$app/forms';
	import { formatNdc } from '#lib/catalog/ndc.ts';

	type Item = { id: string; name: string; packages: { id: string; ndc: string; title: string }[] };

	let {
		slotId,
		label,
		options,
		formularyItemId,
		restriction,
		locked = false
	}: {
		slotId: string;
		/** The line's name, for labels. */
		label: string;
		/** The items of the line's drug + route, each with its live packages. */
		options: Item[];
		formularyItemId: string | null;
		restriction: { reason: string | null; packageIds: string[] } | null;
		locked?: boolean;
	} = $props();

	let itemId = $state('');
	let picked = $state<string[]>([]);
	let reason = $state('');
	let pending = $state(false);
	// Follow the stored constraint whenever it reloads.
	$effect(() => {
		itemId = formularyItemId ?? '';
		picked = restriction?.packageIds ?? [];
		reason = restriction?.reason ?? '';
	});

	const item = $derived(options.find((entry) => entry.id === itemId) ?? null);
	const stored = $derived(options.find((entry) => entry.id === formularyItemId) ?? null);
	const summary = $derived(
		!stored
			? `Any of ${options.length} formulary item${options.length === 1 ? '' : 's'}`
			: restriction
				? `${stored.name}, ${restriction.packageIds.length} of ${stored.packages.length} NDCs${restriction.reason ? ` (${restriction.reason})` : ''}`
				: `Only ${stored.name}`
	);
	const toggle = (id: string) =>
		(picked = picked.includes(id) ? picked.filter((entry) => entry !== id) : [...picked, id]);
</script>

<details class="pin">
	<summary><span class="caption">Allowed</span> {summary}</summary>
	{#if locked}
		<p class="hint">Unlock the compound to change what this line may be filled from.</p>
	{:else}
		<form
			method="POST"
			action="?/pin"
			use:enhance={() => {
				pending = true;
				return async ({ update }) => {
					await update({ reset: false });
					pending = false;
				};
			}}
		>
			<input type="hidden" name="slotId" value={slotId} />
			<label>
				<span class="caption">Formulary item</span>
				<select
					name="formularyItemId"
					bind:value={itemId}
					onchange={() => (picked = [])}
					aria-label="Formulary item for {label}"
				>
					<option value="">Any item of this drug and route</option>
					{#each options as option (option.id)}<option value={option.id}>{option.name}</option
						>{/each}
				</select>
			</label>
			{#if item && item.packages.length > 1}
				<fieldset>
					<legend class="caption"
						>Only these NDCs <span class="hint"
							>(none checked allows all {item.packages.length})</span
						></legend
					>
					{#each item.packages as pkg (pkg.id)}
						<label class="ndc">
							<input
								type="checkbox"
								name="packageId"
								value={pkg.id}
								checked={picked.includes(pkg.id)}
								onchange={() => toggle(pkg.id)}
							/>
							<span class="mono">{formatNdc(pkg.ndc)}</span>
							{pkg.title}
						</label>
					{/each}
					{#if picked.length}
						<label>
							<span class="caption">Why</span>
							<input name="reason" bind:value={reason} placeholder="e.g. non-DEHP confirmed" />
						</label>
					{/if}
				</fieldset>
			{/if}
			<button type="submit" disabled={pending}>Apply</button>
		</form>
	{/if}
</details>

<style>
	.pin {
		grid-column: 1 / -1;
		margin: -0.25rem 0 0.5rem;
		font-size: 0.8rem;
		color: #4a5466;
	}
	summary {
		cursor: pointer;
	}
	.caption {
		color: #7a8494;
		font-size: 0.68rem;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		margin-right: 0.35rem;
	}
	form {
		display: grid;
		gap: 0.5rem;
		margin: 0.5rem 0 0 1rem;
		max-width: 42rem;
	}
	fieldset {
		border: 1px solid #e3e6ec;
		border-radius: 6px;
		padding: 0.5rem 0.75rem;
		display: grid;
		gap: 0.25rem;
	}
	.ndc {
		display: flex;
		gap: 0.4rem;
		align-items: baseline;
	}
	.mono {
		font-family: ui-monospace, monospace;
	}
	.hint {
		color: #7a8494;
		text-transform: none;
		letter-spacing: 0;
	}
	button {
		justify-self: start;
	}
</style>
