import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      trim: true,
      unique: true,
      sparse: true,
    },
    productCode: {
      type: String,
      trim: true,
    },
    name: {
      type: String,
      required: [true, 'Product name is required'],
      trim: true,
    },
    category: {
      type: String,
      required: [true, 'Product category is required'],
      trim: true,
    },
    serviceType: {
      type: String,
      trim: true,
      default: 'Broadband',
    },
    speed: {
      type: String,
      trim: true,
    },
    monthlyPrice: {
      type: Number,
      required: [true, 'Monthly price is required'],
      min: [0, 'Monthly price cannot be negative'],
    },
    installationFee: {
      type: Number,
      default: 0,
      min: [0, 'Installation fee cannot be negative'],
    },
    description: {
      type: String,
      trim: true,
    },
    features: {
      type: [String],
      default: [],
    },
    image: {
      type: String,
      trim: true,
    },
    availableQuantity: {
      type: Number,
      default: 999,
      min: [0, 'Available quantity cannot be negative'],
    },
    status: {
      type: String,
      enum: ['active', 'inactive', 'out-of-stock'],
      default: 'active',
    },
    popular: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Indexes
productSchema.index({ category: 1 });
productSchema.index({ status: 1 });
productSchema.index({ popular: 1 });
productSchema.index({ name: 'text', description: 'text' });

// Virtuals for backward compatibility
productSchema.virtual('productName').get(function () {
  return this.name;
});

productSchema.virtual('price').get(function () {
  return this.monthlyPrice;
});

productSchema.virtual('inStock').get(function () {
  return this.availableQuantity > 0 && this.status === 'active';
});

// Pre-save hook to ensure productId is set
productSchema.pre('save', function (next) {
  if (!this.productId) {
    this.productId = this._id.toString();
  }
  if (!this.productCode) {
    this.productCode = `PRD-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
  }
  next();
});

const Product = mongoose.model('Product', productSchema);

export default Product;

