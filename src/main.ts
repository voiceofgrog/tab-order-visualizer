/**
 * Entry point. Defines window.TabOrderViz once; loading the bundle again (a second
 * bookmarklet click, or the extension re-injecting) reuses the existing instance.
 * Loading the bundle does nothing visible: the bookmarklet and extension call toggle().
 */
import { computeOrder, type OrderResult } from './order';
import { Overlay } from './overlay';
import { scan } from './scan';
import { estimate, skipLinkEstimate, type Announcement, type Estimate, type SkipEstimate } from './time';
import type { ScanResult } from './types';

export interface TabOrderVizApi {
  version: string;
  /** Computes the Tab order without drawing or touching anything. */
  compute(root?: Element): OrderResult;
  /** Full scan: order, focus measurements, suggested order and issues. */
  scan(): Promise<ScanResult>;
  /** Time model for reaching Tab stop number `index` (1-based), plus skip-link savings. */
  estimate(index: number): Promise<{ announcement: Announcement; estimates: Estimate[]; skip: SkipEstimate | null }>;
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
    async estimate(index) {
      const r = await scan();
      const target = r.order.stops[index - 1];
      if (!target) throw new RangeError(`There is no Tab stop ${index}; the page has ${r.order.stops.length}.`);
      return { announcement: r.announcements.get(target)!, estimates: estimate(r, target), skip: skipLinkEstimate(r) };
    },
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
