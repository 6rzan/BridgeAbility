'use strict';

/**
 * Direct-to-S3 upload of a listing image (F3).
 *
 * HOW THE FILE TRAVELS
 *
 *   1. The browser asks our server for permission: POST .../image/presign with the file's
 *      type and exact byte length.
 *   2. The server checks the provider owns the listing, checks the type and size, derives a
 *      key under that provider's own path, and returns a presigned PUT URL.
 *   3. The browser PUTs the file straight to S3. It never touches the application tier.
 *   4. The browser submits the ordinary form, carrying the key and the alt text, and the
 *      server records them against the listing.
 *
 * Steps 1 and 4 are the ones that check anything; step 3 is enforced by S3 against the
 * signature, which has the content type and the content length baked into it. A caller who
 * skips this script entirely still cannot attach an image to a listing they do not own: the
 * confirm step re-derives the expected key shape and rejects anything else.
 *
 * This is the only place in the application where an interaction genuinely needs scripting.
 * The form it drives starts hidden and is revealed here, and a <noscript> beside it explains
 * why, so a user with scripting off is told rather than left clicking a control that does
 * nothing. Every other action on the page is a plain form post.
 */
(function () {
  var form = document.querySelector('form[data-image-upload]');
  if (!form) return;

  // The markup is inert until this script runs, so revealing it here is the promise that
  // something is behind it.
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

  // Mirrors validation/providerServiceSchemas.js. This copy exists to answer quickly, not to
  // decide -- the server checks the same things and its answer is the one that counts.
  var ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

  // `uploaded` stops a second click re-uploading a file that is already in S3, which would
  // leave an orphaned object behind for no reason.
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

  /** Ask our server to authorise this exact file. */
  function requestUpload(file) {
    return fetch(presignUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      // Same-origin by default, but stated so the CSRF cookie's presence is not accidental.
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

  /**
   * Send the bytes to S3.
   *
   * The Content-Type header must be exactly what was signed. S3 answers 403 if it differs, so
   * this is not a formality -- it is the same value that went into requestUpload above.
   */
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

  // A newly chosen file invalidates whatever was uploaded before it.
  fileInput.addEventListener('change', function () {
    uploaded = false;
    keyInput.value = '';
    clearError();
    setStatus('');
  });

  form.addEventListener('submit', function (event) {
    // Once the file is in S3 and the key is in the hidden field, this is an ordinary form
    // post and the browser should be left to make it.
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

    // Alt text is checked before a byte is sent, so a missing description costs nothing to
    // correct. The server refuses the confirm step without it regardless.
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
        // Resubmit; the guard at the top of this handler now lets it through.
        form.submit();
      })
      .catch(function (error) {
        setBusy(false);
        showError(error.message);
      });
  });
}());
