import Connection from '../models/Connection.js';
import mongoose from 'mongoose';

// @desc    Get customer details by telephone number
// @route   GET /api/customers/:telephone
// @access  Public
export const getCustomerByTelephone = async (req, res, next) => {
  const { telephone } = req.params;
  const digitsOnly = (telephone || '').replace(/\D/g, '');
  const last9 = digitsOnly.slice(-9);

  try {
    let customerData = null;

    if (mongoose.connection.readyState === 1) {
      // 1. Search Connection collection
      const connection = await Connection.findOne({
        $or: [
          { telephone: telephone },
          { telephone: digitsOnly },
          { telephone: `0${last9}` },
          { contactNo: telephone },
          { contactNo: digitsOnly },
          { contactNo: `0${last9}` },
        ],
      });

      if (connection) {
        customerData = {
          telephone: connection.telephone,
          fullName: connection.fullName,
          nameFull: connection.fullName,
          legalOwner: connection.fullName,
          title: 'Mr',
          nic: connection.nic,
          contactNo: connection.contactNo || connection.telephone,
          mobileNumber: connection.contactNo || connection.telephone,
          fixedNumber: connection.telephone,
          email: connection.email || '',
          customerType: connection.customerType || 'home',
          status: connection.status || 'active',
          address: [connection.addressLine1, connection.addressLine2].filter(Boolean).join(', ') || 'No 45, Lotus Road, Colombo 01',
          addressLine1: connection.addressLine1 || '',
          addressLine2: connection.addressLine2 || '',
          contactName: connection.fullName,
          dob: '1990-05-15',
        };
      }

      // 2. If not found in Connection, search Application collection for recent submission
      if (!customerData) {
        const ApplicationModel = mongoose.models.Application;
        if (ApplicationModel) {
          const app = await ApplicationModel.findOne({
            $or: [
              { phone: telephone },
              { phone: digitsOnly },
              { phone: `0${last9}` },
              { 'formData.mobileNumber': telephone },
              { 'formData.mobileNumber': digitsOnly },
              { 'formData.mobileNumber': `0${last9}` },
            ],
          }).sort({ createdAt: -1 });

          if (app && app.formData) {
            customerData = {
              telephone: app.phone || telephone,
              fullName: app.formData.nameFull || app.formData.contactName || 'Existing Customer',
              nameFull: app.formData.nameFull || app.formData.contactName || 'Existing Customer',
              title: app.formData.title || 'Mr',
              nic: app.nic || app.formData.nic || '',
              contactNo: app.phone || app.formData.mobileNumber || telephone,
              mobileNumber: app.formData.mobileNumber || app.phone || telephone,
              fixedNumber: app.formData.fixedNumber || '',
              email: app.formData.email || '',
              customerType: app.formData.customerType || 'home',
              address: app.formData.address || app.formData.installAddress || '',
              contactName: app.formData.contactName || app.formData.nameFull || '',
              dob: app.formData.dob || '1992-08-20',
              taxExemption: app.formData.taxExemption || '',
              status: 'active',
            };
          }
        }
      }
    }

    // 3. Fallback sample data for seeded demo numbers (or when DB has no matching record)
    const seededDemoNumbers = ['0112345678', '0771234567', '0712345678', '0777123456', '771234567', '112345678'];
    if (!customerData && (seededDemoNumbers.includes(digitsOnly) || seededDemoNumbers.includes(telephone) || digitsOnly.endsWith('1234567'))) {
      customerData = {
        telephone: telephone || '0771234567',
        fullName: 'Lionel Perera',
        nameFull: 'Lionel Perera',
        legalOwner: 'Lionel Perera',
        contactPerson: 'Lionel Perera',
        contactName: 'Lionel Perera',
        title: 'Mr',
        nic: '198512345678',
        dob: '1985-05-14',
        contactNo: '0771234567',
        mobileNumber: '0771234567',
        fixedNumber: '0112345678',
        email: 'lio.perera@example.lk',
        address: 'No 45, Lotus Road, Colombo 01',
        addressLine1: 'No 45, Lotus Road',
        addressLine2: 'Colombo 01',
        customerType: 'home',
        taxExemption: 'TAX-8849',
        status: 'active',
        broadbandUsername: 'lio.perera@sltbb',
      };
    }

    if (customerData) {
      return res.status(200).json({
        success: true,
        isExisting: true,
        data: customerData,
      });
    }

    // Customer not found -> new customer
    return res.status(200).json({
      success: true,
      isExisting: false,
      message: `No existing customer record found for telephone: ${telephone}`,
    });
  } catch (error) {
    next(error);
  }
};
