'use strict';

(function () {
  var STORAGE_CONTRAST = 'bridgeability.contrast';
  var STORAGE_SCALE = 'bridgeability.textScale';
  var MIN_SCALE = 0.875;
  var MAX_SCALE = 1.5;
  var STEP = 0.125;

  var root = document.documentElement;
  var bar = document.querySelector('[data-a11y-bar]');
  if (!bar) return;

  bar.hidden = false;

  var contrastButton = bar.querySelector('[data-contrast-toggle]');

  function readScale() {
    var stored = parseFloat(window.localStorage.getItem(STORAGE_SCALE));
    return Number.isFinite(stored) ? stored : 1;
  }

  function applyScale(scale) {
    var clamped = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    root.style.setProperty('--type-scale', String(clamped));
    window.localStorage.setItem(STORAGE_SCALE, String(clamped));
  }

  function applyContrast(isHigh) {
    if (isHigh) {
      root.setAttribute('data-contrast', 'high');
    } else {
      root.removeAttribute('data-contrast');
    }
    contrastButton.setAttribute('aria-pressed', String(isHigh));
    window.localStorage.setItem(STORAGE_CONTRAST, isHigh ? 'high' : 'normal');
  }

  applyScale(readScale());
  applyContrast(window.localStorage.getItem(STORAGE_CONTRAST) === 'high');

  contrastButton.addEventListener('click', function () {
    applyContrast(contrastButton.getAttribute('aria-pressed') !== 'true');
  });

  bar.addEventListener('click', function (event) {
    var button = event.target.closest('[data-text-size]');
    if (!button) return;

    var action = button.getAttribute('data-text-size');
    if (action === 'reset') {
      applyScale(1);
    } else {
      applyScale(readScale() + (action === 'up' ? STEP : -STEP));
    }
  });
})();
