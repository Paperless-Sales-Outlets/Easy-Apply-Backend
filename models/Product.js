import mongoose from 'mongoose';

const productSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    productCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: ['broadband', 'voice', 'peo-tv', 'accessories', 'devices', 'packages'],
    },
    image: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative'],
    },
    availableQuantity: {
      type: Number,
      required: true,
      min: [0, 'Available quantity cannot be negative'],
      default: 0,
    },
    status: {
      type: String,
      required: true,
      enum: ['active', 'inactive', 'out-of-stock'],
      default: 'active',
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
productSchema.index({ productId: 1 });
productSchema.index({ productCode: 1 });
productSchema.index({ category: 1 });
productSchema.index({ status: 1 });

// Virtual for checking if product is in stock
productSchema.virtual('inStock').get(function () {
  return this.availableQuantity > 0 && this.status === 'active';
});

// Method to decrease stock
productSchema.methods.decreaseStock = async function (quantity) {
  if (this.availableQuantity < quantity) {
    throw new Error('Insufficient stock');
  }
  this.availableQuantity -= quantity;
  if (this.availableQuantity === 0) {
    this.status = 'out-of-stock';
  }
  await this.save();
};

// Method to increase stock
productSchema.methods.increaseStock = async function (quantity) {
  this.availableQuantity += quantity;
  if (this.status === 'out-of-stock' && this.availableQuantity > 0) {
    this.status = 'active';
  }
  await this.save();
};

const Product = mongoose.model('Product', productSchema);

export default Product;
