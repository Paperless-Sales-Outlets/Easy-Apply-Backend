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
  body('phone')
    .optional()
    .matches(/^07\d{8}$/)
    .withMessage('Verified mobile must be 10 digits starting with 07'),
  body('formData.telephone')
    .optional()
    .matches(/^01\d{8}$/)
    .withMessage('Fixed telephone must be 10 digits starting with 01'),
  body().custom((value, { req }) => {
    if (req.body.serviceType === 'reconnection') {
      const data = req.body.formData || {};
      const hasFacility = data.facility_broadband || data.facility_peoTv || data.facility_sltPlus || data.facility_cli || data.facility_idd || data.facility_email || data.facility_dialUp || data.facility_other;
      
      if (!hasFacility) {
        throw new Error('At least one facility must be selected for reconnection');
      }

      if (data.facility_email && !data.emailUsername) {
        throw new Error('Email Username is required when Email facility is selected');
      }

      if (data.facility_dialUp && !data.dialUpUsername) {
        throw new Error('Dial-up Username is required when Dial-up facility is selected');
      }

      // Add Payment receipt validation (if a user theoretically indicated 'already settled')
      // Note: we can check req.files here
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

// Validation rules for PayHere payment creation
export const validatePaymentCreate = [
  body('orderId')
    .optional()
    .trim(),
  body('amount')
    .notEmpty()
    .withMessage('Payment amount is required')
    .isNumeric()
    .withMessage('Amount must be a valid number')
    .custom((val) => parseFloat(val) > 0)
    .withMessage('Amount must be greater than 0'),
  validateRequest,
];

