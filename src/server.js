import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import os from 'os';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';


import db from './config/db.js'; // Import pangkalan data untuk cek kesihatan
import authRoutes from './routes/authRoutes.js';
import memberRoutes from './routes/memberRoutes.js';
import pertandinganRoutes from './routes/pertandinganRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import userRoutes from './routes/userRoutes.js';
import bayaranRoutes from './routes/bayaranRoutes.js';
import bantuanRoutes from './routes/bantuanRoutes.js';


import eventBus from './utils/eventEmitter.js';
import { requestLogger, errorLogger } from './middleware/logMiddleware.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();


// ==========================================
// PENGESAN METRIK GLOBAL AIGEO
// ==========================================
let totalRequests = 0;
let activeConnections = 0;
let sqlStatus = "ONLINE";

// Gelung Latar Belakang (Setiap 5 saat): Uji denyutan nadi SQL Database
setInterval(async () => {
    try {
        await db.query('SELECT 1'); // Uji arahan paling ringan
        sqlStatus = "ONLINE";
    } catch (error) {
        sqlStatus = "OFFLINE";
    }
}, 5000);

// Middleware untuk mengira jumlah request yang masuk

app.use((req, res, next) => {
    console.log(`[API REQ] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    totalRequests++;
    next();
});

const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:4173',
].filter(Boolean);

app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, false);
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json());
app.use(requestLogger);

// Sajikan folder statik
app.use(express.static(path.join(__dirname, 'public')));

// Laluan API
app.use('/api/auth', authRoutes);
app.use('/api/ahli', memberRoutes);
app.use('/api/pertandingan', pertandinganRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ahli', userRoutes);
app.use('/api/bayaran', bayaranRoutes);
app.use('/api/bantuan', bantuanRoutes);
app.post('/api/aigeo/login', (req, res) => {
    const { password } = req.body;
    if (password === process.env.AIGEO_PASS) {
        const token = jwt.sign({ role: 'AIGEO_MASTER' }, process.env.JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: 'AKSES DITOLAK' });
    }
});

// ==========================================
// LALUAN SSE STREAM & PENGHANTARAN METRIK
// ==========================================
app.get('/api/stream', (req, res) => {
    const token = req.query.token;

    if (!token) return res.status(401).send("Akses Ditolak");

    try {
        jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
        return res.status(403).send("Token Tidak Sah");
    }

    // Tambah 1 sambungan aktif setiap kali admin buka dashboard
    activeConnections++;

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const hantarData = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    eventBus.on('aktiviti_baharu', hantarData);

    const statsInterval = setInterval(() => {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const usedMem = totalMem - freeMem;
        
        // Kira peratusan
        const ramUsage = ((usedMem / totalMem) * 100).toFixed(1);
        
        // Tukar bytes kepada Gigabytes (1 GB = 1024^3 bytes)
        const usedMemGB = (usedMem / (1024 * 1024 * 1024)).toFixed(2);
        const totalMemGB = (totalMem / (1024 * 1024 * 1024)).toFixed(2);

        const cpuLoad = os.loadavg()[0].toFixed(2); 
        const ping = Math.floor(Math.random() * 15) + 5; 
        const uplink = (Math.random() * 10 + 5).toFixed(2); 

        // Hantar semua data metrik ke Dashboard
        res.write(`data: ${JSON.stringify({ 
            jenis: 'AIGEO_STATS', 
            ram: ramUsage, 
            ramKapasiti: `${usedMemGB} / ${totalMemGB} GB`, // <-- Data baharu untuk paparan GB
            cpu: cpuLoad, 
            ping: ping, 
            uplink: uplink, 
            teras: os.cpus().length,
            dbStatus: sqlStatus,        
            activeConn: activeConnections, 
            totalReq: totalRequests        
        })}\n\n`);
    }, 2000);

    req.on('close', () => {
        activeConnections--; // Tolak 1 apabila admin tutup dashboard
        eventBus.off('aktiviti_baharu', hantarData);
        clearInterval(statsInterval);
    });
});

app.use(errorLogger);

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => console.log(`🛸 AIGEO Core sedang berjalan di port ${PORT}`));