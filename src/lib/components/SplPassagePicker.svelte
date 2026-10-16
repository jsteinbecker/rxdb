<script lang="ts">
      import {MAX_SPL_PASSAGES, type SplPassageDraft} from '$lib/citation-form';
      import type {PackageDetails} from '$lib/server/catalog-providers';
      import {citationCapture} from '$lib/citation-capture.svelte';

      let {
            passages = $bindable(),
            sections,
            splSetId
      }: {
            passages: SplPassageDraft[];
            sections: NonNullable<PackageDetails['label']>['sections'];
            splSetId: string | null;
      } = $props();

      const HIGHLIGHT = 'spl-citation';
      let notice = $state('');
      // A repaint queued as the picker unmounts must not bring the highlights back.
      let mounted = true;
      const titleOf = (key: string) => sections.find((section) => section.key === key)?.title ?? key;

      /** Text offsets within `root` as a live range, or null once that text is gone. */
      function rangeAt(root: Element, start: number, end: number): Range | null {
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
            const range = document.createRange();
            let seen = 0;
            let started = false;
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                  const length = (node as Text).length;
                  if (!started && start <= seen + length) {
                        range.setStart(node, start - seen);
                        started = true;
                  }
                  if (started && end <= seen + length) {
                        range.setEnd(node, end - seen);
                        return range;
                  }
                  seen += length;
            }
            return null;
      }

      // Highlights stay painted on the page's own label sections, re-found by offset
      // whenever a section is expanded again.
      function paint() {
            if (!mounted || typeof CSS === 'undefined' || !('highlights' in CSS)) return;
            const ranges = passages.flatMap((passage) => {
                  const section = document.querySelector(`[data-spl-section="${CSS.escape(passage.sectionKey)}"]`);
                  const range = section && rangeAt(section, passage.startOffset, passage.endOffset);
                  return range ? [range] : [];
            });
            CSS.highlights.set(HIGHLIGHT, new Highlight(...ranges));
      }

      $effect(paint);

      $effect(() => {
            let frame = 0;
            const observer = new MutationObserver(() => {
                  cancelAnimationFrame(frame);
                  frame = requestAnimationFrame(paint);
            });
            observer.observe(document.body, {childList: true, subtree: true});
            // Wait for the selection to settle after the button or key is released.
            const onRelease = () => setTimeout(capture);
            document.addEventListener('mouseup', onRelease);
            document.addEventListener('keyup', onRelease);
            return () => {
                  mounted = false;
                  observer.disconnect();
                  cancelAnimationFrame(frame);
                  document.removeEventListener('mouseup', onRelease);
                  document.removeEventListener('keyup', onRelease);
                  if (typeof CSS !== 'undefined' && 'highlights' in CSS) CSS.highlights.delete(HIGHLIGHT);
            };
      });

      function capture() {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || !selection.rangeCount) return;
            const anchor = selection.anchorNode?.parentElement?.closest('[data-spl-section]');
            const focus = selection.focusNode?.parentElement?.closest('[data-spl-section]');
            if (!anchor && !focus) return;
            if (anchor !== focus) {
                  notice = 'Keep each highlight within one section; highlight again to add another.';
                  return;
            }
            const section = anchor as Element;
            const range = selection.getRangeAt(0);
            const excerpt = selection.toString().trim();
            if (!excerpt) return;
            if (excerpt.length > 1000) {
                  notice = 'Highlight at most 1000 characters at a time.';
                  return;
            }
            const raw = range.toString();
            const start = textBefore(section, range.startContainer, range.startOffset);
            if (add(section, range, excerpt, start + (raw.length - raw.trimStart().length), start + raw.trimEnd().length))
                  selection.removeAllRanges();
      }

      /** How much of `section`'s text comes before this point. */
      function textBefore(section: Element, node: Node, offset: number): number {
            const before = document.createRange();
            before.selectNodeContents(section);
            before.setEnd(node, offset);
            return before.toString().length;
      }

      /** Where a table row's text sits within its section. */
      function rowSpan(row: HTMLTableRowElement) {
            const section = row.closest('[data-spl-section]');
            if (!section) return null;
            const range = document.createRange();
            range.selectNodeContents(row);
            const startOffset = textBefore(section, row, 0);
            return {section, range, startOffset, endOffset: startOffset + range.toString().length};
      }

      /** Adds a passage, replacing any it overlaps; false when there is no room. */
      function add(section: Element, range: Range, excerpt: string, startOffset: number, endOffset: number): boolean {
            let subsectionTitle = '';
            for (const heading of section.querySelectorAll('.heading')) {
                  if (range.comparePoint(heading, 0) === -1) subsectionTitle = heading.textContent?.trim() ?? '';
            }
            const sectionKey = section.getAttribute('data-spl-section') ?? '';
            const kept = passages.filter(
                  (passage) =>
                        passage.sectionKey !== sectionKey ||
                        passage.endOffset <= startOffset ||
                        passage.startOffset >= endOffset
            );
            if (kept.length >= MAX_SPL_PASSAGES) {
                  notice = `A citation can quote at most ${MAX_SPL_PASSAGES} passages.`;
                  return false;
            }
            notice = '';
            passages = [...kept, {sectionKey, excerpt, subsectionTitle, startOffset, endOffset}];
            return true;
      }

      const sameRow = (passage: SplPassageDraft, span: NonNullable<ReturnType<typeof rowSpan>>) =>
            passage.sectionKey === span.section.getAttribute('data-spl-section') &&
            passage.startOffset === span.startOffset &&
            passage.endOffset === span.endOffset;

      // Table rows on the page offer a checkmark while this picker is open.
      $effect(() => {
            const capture = {
                  rowPicked(row: HTMLTableRowElement) {
                        const span = rowSpan(row);
                        return !!span && passages.some((passage) => sameRow(passage, span));
                  },
                  toggleRow(row: HTMLTableRowElement, excerpt: string) {
                        const span = rowSpan(row);
                        if (!span) return;
                        if (passages.some((passage) => sameRow(passage, span))) {
                              passages = passages.filter((passage) => !sameRow(passage, span));
                              notice = '';
                        } else if (!excerpt.trim()) notice = 'This row has no text to cite.';
                        else if (excerpt.length > 1000) notice = 'This row is longer than 1000 characters; highlight part of it instead.';
                        else add(span.section, span.range, excerpt.trim(), span.startOffset, span.endOffset);
                        // The checkbox follows the passages, not the click.
                        const input = row.querySelector<HTMLInputElement>('.pick input');
                        if (input) input.checked = passages.some((passage) => sameRow(passage, span));
                  }
            };
            citationCapture.current = capture;
            return () => {
                  if (citationCapture.current === capture) citationCapture.current = null;
            };
      });

      function show(passage: SplPassageDraft) {
            const section = document.querySelector(`[data-spl-section="${CSS.escape(passage.sectionKey)}"]`);
            const range = section && rangeAt(section, passage.startOffset, passage.endOffset);
            const target = range?.startContainer.parentElement ?? section;
            target?.scrollIntoView({block: 'center', behavior: 'smooth'});
      }
