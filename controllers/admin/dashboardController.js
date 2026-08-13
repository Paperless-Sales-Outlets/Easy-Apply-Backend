import Form from '../../models/admin/formModel.js';

// GET /api/admin/dashboard
export const getOperationDashboard = async (req, res, next) => {
  try {
    const totalForms = await Form.countDocuments();

    // Recent comments across all forms
    const recentComments = await Form.aggregate([
      { $unwind: '$comments' },
      { $sort: { 'comments.createdAt': -1 } },
      { $limit: 30 },
      {
        $project: {
          formId: '$_id',
          formType: '$formType',
          'comment._id': '$comments._id',
          'comment.text': '$comments.text',
          'comment.author': '$comments.author',
          'comment.createdAt': '$comments.createdAt',
        },
      },
    ]);

    res.status(200).json({ success: true, stats: { totalForms }, recentComments });
  } catch (error) {
    next(error);
  }
};
