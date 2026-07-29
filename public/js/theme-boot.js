/**
 * theme-boot.js
 *
 * Applies the saved theme before the first paint. Loaded as a blocking script
 * in <head> rather than inline: the Content-Security-Policy has no
 * 'unsafe-inline' for scripts, so an inline block here would never run and
 * every load would flash the default colours.
 */
(function () {
  try {
    var t = localStorage.getItem('inkmagik.theme');
    if (t === 'board' || t === 'paper') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* private mode — default theme is fine */ }
})();
