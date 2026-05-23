import db from '../config/db.js';

// ==========================================
// BAHAGIAN A: UNTUK URUSETIA / AJK (ADMIN)
// ==========================================

export const bukaPertandingan = async (req, res) => {
    const { 
        nama_pertandingan, 
        keterangan, 
        tarikh_kejohanan, 
        tarikh_tutup_pendaftaran,
        emel_urusetia,
        no_tel_urusetia 
    } = req.body;

    // Tangkap nama fail jika ada gambar dimuat naik
    const poster = req.file ? req.file.filename : null;

    try {
        const query = `
            INSERT INTO pertandingan 
            (nama_pertandingan, keterangan, tarikh_kejohanan, tarikh_tutup, emel_urusetia, no_tel_urusetia, poster, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'AKTIF')
        `;
        const [result] = await db.query(query, [
            nama_pertandingan, 
            keterangan, 
            tarikh_kejohanan, 
            tarikh_tutup_pendaftaran,
            emel_urusetia || null,
            no_tel_urusetia || null,
            poster
        ]);

        res.status(201).json({ 
            success: true, 
            message: "Pertandingan berjaya dibuka untuk pendaftaran!",
            id_pertandingan: result.insertId 
        });
    } catch (error) {
        console.error("Ralat Buka Pertandingan:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan semasa membuka acara." });
    }
};

export const senaraiPesertaPertandingan = async (req, res) => {
    const { id } = req.params;

    try {
        const query = `
            SELECT 
                p.tarikh_daftar, 
                p.kategori, 
                m.nama_pegawai, 
                m.penempatan, 
                u.email, 
                k.no_tel
            FROM penyertaan_pertandingan p
            JOIN users u ON p.no_kp = u.no_kp
            JOIN master_penjawat m ON u.no_kp = m.no_kp
            LEFT JOIN keahlian_kelab k ON p.no_kp = k.no_kp
            WHERE p.pertandingan_id = ?
            ORDER BY p.tarikh_daftar ASC
        `;
        const [peserta] = await db.query(query, [id]);
        res.status(200).json({ success: true, data: peserta });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menarik senarai peserta." });
    }
};

// ==========================================
// BAHAGIAN B: UNTUK AHLI (MEMBER)
// ==========================================

export const senaraiPertandinganAktif = async (req, res) => {
    try {
        // SELECT tambahan lajur `poster` supaya gambar boleh dipaparkan
        const query = `
            SELECT 
                id, 
                nama_pertandingan, 
                keterangan, 
                tarikh_kejohanan, 
                tarikh_tutup, 
                emel_urusetia, 
                no_tel_urusetia,
                poster
            FROM pertandingan 
            WHERE status = 'AKTIF' AND tarikh_tutup >= CURDATE()
            ORDER BY tarikh_kejohanan ASC
        `;
        const [pertandingan] = await db.query(query);
        res.status(200).json({ success: true, data: pertandingan });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat menarik senarai pertandingan." });
    }
};

export const sertaiPertandingan = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { pertandingan_id, kategori } = req.body;

    try {
        const [cek] = await db.query(
            "SELECT id FROM penyertaan_pertandingan WHERE pertandingan_id = ? AND no_kp = ?",
            [pertandingan_id, no_kp]
        );

        if (cek.length > 0) {
            return res.status(400).json({ success: false, message: "Anda sudah mendaftar untuk pertandingan ini!" });
        }

        const query = `INSERT INTO penyertaan_pertandingan (pertandingan_id, no_kp, kategori) VALUES (?, ?, ?)`;
        await db.query(query, [pertandingan_id, no_kp, kategori || 'Umum']);

        res.status(201).json({ success: true, message: "Pendaftaran berjaya!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal mendaftar." });
    }
};