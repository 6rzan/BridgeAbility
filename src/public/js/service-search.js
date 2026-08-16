'use strict';

/**
 * Live filtering for the service catalogue (F1).
 *
 * The page works completely without this file: the filter panel is a GET form, the pagination
 * links are real links, and submitting reloads the page with the filters in the query string.
 * This script replaces the reload with a fetch of the same results fragment the server
 * already renders, which means there is no second copy of the card markup to keep in step.
 *
 * Three things it must not break, and does not:
 *  - The URL still changes, through history.pushState, so a filtered view is still
 *    shareable and bookmarkable, and Back still works.
 *  - The result count lives in an aria-live region, so a screen reader user hears what
 *    changed instead of silence.
 *  - Focus is never moved out from under the user while they are typing.
 */
(function () {
  var form = document.querySelector('[data-service-search]');
  var region = document.querySelector('[data-results-region]');
  if (!form || !region || !window.fetch || !window.history.pushState) return;

  // The submit button is only needed when this script is absent, so it is hidden now rather
  // than in the markup -- the no-JavaScript page must still show a way to apply filters.
  var submitButton = form.querySelector('[data-search-submit]');
  if (submitButton) {
    submitButton.hidden = true;
  }

  var DEBOUNCE_MS = 300;
  var timer = null;
  var currentRequest = 0;

  function queryStringFrom(formElement) {
    var params = new URLSearchParams(new FormData(formElement));

    // Drop empty filters so the URL stays readable and matches what a plain form submission
    // would have produced after the server applied its defaults.
    var cleaned = new URLSearchParams();
    params.forEach(function (value, key) {
      if (value !== '') cleaned.set(key, value);
    });

    return cleaned.toString();
  }

  /**
   * Fetch and swap the results fragment.
   *
   * `currentRequest` guards against a slow earlier response landing after a faster later one
   * and showing results for a filter the user has already changed.
   */
  function update(queryString, options) {
    var requestId = ++currentRequest;
    var settings = options || {};

    region.setAttribute('aria-busy', 'true');

    var separator = queryString ? '&' : '';
    fetch('/services?' + queryString + separator + 'partial=results', {
      headers: { 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
    })
      .then(function (response) {
        if (!response.ok) throw new Error('Request failed with status ' + response.status);
        return response.text();
      })
      .then(function (html) {
        if (requestId !== currentRequest) return;

        region.innerHTML = html;
        region.setAttribute('aria-busy', 'false');

        if (!settings.replaceHistory) {
          window.history.pushState({ queryString: queryString }, '', '/services' + (queryString ? '?' + queryString : ''));
        }

        // Following a page link should behave like navigation: move focus to the results so
        // keyboard and screen reader users land on the new page rather than at the top.
        if (settings.focusResults) {
          var count = region.querySelector('#results-count');
          if (count) {
            count.setAttribute('tabindex', '-1');
            count.focus();
          }
        }
      })
      .catch(function () {
        // Fall back to a real navigation. The server renders the same page, so the user gets
        // their results either way and never sees a dead filter panel.
        region.setAttribute('aria-busy', 'false');
        window.location.href = '/services' + (queryString ? '?' + queryString : '');
      });
  }

  function scheduleUpdate() {
    window.clearTimeout(timer);
    timer = window.setTimeout(function () {
      update(queryStringFrom(form));
    }, DEBOUNCE_MS);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    window.clearTimeout(timer);
    update(queryStringFrom(form));
  });

  // Typing is debounced; choosing from a select is deliberate and applies at once.
  form.addEventListener('input', function (event) {
    if (event.target.matches('select')) return;
    scheduleUpdate();
  });

  form.addEventListener('change', function (event) {
    if (!event.target.matches('select')) return;
    window.clearTimeout(timer);
    update(queryStringFrom(form));
  });

  // Pagination links are delegated, because the results region is replaced on every update
  // and a listener bound to a link would be thrown away with it.
  region.addEventListener('click', function (event) {
    var link = event.target.closest('.pagination a');
    if (!link) return;

    // Let the browser handle a modified click, so open-in-new-tab still works.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    event.preventDefault();
    update(link.search.replace(/^\?/, ''), { focusResults: true });
  });

  // Back and forward must show the state they point at, not a stale fragment.
  window.addEventListener('popstate', function () {
    update(window.location.search.replace(/^\?/, ''), { replaceHistory: true });
  });
})();
