import db from '../config/db.js';
import bcrypt from 'bcryptjs';


// ==========================================
// 1. Ambil Profil & Logik Expired (Cukai Jalan)
// ==========================================
export const getMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp;

    try {
        const query = `
            SELECT 
                m.no_kp, 
                m.nama_pegawai AS nama_penuh, 
                m.gred_sspa, 
                m.penempatan, 
                IFNULL(m.kategori_staf, 'LAMA') AS kategori_staf,
                k.no_ahli, 
                k.negeri_bertugas, 
                k.email, 
                k.no_tel, 
                k.saiz_baju, 
                k.pilihan_potongan, 
                k.nama_waris, 
                k.hubungan_waris, 
                k.no_tel_waris, 
                k.no_acc_waris,
                k.bank_waris,
                k.status_ahli, 
                k.gambar, 
                k.klasifikasi_jawatan, 
                k.yuran_bulanan,
                k.no_acc_bank, 
                k.bank_ahli,
                YEAR(k.created_at) AS tahun_daftar
            FROM master_penjawat m
            LEFT JOIN keahlian_kelab k ON m.no_kp = k.no_kp
            WHERE m.no_kp = ?
        `;
        const [rows] = await db.query(query, [no_kp]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Rekod kakitangan tidak ditemui di dalam senarai Induk." });
        }

        let profil = rows[0];

        // ========================================================
        // LOGIK EXPIRED 31 DISEMBER (AUTO-DOWNGRADE KE TIDAK AKTIF)
        // ========================================================
        // Hanya terpakai kepada ahli FPX yang sedang AKTIF
        if (profil.pilihan_potongan === 'Potongan FPX (ToyyibPay)' && profil.status_ahli === 'A - Aktif') {
            const currentYear = new Date().getFullYear();

            // Cari tahun bayaran terakhir yang BERJAYA
            const [bayaran] = await db.query(`
                SELECT MAX(YEAR(tarikh_cipta)) as last_paid_year 
                FROM sejarah_bayaran 
                WHERE no_kp = ? AND status = 'BERJAYA'
            `, [no_kp]);

            const lastPaidYear = bayaran[0].last_paid_year;

            // Jika tahun terakhir bayar adalah TAHUN LEPAS (kurang dari tahun semasa)
            if (!lastPaidYear || lastPaidYear < currentYear) {
                console.log(`[EXPIRED] Keahlian FPX IC: ${no_kp} telah luput. Status ditukar ke TIDAK BERBAYAR.`);
                
                // 1. Update database
                await db.query(`UPDATE keahlian_kelab SET status_ahli = 'TIDAK BERBAYAR' WHERE no_kp = ?`, [no_kp]);
                await db.query(`UPDATE users SET status_akaun = 'Tidak Aktif' WHERE no_kp = ?`, [no_kp]);
                
                // 2. Update objek profil semasa untuk dihantar ke frontend
                profil.status_ahli = 'TIDAK BERBAYAR';
            }
        }
        // ========================================================

        // Logik penentuan status pembayaran untuk UI
        if (profil.status_ahli === 'A - Aktif') {
            profil.is_paid = true;
            profil.status_yuran = 'AHLI BERBAYAR';
        } else {
            profil.is_paid = false;
            profil.status_yuran = 'BELUM DIJELASKAN';
        }

        res.status(200).json({ success: true, data: profil });
    } catch (error) {
        console.error("Ralat Tarik Profil Master:", error);
        res.status(500).json({ success: false, message: "Ralat menarik data profil master." });
    }
};


// ==========================================
// Kemaskini Profil & Hantar Borang Keahlian
// ==========================================
export const updateMyProfile = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { 
        email, no_tel, saiz_baju, nama_waris, hubungan_waris, no_tel_waris,
        no_acc_waris, bank_waris, 
        negeri_bertugas, nama_ptj, pilihan_potongan, klasifikasi_jawatan, yuran_bulanan,
        no_acc_bank, bank_ahli, // <-- TAMBAH bank_ahli DI SINI
        is_update_only
    } = req.body;

    const resit_pembayaran = req.file ? req.file.filename : null;

    try {
        const isUpdate = (is_update_only === 'true' || is_update_only === true);
        const setStatusAhli = isUpdate ? 'status_ahli' : "'Menunggu Kelulusan'";

        const query = `
            UPDATE keahlian_kelab 
            SET email = ?, 
                no_tel = ?, 
                saiz_baju = IFNULL(?, saiz_baju), 
                nama_waris = IFNULL(?, nama_waris), 
                hubungan_waris = IFNULL(?, hubungan_waris), 
                no_tel_waris = IFNULL(?, no_tel_waris),
                no_acc_waris = IFNULL(?, no_acc_waris),
                bank_waris = IFNULL(?, bank_waris),
                negeri_bertugas = IFNULL(?, negeri_bertugas), 
                nama_ptj = IFNULL(?, nama_ptj), 
                pilihan_potongan = IFNULL(?, pilihan_potongan), 
                klasifikasi_jawatan = IFNULL(?, klasifikasi_jawatan), 
                yuran_bulanan = IFNULL(?, yuran_bulanan),
                resit_pembayaran = IFNULL(?, resit_pembayaran),
                no_acc_bank = IFNULL(?, no_acc_bank),
                bank_ahli = IFNULL(?, bank_ahli),
                status_ahli = ${setStatusAhli}
            WHERE no_kp = ?
        `;
        
        await db.query(query, [
            email, no_tel, saiz_baju, 
            nama_waris, hubungan_waris, no_tel_waris,
            no_acc_waris, bank_waris, 
            negeri_bertugas, nama_ptj, pilihan_potongan, 
            klasifikasi_jawatan, yuran_bulanan, 
            resit_pembayaran, no_acc_bank, bank_ahli, no_kp
        ]);

        if (nama_ptj) {
            await db.query(`UPDATE master_penjawat SET penempatan = ? WHERE no_kp = ?`, [nama_ptj, no_kp]);
        }

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
// Tarik Senarai PTJ dari master_penjawat (Pilihan 2)
// ==========================================
export const getSenaraiPTJ = async (req, res) => {
    try {
        const [ptj] = await db.query('SELECT DISTINCT penempatan AS nama_ptj FROM master_penjawat WHERE penempatan IS NOT NULL AND penempatan != "" ORDER BY penempatan ASC');
        res.status(200).json({ success: true, data: ptj });
    } catch (error) {
        console.error("Ralat Senarai PTJ:", error);
        res.status(500).json({ success: false, message: "Ralat menarik senarai PTJ." });
    }
};

// ... KEKALKAN KOD LAIN (applyResignation, changePassword, dll) ...

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