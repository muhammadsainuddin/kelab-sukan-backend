import db from '../config/db.js';
import bcrypt from 'bcryptjs';

// ==========================================
// 1. Ambil Profil & Logik Expired
// ==========================================
export const getMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp;

    try {
        const query = `
            SELECT 
                no_kp, 
                nama_pegawai AS nama_penuh, 
                gred_sspa, 
                penempatan, 
                IFNULL(kategori_staf, 'LAMA') AS kategori_staf,
                no_ahli, 
                negeri_bertugas, 
                emel_kelab AS email, 
                no_tel, 
                saiz_baju, 
                pilihan_potongan, 
                nama_waris, 
                hubungan_waris, 
                no_tel_waris, 
                no_acc_waris,
                bank_waris,
                status_ahli, 
                gambar, 
                klasifikasi_jawatan, 
                yuran_bulanan,
                no_acc_bank, 
                bank_ahli,
                YEAR(created_at) AS tahun_daftar
            FROM senarai_staff
            WHERE no_kp = ?
        `;
        const [rows] = await db.query(query, [no_kp]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Rekod kakitangan tidak ditemui di dalam senarai Induk." });
        }

        let profil = rows[0];

        // LOGIK EXPIRED 31 DISEMBER (FPX SAHAJA)
        if (profil.pilihan_potongan === 'Potongan FPX (ToyyibPay)' && profil.status_ahli === 'A - Aktif') {
            const currentYear = new Date().getFullYear();
            const [bayaran] = await db.query(`
                SELECT MAX(YEAR(tarikh_cipta)) as last_paid_year 
                FROM sejarah_bayaran 
                WHERE no_kp = ? AND status = 'BERJAYA'
            `, [no_kp]);

            const lastPaidYear = bayaran[0].last_paid_year;

            if (!lastPaidYear || lastPaidYear < currentYear) {
                await db.query(`UPDATE senarai_staff SET status_ahli = 'TIDAK BERBAYAR' WHERE no_kp = ?`, [no_kp]);
                await db.query(`UPDATE users SET status_akaun = 'Tidak Aktif' WHERE no_kp = ?`, [no_kp]);
                profil.status_ahli = 'TIDAK BERBAYAR';
            }
        }

        if (profil.status_ahli === 'A - Aktif') {
            profil.is_paid = true;
            profil.status_yuran = 'AHLI BERBAYAR';
        } else {
            profil.is_paid = false;
            profil.status_yuran = 'BELUM DIJELASKAN';
        }

        res.status(200).json({ success: true, data: profil });
    } catch (error) {
        console.error("Ralat Tarik Profil:", error);
        res.status(500).json({ success: false, message: "Ralat menarik data profil." });
    }
};

// ==========================================
// 2. Kemaskini Profil
// ==========================================
export const updateMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { 
        email, no_tel, saiz_baju, nama_waris, hubungan_waris, no_tel_waris,
        no_acc_waris, bank_waris, negeri_bertugas, nama_ptj, pilihan_potongan, 
        klasifikasi_jawatan, yuran_bulanan, no_acc_bank, bank_ahli, is_update_only
    } = req.body;

    const resit_pembayaran = req.file ? req.file.filename : null;

    try {
        const isUpdate = (is_update_only === 'true' || is_update_only === true);
        const setStatusAhli = isUpdate ? 'status_ahli' : "'Menunggu Kelulusan'";

        const query = `
            UPDATE senarai_staff 
            SET emel_kelab = ?, no_tel = ?, saiz_baju = IFNULL(?, saiz_baju), 
                nama_waris = IFNULL(?, nama_waris), hubungan_waris = IFNULL(?, hubungan_waris), 
                no_tel_waris = IFNULL(?, no_tel_waris), no_acc_waris = IFNULL(?, no_acc_waris),
                bank_waris = IFNULL(?, bank_waris), negeri_bertugas = IFNULL(?, negeri_bertugas), 
                penempatan = IFNULL(?, penempatan), pilihan_potongan = IFNULL(?, pilihan_potongan), 
                klasifikasi_jawatan = IFNULL(?, klasifikasi_jawatan), yuran_bulanan = IFNULL(?, yuran_bulanan),
                resit_pembayaran = IFNULL(?, resit_pembayaran), no_acc_bank = IFNULL(?, no_acc_bank),
                bank_ahli = IFNULL(?, bank_ahli), status_ahli = ${setStatusAhli}
            WHERE no_kp = ?
        `;
        
        await db.query(query, [
            email, no_tel, saiz_baju, nama_waris, hubungan_waris, no_tel_waris,
            no_acc_waris, bank_waris, negeri_bertugas, nama_ptj, pilihan_potongan, 
            klasifikasi_jawatan, yuran_bulanan, resit_pembayaran, no_acc_bank, bank_ahli, no_kp
        ]);

        if (req.body.kata_laluan) {
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(req.body.kata_laluan, saltRounds);
            await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashedPassword, no_kp]);
        }

        if (email) {
            await db.query(`UPDATE users SET email = ? WHERE no_kp = ?`, [email, no_kp]);
        }

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
// 3. Tarik Senarai PTJ
// ==========================================
export const getSenaraiPTJ = async (req, res) => {
    try {
        const [ptj] = await db.query('SELECT DISTINCT penempatan AS nama_ptj FROM senarai_staff WHERE penempatan IS NOT NULL AND penempatan != "" ORDER BY penempatan ASC');
        res.status(200).json({ success: true, data: ptj });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menarik senarai PTJ." });
    }
};

// ==========================================
// 4. Permohonan Berhenti Ahli
// ==========================================
export const applyResignation = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { sebab_berhenti } = req.body;

    try {
        await db.query(`INSERT INTO berhenti_ahli (no_kp, sebab_berhenti, status_permohonan, tarikh_mohon) VALUES (?, ?, 'MENUNGGU', NOW())`, [no_kp, sebab_berhenti]);
        await db.query(`UPDATE senarai_staff SET status_ahli = 'PROSES BERHENTI' WHERE no_kp = ?`, [no_kp]);

        res.status(200).json({ success: true, message: "Permohonan berhenti telah dihantar kepada Urusetia." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menghantar permohonan berhenti." });
    }
};

// ==========================================
// 5. Tukar Password
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
// 6. Muat Naik Gambar Profil (Auto Upload)
// ==========================================
export const updateGambarProfil = async (req, res) => {
    const no_kp = req.user.no_kp;
    if (!req.file) return res.status(400).json({ success: false, message: "Tiada fail gambar dijumpai." });
    
    try {
        await db.query(`UPDATE senarai_staff SET gambar = ? WHERE no_kp = ?`, [req.file.filename, no_kp]);
        res.status(200).json({ success: true, message: "Gambar profil berjaya dikemas kini!", gambar: req.file.filename });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menyimpan gambar." });
    }
};