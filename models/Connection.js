import mongoose from 'mongoose';

const connectionSchema = new mongoose.Schema(
  {
    telephone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
    },
    nic: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
    },
    contactNo: {
      type: String,
      required: true,
      trim: true,
    },
    addressLine1: {
      type: String,
      required: true,
      trim: true,
    },
    addressLine2: {
      type: String,
      trim: true,
    },
    location: {
      lat: {
        type: Number,
      },
      lng: {
        type: Number,
      }
    },
    // Additional fields based on NewConnectionWizard
    customerType: {
      type: String,
      enum: ['home', 'office', 'religious'],
      default: 'home'
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ['active', 'disconnected', 'suspended'],
      default: 'active'
    },
    disconnectedFrom: {
      type: String,
      trim: true
    },
    disconnectedTo: {
      type: String,
      trim: true
    },
    outstandingBalance: {
      type: Number,
      default: 0
    },
    broadbandUsername: {
      type: String,
      trim: true,
      lowercase: true
    }
  },
  {
    timestamps: true,
  }
);

const Connection = mongoose.model('Connection', connectionSchema);

export default Connection;
