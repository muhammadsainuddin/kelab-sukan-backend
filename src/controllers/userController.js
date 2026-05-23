import db from '../config/db.js';
import bcrypt from 'bcryptjs';

// ==========================================
// 1. Ambil Profil Lengkap Ahli (Tarik dari Induk)
// ==========================================
export const getMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp; // Diambil dari verifyToken middleware

    try {
        // Guna master_penjawat sebagai jadual utama (LEFT JOIN ke kelab)
        const query = `
            SELECT 
                m.no_kp, m.nama_pegawai AS nama_penuh, m.gred_sspa, m.penempatan,
                k.no_ahli, k.negeri_bertugas, k.email, k.no_tel, k.saiz_baju, 
                k.pilihan_potongan, k.nama_waris, k.hubungan_waris, k.no_tel_waris, 
                k.status_ahli, k.gambar, k.klasifikasi_jawatan, k.yuran_bulanan
            FROM master_penjawat m
            LEFT JOIN keahlian_kelab k ON m.no_kp = k.no_kp
            WHERE m.no_kp = ?
        `;
        const [rows] = await db.query(query, [no_kp]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Rekod kakitangan tidak ditemui di dalam senarai Induk." });
        }

        const profil = rows[0];

        // LOGIK PENENTUAN STATUS PEMBAYARAN
        if (profil.status_ahli === 'A - Aktif') {
            profil.is_paid = true;
            profil.status_yuran = 'AHLI BERBAYAR';
        } else {
            profil.is_paid = false;
            profil.status_yuran = 'AHLI TIDAK BERBAYAR';
        }

        res.status(200).json({ success: true, data: profil });
    } catch (error) {
        console.error("Ralat Tarik Profil:", error);
        res.status(500).json({ success: false, message: "Ralat menarik data profil." });
    }
};

// ==========================================
// 2. Kemaskini Profil & Hantar Borang Keahlian
// ==========================================
export const updateMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { 
        email, no_tel, saiz_baju, nama_waris, hubungan_waris, no_tel_waris,
        negeri_bertugas, nama_ptj, pilihan_potongan, klasifikasi_jawatan, yuran_bulanan,
        is_update_only // Flag yang dihantar dari Vue.js
    } = req.body;

    // Tangkap nama fail resit jika ada (Pastikan anda letak middleware multer di route)
    const resit_pembayaran = req.file ? req.file.filename : null;

    try {
        // LOGIK STATUS: 
        // Jika is_update_only adalah true, kita kekalkan nilai 'status_ahli' asal dalam database.
        // Jika bukan (pendaftaran baru), kita set jadi 'Menunggu Kelulusan'.
        const isUpdate = (is_update_only === 'true' || is_update_only === true);
        const setStatusAhli = isUpdate ? 'status_ahli' : "'Menunggu Kelulusan'";

        // Guna IFNULL supaya jika pengguna hanya update saiz baju, data waris yang lama tak terpadam (menjadi null).
        const query = `
            UPDATE keahlian_kelab 
            SET email = ?, 
                no_tel = ?, 
                saiz_baju = IFNULL(?, saiz_baju), 
                nama_waris = IFNULL(?, nama_waris), 
                hubungan_waris = IFNULL(?, hubungan_waris), 
                no_tel_waris = IFNULL(?, no_tel_waris),
                negeri_bertugas = IFNULL(?, negeri_bertugas), 
                nama_ptj = IFNULL(?, nama_ptj), 
                pilihan_potongan = IFNULL(?, pilihan_potongan), 
                klasifikasi_jawatan = IFNULL(?, klasifikasi_jawatan), 
                yuran_bulanan = IFNULL(?, yuran_bulanan),
                resit_pembayaran = IFNULL(?, resit_pembayaran),
                status_ahli = ${setStatusAhli}
            WHERE no_kp = ?
        `;
        
        await db.query(query, [
            email, no_tel, saiz_baju, 
            nama_waris, hubungan_waris, no_tel_waris,
            negeri_bertugas, nama_ptj, pilihan_potongan, 
            klasifikasi_jawatan, yuran_bulanan, 
            resit_pembayaran, no_kp
        ]);

        // Di dalam controller backend (updateMyProfile):
        if (req.body.kata_laluan) {
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(req.body.kata_laluan, saltRounds);

            // Ubah password di jadual 'users'
            await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashedPassword, req.user.no_kp]);
        }

        // Kemaskini e-mel di jadual users juga untuk log masuk (Jika e-mel dihantar)
        if (email) {
            await db.query(`UPDATE users SET email = ? WHERE no_kp = ?`, [email, no_kp]);
        }

        // Paparkan mesej yang berbeza mengikut jenis tindakan
        const responseMessage = isUpdate 
            ? "Maklumat profil anda berjaya dikemas kini." 
            : "Borang pendaftaran anda telah dihantar kepada Urusetia.";

        res.status(200).json({ success: true, message: responseMessage });
    } catch (error) {
        console.error("Ralat Kemaskini Profil:", error);
        res.status(500).json({ success: false, message: "Gagal mengemaskini profil." });
    }
};

// ==========================================
// 3. Permohonan Berhenti Ahli
// ==========================================
export const applyResignation = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { sebab_berhenti } = req.body;

    try {
        // 1. Simpan permohonan dalam jadual berhenti_ahli
        const query = `INSERT INTO berhenti_ahli (no_kp, sebab_berhenti, status_permohonan, tarikh_mohon) VALUES (?, ?, 'MENUNGGU', NOW())`;
        await db.query(query, [no_kp, sebab_berhenti]);

        // 2. Tukar status dalam keahlian_kelab kepada 'PROSES BERHENTI' supaya Admin perasan
        await db.query(`UPDATE keahlian_kelab SET status_ahli = 'PROSES BERHENTI' WHERE no_kp = ?`, [no_kp]);

        res.status(200).json({ success: true, message: "Permohonan berhenti telah dihantar kepada Urusetia." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menghantar permohonan berhenti." });
    }
};

// ==========================================
// 4. Tukar Password
// ==========================================
export const changePassword = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { oldPassword, newPassword } = req.body;

    try {
        const [user] = await db.query(`SELECT password FROM users WHERE no_kp = ?`, [no_kp]);
        
        const isMatch = await bcrypt.compare(oldPassword, user[0].password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Kata laluan lama salah." });

        const hashed = await bcrypt.hash(newPassword, 10);
        await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashed, no_kp]);

        res.status(200).json({ success: true, message: "Kata laluan berjaya ditukar." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menukar kata laluan." });
    }
};

// ==========================================
// 5. Muat Naik Gambar Profil (Auto Upload)
// ==========================================
export const updateGambarProfil = async (req, res) => {
    const no_kp = req.user.no_kp;
    
    // Pastikan fail ditangkap
    if (!req.file) {
        return res.status(400).json({ success: false, message: "Tiada fail gambar dijumpai." });
    }
    
    const gambar = req.file.filename;

    try {
        await db.query(`UPDATE keahlian_kelab SET gambar = ? WHERE no_kp = ?`, [gambar, no_kp]);
        res.status(200).json({ success: true, message: "Gambar profil berjaya dikemas kini!", gambar });
    } catch (error) {
        console.error("Ralat Upload Gambar:", error);
        res.status(500).json({ success: false, message: "Ralat pangkalan data semasa menyimpan gambar." });
    }
};