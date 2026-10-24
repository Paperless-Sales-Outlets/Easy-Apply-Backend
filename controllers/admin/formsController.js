import Form from '../../models/admin/formModel.js';

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
