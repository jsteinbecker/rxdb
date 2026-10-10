import assert from 'node:assert/strict';
import { test } from 'node:test';
import { localPhotoFile } from './local-pill-photos';
import { pillPhotoUrl } from '../pill-image-layout';

test('only NDC-named image files are served, never a path', () => {
	assert.equal(localPhotoFile('00378027101.jpg'), '00378027101.jpg');
	assert.equal(localPhotoFile('00378-0271-01.JPEG'), '00378-0271-01.JPEG');
	assert.equal(localPhotoFile('00093214062_2.png'), '00093214062_2.png');
	assert.equal(localPhotoFile('../.env'), null);
	assert.equal(localPhotoFile('sub/00378027101.jpg'), null);
	assert.equal(localPhotoFile('README.md'), null);
	assert.equal(localPhotoFile('notanndc.jpg'), null);
});

test('a local photo is served from the dev route, versioned by modification time', () => {
	assert.equal(
		pillPhotoUrl({ setId: 'local', image: '00378-0271-01.jpg#1712' }),
		'/dev/pill-photos/00378-0271-01.jpg?v=1712'
	);
});
