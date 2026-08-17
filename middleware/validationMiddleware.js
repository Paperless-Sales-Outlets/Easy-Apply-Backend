import { body, query, validationResult } from 'express-validator';

// Middleware to evaluate the validation result
export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errorMsg = errors.array().map((err) => err.msg).join(', ');
    res.status(400);
    return next(new Error(errorMsg));
  }
  next();
};

// Validation rules for submitting an application
export const validateApplicationSubmission = [
  body('serviceType')
    .trim()
    .notEmpty()
    .withMessage('Service type is required')
    .isIn([
      'new-connection',
      'reconnection',
      'relocation',
      'termination',
      'transfer',
      'package-migration',
      'service-vacation',
      'refund-request',
      'customer-request-acceptance',
    ])
    .withMessage('Invalid service type'),
  body('formData')
    .notEmpty()
    .withMessage('Form data is required')
    .custom((value, { req }) => {
      // If req.body.formData arrives as a string (from multipart form-data), parse it
      let parsedData = value;
      if (typeof value === 'string') {
        try {
          parsedData = JSON.parse(value);
          req.body.formData = parsedData;
        } catch (e) {
          throw new Error('Invalid JSON structure in formData');
        }
      }

      if (typeof parsedData !== 'object' || parsedData === null) {
        throw new Error('Form data must be an object');
      }

      // BRD 5.1.6 Validation: Validate package selection or cart items for new connection
      if (req.body.serviceType === 'new-connection') {
        const hasCartItems = Array.isArray(parsedData.cartItems) && parsedData.cartItems.length > 0;
        const broadbandPkg = parsedData.broadbandPackage || parsedData.otherBroadbandPackage;
        if (!hasCartItems && !broadbandPkg) {
          throw new Error('Selection of at least one Broadband / Telecom Package is mandatory.');
        }
      }

      return true;
    }),
  validateRequest,
];

// Validation rules for updating status
export const validateStatusUpdate = [
  body('status')
    .trim()
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['pending', 'approved', 'rejected', 'flagged'])
    .withMessage('Invalid status value. Must be one of: pending, approved, rejected, flagged'),
  validateRequest,
];

// Validation rules for checking public status
export const validatePublicStatusCheck = [
  query('ref')
    .trim()
    .notEmpty()
    .withMessage('Application reference number (ref) is required'),
  validateRequest,
];
