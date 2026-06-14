import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import sendEmail from '../utils/sendEmail.js';

// ==========================================
// 1. Pengaktifan Akaun (Register)
// ==========================================
export const register = async (req, res) => {
    const { no_kp, email, password, no_tel } = req.body;

    try {
        // Semak sama ada kakitangan wujud dalam database (dari import CSV sebelum ini)
        const [users] = await db.query('SELECT * FROM users WHERE no_kp = ?', [no_kp]);
        
        if (users.length === 0) {
            return res.status(403).json({ message: "Maaf, No. Kad Pengenalan ini tiada dalam rekod kakitangan Perhilitan." });
        }

        const user = users[0];

        // Jika password sudah ada, bermaksud akaun telah diaktifkan
        if (user.password !== null) {
            return res.status(400).json({ message: "Akaun untuk No. Kad Pengenalan ini telah diaktifkan. Sila log masuk." });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Kemaskini rekod sedia ada dengan emel, phone, password dan tukar status
        const queryUpdate = `
            UPDATE users 
            SET emel = ?, phone = ?, password = ?, status_ahli = 'aktif' 
            WHERE no_kp = ?
        `;
        await db.query(queryUpdate, [email, no_tel, hashedPassword, no_kp]);

        res.status(201).json({ message: "Akaun berjaya diaktifkan! Sila log masuk." });
    } catch (error) {
        console.error("Register Error:", error);
        res.status(500).json({ message: "Ralat pelayan semasa pendaftaran." });
    }
};

// ==========================================
// 2. Log Masuk (Login)
// ==========================================
export const login = async (req, res) => {
    const { email, password } = req.body;

    try {
        // Carian dibuat berdasarkan emel di dalam jadual users
        const query = `
            SELECT u.id, u.no_kp, u.password, u.role, u.status_ahli, u.nama_pegawai, p.nama_penempatan 
            FROM users u
            LEFT JOIN penempatan p ON u.penempatan_id = p.id
            WHERE u.emel = ?
        `;
        const [users] = await db.query(query, [email]);
        const user = users[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "E-mel atau kata laluan salah." });
        }

        if (user.status_ahli === 'tidak aktif') {
            return res.status(403).json({ message: "Akaun anda tidak aktif. Sila hubungi Admin." });
        }

        const token = jwt.sign({ id: user.id, role: user.role, no_kp: user.no_kp }, process.env.JWT_SECRET, { expiresIn: '1d' });

        res.status(200).json({
            message: "Berjaya log masuk.",
            token,
            user: { id: user.id, no_kp: user.no_kp, name: user.nama_pegawai, role: user.role, penempatan: user.nama_penempatan }
        });
    } catch (error) {
        console.error("Login Error:", error);
        res.status(500).json({ message: "Ralat pelayan." });
    }
};

// ==========================================
// 3. Lupa Kata Laluan (Forgot Password)
// ==========================================
export const forgotPassword = async (req, res) => {
    const { email } = req.body;

    try {
        const query = `SELECT id, emel FROM users WHERE emel = ?`;
        const [users] = await db.query(query, [email]);
        const user = users[0];

        if (!user) {
            return res.status(404).json({ message: "E-mel tidak dijumpai." });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiryTime = new Date(Date.now() + 10 * 60 * 1000); 

        // Pastikan column reset_token & reset_token_expiry ditambah dalam jadual users
        await db.query('UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?', [hashedResetToken, expiryTime, user.id]);

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
        
        const emailTemplate = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
            <div style="background-color: #0F4C3A; padding: 20px; text-align: center; color: white;">
                <h2 style="margin: 0;">Reset Kata Laluan</h2>
            </div>
            <div style="padding: 20px; color: #333; line-height: 1.6;">
                <p>Klik pautan di bawah untuk reset kata laluan anda. Pautan ini sah selama 10 minit.</p>
                <div style="text-align: center; margin: 20px 0;">
                    <a href="${resetUrl}" style="background-color: #E30613; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Reset Kata Laluan</a>
                </div>
            </div>
        </div>`;

        await sendEmail({ email: user.emel, subject: "Tukar Kata Laluan Kelab PERHILITAN", message: emailTemplate });
        res.status(200).json({ message: "E-mel tetapan semula telah dihantar." });
    } catch (error) {
        console.error("Forgot Password Error:", error);
        res.status(500).json({ message: "Gagal menghantar e-mel." });
    }
};

// ==========================================
// 4. Tetapkan Semula Kata Laluan (Reset Password)
// ==========================================
export const resetPassword = async (req, res) => {
    const { token } = req.params;
    const { newPassword } = req.body;

    try {
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        const [users] = await db.query('SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()', [hashedToken]);
        const user = users[0];

        if (!user) return res.status(400).json({ message: "Token tidak sah atau telah tamat tempoh." });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await db.query('UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?', [hashedPassword, user.id]);

        res.status(200).json({ message: "Kata laluan berjaya ditukar." });
    } catch (error) {
        res.status(500).json({ message: "Ralat pelayan." });
    }
};