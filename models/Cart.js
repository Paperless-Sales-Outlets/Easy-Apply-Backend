import mongoose from 'mongoose';

const cartItemSchema = new mongoose.Schema(
  {
    productId: {
      type: String,
      required: true,
      trim: true,
    },
    productName: {
      type: String,
      required: true,
      trim: true,
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1'],
      default: 1,
    },
    price: {
      type: Number,
      required: true,
      min: [0, 'Price cannot be negative'],
    },
    subtotal: {
      type: Number,
      required: true,
      min: [0, 'Subtotal cannot be negative'],
    },
  },
  { _id: true }
);

const cartSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    items: {
      type: [cartItemSchema],
      default: [],
    },
    totalAmount: {
      type: Number,
      required: true,
      min: [0, 'Total amount cannot be negative'],
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

// Index for faster queries
cartSchema.index({ userId: 1 });

// Method to calculate total amount
cartSchema.methods.calculateTotal = function () {
  this.totalAmount = this.items.reduce((total, item) => {
    return total + (item.quantity * item.price);
  }, 0);
  return this.totalAmount;
};

// Method to add item to cart
cartSchema.methods.addItem = function (product, quantity) {
  const existingItemIndex = this.items.findIndex(
    (item) => item.productId === product.productId
  );

  if (existingItemIndex !== -1) {
    // Update existing item
    this.items[existingItemIndex].quantity += quantity;
    this.items[existingItemIndex].subtotal =
      this.items[existingItemIndex].quantity * this.items[existingItemIndex].price;
  } else {
    // Add new item
    this.items.push({
      productId: product.productId,
      productName: product.productName,
      quantity: quantity,
      price: product.price,
      subtotal: quantity * product.price,
    });
  }

  this.calculateTotal();
  return this.save();
};

// Method to update item quantity
cartSchema.methods.updateItemQuantity = function (productId, quantity) {
  const itemIndex = this.items.findIndex(
    (item) => item.productId === productId
  );

  if (itemIndex === -1) {
    throw new Error('Item not found in cart');
  }

  this.items[itemIndex].quantity = quantity;
  this.items[itemIndex].subtotal = quantity * this.items[itemIndex].price;
  this.calculateTotal();
  return this.save();
};

// Method to remove item from cart
cartSchema.methods.removeItem = function (productId) {
  const itemIndex = this.items.findIndex(
    (item) => item.productId === productId
  );

  if (itemIndex === -1) {
    throw new Error('Item not found in cart');
  }

  this.items.splice(itemIndex, 1);
  this.calculateTotal();
  return this.save();
};

// Method to clear cart
cartSchema.methods.clearCart = function () {
  this.items = [];
  this.totalAmount = 0;
  return this.save();
};

// Pre-save hook to ensure total is calculated
cartSchema.pre('save', function (next) {
  if (this.isModified('items')) {
    this.calculateTotal();
  }
  next();
});

const Cart = mongoose.model('Cart', cartSchema);

export default Cart;
