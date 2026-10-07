'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireSession, requireAnyRole } = require('../middleware/auth');
const { ROLES, STAFF_ROLES } = require('../constants/roles');
const { time } = require('../utils/timing');
const {
  createProductImageService,
  validateProductImageInput,
} = require('../services/ProductImageService');

const ALLOWED_QUERY_KEYS = new Set(['dataAreaId', 'itemNumber']);

function hasOnlyImageQueryParameters(query) {
  return Object.keys(query || {}).every((key) => ALLOWED_QUERY_KEYS.has(key));
}

function createGetProductImageHandler({ productImageService, timeFn = time }) {
  return async (req, res) => {
    const input = validateProductImageInput(req.query);
    if (!input || !hasOnlyImageQueryParameters(req.query)) {
      res.set('Cache-Control', 'no-store');
      return res.status(400).json({ error: 'Invalid product image parameters' });
    }

    try {
      const image = await timeFn('product_image_d365', () => productImageService.getProductImage(input));
      if (!image) {
        res.set('Cache-Control', 'no-store');
        return res.status(204).end();
      }

      // Productbeelden wijzigen zelden; een lange private browser-cache (1 dag) zorgt dat een
      // terugkeer naar het bord geen losse image-requests meer afvuurt (minder "flitsen" + minder
      // rate-limit-druk). De server-side cache in ProductImageService dekt de eerste koude fetch.
      res.set('Cache-Control', 'private, max-age=86400');
      return res.type(image.contentType).send(image.content);
    } catch {
      res.set('Cache-Control', 'no-store');
      return res.status(502).json({ error: 'Product image is temporarily unavailable' });
    }
  };
}

function createMediaRouter({
  productImageService = createProductImageService(),
  rateLimiter = rateLimit({
    // Een beeld-zwaar bord laadt bij de eerste paint tientallen product-images (één request per
    // uniek item). 60/min was te krap → sommige thumbnails kregen 429 en "flitsten" later of
    // verdwenen. 300/min dekt een grote eerste laadbeurt; daarna serveert de browser-cache (1 dag).
    windowMs: 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  }),
  requireSessionFn = requireSession,
  requireAnyRoleFn = requireAnyRole,
  timeFn = time,
} = {}) {
  const router = express.Router();
  const staffOnly = requireAnyRoleFn(STAFF_ROLES);

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get(
    '/product-image',
    rateLimiter,
    requireSessionFn,
    staffOnly,
    createGetProductImageHandler({ productImageService, timeFn })
  );

  return router;
}

module.exports = {
  createGetProductImageHandler,
  createMediaRouter,
  hasOnlyImageQueryParameters,
};
