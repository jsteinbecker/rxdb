import { searchResponse } from '#lib/server/catalog/search.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = ({ url }) => searchResponse(url);
