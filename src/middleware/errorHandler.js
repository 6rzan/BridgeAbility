'use strict';

/** 404 handler -- runs when no route matched. */
function notFound(req, res) {
  res.status(404);
  if (req.accepts('html')) {
    return res.render('error', {
      title: 'Page not found',
      statusCode: 404,
      message: 'We could not find that page.',
    });
  }
  return res.json({ error: 'Not found' });
}

/**
 * Central error handler.
 *
 * Internal error details are logged server-side but never sent to the browser, so a stack
 * trace or SQL fragment cannot leak to a user.
 */
function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode && error.statusCode < 500 ? error.statusCode : 500;

  if (statusCode >= 500) {
    console.error('[error]', { path: req.path, method: req.method, message: error.message, stack: error.stack });
  }

  const message = statusCode >= 500 ? 'Something went wrong on our side.' : error.message;

  res.status(statusCode);
  if (req.accepts('html')) {
    return res.render('error', { title: 'Something went wrong', statusCode, message });
  }
  return res.json({ error: message });
}

module.exports = { notFound, errorHandler };
