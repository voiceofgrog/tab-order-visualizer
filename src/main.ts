/**
 * Entry point. Defines window.TabOrderViz once; loading the bundle again (a second
 * bookmarklet click, or the extension re-injecting) reuses the existing instance.
 * Loading the bundle does nothing visible: the bookmarklet and extension call toggle().
 */
import { computeOrder, type OrderResult } from './order';
import { Overlay } from './overlay';

export interface TabOrderVizApi {
  version: string;
  /** Computes the Tab order without drawing anything. */
  compute(root?: Element): OrderResult;
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
    version: '0.1.0',
    compute: (root) => computeOrder(root),
    show() {
      if (overlay) overlay.setVisible(true);
      else overlay = new Overlay(() => computeOrder(), () => (overlay = null));
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
