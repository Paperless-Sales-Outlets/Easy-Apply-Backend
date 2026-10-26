import { body, query, validationResult } from 'express-validator';


// Middleware to evaluate validation result
export const validateRequest = (req, res, next) => {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    const errorMsg = errors.array().map((err) => err.msg).join(', ');
    res.status(400);
    return next(new Error(errorMsg));
  }

  next();
};


// Middleware to parse multipart formData JSON
export const parseMultipartFormData = (req, res, next) => {

  if (
    req.body.formData &&
    typeof req.body.formData === 'string'
  ) {

    try {
      req.body.formData = JSON.parse(req.body.formData);

    } catch {

      res.status(400);
      return next(
        new Error('Invalid JSON format in formData')
      );

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
    .isIn(['new-connection'])
    .withMessage('Invalid service type'),



  body('formData')
    .notEmpty()
    .withMessage('Form data is required')

    .custom((value, { req }) => {

      let parsedData = value;


      // Parse multipart JSON
      if (typeof value === 'string') {

        try {

          parsedData = JSON.parse(value);
          req.body.formData = parsedData;

        } catch {

          throw new Error(
            'Invalid JSON structure in formData'
          );

        }

      }


      if (
        typeof parsedData !== 'object' ||
        parsedData === null
      ) {

        throw new Error(
          'Form data must be an object'
        );

      }

      return true;

    }),



  // Verified contact phone number validation (mobile or fixed 10 digits starting with 0)
  body('phone')
    .optional()
    .customSanitizer(value => {
      if (typeof value === 'string' && value.match(/^7\d{8}$/)) {
        return '0' + value;
      }
      return value;
    })
    .matches(/^0\d{9}$/)
    .withMessage(
      'Verified phone must be 10 digits starting with 0'
    ),



  // Fixed telephone or account number validation
  body('formData.telephone')
    .optional()
    .matches(/^\d{10}$/)
    .withMessage(
      'Telephone or Account number must be exactly 10 digits'
    ),




  validateRequest,

];




// Validation rules for public status check
export const validatePublicStatusCheck = [
  query('ref')
    .optional()
    .trim(),
  query('referenceNumber')
    .optional()
    .trim(),
  (req, res, next) => {
    const val = req.query.ref || req.query.referenceNumber;
    if (!val || !val.trim()) {
      res.status(400);
      return next(new Error('Application reference number is required'));
    }
    req.query.ref = val.trim();
    next();
  },
];




// Validation rules for PayHere payment creation
export const validatePaymentCreate = [

  body('orderId')
    .optional()
    .trim(),


  body('amount')
    .notEmpty()
    .withMessage(
      'Payment amount is required'
    )
    .isNumeric()
    .withMessage(
      'Amount must be a valid number'
    )
    .custom((val) => parseFloat(val) > 0)
    .withMessage(
      'Amount must be greater than 0'
    ),


  validateRequest,

];


// Validation for reviewing a KYC case (approve / reject / flag / reopen)
export const validateKycReview = [
  body('status')
    .trim()
    .toLowerCase()
    .notEmpty()
    .withMessage('Review status is required')
    .isIn(['pending', 'approved', 'rejected', 'flagged'])
    .withMessage('Invalid review status. Must be one of: pending, approved, rejected, flagged'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes must be at most 2000 characters'),
  validateRequest,
];


// Validation for updating an application's status (approve / reject / flag / etc.)
export const validateUpdateApplicationStatus = [
  body('status')
    .trim()
    .toLowerCase()
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['pending', 'pending payment', 'approved', 'confirmed', 'completed', 'rejected', 'flagged'])
    .withMessage('Invalid status value. Must be one of: pending, pending payment, approved, confirmed, completed, rejected, flagged'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes must be at most 2000 characters'),
  validateRequest,
];


// Validation for get forms query parameters
export const validateGetFormsQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('Limit must be between 1 and 200'),
  validateRequest,
];


// Validation for updating office fields (CR Number, Amount Paid, Staff Signature, Appointment Date)
export const validateOfficeFields = [
  body('crNumber')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('CR Number must be at most 100 characters'),
  body('amountPaid')
    .optional()
    .custom((value) => {
      if (value === null) return true;
      if (typeof value === 'string' && value.trim() === '') return true;
      const num = Number(value);
      if (isNaN(num) || num < 0) throw new Error('Amount Paid must be a non-negative number');
      return true;
    }),
  body('staffSignature')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Staff Signature must be at most 200 characters'),
  body('appointmentDate')
    .optional()
    .custom((value) => {
      if (value === null || value === '') return true;
      const date = new Date(value);
      if (isNaN(date.getTime())) throw new Error('Appointment Date must be a valid date');
      return true;
    }),
  validateRequest,
];