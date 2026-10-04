import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const customerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      match: [
        /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
        'Please enter a valid email address',
      ],
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
      trim: true,
    },
    NIC: {
      type: String,
      required: [true, 'NIC / Passport / BR Number is required'],
      unique: true,
      trim: true,
      uppercase: true,
    },
    title: { type: String, default: 'Mr.' },
    dob: { type: String },
    gender: { type: String, default: 'Male' },
    nationality: { type: String, default: 'Sri Lankan' },
    contactNumber: { type: String },
    addressLine1: { type: String },
    addressLine2: { type: String },
    city: { type: String },
    district: { type: String },
    postalCode: { type: String },
    preferredContact: { type: String, default: 'SMS' },
    identityDocuments: {
      nicFront: { type: mongoose.Schema.Types.ObjectId },
      nicBack: { type: mongoose.Schema.Types.ObjectId },
      facePhoto: { type: mongoose.Schema.Types.ObjectId },
      capturedAt: { type: Date },
    },
    password: {
      type: String,
      minlength: [6, 'Password must be at least 6 characters'],
      select: false,
    },
  },
  {
    timestamps: true,
    collection: 'customers',
  }
);

customerSchema.pre('save', async function (next) {
  if (!this.password || !this.isModified('password')) return next();

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  return next();
});

customerSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

const Customer = mongoose.model('Customer', customerSchema);

export default Customer;