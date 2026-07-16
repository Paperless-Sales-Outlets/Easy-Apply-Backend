import Otp from '../models/Otp.js';

// @desc    Generate and send OTP for phone verification
// @route   POST /api/otp/send
// @access  Public
export const sendOtp = async (req, res, next) => {
  const { phone } = req.body;

  if (!phone) {
    res.status(400);
    return next(new Error('Phone number is required'));
  }

  try {
    // Delete any existing OTP for this phone number
    await Otp.deleteMany({ phone });

    // Generate a 6-digit OTP
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Save to database (auto-expires in 5 minutes)
    await Otp.create({ phone, otp: otpCode });

    // Print OTP to server console for demo/testing purposes
    console.log(`\n📱 OTP for +94${phone}: ${otpCode}\n`);

    res.status(200).json({
      success: true,
      message: 'OTP sent successfully. Check the server console.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Verify OTP entered by user
// @route   POST /api/otp/verify
// @access  Public
export const verifyOtp = async (req, res, next) => {
  const { phone, otp } = req.body;

  if (!phone || !otp) {
    res.status(400);
    return next(new Error('Phone number and OTP are required'));
  }

  try {
    const record = await Otp.findOne({ phone, otp });

    if (!record) {
      res.status(400);
      return next(new Error('Invalid or expired OTP'));
    }

    // Delete OTP after successful verification
    await Otp.deleteMany({ phone });

    res.status(200).json({
      success: true,
      message: 'Phone number verified successfully',
    });
  } catch (error) {
    next(error);
  }
};
