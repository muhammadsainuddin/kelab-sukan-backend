import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import sendEmail from '../utils/sendEmail.js';
import { messages, getLang } from '../utils/lang.js';

// ==========================================
// FUNGSI BANTUAN: Pengiraan Automatik
// ==========================================
const kiraYuran = (gred) => {
    if (!gred) return 15.00;
    const match = gred.match(/\d+/);
    if (match) {
        const num = parseInt(match[0], 10);
        if (num >= 1 && num <= 8) return 5.00;
        if (num >= 9 && num <= 14) return 10.00;
    }
    return 15.00;
};

const tentukanPotongan = (gred, pilihanPengguna) => {
    if (!gred) return pilihanPengguna || 'Tunai / Transfer';
    const gredUpper = gred.toUpperCase();
    if (gredUpper.includes('JUSA') || gredUpper.includes('VU') || gredUpper.includes('VK') || gredUpper.startsWith('G')) {
        return 'Potongan Gaji / Jabatan';
    }
    return pilihanPengguna || 'Tunai / Transfer';
};

// ==========================================
// 1. Pendaftaran Akaun Ringkas (Register)
// ==========================================
export const register = async (req, res) => {
    const { no_kp, email, password, no_tel } = req.body;

    try {
        // 1. SEMAKAN INDUK: Adakah No IC wujud dalam senarai_staff?
        const [staf] = await db.query('SELECT * FROM senarai_staff WHERE no_kp = ?', [no_kp]);
        if (staf.length === 0) {
            return res.status(403).json({ message: "Maaf, No. Kad Pengenalan ini tiada dalam rekod kakitangan Induk. Sila hubungi HR/Urusetia." });
        }

        // 2. Semak jika akaun (no_kp) sudah wujud dalam jadual users
        const [existingUser] = await db.query('SELECT id FROM users WHERE no_kp = ?', [no_kp]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: "Akaun untuk No. Kad Pengenalan ini telah wujud dalam sistem." });
        }

        // Semakan Keselamatan Tambahan: Pastikan emel belum digunakan oleh staf lain
        const [existingEmail] = await db.query('SELECT id FROM senarai_staff WHERE emel_kelab = ? AND no_kp != ?', [email, no_kp]);
        if (existingEmail.length > 0) {
            return res.status(400).json({ message: "E-mel ini telah digunakan oleh rekod kakitangan lain." });
        }

        const dataStaf = staf[0];
        
        // 3. Hash Kata Laluan
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 4. Daftar akaun (Jadual `users` KINI TIDAK LAGI MENYIMPAN EMEL)
        const queryUser = `INSERT INTO users (no_kp, password, role, status_akaun) VALUES (?, ?, 'Ahli', 'Aktif')`;
        await db.query(queryUser, [no_kp, hashedPassword]);

        // 5. KEMAS KINI REKOD INDUK (senarai_staff) dengan emel & no telefon.
        const statusAkhir = dataStaf.status_ahli === 'A - Aktif' ? 'A - Aktif' : 'TIDAK BERBAYAR';
        
        const queryUpdateStaf = `
            UPDATE senarai_staff 
            SET emel_kelab = ?, no_tel = ?, status_ahli = ?
            WHERE no_kp = ?
        `;
        await db.query(queryUpdateStaf, [email, no_tel, statusAkhir, no_kp]);

        res.status(201).json({ 
            message: "Pendaftaran berjaya! Sila log masuk dan kemas kini profil anda di dalam sistem." 
        });

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
        // Gabungkan jadual `users` dan `senarai_staff` berpandukan `no_kp`
        // Carian dibuat berdasarkan `emel_kelab` di dalam jadual senarai_staff
        const query = `
            SELECT u.id, u.no_kp, u.password, u.role, u.status_akaun, 
                   s.nama_pegawai, s.penempatan, s.emel_kelab 
            FROM users u
            JOIN senarai_staff s ON u.no_kp = s.no_kp
            WHERE s.emel_kelab = ?
        `;
        const [users] = await db.query(query, [email]);
        const user = users[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "E-mel atau kata laluan salah." });
        }

        if (user.status_akaun === 'Ditolak') {
            return res.status(403).json({ message: "Akaun anda telah disekat/ditolak oleh pentadbir." });
        }

        // Jana Token JWT
        const token = jwt.sign(
            { id: user.id, role: user.role, no_kp: user.no_kp },
            process.env.JWT_SECRET,
            { expiresIn: '1d' }
        );

        res.status(200).json({
            message: "Berjaya log masuk.",
            token,
            user: { 
                no_kp: user.no_kp, name: user.nama_pegawai, role: user.role, penempatan: user.penempatan 
            }
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
    const lang = getLang(req);
    const msg = messages[lang];
    const { email } = req.body;

    try {
        // Cari pengguna berdasarkan `emel_kelab` dari senarai_staff
        const query = `
            SELECT u.id, s.emel_kelab 
            FROM users u
            JOIN senarai_staff s ON u.no_kp = s.no_kp
            WHERE s.emel_kelab = ?
        `;
        const [users] = await db.query(query, [email]);
        const user = users[0];

        if (!user) {
            return res.status(404).json({ message: msg.noUser });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiryTime = new Date(Date.now() + 10 * 60 * 1000); 

        // Update token pada jadual `users` menggunakan u.id
        await db.query(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
            [hashedResetToken, expiryTime, user.id]
        );

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
        
        const emailTemplate = `
        <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.05);">
            <div style="background-color: #0F4C3A; padding: 30px 20px; text-align: center;">
                <h1 style="margin: 0; font-size: 24px; color: #ffffff; letter-spacing: 1px;">KELAB SUKAN PERHILITAN</h1>
                <p style="margin: 5px 0 0; font-size: 12px; color: #a7f3d0; text-transform: uppercase; letter-spacing: 1px;">Portal Akses Ahli</p>
            </div>
            <div style="padding: 35px 40px; color: #374151; line-height: 1.6;">
                <h2 style="font-size: 20px; color: #111827; margin-top: 0; margin-bottom: 20px;">${msg.emailTitle}</h2>
                <p style="margin-bottom: 15px;">${msg.emailBody1}</p>
                <p style="margin-bottom: 25px;">${msg.emailBody2}</p>
                <div style="text-align: center; margin: 35px 0;">
                    <a href="${resetUrl}" target="_blank" style="background-color: #E30613; color: #ffffff; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; font-size: 15px; transition: background-color 0.3s;">
                        ${msg.emailBtn}
                    </a>
                </div>
                <p style="font-size: 14px; color: #6b7280; margin-bottom: 0;">${msg.emailIgnore}</p>
            </div>
            <div style="background-color: #f9fafb; padding: 25px 30px; text-align: center; font-size: 11px; color: #6b7280; border-top: 1px solid #e5e7eb;">
                <p style="margin: 0 0 10px;">&copy; ${new Date().getFullYear()} Kelab Sukan Perhilitan. Hak Cipta Terpelihara.</p>
                <p style="margin: 0 0 10px;">E-mel ini dijana secara automatik. Sila jangan balas mesej ini.</p>
            </div>
        </div>
        `;

        await sendEmail({
            email: user.emel_kelab,
            subject: msg.emailSubject,
            message: emailTemplate
        });

        res.status(200).json({ message: msg.resetEmailSent });
    } catch (error) {
        console.error("Forgot Password Error:", error);
        
        // Carian ID sebelum clear token jika berlaku ralat hantar e-mel
        const [failedUsers] = await db.query('SELECT u.id FROM users u JOIN senarai_staff s ON u.no_kp = s.no_kp WHERE s.emel_kelab = ?', [email]);
        if(failedUsers.length > 0) {
            await db.query('UPDATE users SET reset_token = NULL, reset_token_expiry = NULL WHERE id = ?', [failedUsers[0].id]);
        }
        res.status(500).json({ message: msg.emailFailed });
    }
};

// ==========================================
// 4. Tetapkan Semula Kata Laluan (Reset Password)
// ==========================================
export const resetPassword = async (req, res) => {
    const lang = getLang(req);
    const msg = messages[lang];

    const { token } = req.params;
    const { newPassword } = req.body;

    try {
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

        // Carian reset_token pada jadual `users` sahaja
        const [users] = await db.query(
            'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
            [hashedToken]
        );
        const user = users[0];

        if (!user) {
            return res.status(400).json({ message: msg.invalidToken });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await db.query(
            'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
            [hashedPassword, user.id]
        );

        res.status(200).json({ message: msg.resetSuccess });
    } catch (error) {
        console.error("Reset Password Error:", error);
        res.status(500).json({ message: msg.serverError });
    }
};