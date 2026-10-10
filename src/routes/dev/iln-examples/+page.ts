import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';

export const load = () => {
	if (!dev) error(404);
};
