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

export const parseMultipartFormData = (req, res, next) => {
  if (req.body.formData && typeof req.body.formData === 'string') {
    try {
      req.body.formData = JSON.parse(req.body.formData);
    } catch (e) {
      res.status(400);
      return next(new Error('Invalid JSON format in formData'));
    }
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
    .isObject()
    .withMessage('Form data must be an object'),
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
