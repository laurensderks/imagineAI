/**
 * pages.js
 *
 * Manages a fixed set of independent drawing pages, like a small sketchbook.
 * Each page keeps its own set of layer histories (back / middle / foreground)
 * plus which layer was active — switching pages swaps all of that into the
 * DrawingCanvas, so nothing is ever lost and the user can jump to any page at
 * any time.
 */

(function (global) {
  const PAGE_COUNT = 4;
  const LAYER_COUNT = 3;

  const emptyPage = () => ({
    layers: Array.from({ length: LAYER_COUNT }, () => []),
    active: 1, // middle
  });

  class PageManager {
    constructor({ drawing, tabsContainer, onPageChange }) {
      this.drawing = drawing;
      this.tabsContainer = tabsContainer;
      this.onPageChange = onPageChange;

      this.pages = Array.from({ length: PAGE_COUNT }, emptyPage);
      this.currentIndex = 0;

      this._renderTabs();
      this._updateUI();
      const p0 = this.pages[0];
      this.drawing.loadLayers(p0.layers, p0.active);
    }

    _renderTabs() {
      this.tabsContainer.innerHTML = '';
      this.tabs = this.pages.map((_, i) => {
        const btn = document.createElement('button');
        btn.className = 'page-tab';
        btn.type = 'button';
        btn.textContent = String(i + 1);
        btn.setAttribute('aria-label', `Go to page ${i + 1}`);
        btn.addEventListener('click', () => this.goTo(i));
        this.tabsContainer.appendChild(btn);
        return btn;
      });
    }

    _updateUI() {
      this.tabs.forEach((tab, i) => tab.classList.toggle('active', i === this.currentIndex));
    }

    // Snapshot the live layer histories + active layer back into the current
    // page before we switch away (they may have been reassigned by clear()).
    _captureCurrent() {
      this.pages[this.currentIndex] = {
        layers: this.drawing.getLayers(),
        active: this.drawing.getActiveLayer(),
      };
    }

    goTo(index) {
      if (index < 0 || index >= this.pages.length || index === this.currentIndex) return;
      this._captureCurrent();
      this.currentIndex = index;

      // Clear any half-finished fill from a tab we were mid-load on (rapid taps).
      this._clearLoadingTab();

      // Light the target tab up now so the tap registers instantly, then let
      // its accent gradient fill from the bottom as the page's layers redraw.
      this._updateUI();
      const tab = this.tabs[index];
      tab.classList.add('loading');
      tab.style.setProperty('--load', '0');
      this._loadingTab = tab;
      // Dim the current page while its replacement renders off-screen.
      this.drawing.setLoadingDim(true);

      const page = this.pages[index];
      this.drawing.loadLayersProgressive(
        page.layers,
        page.active,
        (p) => { tab.style.setProperty('--load', String(p)); },
        () => {
          tab.classList.remove('loading');
          tab.style.removeProperty('--load');
          this.drawing.setLoadingDim(false); // brighten new page in
          if (this._loadingTab === tab) this._loadingTab = null;
        }
      );

      if (typeof this.onPageChange === 'function') this.onPageChange();
    }

    _clearLoadingTab() {
      if (this._loadingTab) {
        this._loadingTab.classList.remove('loading');
        this._loadingTab.style.removeProperty('--load');
        this._loadingTab = null;
      }
    }

    // Returns the up-to-date pages + current index (re-capturing the live state
    // first). Used by autosave.
    snapshot() {
      this._captureCurrent();
      return { pages: this.pages, index: this.currentIndex };
    }

    // Replaces all pages with restored layer sets and shows the given page.
    restore(pages, index) {
      this.pages = Array.from({ length: PAGE_COUNT }, (_, i) => {
        const pg = pages[i];
        if (!pg || !Array.isArray(pg.layers)) return emptyPage();
        return {
          layers: Array.from({ length: LAYER_COUNT }, (_, li) =>
            Array.isArray(pg.layers[li]) ? pg.layers[li] : []),
          active: Math.min(Math.max(0, pg.active | 0), LAYER_COUNT - 1),
        };
      });
      this.currentIndex = Math.min(Math.max(0, index | 0), PAGE_COUNT - 1);
      const cur = this.pages[this.currentIndex];
      this.drawing.loadLayers(cur.layers, cur.active);
      this._updateUI();
    }
  }

  global.PageManager = PageManager;
})(window);
