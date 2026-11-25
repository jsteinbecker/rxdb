import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createServer } from 'vite';
import { svelteColdStyle } from './svelte-cold-style';

test('a style requested before its component is compiled is still scoped CSS', async (t) => {
	// Inside the project, so the compiled component's `svelte` imports resolve.
	const root = await mkdtemp(join(process.cwd(), '.tmp-cold-style-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await writeFile(
		join(root, 'Item.svelte'),
		'<script>let name = "x";</script>\n<li>{name}</li>\n<style>li { display: flex; }</style>\n'
	);
	const server = await createServer({
		root,
		configFile: false,
		logLevel: 'silent',
		plugins: [svelteColdStyle(), svelte({ configFile: false })],
		optimizeDeps: { noDiscovery: true },
		server: { middlewareMode: true, ws: false, watch: null }
	});
	t.after(() => server.close());

	for (const query of ['svelte&type=style&lang.css', 'direct&svelte&type=style&lang.css']) {
		server.moduleGraph.invalidateAll();
		const css = (await server.transformRequest(`/Item.svelte?${query}`))?.code ?? '';
		assert.match(css, /li\.svelte-\w+/, query);
		assert.doesNotMatch(css, /<script>/, query);
	}
});
