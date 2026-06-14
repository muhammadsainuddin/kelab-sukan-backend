import express from 'express';
import { ciptaBil, toyyibpayCallback, getSejarahBayaran, semakStatusBayaran } from '../controllers/bayaranController.js';
import { verifyToken } from '../middleware/authMiddleware.js'; // Andaian ada middleware auth

const router = express.Router();

router.post('/cipta-bil', verifyToken, ciptaBil);
router.post('/callback', toyyibpayCallback); // Webhook tidak perlu verifyToken (Datang dari ToyyibPay)
router.get('/sejarah', verifyToken, getSejarahBayaran);

// Route baru untuk semak status bayaran
router.get('/semak', verifyToken, semakStatusBayaran); // Semak semua pending milik user tersebut
router.get('/semak/:billcode', verifyToken, semakStatusBayaran); // Semak spesifik billcode

export default router;