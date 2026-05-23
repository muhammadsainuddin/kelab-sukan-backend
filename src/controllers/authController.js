import db from '../config/db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import sendEmail from '../utils/sendEmail.js';
import { messages, getLang } from '../utils/lang.js'; // Utility bahasa
import eventBus from '../utils/eventEmitter.js';

// ==========================================
// FUNGSI BANTUAN: Pengiraan Automatik
// ==========================================


// PENGIRAAN YURAN BERDASARKAN IMEJ 2
const kiraYuran = (gred) => {
    if (!gred) return 5.00;
    const gredUpper = gred.toUpperCase();
    
    // i. Gred JUSA: RM 15.00
    if (gredUpper.includes('JUSA') || gredUpper.includes('VU') || gredUpper.includes('VK')) {
        return 15.00;
    }
    
    const match = gred.match(/\d+/);
    if (match) {
        const num = parseInt(match[0], 10);
        // ii. Gred 41 hingga 54: RM 10.00
        if (num >= 41 && num <= 54) return 10.00;
        // iii. Gred 1 hingga 36: RM 5.00
        if (num >= 1 && num <= 36) return 5.00;
    }
    return 5.00; // Default
};

// PENENTUAN KAEDAH POTONGAN BERDASARKAN IMEJ 2
const tentukanPotongan = (gred, pilihanPengguna) => {
    if (!gred) return pilihanPengguna || 'Tunai / Transfer';
    const gredUpper = gred.toUpperCase();
    
    // Wajib Potongan Gaji: Kumpulan JUSA / Gred 'G'
    if (gredUpper.includes('JUSA') || gredUpper.includes('VU') || gredUpper.includes('VK') || gredUpper.startsWith('G')) {
        return 'Potongan Gaji / Jabatan';
    }
    
    // Gred Gunasama: Boleh pilih Tunai atau Potongan Gaji
    return pilihanPengguna || 'Tunai / Transfer';
};

// ==========================================
// 1. Pendaftaran Akaun (Register)
// ==========================================
export const register = async (req, res) => {
    const { 
        no_kp, email, password, no_tel, negeri_bertugas, 
        nama_waris, hubungan_waris, no_tel_waris, pilihan_potongan 
    } = req.body;

    try {
        // 1. Semak No IC dengan master_penjawat (Induk)
        const [staf] = await db.query('SELECT * FROM master_penjawat WHERE no_kp = ?', [no_kp]);
        if (staf.length === 0) {
            return res.status(403).json({ message: "Maaf, No. IC ini tiada dalam rekod kakitangan Induk. Sila hubungi Urusetia." });
        }

        // 2. Semak jika sudah berdaftar
        const [existingUser] = await db.query('SELECT * FROM users WHERE email = ? OR no_kp = ?', [email, no_kp]);
        if (existingUser.length > 0) {
            return res.status(400).json({ message: "Akaun untuk No. IC atau E-mel ini telah wujud dalam sistem." });
        }

        const dataStaf = staf[0];
        
        // 3. Pengiraan Pintar (Yuran & Potongan berdasarkan Gred)
        const yuranBulanan = kiraYuran(dataStaf.gred_sspa);
        const kaedahPotongan = tentukanPotongan(dataStaf.gred_sspa, pilihan_potongan);

        // 4. Hash Kata Laluan
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // 5. Simpan ke dalam jadual `users` dengan status 'Menunggu'
        const queryUser = `INSERT INTO users (no_kp, email, password, role, status_akaun) VALUES (?, ?, ?, 'Ahli', 'Menunggu')`;
        await db.query(queryUser, [no_kp, email, hashedPassword]);

        // 6. Simpan rekod kelab secara menyeluruh ke `keahlian_kelab`
        const queryKeahlian = `
            INSERT INTO keahlian_kelab 
            (no_kp, nama_penuh, nama_majikan, negeri_bertugas, email, no_tel, nama_waris, hubungan_waris, no_tel_waris, yuran_bulanan, pilihan_potongan, status_ahli) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Menunggu Kelulusan')
        `;
        
        // Nota: nama_majikan digunakan untuk menyimpan lokasi penempatan berdasarkan tetapan kelab anda
        await db.query(queryKeahlian, [
            no_kp, 
            dataStaf.nama_pegawai, 
            dataStaf.penempatan, 
            negeri_bertugas, 
            email, 
            no_tel, 
            nama_waris, 
            hubungan_waris, 
            no_tel_waris, 
            yuranBulanan, 
            kaedahPotongan
        ]);

        res.status(201).json({ 
            message: "Pendaftaran berjaya! Permohonan anda sedang diproses. Sila tunggu pengesahan daripada Admin sebelum log masuk." 
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
        const query = `
            SELECT u.*, m.nama_pegawai, m.penempatan 
            FROM users u
            JOIN master_penjawat m ON u.no_kp = m.no_kp
            WHERE u.email = ?
        `;
        const [users] = await db.query(query, [email]);
        const user = users[0];

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(401).json({ message: "E-mel atau kata laluan salah." });
        }

        // HALANG LOG MASUK JIKA STATUS 'Menunggu'
        if (user.status_akaun === 'Menunggu') {
            return res.status(403).json({ message: "Akaun anda sedang menunggu kelulusan daripada Admin." });
        }
        
        if (user.status_akaun === 'Ditolak') {
            return res.status(403).json({ message: "Akaun anda telah ditolak oleh Admin." });
        }

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
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        const user = users[0];

        if (!user) {
            return res.status(404).json({ message: msg.noUser });
        }

        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiryTime = new Date(Date.now() + 10 * 60 * 1000); // Token sah selama 10 minit

        await db.query(
            'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE email = ?',
            [hashedResetToken, expiryTime, email]
        );

        const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;
        
        // Bina e-mel dinamik menggunakan templat
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
            email: user.email,
            subject: msg.emailSubject,
            message: emailTemplate
        });

        res.status(200).json({ message: msg.resetEmailSent });
    } catch (error) {
        console.error("Forgot Password Error:", error);
        await db.query('UPDATE users SET reset_token = NULL, reset_token_expiry = NULL WHERE email = ?', [email]);
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

        const [users] = await db.query(
            'SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
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