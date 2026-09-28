import { prisma } from './prisma';
import { loadPackageSnapshots, stageCollection } from './catalog-store';
import { REVIEW_FIELDS } from '$lib/reinterpret';

export async function savePropertyOverride(
  ndc: string,
  key: string,
  value: string,
  sectionKey: string,
  excerpt: string
) {
  const field = REVIEW_FIELDS.find((candidate) => candidate.key === key && candidate.editable);
  if (!field || !field.keys || field.keys.length !== 1)
    throw new Error('Choose an editable property.');
  const current = (await loadPackageSnapshots(prisma, [ndc])).get(ndc)?.item;
  if (!current) throw new Error('No staged data for this NDC.');
  const section = current.details?.label?.sections.find(
    (candidate) => candidate.key === sectionKey
  );
  if (!current.splSetId || !section) throw new Error('Choose a section from this SPL.');
  const quote = excerpt.trim();
  const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();
  if (!quote || quote.length > 1000 || !normalized(section.text).includes(normalized(quote)))
    throw new Error('Select an exact excerpt from the displayed SPL section.');
  const corrected = value.trim();
  if (!corrected || corrected.length > 500) throw new Error('Enter a value under 500 characters.');
  const override = {
    value: corrected,
    excerpt: quote,
    sectionKey,
    sectionTitle: section.title,
    splSetId: current.splSetId,
    createdAt: new Date().toISOString()
  };
  const item = {
    ...current,
    propertyOverrides: { ...current.propertyOverrides, [key]: override },
    evidence: [
      {
        source: 'user-override',
        nativeId: `${ndc}:${key}:${override.createdAt}`,
        url: `urn:rxdb:override:ndc:${ndc}`,
        payload: { key, ...override }
      }
    ]
  };
  Object.assign(item, { [field.keys[0]]: corrected });
  await stageCollection(prisma, [], [item]);
}
