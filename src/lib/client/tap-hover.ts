/**
 * Tap as hover, for touch screens.
 *
 * Edit buttons and row menus stay hidden until their row is hovered, and a
 * finger never hovers. A tap marks the tapped element and every ancestor with
 * `data-tapped`, exactly the chain `:hover` would cover, so a stylesheet shows
 * the same controls for `row[data-tapped]` as for `row:hover`. The next tap
 * anywhere moves the mark.
 *
 * A tap that lands on a control still hidden only reveals it: the click is
 * swallowed, so nothing nobody could see is ever pressed.
 *
 * @module
 */

const ATTRIBUTE = 'data-tapped';
const CONTROL = 'button, a[href], [role="menuitem"], [role="menuitemradio"], summary';

/** Whether the control, or anything it sits in, is faded out of sight right now. */
function hidden(control: Element): boolean {
	for (let node: Element | null = control; node && node !== document.body; node = node.parentElement)
		if (Number(getComputedStyle(node).opacity) < 0.1) return true;
	return false;
}

/** Starts tap-as-hover on the document; returns the function that stops it. */
export function installTapHover(): () => void {
	let swallow: EventTarget | null = null;

	const onPointerDown = (event: PointerEvent) => {
		if (event.pointerType === 'mouse') return;
		const target = event.target instanceof Element ? event.target : null;
		const control = target?.closest(CONTROL);
		swallow = control && hidden(control) ? control : null;
		for (const marked of document.querySelectorAll(`[${ATTRIBUTE}]`)) marked.removeAttribute(ATTRIBUTE);
		for (let node = target; node && node !== document.documentElement; node = node.parentElement)
			node.setAttribute(ATTRIBUTE, '');
	};

	const onClick = (event: MouseEvent) => {
		if (!swallow) return;
		const control = event.target instanceof Element ? event.target.closest(CONTROL) : null;
		if (control === swallow) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
		swallow = null;
	};

	document.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
	document.addEventListener('click', onClick, { capture: true });
	return () => {
		document.removeEventListener('pointerdown', onPointerDown, { capture: true });
		document.removeEventListener('click', onClick, { capture: true });
	};
}
