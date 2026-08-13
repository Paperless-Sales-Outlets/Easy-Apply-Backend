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

    } catch (e) {

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
      'internet-services',
    ])
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

        } catch (e) {

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



      // BRD 5.1.6
      // Broadband package mandatory for new connection
      if (
        req.body.serviceType === 'new-connection'
      ) {

        const broadbandPkg =
          parsedData.broadbandPackage ||
          parsedData.otherBroadbandPackage;


        if (!broadbandPkg) {

          throw new Error(
            'Selection of at least one Broadband Package is mandatory per BRD 5.1.6.'
          );

        }

      }


      return true;

    }),



  // Mobile number validation
  body('phone')
    .optional()
    .customSanitizer(value => {
      if (typeof value === 'string' && value.match(/^7\d{8}$/)) {
        return '0' + value;
      }
      return value;
    })
    .matches(/^07\d{8}$/)
    .withMessage(
      'Verified mobile must be 10 digits starting with 07'
    ),



  // Fixed telephone or account number validation
  body('formData.telephone')
    .optional()
    .matches(/^\d{10}$/)
    .withMessage(
      'Telephone or Account number must be exactly 10 digits'
    ),




  // Service-specific validations
  body().custom((value, { req }) => {


    if (
      req.body.serviceType === 'reconnection'
    ) {


      const data =
        req.body.formData || {};



      const hasFacility =
        data.facility_broadband ||
        data.facility_peoTv ||
        data.facility_sltPlus ||
        data.facility_cli ||
        data.facility_idd ||
        data.facility_email ||
        data.facility_dialUp ||
        data.facility_other;



      if (!hasFacility) {

        throw new Error(
          'At least one facility must be selected for reconnection'
        );

      }




      if (
        data.facility_email &&
        !data.emailUsername
      ) {

        throw new Error(
          'Email Username is required when Email facility is selected'
        );

      }




      if (
        data.facility_dialUp &&
        !data.dialUpUsername
      ) {

        throw new Error(
          'Dial-up Username is required when Dial-up facility is selected'
        );

      }

      if (
        data.facility_other &&
        !data.otherServiceText
      ) {
        throw new Error(
          'Please specify the other service you want to reconnect'
        );
      }



      // Payment receipt validation can be added here
      // using req.files if required

    }


    return true;

  }),



  validateRequest,

];




// Validation rules for updating status
export const validateStatusUpdate = [

  body('status')
    .trim()
    .toLowerCase()
    .notEmpty()
    .withMessage('Status is required')
    .isIn([
      'pending',
      'approved',
      'rejected',
      'flagged'
    ])
    .withMessage(
      'Invalid status value. Must be one of: pending, approved, rejected, flagged'
    ),

  validateRequest,

];




// Validation rules for public status check
export const validatePublicStatusCheck = [

  query('ref')
    .trim()
    .notEmpty()
    .withMessage(
      'Application reference number (ref) is required'
    ),

  validateRequest,

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


// Validation rules for admin form creation
export const validateAdminFormCreate = [
  body('formType')
    .trim()
    .notEmpty()
    .withMessage('Form type is required'),

  body('data')
    .notEmpty()
    .withMessage('Form data is required')
    .custom((value, { req }) => {
      if (typeof value === 'string') {
        try {
          req.body.data = JSON.parse(value);
        } catch (e) {
          throw new Error('Invalid JSON in data');
        }
      }
      if (typeof req.body.data !== 'object' || req.body.data === null) {
        throw new Error('Form data must be an object');
      }
      return true;
    }),

  validateRequest,
];


// Validation for updating a form
export const validateAdminFormUpdate = [
  body('status')
    .optional()
    .trim()
    .toLowerCase()
    .isIn(['pending', 'approved', 'rejected', 'flagged'])
    .withMessage('Invalid status value'),
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
    .isIn(['pending', 'pending payment', 'approved', 'confirmed', 'rejected', 'flagged'])
    .withMessage('Invalid status value. Must be one of: pending, pending payment, approved, confirmed, rejected, flagged'),
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes must be at most 2000 characters'),
  validateRequest,
];


// Validation for adding a comment to a form
export const validateAddComment = [
  body('text')
    .trim()
    .notEmpty()
    .withMessage('Comment text is required')
    .isLength({ max: 1000 })
    .withMessage('Comment must be at most 1000 characters'),
  validateRequest,
];


// Validation for get forms query parameters
export const validateGetFormsQuery = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 200 }).withMessage('Limit must be between 1 and 200'),
  validateRequest,
];