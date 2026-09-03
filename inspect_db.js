import mongoose from 'mongoose';
import dotenv from 'dotenv';
dotenv.config();

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('Connected to MongoDB');
    
    // Instead of importing the model, we can query the collection directly
    const db = mongoose.connection.db;
    const application = await db.collection('applications').findOne({ referenceNumber: 'REQ-94107000' });
    
    console.log(JSON.stringify(application, null, 2));
    
    mongoose.disconnect();
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
