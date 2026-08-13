import mongoose from 'mongoose';

const CommentSchema = new mongoose.Schema(
  {
    text: { type: String, required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  },
  { timestamps: true }
);

const FormSchema = new mongoose.Schema(
  {
    formType: { type: String, required: true },
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    status: { type: String, default: 'pending' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
    comments: [CommentSchema],
  },
  { timestamps: true }
);

const Form = mongoose.model('Form', FormSchema);

export default Form;
