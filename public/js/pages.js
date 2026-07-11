/**
 * pages.js
 *
 * Manages a fixed set of independent drawing pages, like a small sketchbook.
 * Each page keeps its own stroke history — switching pages swaps which
 * history array the DrawingCanvas is pointed at, so nothing is ever lost,
 * and the user can jump to any page at any time.
 */

(function (global) {
  const PAGE_COUNT = 4;

  class PageManager {
    constructor({ drawing, tabsContainer, onPageChange }) {
      this.drawing = drawing;
      this.tabsContainer = tabsContainer;
      this.onPageChange = onPageChange;

      // Each page owns its own stroke history array.
      this.pages = Array.from({ length: PAGE_COUNT }, () => []);
      this.currentIndex = 0;

      this._renderTabs();
      this._updateUI();
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

    goTo(index) {
      if (index < 0 || index >= this.pages.length || index === this.currentIndex) return;
      // Capture whatever the current page's history array is right now
      // (it may have been reassigned by clear()) before switching away.
      this.pages[this.currentIndex] = this.drawing.history;
      this.currentIndex = index;

      // Clear any half-finished fill from a tab we were mid-load on (rapid taps).
      this._clearLoadingTab();

      // Light the target tab up *now* so the tap registers instantly, then let
      // its accent gradient fill from the bottom as the page's strokes redraw —
      // real progress, so there's no need to keep tapping.
      this._updateUI();
      const tab = this.tabs[index];
      tab.classList.add('loading');
      tab.style.setProperty('--load', '0');
      this._loadingTab = tab;
      // Dim the current page while its replacement renders off-screen.
      this.drawing.canvas.classList.add('page-loading');

      this.drawing.loadPageProgressive(
        this.pages[index],
        (p) => { tab.style.setProperty('--load', String(p)); },
        () => {
          tab.classList.remove('loading');
          tab.style.removeProperty('--load');
          this.drawing.canvas.classList.remove('page-loading'); // brighten new page in
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

    // Returns the up-to-date pages + current index (re-capturing the live
    // history first, since clear() swaps in a fresh array). Used by autosave.
    snapshot() {
      this.pages[this.currentIndex] = this.drawing.history;
      return { pages: this.pages, index: this.currentIndex };
    }

    // Replaces all pages with restored histories and shows the given page.
    restore(pages, index) {
      this.pages = Array.from({ length: PAGE_COUNT }, (_, i) =>
        Array.isArray(pages[i]) ? pages[i] : []
      );
      this.currentIndex = Math.min(Math.max(0, index | 0), PAGE_COUNT - 1);
      this.drawing.loadPage(this.pages[this.currentIndex]);
      this._updateUI();
    }
  }

  global.PageManager = PageManager;
})(window);
