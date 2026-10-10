import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { LOCAL_PHOTO_TYPES, localPhotoFile, readLocalPhoto } from '$lib/server/local-pill-photos';
import type { RequestHandler } from './$types';

/** Hand-saved pill photos from `dev-pill-photos/`, under `vite dev` only. */
export const GET: RequestHandler = async ({ params }) => {
	if (!dev) error(404, 'Not found');
	const file = localPhotoFile(params.file);
	if (!file) error(404, 'Not a pill photo name');
	try {
		const body = await readLocalPhoto(file);
		const type = LOCAL_PHOTO_TYPES[file.split('.').pop()!.toLowerCase()];
		return new Response(new Uint8Array(body), {
			headers: { 'content-type': type, 'cache-control': 'no-cache' }
		});
	} catch {
		error(404, 'No such pill photo');
	}
};