</script>

<p class="hint">
      Highlight the supporting text in the label sections on the page, or check table rows. Each one is
      added; expand a section first to see its text.
</p>
{#if passages.length}
      <ol class="passages">
            {#each passages as passage, index (`${passage.sectionKey}:${passage.startOffset}`)}
                  <li>
                        <button class="excerpt" onclick={() => show(passage)} title="Show on the page" type="button">
                              <mark>{passage.excerpt}</mark>
                              <span class="where">{titleOf(passage.sectionKey)}{passage.subsectionTitle ? ` › ${passage.subsectionTitle}` : ''}</span>
                        </button>
                        <button aria-label="Remove passage" class="remove" type="button"
                                onclick={() => (passages = passages.filter((_, at) => at !== index))}>×
                        </button>
                  </li>
            {/each}
      </ol>
      {#if splSetId}<p class="hint">SPL {splSetId}</p>{/if}
{:else}
      <p class="empty">No passages highlighted yet.</p>
{/if}
{#if notice}<p class="notice">{notice}</p>{/if}

<style>
      :global(::highlight(spl-citation)) {
            background-color: #fff0a6;
      }

      .hint,
      .empty,
      .notice {
            margin: 0;
            color: #5c6777;
            font-size: 0.8rem;
      }

      .empty {
            padding: 0.5rem 0.6rem;
            border: 1px dashed #c9d3e0;
            border-radius: 7px;
            text-align: center;
      }

      .notice {
            color: #a4461a;
      }

      .passages {
            display: grid;
            gap: 0.35rem;
            max-height: 14rem;
            margin: 0;
            padding: 0;
            overflow: auto;
            list-style: none;
      }

      li {
            display: flex;
            align-items: flex-start;
            gap: 0.25rem;
            padding: 0.35rem 0.25rem 0.35rem 0.5rem;
            border: 1px solid #e0e7f0;
            border-radius: 7px;
      }

      .excerpt {
            display: grid;
            gap: 0.15rem;
            flex: 1;
            min-width: 0;
            padding: 0;
            border: 0;
            background: none;
            color: inherit;
            font: inherit;
            font-size: 0.82rem;
            text-align: left;
            cursor: pointer;
      }

      .excerpt mark {
            display: -webkit-box;
            overflow: hidden;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 3;
            background: #fff0a6;
            white-space: pre-wrap;
      }

      .where {
            color: #5c6777;
            font-size: 0.74rem;
      }

      .remove {
            flex: none;
            padding: 0 0.3rem;
            border: 0;
            background: none;
            color: #7a8594;
            font-size: 1.05rem;
            line-height: 1.2;
            cursor: pointer;
      }

      .remove:hover {
            color: #a32b2b;
      }
</style>
