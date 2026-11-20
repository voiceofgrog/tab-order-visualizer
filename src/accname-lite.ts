/**
 * Small stand-in for dom-accessibility-api, used only in the bookmarklet build to keep it
 * under Firefox's 65,536-character bookmark limit. The full build (extension, demos, tests)
 * uses the real library.
 *
 * computeAccessibleName returns '' so labelOf() falls back to its own simpler rules
 * (aria-label, aria-labelledby, <label>, visible text, alt, title, placeholder).
 * getRole uses an explicit role attribute, otherwise a tag-based mapping that covers
 * the elements that are usually Tab stops.
 */
export function computeAccessibleName(): string {
  return '';
}

const INPUT_ROLES: Record<string, string> = {
  button: 'button', submit: 'button', reset: 'button', image: 'button',
  checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton',
  search: 'searchbox', email: 'textbox', tel: 'textbox', text: 'textbox', url: 'textbox', password: 'textbox',
};

export function getRole(el: Element): string | null {
  const explicit = el.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  switch (el.localName) {
    case 'a':
    case 'area':
      return el.hasAttribute('href') ? 'link' : null;
    case 'button':
    case 'summary':
      return 'button';
    case 'select':
      return (el as HTMLSelectElement).multiple ? 'listbox' : 'combobox';
    case 'textarea':
      return 'textbox';
    case 'input':
      return INPUT_ROLES[(el as HTMLInputElement).type] ?? 'textbox';
    case 'iframe':
      return 'document';
  }
  return null;
}
