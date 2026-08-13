import Form from '../../models/admin/formModel.js';
import User from '../../models/User.js';

// GET /api/admin/forms
export const getForms = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, formType, status, search } = req.query;

    const filter = {};
    if (formType) filter.formType = formType;
    if (status) filter.status = status;
    if (search) filter.$or = [
      { 'data.name': { $regex: search, $options: 'i' } },
      { 'data.referenceNumber': { $regex: search, $options: 'i' } },
    ];

    const pageNum = Math.max(1, parseInt(page, 10));
    const pageSize = Math.min(200, parseInt(limit, 10));
    const skip = (pageNum - 1) * pageSize;

    const [forms, totalCount] = await Promise.all([
      Form.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
      Form.countDocuments(filter),
    ]);

    res.status(200).json({ success: true, forms, pagination: { currentPage: pageNum, pageSize, totalCount } });
  } catch (error) {
    next(error);
  }
};

// GET /api/admin/forms/:id
export const getFormById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const form = await Form.findById(id).populate('createdBy', 'name email').lean();
    if (!form) {
      res.status(404);
      return next(new Error('Form not found'));
    }
    res.status(200).json({ success: true, form });
  } catch (error) {
    next(error);
  }
};

// POST /api/admin/forms
export const createForm = async (req, res, next) => {
  try {
    const { formType, data, status } = req.body;
    const form = await Form.create({ formType, data, status, createdBy: req.user && req.user._id });
    res.status(201).json({ success: true, form });
  } catch (error) {
    next(error);
  }
};

// PUT /api/admin/forms/:id
export const updateForm = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const form = await Form.findByIdAndUpdate(id, updates, { new: true }).lean();
    if (!form) {
      res.status(404);
      return next(new Error('Form not found'));
    }
    res.status(200).json({ success: true, form });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/admin/forms/:id
export const deleteForm = async (req, res, next) => {
  try {
    const { id } = req.params;
    const form = await Form.findByIdAndDelete(id).lean();
    if (!form) {
      res.status(404);
      return next(new Error('Form not found'));
    }
    res.status(200).json({ success: true, message: 'Form deleted' });
  } catch (error) {
    next(error);
  }
};

// POST /api/admin/forms/:id/comments
export const addComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    if (!text || !text.trim()) {
      res.status(400);
      return next(new Error('Comment text is required'));
    }

    const comment = { text: text.trim(), author: req.user ? req.user._id : undefined };

    const form = await Form.findByIdAndUpdate(
      id,
      { $push: { comments: comment } },
      { new: true }
    ).lean();

    if (!form) {
      res.status(404);
      return next(new Error('Form not found'));
    }

    // Populate the newly added comment author for response
    const populated = await Form.findById(form._id).populate('comments.author', 'name email').lean();

    res.status(201).json({ success: true, form: populated });
  } catch (error) {
    next(error);
  }
};
