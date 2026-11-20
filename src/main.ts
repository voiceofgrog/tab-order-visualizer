/**
 * Entry point. Defines window.TabOrderViz once; loading the bundle again (a second
 * bookmarklet click, or the extension re-injecting) reuses the existing instance.
 * Loading the bundle does nothing visible: the bookmarklet and extension call toggle().
 */
import { computeOrder, type OrderResult } from './order';
import { Overlay } from './overlay';
import { scan } from './scan';
import type { ScanResult } from './types';

export interface TabOrderVizApi {
  version: string;
  /** Computes the Tab order without drawing or touching anything. */
  compute(root?: Element): OrderResult;
  /** Full scan: order, focus measurements, suggested order and issues. */
  scan(): Promise<ScanResult>;
  show(): void;
  hide(): void;
  toggle(): void;
  close(): void;
  isOpen(): boolean;
}

declare global {
  interface Window {
    TabOrderViz?: TabOrderVizApi;
  }
}

if (!window.TabOrderViz) {
  let overlay: Overlay | null = null;
  const api: TabOrderVizApi = {
    version: '0.2.0',
    compute: (root) => computeOrder(root),
    scan: () => scan(),
    show() {
      if (overlay) overlay.setVisible(true);
      else overlay = new Overlay(scan, () => (overlay = null));
    },
    hide() {
      overlay?.setVisible(false);
    },
    toggle() {
      if (overlay) overlay.destroy();
      else api.show();
    },
    close() {
      overlay?.destroy();
    },
    isOpen: () => overlay !== null,
  };
  window.TabOrderViz = api;
}
