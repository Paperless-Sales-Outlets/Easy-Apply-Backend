import mongoose from 'mongoose';
import dotenv from 'dotenv';
import Application from './models/Application.js';

dotenv.config();

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('Connected to MongoDB.');
    const apps = await Application.find().sort({ createdAt: -1 }).limit(3);

    if (apps.length === 0) {
      console.log('No applications found in the database at all.');
    } else {
      apps.forEach(app => {
        console.log('\n--- APPLICATION ---');
        console.log(`Service Type: ${app.serviceType}`);
        console.log(`Reference Number: ${app.referenceNumber}`);
        console.log(`Created At: ${app.createdAt}`);
        console.log('Documents Saved in DB:');
        console.log(JSON.stringify(app.formData.documents || [], null, 2));
      });
    }

    mongoose.connection.close();
  })
  .catch(err => {
    console.error('Error connecting to MongoDB:', err);
    process.exit(1);
  });
