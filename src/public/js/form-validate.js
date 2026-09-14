'use strict';

/**
 * Client-side form validation and the registration form's role-dependent sections.
 *
 * This is an enhancement and nothing depends on it. Forms carry `novalidate` so the browser's
 * own bubbles do not compete with our messages, and every rule below is also enforced by zod
 * on the server -- these checks make the feedback immediate, they do not make it trustworthy.
 * With scripting off the form still submits and the server still rejects bad input.
 *
 * The markup it writes into is the same markup the server renders on a failed submission:
 * the same .field__error element, the same aria-describedby wiring, the same error summary.
 * A user cannot tell which side produced the message, and there is only one thing to test.
 */
(function () {
  var forms = document.querySelectorAll('form[data-validate]');
  if (forms.length === 0) return;

  function fieldOf(control) {
    return control.closest('.field');
  }

  function showError(control, message) {
    var field = fieldOf(control);
    if (!field) return;

    var errorElement = field.querySelector('.field__error');
    var text = errorElement.querySelector('[data-error-text]');

    text.textContent = message;
    errorElement.hidden = false;
    control.setAttribute('aria-invalid', 'true');

    // The error element always exists in the markup, so its id is already listed in
    // aria-describedby; nothing needs rewiring when it becomes visible.
  }

  function clearError(control) {
    var field = fieldOf(control);
    if (!field) return;

    var errorElement = field.querySelector('.field__error');
    errorElement.hidden = true;
    errorElement.querySelector('[data-error-text]').textContent = '';
    control.removeAttribute('aria-invalid');
  }

  /** Returns a message, or null when the control is acceptable. */
  function validate(control) {
    var value = control.value.trim();
    var label = control.closest('.field').querySelector('label').textContent.trim();

    if (control.required && value === '') {
      // A field can author its own wording where the label does not make a readable
      // sentence -- "Enter your confirm password" being the obvious one.
      return control.getAttribute('data-required-message')
        || 'Enter your ' + label.replace(/\s*\(optional\)$/, '').toLowerCase() + '.';
    }

    if (value === '') {
      return null;
    }

    if (control.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return 'Enter an email address in the format name@example.com.';
    }

    var minlength = parseInt(control.getAttribute('minlength'), 10);
    if (Number.isFinite(minlength) && value.length < minlength) {
      return 'Use at least ' + minlength + ' characters.';
    }

    if (control.name === 'confirmPassword') {
      var password = control.form.querySelector('[name="password"]');
      if (password && password.value !== control.value) {
        return 'Both password fields must match.';
      }
    }

    return null;
  }

  /**
   * Only validates controls the user has actually finished with. Validating everything as
   * soon as the page loads, or on every keystroke, tells someone their email is invalid while
   * they are still typing the first character of it.
   */
  function attachBlurValidation(form) {
    form.addEventListener('blur', function (event) {
      var control = event.target;
      if (!control.matches('.input, .textarea, .select')) return;
      if (!control.dataset.touched) return;

      var message = validate(control);
      if (message) {
        showError(control, message);
      } else {
        clearError(control);
      }
    }, true);

    form.addEventListener('input', function (event) {
      var control = event.target;
      if (!control.matches('.input, .textarea, .select')) return;

      control.dataset.touched = 'true';
      // Clear a message as soon as the user starts fixing it, rather than making them
      // submit again to find out whether they have.
      if (control.getAttribute('aria-invalid') === 'true' && !validate(control)) {
        clearError(control);
      }
    });
  }

  /**
   * On submit, collect every problem, rebuild the summary at the top, and move focus to it.
   * Focus is what makes the failure perceivable to a screen reader user; without it the page
   * simply does not appear to respond.
   */
  function attachSubmitValidation(form) {
    form.addEventListener('submit', function (event) {
      var controls = form.querySelectorAll('.input, .textarea, .select');
      var problems = [];

      Array.prototype.forEach.call(controls, function (control) {
        if (control.closest('[hidden]')) return;

        var message = validate(control);
        if (message) {
          showError(control, message);
          problems.push({ id: control.id, message: message });
        } else {
          clearError(control);
        }
      });

      if (problems.length === 0) return;

      event.preventDefault();
      renderSummary(form, problems);
    });
  }

  function renderSummary(form, problems) {
    var summary = form.parentNode.querySelector('[data-error-summary]');

    if (!summary) {
      summary = document.createElement('div');
      summary.className = 'alert alert--error';
      summary.setAttribute('role', 'alert');
      summary.setAttribute('tabindex', '-1');
      summary.setAttribute('data-error-summary', '');
      form.parentNode.insertBefore(summary, form);
    }

    summary.textContent = '';

    var icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('class', 'icon');
    icon.setAttribute('aria-hidden', 'true');
    icon.setAttribute('focusable', 'false');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#icon-error');
    icon.appendChild(use);

    var body = document.createElement('div');
    body.className = 'alert__body';

    var heading = document.createElement('h2');
    heading.className = 'panel__title';
    heading.textContent = problems.length === 1
      ? 'There is a problem'
      : 'There are ' + problems.length + ' problems';

    var list = document.createElement('ul');
    problems.forEach(function (problem) {
      var item = document.createElement('li');
      var link = document.createElement('a');
      link.href = '#' + problem.id;
      link.textContent = problem.message;
      item.appendChild(link);
      list.appendChild(item);
    });

    body.appendChild(heading);
    body.appendChild(list);
    summary.appendChild(icon);
    summary.appendChild(body);

    summary.focus();
  }

  /**
   * Registration only: hide whichever section does not apply to the selected role. The server
   * renders both visible, so this narrowing is purely an enhancement -- see the comment in
   * views/auth/register.ejs for why that direction matters.
   */
  function attachRolePanels(form) {
    var choices = form.querySelectorAll('[data-role-choice]');
    var panels = form.querySelectorAll('[data-role-panel]');
    if (choices.length === 0 || panels.length === 0) return;

    function apply() {
      var selected = form.querySelector('[data-role-choice]:checked');
      if (!selected) return;

      Array.prototype.forEach.call(panels, function (panel) {
        panel.hidden = panel.getAttribute('data-role-panel') !== selected.value;
      });
    }

    Array.prototype.forEach.call(choices, function (choice) {
      choice.addEventListener('change', apply);
    });

    apply();
  }

  Array.prototype.forEach.call(forms, function (form) {
    attachBlurValidation(form);
    attachSubmitValidation(form);
    attachRolePanels(form);
  });

  // If the server rendered a summary, put focus on it for the same reason: the user has just
  // navigated and needs to know why they are back on the form.
  var serverSummary = document.querySelector('[data-error-summary]');
  if (serverSummary) {
    serverSummary.focus();
  }
})();
