import Connection from '../models/Connection.js';
import Customer from '../models/Customer.js';
import { publicCustomer, storeIdentityImage } from './authController.js';
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

      // 2. If not found in Connection, search Customer collection (registered or OCR verified customer)
      if (formattedAccounts.length === 0) {
        const custRecord = await Customer.findOne({
          $or: [
            { phone: phoneStr },
            { phone: digitsOnly },
            { phone: last9 },
            { phone: `0${last9}` },
            { phone: `+94${last9}` },
            { phone: `94${last9}` },
          ],
        });

        if (custRecord) {
          formattedAccounts = [
            {
              customerId: custRecord._id.toString(),
              accountNumber: `REG-${custRecord.phone}`,
              phoneNumber: custRecord.phone,
              telephone: custRecord.phone,
              fullName: custRecord.name,
              customerName: custRecord.name,
              nameFull: custRecord.name,
              title: custRecord.title || 'Mr',
              nic: custRecord.NIC,
              mobileNumber: custRecord.phone,
              contactNumber: custRecord.contactNumber || custRecord.phone,
              email: custRecord.email || '',
              dob: custRecord.dob || '',
              gender: custRecord.gender || 'Male',
              address: [custRecord.addressLine1, custRecord.addressLine2].filter(Boolean).join(', '),
              addressLine1: custRecord.addressLine1 || '',
              addressLine2: custRecord.addressLine2 || '',
              city: custRecord.city || '',
              district: custRecord.district || '',
              postalCode: custRecord.postalCode || '',
              customerType: 'home',
              status: 'registered',
              serviceType: 'New Connection',
              registeredDate: custRecord.createdAt,
            },
          ];
        }
      }

      // 3. If not found in Customer, search Application collection for recent submission
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

