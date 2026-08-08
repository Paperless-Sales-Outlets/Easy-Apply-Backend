import Connection from '../models/Connection.js';
import mongoose from 'mongoose';

// @desc    Get customer details by telephone number
// @route   GET /api/customers/:telephone
// @access  Public
export const getCustomerByTelephone = async (req, res, next) => {
  const { telephone } = req.params;

  try {
    let connection = null;

    if (mongoose.connection.readyState === 1) {
      connection = await Connection.findOne({ telephone });
    }

    // Fallback sample data for seeded number or offline DB mode
    if (!connection && (telephone === '0112345678' || mongoose.connection.readyState !== 1)) {
      connection = {
        telephone: telephone || '0112345678',
        fullName: 'Lionel Perera',
        legalOwner: 'Lionel Perera',
        contactPerson: 'Lionel Perera',
        serviceType: 'Megaline',
        nic: '198512345678',
        contactNo: '0771234567',
        addressLine1: 'No 45, Lotus Road',
        addressLine2: 'Colombo 01',
        location: { lat: 6.9319, lng: 79.8478 },
        customerType: 'home',
        email: 'lio.perera@example.lk',
        status: 'disconnected',
        disconnectedFrom: '2023-01-15',
        disconnectedTo: '2023-10-15',
        outstandingBalance: 2500.50,
        broadbandUsername: 'lio.perera@sltbb',
      };
    }

    if (connection) {
      const customerData = {
        telephone: connection.telephone,
        fullName: connection.fullName,
        legalOwner: connection.fullName,
        contactPerson: connection.contactPerson || connection.fullName,
        serviceType: connection.serviceType || 'Megaline',
        nic: connection.nic,
        contactNo: connection.contactNo,
        mobile: connection.contactNo,
        email: connection.email,
        customerType: connection.customerType,
        status: connection.status,
        addressLine1: connection.addressLine1,
        addressLine2: connection.addressLine2,
        currentAddress: {
          address1: connection.addressLine1 || '',
          address2: connection.addressLine2 || '',
          city: connection.addressLine2 || 'Colombo 01',
          district: 'Colombo',
          postalCode: '00100',
        },
        location: connection.location,
        disconnectedFrom: connection.disconnectedFrom,
        disconnectedTo: connection.disconnectedTo,
        outstandingBalance: connection.outstandingBalance,
        broadbandUsername: connection.broadbandUsername,
      };

      return res.status(200).json({
        success: true,
        data: customerData,
      });
    }

    res.status(404);
    return next(new Error(`Customer / Connection not found for telephone number: ${telephone}`));
  } catch (error) {
    next(error);
  }
};
