import db from '../config/db.js';

// Ahli: Hantar Permohonan
export const mohonBantuan = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { jenis_bantuan, keterangan } = req.body;
    
    // Gunakan middleware upload yang sama, ia akan simpan fail jika ada
    const dokumen = req.file ? req.file.filename : null;

    try {
        await db.query(
            `INSERT INTO bantuan_kebajikan (no_kp, jenis_bantuan, keterangan, dokumen_sokongan) VALUES (?, ?, ?, ?)`,
            [no_kp, jenis_bantuan, keterangan, dokumen]
        );
        res.status(201).json({ success: true, message: "Permohonan bantuan berjaya dihantar kepada Urusetia." });
    } catch (error) {
        console.error("Ralat Mohon Bantuan:", error);
        res.status(500).json({ success: false, message: "Gagal menghantar permohonan." });
    }
};

// Ahli: Lihat Sejarah Permohonan Sendiri
export const sejarahBantuan = async (req, res) => {
    const no_kp = req.user.no_kp;
    try {
        const [sejarah] = await db.query(
            `SELECT * FROM bantuan_kebajikan WHERE no_kp = ? ORDER BY tarikh_mohon DESC`,
            [no_kp]
        );
        res.status(200).json({ success: true, data: sejarah });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat memuatkan sejarah permohonan." });
    }
};