import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

test('shared catalog models, resolution and parsing have no transitive dependency on server modules', () => {
	const lib = fileURLToPath(new URL('../', import.meta.url));
	const visited = new Set<string>();
	const pending = [
		'catalog/types.ts',
		'catalog/search-types.ts',
		'catalog/package-state.ts',
		'labels/routes.ts',
		'catalog/effective-package.ts',
		'catalog/review-package.ts',
		'catalog/package-view.ts',
		'medication/clinical-name.ts'
	].map((file) => path.join(lib, file));
	while (pending.length) {
		const file = pending.pop()!;
		if (visited.has(file)) continue;
		visited.add(file);
		assert.equal(path.relative(lib, file).split(path.sep).includes('server'), false, file);
		const source = ts.preProcessFile(readFileSync(file, 'utf8'), true);
		for (const { fileName } of source.importedFiles) {
			const target = fileName.startsWith('$lib/')
				? path.join(lib, fileName.slice(5))
				: fileName.startsWith('.')
					? path.resolve(path.dirname(file), fileName)
					: null;
			if (target) pending.push(target.replace(/\.(js|ts)$/, '') + '.ts');
		}
	}
});
