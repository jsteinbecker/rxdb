<script lang="ts">
	import { resolve } from '$app/paths';
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import PharmClassRuleDialog from '$lib/components/PharmClassRuleDialog.svelte';
	import { ruleKeyText } from '$lib/pharm-class-rule-label';

	let { data, form } = $props();

	let dialog: PharmClassRuleDialog;
	let menuFor = $state<string | null>(null);

	const MODES = { replace: 'Replace', add: 'Add', suppress: 'Hide' } as const;
	const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`;

	type Rule = (typeof data.rules)[number];

	function edit(rule: Rule) {
		menuFor = null;
		dialog.edit({ ...rule, title: ruleKeyText(rule) });
	}
</script>

<svelte:window
	onclick={(event) => {
		if (menuFor && !(event.target as Element).closest('.row-menu')) menuFor = null;
	}}
	onkeydown={(event) => event.key === 'Escape' && (menuFor = null)}
/>

<svelte:head>
	<title>Pharmacologic class rules · RxDB</title>
</svelte:head>

<main>
	<PageHeader title="Pharmacologic class rules">
		{#snippet eyebrow()}
			<a href={resolve('/')}>RxDB</a> / <a href={resolve('/formulary')}>Formulary</a> / Class rules ·
			<a href={resolve('/settings')}>Settings</a>
		{/snippet}
		<p>
			{plural(data.rules.length, 'rule')} in {data.scope.name}. Rules replace, add to or hide the
			classes shown for matching packages; the source data is untouched.
		</p>
	</PageHeader>

	{#if form?.action === 'pharmClassRuleDelete' && form.message}
		<p class="notice error" role="alert">{form.message}</p>
	{:else if form?.notice}
		<p class="notice" role="status">{form.notice}</p>
	{/if}

	{#if !data.rules.length}
		<p class="empty">
			No rules yet. Open an NDC page from the <a href={resolve('/formulary')}>formulary</a> and choose
			Assign class from its ⋯ menu to create one.
		</p>
	{:else}
		<table>
			<thead>
				<tr>
					<th>Applies to</th>
					<th>Mode</th>
					<th>Classes</th>
					<th class="num">Matches</th>
					<th>Note</th>
					<th></th>
				</tr>
			</thead>
			<tbody>
				{#each data.rules as rule, index (rule.id)}
					<tr>
						<td>{ruleKeyText(rule)}</td>
						<td>{MODES[rule.mode]}</td>
						<td>
							{#if rule.classes.length}
								<ul class="chips">
									{#each rule.classes as name (name)}<li>{name}</li>{/each}
								</ul>
							{:else}
								<span class="muted">All classes</span>
							{/if}
						</td>
						<td class="num">
							{#await data.matches}
								<span class="muted">…</span>
							{:then counts}
								{counts[index].count}{counts[index].capped ? '+' : ''}
							{:catch}
								<span class="muted">?</span>
							{/await}
						</td>
						<td class="note">{rule.note ?? ''}</td>
						<td class="actions">
							<div class="row-menu" class:open={menuFor === rule.id}>
								<button
									class="menu-trigger"
									aria-label="Rule options"
									aria-haspopup="menu"
									aria-expanded={menuFor === rule.id}
									onclick={() => (menuFor = menuFor === rule.id ? null : rule.id)}>⋯</button
								>
								{#if menuFor === rule.id}
									<div class="menu" role="menu">
										<button type="button" role="menuitem" onclick={() => edit(rule)}>Edit</button>
										<form
											method="POST"
											action="?/pharmClassRuleDelete"
											use:enhance={({ cancel }) => {
												if (data.settings.confirmRemove && !confirm('Delete this rule?'))
													return cancel();
												menuFor = null;
											}}
										>
											<input type="hidden" name="id" value={rule.id} />
											<button class="danger" role="menuitem">Delete</button>
										</form>
									</div>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</main>

<PharmClassRuleDialog
	bind:this={dialog}
	known={data.known}
	confirmRemove={data.settings.confirmRemove}
	message={form?.action === 'pharmClassRule' || form?.action === 'pharmClassRuleDelete'
		? form.message
		: null}
/>

<style>
	.notice {
		border-radius: 0.55rem;
		padding: 0.6rem 0.85rem;
	}

	.notice:not(.error) {
		background: #eef3fa;
		color: #3464a5;
	}

	.notice.error {
		background: #fdecec;
		color: #9a2a2a;
	}

	.empty,
	.muted {
		color: #5c6777;
	}

	table {
		width: 100%;
		margin-top: 1.5rem;
		border-collapse: collapse;
		font-size: 0.9rem;
	}

	th,
	td {
		padding: 0.55rem 0.6rem;
		border-bottom: 1px solid #e3e8ef;
		text-align: left;
		vertical-align: top;
	}

	th {
		color: #7a8594;
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.num {
		text-align: right;
		white-space: nowrap;
	}

	.note {
		color: #5c6777;
		max-width: 16rem;
	}

	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.3rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.chips li {
		padding: 0.1rem 0.5rem;
		border: 1px solid #c9d6e8;
		border-radius: 999px;
		background: #eef3fa;
		font-size: 0.8rem;
	}

	.actions {
		width: 1%;
	}

	.row-menu {
		position: relative;
	}

	.menu-trigger {
		background: none;
		border: 0;
		color: #5c6777;
		padding: 0.1rem 0.45rem;
		border-radius: 0.35rem;
		line-height: 1;
		cursor: pointer;
	}

	.menu-trigger:hover,
	.row-menu.open .menu-trigger {
		background: #eef2f7;
	}

	.menu {
		position: absolute;
		right: 0;
		top: calc(100% + 0.25rem);
		z-index: 10;
		min-width: 8rem;
		padding: 0.3rem;
		background: #fff;
		border: 1px solid #d9dee6;
		border-radius: 0.5rem;
		box-shadow: 0 6px 20px rgb(15 23 42 / 0.12);
	}

	.menu button {
		display: flex;
		width: 100%;
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		padding: 0.35rem 0.5rem;
		border-radius: 0.35rem;
		font-size: 0.85rem;
		cursor: pointer;
	}

	.menu button:hover {
		background: #eef2f7;
	}

	.menu .danger {
		color: #a4461a;
	}
</style>
