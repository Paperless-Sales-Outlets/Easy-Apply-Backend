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

<<<<<<< HEAD
      // BRD 5.1.6 Validation: Validate package selection or cart items for new connection
      if (req.body.serviceType === 'new-connection') {
        const hasCartItems = Array.isArray(parsedData.cartItems) && parsedData.cartItems.length > 0;
        const broadbandPkg = parsedData.broadbandPackage || parsedData.otherBroadbandPackage;
        if (!hasCartItems && !broadbandPkg) {
          throw new Error('Selection of at least one Broadband / Telecom Package is mandatory.');
=======


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

>>>>>>> 789d79f0ffe682723d781829d07a04b1e3053b3b
        }

      }


      return true;

    }),



  // Mobile number validation
  body('phone')
    .optional()
    .matches(/^07\d{8}$/)
    .withMessage(
      'Verified mobile must be 10 digits starting with 07'
    ),



  // Fixed telephone validation
  body('formData.telephone')
    .optional()
    .matches(/^01\d{8}$/)
    .withMessage(
      'Fixed telephone must be 10 digits starting with 01'
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