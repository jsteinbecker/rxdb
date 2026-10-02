import {
  type EquivalentPackage,
  overrideTargets,
  type PropertyOverride,
  validOverrideValue
} from '../property-override-fields';
import { AMBIGUITY_KINDS, type AmbiguityKind } from '../labeler-ambiguity';
import type { LabelBlock } from '../spl-sections';
import type { ExternalPackage } from './catalog-providers';

type Package = Omit<ExternalPackage, 'splXml' | 'evidence'>;

function blockText(block: LabelBlock): string {
  if (block.type === 'heading') return block.text;
  if (block.type === 'paragraph') return block.runs.map((run) => run.text).join('');
  if (block.type === 'list') return block.items.flatMap((item) => item.map(blockText)).join(' ');
  return [
    block.caption ?? '',
    ...[...block.head, ...block.body, ...block.foot].flatMap((row) =>
      row.map((cell) => cell.runs.map((run) => run.text).join(''))
    )
  ].join(' ');
}

function hasHeading(blocks: LabelBlock[], title: string): boolean {
  return blocks.some((block) =>
    block.type === 'heading'
      ? block.text === title
      : block.type === 'list' && block.items.some((item) => hasHeading(item, title))
  );
}

/** What the user submitted as support for an override, before checking. */
export type OverrideCitationInput =
  | {
      source: 'spl';
      sectionKey: string;
      excerpt: string;
      subsectionTitle: string;
      startOffset: number;
      endOffset: number;
    }
  | { source: 'url'; url: string; title: string; excerpt: string }
  | { source: 'ndc'; ndc: string };

/** Parses the override form's citation fields; null when the source is unknown. */
export function readCitationInput(form: FormData): OverrideCitationInput | null {
  const text = (name: string) => String(form.get(name) ?? '');
  const source = text('source') || 'spl';
  if (source === 'spl')
    return {
      source,
      sectionKey: text('sectionKey'),
      excerpt: text('excerpt'),
      subsectionTitle: text('subsectionTitle'),
      startOffset: Number(form.get('startOffset')),
      endOffset: Number(form.get('endOffset'))
    };
  if (source === 'url')
    return { source, url: text('url'), title: text('title'), excerpt: text('excerpt') };
  if (source === 'ndc') return { source, ndc: text('ndc') };
  return null;
}

/**
 * Checks an override against what it cites and returns the record to store.
 * An equivalent NDC must be among `equivalents` and hold exactly `value`.
 */
export function citeOverride(
  current: Package,
  key: string,
  value: string,
  citation: OverrideCitationInput,
  equivalents: EquivalentPackage[],
  now = new Date()
): PropertyOverride {
  if (!overrideTargets(current).some((candidate) => candidate.key === key))
    throw new Error('Choose an overridable property.');
  const corrected = value.trim();
  if (!validOverrideValue(key, corrected))
    throw new Error('Enter a valid value for this property.');
  const createdAt = now.toISOString();
  const normalized = (text: string) => text.replace(/\s+/g, ' ').trim();

  if (citation.source === 'url') {
    let url: URL;
    try {
      url = new URL(citation.url.trim());
    } catch {
      throw new Error('Enter the full address of the outside source.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:')
      throw new Error('Outside sources must be web addresses (http or https).');
    const excerpt = normalized(citation.excerpt);
    if (!excerpt || excerpt.length > 1000)
      throw new Error('Quote the passage from the outside source (up to 1000 characters).');
    return {
      value: corrected,
      source: 'url',
      url: url.href,
      title: normalized(citation.title).slice(0, 200) || null,
      excerpt,
      createdAt
    };
  }

  if (citation.source === 'ndc') {
    const equivalent = equivalents.find((candidate) => candidate.ndc === citation.ndc);
    if (!equivalent) throw new Error('Choose an NDC equivalent to this one.');
    if (equivalent.values[key] !== corrected)
      throw new Error(`NDC ${equivalent.ndc} does not list this value for the property.`);
    return {
      value: corrected,
      source: 'ndc',
      ndc: equivalent.ndc,
      relation: equivalent.relation,
      description: equivalent.description,
      createdAt
    };
  }

  const { sectionKey, excerpt, subsectionTitle, startOffset, endOffset } = citation;
  const section = current.details?.label?.sections.find(
    (candidate) => candidate.key === sectionKey
  );
  if (!current.splSetId || !section) throw new Error('Choose a section from this SPL.');
  const quote = excerpt.trim();
  const sourceText = section.blocks?.length
    ? section.blocks.map(blockText).join(' ')
    : section.text;
  if (!quote || quote.length > 1000 || !normalized(sourceText).includes(normalized(quote)))
    throw new Error('Select an exact excerpt from the displayed SPL section.');
  const subsection = subsectionTitle.trim();
  if (
    !Number.isSafeInteger(startOffset) ||
    !Number.isSafeInteger(endOffset) ||
    startOffset < 0 ||
    endOffset <= startOffset
  )
    throw new Error('Select a passage within one SPL section.');
  if (subsection && !hasHeading(section.blocks ?? [], subsection))
    throw new Error('The selected subsection is not in this SPL section.');
  return {
    value: corrected,
    source: 'spl',
    excerpt: quote,
    sectionKey,
    sectionTitle: section.title,
    subsectionTitle: subsection || null,
    startOffset,
    endOffset,
    splSetId: current.splSetId,
    createdAt
  };
}

/**
 * The overrides for correcting `key` because of a labeler ambiguity: the
 * corrected value, plus whatever else the ambiguity implies, all with the same
 * citation and the ambiguity's name. An equivalent NDC cannot be cited: it
 * lists field values, not the reason a labeler's value was wrong.
 */
export function buildAmbiguityOverrides(
  current: Package,
  key: string,
  value: string,
  kind: AmbiguityKind,
  note: string,
  citation: OverrideCitationInput,
  now = new Date()
): Record<string, PropertyOverride> {
  const definition = AMBIGUITY_KINDS[kind];
  if (!definition.appliesTo(key))
    throw new Error('This ambiguity does not apply to this property.');
  if (citation.source === 'ndc')
    throw new Error('Cite this package’s SPL or an outside source for this correction.');
  const tag = { kind, note: note.trim().slice(0, 500) || null };
  return Object.fromEntries(
    Object.entries({ ...definition.companions, [key]: value }).map(([field, fieldValue]) => [
      field,
      { ...citeOverride(current, field, fieldValue, citation, [], now), ambiguity: tag }
    ])
  );
}
