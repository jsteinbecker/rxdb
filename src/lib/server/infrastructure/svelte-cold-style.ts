/**
 * Dev-server guard against component styles leaking onto the whole app.
 *
 * A component's styles are a by-product of compiling it. When the dev server is asked for
 * them first, `vite-plugin-svelte` has none to give, and Vite falls back to serving the raw
 * `.svelte` file as CSS: the browser applies its rules unscoped, and the server caches that
 * answer. Compiling the component before its styles load closes the gap.
 *
 * @module
 */
import type { Plugin } from 'vite';

/** The id of a component's `<style>` block, as a module import or a `?direct` stylesheet. */
const COMPONENT_STYLE = /\.svelte\?(?:.*&)?svelte&type=style&/;

/** Add it to the Vite plugins; builds compile every component before its styles. */
export const svelteColdStyle = (): Plugin => ({
	name: 'rxdb:svelte-cold-style',
	apply: 'serve',
	// Ahead of the Svelte plugin's loader, which reads what this compile leaves behind.
	enforce: 'pre',
	load: {
		filter: { id: COMPONENT_STYLE },
		async handler(id) {
			// Cached after the first compile. Returning nothing leaves the load to Svelte.
			if (this.environment.mode !== 'dev') return;
			await this.environment.transformRequest(id.slice(0, id.indexOf('?')));
		}
	}
});
