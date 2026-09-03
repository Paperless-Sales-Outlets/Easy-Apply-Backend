import Connection from '../models/Connection.js';
import mongoose from 'mongoose';

// @desc    Lookup customer details by telephone/mobile number from REAL database
// @route   POST /api/customers/lookup
// @route   GET /api/customers/lookup
// @access  Public
export const lookupCustomer = async (req, res, next) => {
  const phoneStr = req.body.phoneNumber || req.body.phone || req.query.phone || req.query.phoneNumber;

  if (!phoneStr) {
    return res.status(400).json({
      success: false,
      message: 'Phone number is required for customer lookup',
    });
  }

  const digitsOnly = String(phoneStr).replace(/\D/g, '');
  const last9 = digitsOnly.slice(-9);

  try {
    let formattedAccounts = [];

    if (mongoose.connection.readyState === 1) {
      // 1. Search Connection collection for matching numbers
      const initialMatch = await Connection.find({
        $or: [
          { telephone: phoneStr },
          { telephone: digitsOnly },
          { telephone: `0${last9}` },
          { contactNo: phoneStr },
          { contactNo: digitsOnly },
          { contactNo: `0${last9}` },
        ],
      });

      if (initialMatch && initialMatch.length > 0) {
        // Collect NICs to find all accounts belonging to this customer
        const nics = [...new Set(initialMatch.map((c) => c.nic).filter(Boolean))];

        const allConnections = await Connection.find({
          $or: [
            { nic: { $in: nics } },
            { telephone: digitsOnly },
            { telephone: `0${last9}` },
            { contactNo: digitsOnly },
            { contactNo: `0${last9}` },
          ],
        }).sort({ createdAt: -1 });

        formattedAccounts = allConnections.map((c) => ({
          customerId: c._id.toString(),
          accountNumber: c.accountNo || `ACC-${c.telephone}`,
          phoneNumber: c.contactNo || c.telephone,
          telephone: c.telephone,
          fullName: c.fullName,
          customerName: c.fullName,
          nameFull: c.fullName,
          title: 'Mr',
          nic: c.nic,
          mobileNumber: c.contactNo || c.telephone,
          fixedContactNumber: c.telephone,
          fixedNumber: c.telephone,
          email: c.email || '',
          address: [c.addressLine1, c.addressLine2].filter(Boolean).join(', '),
          addressLine1: c.addressLine1 || '',
          addressLine2: c.addressLine2 || '',
          customerType: c.customerType || 'home',
          status: c.status || 'active',
          serviceType: c.packageName?.includes('Voice')
            ? 'Voice'
            : c.packageName?.includes('LTE')
            ? 'LTE Home'
            : 'Fibre Broadband',
          package: c.packageName || '300 Mbps Fibre Broadband',
          packageName: c.packageName || '300 Mbps Fibre Broadband',
          speed: c.speed || '300 Mbps',
          monthlyPrice: c.monthlyPrice || 6990,
          outstandingBalance: c.outstandingBalance || 0,
          broadbandUsername: c.broadbandUsername || '',
          registeredDate: c.createdAt,
        }));
      }

      // 2. If not found in Connection, search Application collection for recent submission
      if (formattedAccounts.length === 0 && mongoose.models.Application) {
        const app = await mongoose.models.Application.findOne({
          $or: [
            { phone: phoneStr },
            { phone: digitsOnly },
            { phone: `0${last9}` },
            { 'formData.mobileNumber': digitsOnly },
            { 'formData.mobileNumber': `0${last9}` },
          ],
        }).sort({ createdAt: -1 });

        if (app && app.formData) {
          formattedAccounts = [
            {
              customerId: app._id.toString(),
              accountNumber: app.referenceNumber || `ACC-${app.phone}`,
              phoneNumber: app.phone || phoneStr,
              telephone: app.formData.fixedNumber || app.phone || phoneStr,
              fullName: app.formData.nameFull || app.formData.contactName || '',
              customerName: app.formData.nameFull || app.formData.contactName || '',
              nameFull: app.formData.nameFull || app.formData.contactName || '',
              title: app.formData.title || 'Mr',
              nic: app.nic || app.formData.nic || '',
              mobileNumber: app.formData.mobileNumber || app.phone || phoneStr,
              fixedContactNumber: app.formData.fixedNumber || '',
              fixedNumber: app.formData.fixedNumber || '',
              email: app.formData.email || '',
              address: app.formData.address || app.formData.installAddress || '',
              addressLine1: app.formData.installAddress || app.formData.address || '',
              customerType: app.formData.customerType || 'home',
              status: 'active',
              serviceType: app.serviceType || 'Fibre Broadband',
              package: app.formData.broadbandPackage || '300 Mbps Fibre Broadband',
              packageName: app.formData.broadbandPackage || '300 Mbps Fibre Broadband',
              speed: '300 Mbps',
              monthlyPrice: 6990,
              outstandingBalance: 0,
              broadbandUsername: '',
              registeredDate: app.createdAt,
            },
          ];
        }
      }
    }

    if (formattedAccounts.length > 0) {
      return res.status(200).json({
        success: true,
        customerExists: true,
        customers: formattedAccounts,
      });
    }

    return res.status(200).json({
      success: true,
      customerExists: false,
      customers: [],
      message: 'No existing customer account was found for this number.',
    });
  } catch (error) {
    next(error);
  }
};

// Legacy GET endpoint wrapping lookupCustomer
export const getCustomerByTelephone = async (req, res, next) => {
  req.body.phoneNumber = req.params.telephone;
  return lookupCustomer(req, res, next);
};

// @desc    Check whether a phone number belongs to an existing SLT customer.
//          Returns ONLY {success, exists} — no PII before OTP verification.
// @route   POST /api/customers/check-phone
// @access  Public
export const checkCustomerPhone = async (req, res, next) => {
  const phoneStr = req.body.phoneNumber || req.body.phone;

  if (!phoneStr) {
    return res.status(400).json({ success: false, message: 'Phone number is required' });
  }

  const digitsOnly = String(phoneStr).replace(/\D/g, '');
  const last9 = digitsOnly.slice(-9);

  try {
    let found = false;

    if (mongoose.connection.readyState === 1) {
      // Check Connection collection (primary SLT customer records)
      const match = await Connection.findOne({
        $or: [
          { telephone: phoneStr },
          { telephone: digitsOnly },
          { telephone: `0${last9}` },
          { contactNo: phoneStr },
          { contactNo: digitsOnly },
          { contactNo: `0${last9}` },
        ],
      }).select('_id');

      if (match) {
        found = true;
      }

      // Also check Application collection for recent submissions
      if (!found && mongoose.models.Application) {
        const app = await mongoose.models.Application.findOne({
          $or: [
            { phone: phoneStr },
            { phone: digitsOnly },
            { phone: `0${last9}` },
            { 'formData.mobileNumber': digitsOnly },
            { 'formData.mobileNumber': `0${last9}` },
          ],
        }).select('_id');

        if (app) found = true;
      }
    }

    return res.status(200).json({ success: true, exists: found });
  } catch (error) {
    next(error);
  }
};
