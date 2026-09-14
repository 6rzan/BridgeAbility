'use strict';



(function () {
  var form = document.querySelector('form[data-image-upload]');
  if (!form) return;


  form.hidden = false;

  var fileInput = form.querySelector('[data-image-file]');
  var keyInput = form.querySelector('[data-image-key]');
  var submitButton = form.querySelector('[data-image-submit]');
  var statusRegion = form.querySelector('[data-image-status]');
  var errorRegion = form.querySelector('[data-image-error]');
  var errorText = errorRegion.querySelector('[data-error-text]');
  var altInput = form.querySelector('#field-altText');

  var csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
  var presignUrl = form.getAttribute('data-presign-url');


  var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];


  var uploaded = false;

  function setStatus(message) {
    statusRegion.textContent = message;
  }

  function showError(message) {
    errorText.textContent = message;
    errorRegion.hidden = false;
    setStatus('');
  }

  function clearError() {
    errorText.textContent = '';
    errorRegion.hidden = true;
  }

  function setBusy(busy) {
    submitButton.disabled = busy;
    form.setAttribute('aria-busy', busy ? 'true' : 'false');
  }


  function requestUpload(file) {
    return fetch(presignUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },

      credentials: 'same-origin',
      body: JSON.stringify({ contentType: file.type, contentLength: file.size }),
    }).then(function (response) {
      return response.json().then(function (body) {
        if (!response.ok) {
          throw new Error(body.error || 'The upload could not be authorised.');
        }
        return body;
      });
    });
  }



  function putToS3(uploadUrl, file) {
    return fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('The image could not be uploaded. Please try again.');
      }
    });
  }


  fileInput.addEventListener('change', function () {
    uploaded = false;
    keyInput.value = '';
    clearError();
    setStatus('');
  });

  form.addEventListener('submit', function (event) {

    if (uploaded && keyInput.value) {
      return;
    }

    event.preventDefault();
    clearError();

    var file = fileInput.files && fileInput.files[0];

    if (!file) {
      showError('Choose an image file to upload.');
      fileInput.focus();
      return;
    }

    if (ALLOWED_TYPES.indexOf(file.type) === -1) {
      showError('Upload a JPEG, PNG or WebP image.');
      fileInput.focus();
      return;
    }


    if (!altInput.value || altInput.value.trim().length < 10) {
      showError('Describe what the image shows, in at least 10 characters.');
      altInput.focus();
      return;
    }

    setBusy(true);
    setStatus('Uploading…');

    requestUpload(file)
      .then(function (authorisation) {
        return putToS3(authorisation.uploadUrl, file).then(function () {
          keyInput.value = authorisation.key;
          uploaded = true;
        });
      })
      .then(function () {
        setStatus('Uploaded. Saving…');

        form.submit();
      })
      .catch(function (error) {
        setBusy(false);
        showError(error.message);
      });
  });
}());
