// Many forms render `<Label>Text</Label><Input />` side by side without htmlFor/id, so the control has no
// accessible name (axe: "label", "button-name"; screen readers announce just "edit text"). Rather than hand-patching
// every form, the shared Input/Textarea/Select components use this to name themselves from the label that sits
// DIRECTLY next to them in the same container. It deliberately looks no further than that: borrowing a label from
// a wider ancestor would name a control after something unrelated. An explicit aria-label/labelledby always wins.

const LABEL_SELECTOR = 'label, [data-slot="label"]';

/** Text of the label that is a direct child of the control's container, or ''. Ignores labels wrapping the control. */
export function siblingLabelText(control) {
  const parent = control?.parentElement;
  if (!parent) return '';
  const labels = [...parent.children].filter((child) => child.matches(LABEL_SELECTOR) && !child.contains(control) && child.textContent.trim());
  if (!labels.length) return '';
  // The closest label before the control wins; a label after it is used only if none precedes it.
  const before = labels.filter((label) => label.compareDocumentPosition(control) & Node.DOCUMENT_POSITION_FOLLOWING);
  return (before.at(-1) ?? labels[0]).textContent.trim();
}

/** True when the control already has a name from aria-label, aria-labelledby, or an associated <label>. */
export function hasAccessibleName(control) {
  return Boolean(control.getAttribute('aria-label') || control.getAttribute('aria-labelledby') || control.labels?.length);
}

/** Names the control from its sibling label when nothing else does. Returns the name applied, or ''. */
export function nameFromSiblingLabel(control) {
  if (!control || hasAccessibleName(control)) return '';
  const name = siblingLabelText(control);
  if (name) control.setAttribute('aria-label', name);
  return name;
}
