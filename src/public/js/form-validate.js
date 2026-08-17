'use strict';



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


  }

  function clearError(control) {
    var field = fieldOf(control);
    if (!field) return;

    var errorElement = field.querySelector('.field__error');
    errorElement.hidden = true;
    errorElement.querySelector('[data-error-text]').textContent = '';
    control.removeAttribute('aria-invalid');
  }


  function validate(control) {
    var value = control.value.trim();
    var label = control.closest('.field').querySelector('label').textContent.trim();

    if (control.required && value === '') {

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

      if (control.getAttribute('aria-invalid') === 'true' && !validate(control)) {
        clearError(control);
      }
    });
  }



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


  var serverSummary = document.querySelector('[data-error-summary]');
  if (serverSummary) {
    serverSummary.focus();
  }
})();
