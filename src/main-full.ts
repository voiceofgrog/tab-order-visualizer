/**
 * Full build: the core tool plus axe-core (MPL-2.0, unmodified; license in
 * THIRD-PARTY-LICENSES.txt next to the bundle). Used by the demo pages, tests and extension.
 * The axe wrapper and its plain-language rule texts live only in this build, which keeps the
 * bookmarklet small. Note: axe-core also defines window.axe on load.
 */
import axe from 'axe-core';
import { runAxe } from './axe';
import './main';

const w = window as unknown as { __tovAxeRunner?: () => Promise<unknown> };
w.__tovAxeRunner ??= () => runAxe(axe as never);
