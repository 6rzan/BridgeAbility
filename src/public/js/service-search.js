'use strict';

(function () {
  var form = document.querySelector('[data-service-search]');
  var region = document.querySelector('[data-results-region]');
  if (!form || !region || !window.fetch || !window.history.pushState) return;

  var submitButton = form.querySelector('[data-search-submit]');
  if (submitButton) {
    submitButton.hidden = true;
  }

  var DEBOUNCE_MS = 300;
  var timer = null;
  var currentRequest = 0;

  function queryStringFrom(formElement) {
    var params = new URLSearchParams(new FormData(formElement));

    var cleaned = new URLSearchParams();
    params.forEach(function (value, key) {
      if (value !== '') cleaned.set(key, value);
    });

    return cleaned.toString();
  }

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

        if (settings.focusResults) {
          var count = region.querySelector('#results-count');
          if (count) {
            count.setAttribute('tabindex', '-1');
            count.focus();
          }
        }
      })
      .catch(function () {

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

  form.addEventListener('input', function (event) {
    if (event.target.matches('select')) return;
    scheduleUpdate();
  });

  form.addEventListener('change', function (event) {
    if (!event.target.matches('select')) return;
    window.clearTimeout(timer);
    update(queryStringFrom(form));
  });

  region.addEventListener('click', function (event) {
    var link = event.target.closest('.pagination a');
    if (!link) return;

    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    event.preventDefault();
    update(link.search.replace(/^\?/, ''), { focusResults: true });
  });

  window.addEventListener('popstate', function () {
    update(window.location.search.replace(/^\?/, ''), { replaceHistory: true });
  });
})();
