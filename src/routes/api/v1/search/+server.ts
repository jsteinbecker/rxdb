import { searchResponse } from '$lib/server/catalog/search';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => searchResponse(url);