// @desc    Sync OCR verified customer details and documents to MongoDB
// @route   POST /api/customers/sync-ocr
// @access  Public
export const syncCustomerOcr = async (req, res, next) => {
  const {
    phone,
    email,
    name,
    nic,
    dob,
    gender,
    title,
    address,
    addressLine1,
    addressLine2,
    city,
    district,
    postalCode,
    nicFront,
    nicBack,
    facePhoto,
  } = req.body;

  const phoneStr = phone || req.user?.phone || req.customer?.phone;
  if (!phoneStr && !nic && !email) {
    return res.status(400).json({
      success: false,
      message: 'Phone number, NIC, or email is required to sync profile',
    });
  }

  const digitsOnly = phoneStr ? String(phoneStr).replace(/\D/g, '') : '';
  const last9 = digitsOnly.slice(-9);
  const cleanNic = nic ? String(nic).trim().toUpperCase() : '';
  const cleanEmail = email && typeof email === 'string' && email.trim() ? email.trim().toLowerCase() : undefined;

  try {
    const query = [];
    if (digitsOnly) {
      query.push(
        { phone: digitsOnly },
        { phone: last9 },
        { phone: `0${last9}` },
        { phone: `+94${last9}` },
        { phone: `94${last9}` }
      );
    }
    if (cleanNic) {
      query.push({ NIC: cleanNic });
    }
    if (cleanEmail) {
      query.push({ email: cleanEmail });
    }

    let customer = await Customer.findOne({ $or: query });

    const addr1 = addressLine1 || address || '';
    const resolvedName = name ? String(name).trim() : '';

    if (customer) {
      if (resolvedName) customer.name = resolvedName;
      if (cleanNic) customer.NIC = cleanNic;
      if (cleanEmail) customer.email = cleanEmail;
      if (digitsOnly && !customer.phone) customer.phone = digitsOnly;
      if (dob) customer.dob = dob;
      if (gender) customer.gender = gender;
      if (title) customer.title = title;
      if (addr1) customer.addressLine1 = addr1;
      if (addressLine2) customer.addressLine2 = addressLine2;
      if (city) customer.city = city;
      if (district) customer.district = district;
      if (postalCode) customer.postalCode = postalCode;
    } else {
      customer = new Customer({
        name: resolvedName || 'Customer',
        ...(cleanEmail ? { email: cleanEmail } : {}),
        phone: digitsOnly || (cleanNic ? `07${cleanNic.slice(-7)}` : '0770000000'),
        NIC: cleanNic || `NIC-${Date.now()}`,
        dob: dob || '',
        gender: gender || 'Male',
        title: title || 'Mr.',
        addressLine1: addr1,
        addressLine2: addressLine2 || '',
        city: city || '',
        district: district || '',
        postalCode: postalCode || '',
        role: 'Customer',
        kycStatus: 'pending',
      });
    }

    // Persist KYC images if provided
    try {
      if (nicFront || nicBack || facePhoto) {
        let frontId = null;
        let backId = null;
        let faceId = null;

        try {
          [frontId, backId, faceId] = await Promise.all([
            nicFront && nicFront.startsWith('data:') ? storeIdentityImage(nicFront, 'nic-front', customer._id) : null,
            nicBack && nicBack.startsWith('data:') ? storeIdentityImage(nicBack, 'nic-back', customer._id) : null,
            facePhoto && facePhoto.startsWith('data:') ? storeIdentityImage(facePhoto, 'face-photo', customer._id) : null,
          ]);
        } catch (e) {
          console.warn('GridFS storage fallback for OCR images:', e.message);
        }

        const existingDocs = customer.identityDocuments || {};
        customer.identityDocuments = {
          ...existingDocs,
          nicFront: frontId || nicFront || existingDocs.nicFront,
          nicBack: backId || nicBack || existingDocs.nicBack,
          facePhoto: faceId || facePhoto || existingDocs.facePhoto,
          capturedAt: new Date(),
        };
      }
    } catch (imgErr) {
      console.error('Error saving identity documents on customer:', imgErr.message);
    }

    await customer.save();

    return res.status(200).json({
      success: true,
      message: 'OCR details synced and saved to customer profile successfully',
      customer: publicCustomer(customer),
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get customer profile by phone number or NIC
// @route   GET /api/customers/profile
// @access  Public
export const getCustomerProfile = async (req, res, next) => {
  const phoneStr = req.query.phone || req.query.phoneNumber || req.user?.phone || req.customer?.phone;
  const nicStr = req.query.nic;
  const emailStr = req.query.email || req.user?.email || req.customer?.email;

  if (!phoneStr && !nicStr && !emailStr) {
    return res.status(400).json({ success: false, message: 'Phone number, NIC, or email is required' });
  }

  const digitsOnly = phoneStr ? String(phoneStr).replace(/\D/g, '') : '';
  const last9 = digitsOnly.slice(-9);
  const cleanNic = nicStr ? String(nicStr).trim().toUpperCase() : '';
  const cleanEmail = emailStr && typeof emailStr === 'string' && emailStr.trim() ? emailStr.trim().toLowerCase() : '';

  try {
    const query = [];
    if (digitsOnly) {
      query.push(
        { phone: digitsOnly },
        { phone: last9 },
        { phone: `0${last9}` },
        { phone: `+94${last9}` },
        { phone: `94${last9}` }
      );
    }
    if (cleanNic) {
      query.push({ NIC: cleanNic });
    }
    if (cleanEmail) {
      query.push({ email: cleanEmail });
    }

    // 1. Search Customer model first (contains real OCR parsed data)
    const customer = await Customer.findOne({ $or: query });
    if (customer) {
      return res.status(200).json({
        success: true,
        customer: publicCustomer(customer),
      });
    }

    // 2. Fallback to Connection model
    if (mongoose.connection.readyState === 1 && (phoneStr || cleanEmail)) {
      const connQuery = [];
      if (phoneStr) {
        connQuery.push(
          { telephone: phoneStr },
          { telephone: digitsOnly },
          { telephone: `0${last9}` },
          { contactNo: phoneStr },
          { contactNo: digitsOnly },
          { contactNo: `0${last9}` }
        );
      }
      if (cleanEmail) {
        connQuery.push({ email: cleanEmail });
      }
      const conn = await Connection.findOne({ $or: connQuery });

      if (conn) {
        return res.status(200).json({
          success: true,
          customer: {
            id: conn._id,
            name: conn.fullName,
            phone: conn.contactNo || conn.telephone,
            email: conn.email || cleanEmail || '',
            NIC: conn.nic,
            title: 'Mr',
            dob: '',
            gender: 'Male',
            addressLine1: conn.addressLine1 || '',
            addressLine2: conn.addressLine2 || '',
            city: '',
            district: '',
            postalCode: '',
          },
        });
      }
    }

    return res.status(404).json({
      success: false,
      message: 'Customer profile not found',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update customer profile details
// @route   PUT /api/customers/profile
// @access  Public
export const updateCustomerProfile = async (req, res, next) => {
  const {
    phone,
    name,
    email,
    contactNumber,
    addressLine1,
    addressLine2,
    city,
    district,
    postalCode,
    preferredContact,
    title,
    dob,
    gender,
    nationality,
  } = req.body;

  const phoneStr = phone || req.user?.phone || req.customer?.phone;
  if (!phoneStr) {
    return res.status(400).json({ success: false, message: 'Phone number is required' });
  }

  const digitsOnly = String(phoneStr).replace(/\D/g, '');
  const last9 = digitsOnly.slice(-9);

  try {
    let customer = await Customer.findOne({
      $or: [
        { phone: digitsOnly },
        { phone: last9 },
        { phone: `0${last9}` },
        { phone: `+94${last9}` },
        { phone: `94${last9}` },
      ],
    });

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Customer record not found' });
    }

    if (name) customer.name = name;
    if (email !== undefined) customer.email = email || undefined;
    if (contactNumber) customer.contactNumber = contactNumber;
    if (addressLine1 !== undefined) customer.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) customer.addressLine2 = addressLine2;
    if (city !== undefined) customer.city = city;
    if (district !== undefined) customer.district = district;
    if (postalCode !== undefined) customer.postalCode = postalCode;
    if (preferredContact) customer.preferredContact = preferredContact;
    if (title) customer.title = title;
    if (dob) customer.dob = dob;
    if (gender) customer.gender = gender;
    if (nationality) customer.nationality = nationality;

    await customer.save();

    return res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      customer: publicCustomer(customer),
    });
  } catch (error) {
    next(error);
  }
};

