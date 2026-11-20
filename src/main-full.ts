/**
 * Full build: the core tool plus axe-core (MPL-2.0, unmodified; license in
 * THIRD-PARTY-LICENSES.txt next to the bundle). Used by the demo pages, tests and extension.
 * Note: axe-core also defines window.axe on load.
 */
import axe from 'axe-core';
import './main';

const w = window as unknown as { __tovAxe?: unknown };
w.__tovAxe ??= axe;
