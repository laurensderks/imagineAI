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
      this.drawing.loadPage(this.pages[index]);
      this._updateUI();
      if (typeof this.onPageChange === 'function') this.onPageChange();
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
