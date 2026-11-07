// Easy-Apply-Backend/routes/ocrRoutes.js
import express from 'express';
import { scanNic, recognizeGeneralImage } from '../controllers/ocrController.js';

const router = express.Router();

router.post('/scan-nic', scanNic);
router.post('/recognize', recognizeGeneralImage);

export default router;
