import express from 'express';
import { 
    getMyProfile, 
    updateMyProfile, 
    applyResignation, 
    changePassword,
    updateGambarProfil
} from '../controllers/userController.js';
import { mohonBantuan, sejarahBantuan } from '../controllers/kebajikanController.js';

import { verifyToken } from '../middleware/authMiddleware.js';
import { upload } from '../middleware/uploadMiddleware.js';

const router = express.Router();

// 1. MEWAJIBKAN TOKEN UNTUK SEMUA LALUAN DI BAWAH
// Ini bermakna anda tidak perlu lagi letak 'verifyToken' di dalam setiap router.put/post
router.use(verifyToken);

// 2. LALUAN PROFIL & AKAUN
// getMyProfile: Menarik data profil termasuk status 'is_paid'
router.get('/profil', getMyProfile);

// updateMyProfile: Sekarang menyokong penghantaran borang keahlian & status 'Menunggu Kelulusan'
router.put('/kemaskini-profil', updateMyProfile);

// updateGambarProfil: Menggunakan multer untuk muat naik gambar
router.put('/kemaskini-gambar', upload.single('gambar'), updateGambarProfil);

// applyResignation: Menukar status ke 'PROSES BERHENTI'
router.post('/mohon-berhenti', applyResignation);

// changePassword: Untuk keselamatan akaun
router.put('/tukar-password', changePassword);

// 3. LALUAN KEBAJIKAN (MODUL BANTUAN)
router.post('/bantuan', upload.single('dokumen'), mohonBantuan);
router.get('/bantuan/sejarah', sejarahBantuan);

export default router;