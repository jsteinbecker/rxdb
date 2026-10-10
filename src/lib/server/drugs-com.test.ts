import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drugsComImprintUrl, drugsComNdcUrl } from '../drugs-com';

test('an NDC11 becomes the padded 5-4-2 search', () => {
	assert.equal(drugsComNdcUrl('60687048801'), 'https://www.drugs.com/search.php?searchterm=60687-0488-01');
	assert.equal(drugsComNdcUrl('6068704880'), null);
});

test('an SPL imprint becomes the space-separated pill identifier search', () => {
	assert.equal(drugsComImprintUrl('IP;464'), 'https://www.drugs.com/imprints.php?imprint=IP+464');
	assert.equal(drugsComImprintUrl('10 mg;A&B'), 'https://www.drugs.com/imprints.php?imprint=10+mg+A%26B');
	assert.equal(drugsComImprintUrl(null), null);
	assert.equal(drugsComImprintUrl(' ; '), null);
});
