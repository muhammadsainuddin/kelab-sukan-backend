import db from '../config/db.js';
import bcrypt from 'bcryptjs';

// ==========================================
// 1. PENGURUSAN BANTUAN KEBAJIKAN
// ==========================================
export const senaraiKebajikan = async (req, res) => {
    try {
        const query = `
            SELECT b.id, b.no_kp, m.nama_pegawai, m.penempatan, b.jenis_bantuan, 
                   b.keterangan, b.dokumen_sokongan, b.status_permohonan, b.tarikh_mohon
            FROM bantuan_kebajikan b
            JOIN master_penjawat m ON b.no_kp = m.no_kp
            ORDER BY b.tarikh_mohon DESC
        `;
        const [senarai] = await db.query(query);
        res.status(200).json({ success: true, data: senarai });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const kemaskiniStatusKebajikan = async (req, res) => {
    const { id } = req.params;
    const { status_permohonan } = req.body;
    try {
        await db.query(`UPDATE bantuan_kebajikan SET status_permohonan = ? WHERE id = ?`, [status_permohonan, id]);
        res.status(200).json({ success: true, message: `Permohonan kebajikan dikemas kini kepada: ${status_permohonan}` });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};


// ==========================================
// 2. PENGURUSAN BERHENTI AHLI
// ==========================================
export const senaraiBerhentiAhli = async (req, res) => {
    try {
        const query = `
            SELECT b.id, b.no_kp, m.nama_pegawai, m.penempatan, b.sebab_berhenti, 
                   b.status_permohonan, b.tarikh_mohon
            FROM berhenti_ahli b
            JOIN master_penjawat m ON b.no_kp = m.no_kp
            ORDER BY b.tarikh_mohon DESC
        `;
        const [senarai] = await db.query(query);
        res.status(200).json({ success: true, data: senarai });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

// FUNGSI BAHARU: Boleh Lulus atau Tolak
export const kemaskiniBerhentiAhli = async (req, res) => {
    const { id } = req.params;
    const { no_kp, status_permohonan } = req.body; // Terima 'LULUS' atau 'DITOLAK'

    try {
        // 1. Kemas kini status dalam jadual berhenti_ahli
        await db.query(`UPDATE berhenti_ahli SET status_permohonan = ? WHERE id = ?`, [status_permohonan, id]);
        
        // 2. Kemas kini status akaun Kelab mereka
        if (status_permohonan === 'LULUS') {
            await db.query(`UPDATE keahlian_kelab SET status_ahli = 'TIDAK AKTIF / BERHENTI' WHERE no_kp = ?`, [no_kp]);
        } else if (status_permohonan === 'DITOLAK') {
            // Jika ditolak, kembalikan status keahlian kepada aktif
            await db.query(`UPDATE keahlian_kelab SET status_ahli = 'A - Aktif' WHERE no_kp = ?`, [no_kp]);
        }
        
        res.status(200).json({ success: true, message: `Permohonan penamatan kelab telah ${status_permohonan}.` });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

// ==========================================
// 3. PENGESAHAN PENDAFTARAN (ONLINE)
// ==========================================
// ==========================================
// 6. SENARAI PENGESAHAN (MENUNGGU KELULUSAN)
// ==========================================
export const senaraiMenungguSahkan = async (req, res) => {
    try {
        // Penyelarasan: Mencari ahli yang telah menghantar borang (Status: Menunggu Kelulusan)
        // Kita tarik data dari keahlian_kelab sebagai rujukan utama proses pengesahan yuran
        const query = `
            SELECT 
                k.no_kp, 
                u.email, 
                m.nama_pegawai, 
                m.gred_sspa, 
                m.penempatan, 
                k.negeri_bertugas,
                k.nama_ptj,
                k.yuran_bulanan, 
                k.pilihan_potongan, 
                k.klasifikasi_jawatan,
                k.created_at AS tarikh_mohon
            FROM keahlian_kelab k
            JOIN master_penjawat m ON k.no_kp = m.no_kp
            JOIN users u ON k.no_kp = u.no_kp
            WHERE k.status_ahli = 'Menunggu Kelulusan'
            ORDER BY k.created_at ASC
        `;
        
        const [senarai] = await db.query(query);
        
        res.status(200).json({ 
            success: true, 
            count: senarai.length,
            data: senarai 
        });
    } catch (error) {
        console.error("Ralat Senarai Pengesahan:", error);
        res.status(500).json({ success: false, message: "Ralat pelayan semasa menarik data pengesahan." });
    }
};

// Fungsi Bantuan untuk Kod Negeri
// Fungsi bantuan untuk menukar nama negeri kepada Kod 3 Huruf
const getKodNegeri = (negeri) => {
    if (!negeri) return 'MAL'; // Default jika tiada negeri
    
    const kod = {
        'Johor': 'JHR', 'Kedah': 'KDH', 'Kelantan': 'KTN', 'Melaka': 'MLK',
        'Negeri Sembilan': 'NSN', 'Pahang': 'PHG', 'Perak': 'PRK', 'Perlis': 'PLS',
        'Pulau Pinang': 'PNG', 'Selangor': 'SGR', 'Terengganu': 'TRG',
        'WP Kuala Lumpur': 'KUL', 'WP Labuan': 'LBN', 'WP Putrajaya': 'PJY'
    };
    return kod[negeri] || 'MAL';
};

export const sahkanAkaun = async (req, res) => {
    const { no_kp } = req.params;
    
    // Kita tangkap kedua-dua kemungkinan nama pembolehubah dari Frontend
    const status_keputusan = req.body.status_keputusan || req.body.status_ahli;

    try {
        // Terima sama ada 'Aktif' atau 'A - Aktif'
        if (status_keputusan === 'Aktif' || status_keputusan === 'A - Aktif') {
            
            // 1. Tarik maklumat tarikh mula potongan / daftar untuk tentukan tahun
            const [ahli] = await db.query('SELECT mula_potongan, created_at FROM keahlian_kelab WHERE no_kp = ?', [no_kp]);
            
            // Semakan keselamatan jika no_kp tidak wujud
            if (ahli.length === 0) {
                return res.status(404).json({ success: false, message: "Rekod keahlian tidak dijumpai." });
            }

            // Dapatkan tahun dari mula_potongan, jika tiada guna tahun daftar (created_at) atau tahun semasa
            let tahun = new Date().getFullYear();
            if (ahli[0].mula_potongan) {
                const tarikhMula = new Date(ahli[0].mula_potongan);
                if (!isNaN(tarikhMula)) tahun = tarikhMula.getFullYear();
            } else if (ahli[0].created_at) {
                const tarikhDaftar = new Date(ahli[0].created_at);
                if (!isNaN(tarikhDaftar)) tahun = tarikhDaftar.getFullYear();
            }

            // 2. Cari urutan terakhir bagi format KP-XXXX-TAHUN
            const pattern = `KP-%-${tahun}`;
            const [lastRecord] = await db.query(
                'SELECT no_ahli FROM keahlian_kelab WHERE no_ahli LIKE ? ORDER BY no_ahli DESC LIMIT 1', 
                [pattern]
            );

            let nextNum = 1;
            
            // 3. Logik pecahan ID untuk format baharu: KP-0001-2026
            if (lastRecord.length > 0 && lastRecord[0].no_ahli) {
                try {
                    const parts = lastRecord[0].no_ahli.split('-'); 
                    // parts[0] = 'KP', parts[1] = '0001', parts[2] = '2026'
                    if (parts.length >= 3) {
                        nextNum = parseInt(parts[1], 10) + 1;
                    }
                } catch (err) {
                    // Fallback jika format lama di pangkalan data rosak
                    nextNum = 1; 
                }
            }

            // 4. Format ID Baharu: KP-0001-2026 (Running number 4 digit)
            const noAhliBaru = `KP-${nextNum.toString().padStart(4, '0')}-${tahun}`;

            // 5. Kemas kini status kepada Aktif dan simpan No Ahli
            await db.query(
                'UPDATE keahlian_kelab SET status_ahli = "A - Aktif", no_ahli = ? WHERE no_kp = ?',
                [noAhliBaru, no_kp]
            );
            await db.query('UPDATE users SET status_akaun = "Aktif" WHERE no_kp = ?', [no_kp]);
            
            return res.status(200).json({ 
                success: true, 
                message: "Tindakan pengesahan selesai. Akaun aktif.",
                no_ahli: noAhliBaru 
            });

        } else {
            // JIKA DITOLAK
            await db.query('UPDATE keahlian_kelab SET status_ahli = "Ditolak" WHERE no_kp = ?', [no_kp]);
            await db.query('UPDATE users SET status_akaun = "Ditolak" WHERE no_kp = ?', [no_kp]);
            
            return res.status(200).json({ success: true, message: "Permohonan telah ditolak." });
        }

    } catch (error) {
        // Tulis ralat sebenar di Terminal Mac anda (Sangat penting untuk debugging)
        console.error("🔴 RALAT SAHKAN AKAUN:", error);
        res.status(500).json({ success: false, message: "Ralat pada pelayan pangkalan data." });
    }
};

// ==========================================
// 4. PENGURUSAN AHLI KELAB
// ==========================================
export const senaraiSemuaAhli = async (req, res) => {
    try {
        const query = `
            SELECT k.*, m.gred_sspa, m.penempatan, u.role, u.status_akaun
            FROM keahlian_kelab k
            LEFT JOIN master_penjawat m ON k.no_kp = m.no_kp
            LEFT JOIN users u ON k.no_kp = u.no_kp
            ORDER BY k.nama_penuh ASC
        `;
        const [ahli] = await db.query(query);
        res.status(200).json({ success: true, data: ahli });
    } catch (error) {
        // Tulis ralat sebenar di terminal supaya senang debug!
        console.error("Ralat pada senaraiSemuaAhli:", error); 
        res.status(500).json({ success: false, message: "Gagal menarik senarai ahli." });
    }
};

export const kemaskiniAhli = async (req, res) => {
    const { no_kp } = req.params;
    const { no_ahli, status_ahli, role } = req.body;
    try {
        await db.query(
            `UPDATE keahlian_kelab SET no_ahli = ?, status_ahli = ? WHERE no_kp = ?`, 
            [no_ahli || null, status_ahli, no_kp]
        );
        if (role) {
            const statusAkaun = status_ahli === 'A - Aktif' ? 'Aktif' : 'Ditolak';
            await db.query(`UPDATE users SET role = ?, status_akaun = ? WHERE no_kp = ?`, [role, statusAkaun, no_kp]);
        }
        res.status(200).json({ success: true, message: "Maklumat ahli berjaya dikemas kini." });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal mengemas kini ahli." });
    }
};

export const daftarAhliManual = async (req, res) => {
    const { no_kp, yuran_bulanan, pilihan_potongan, mula_potongan, no_ahli } = req.body;
    try {
        // Semak Wajib: Tarik nama & penempatan dari Induk Staff
        const [induk] = await db.query(`SELECT nama_pegawai, penempatan FROM master_penjawat WHERE no_kp = ?`, [no_kp]);
        if (induk.length === 0) {
            return res.status(400).json({ success: false, message: "Penjawat tiada dalam senarai Induk." });
        }

        const nama_penuh = induk[0].nama_pegawai;
        const nama_majikan = induk[0].penempatan;

        // Semak jika dah daftar
        const [wujud] = await db.query(`SELECT no_kp FROM keahlian_kelab WHERE no_kp = ?`, [no_kp]);
        if (wujud.length > 0) {
            return res.status(400).json({ success: false, message: "Kakitangan ini sudah berdaftar sebagai ahli." });
        }

        const query = `
            INSERT INTO keahlian_kelab 
            (no_kp, nama_penuh, nama_majikan, yuran_bulanan, pilihan_potongan, mula_potongan, no_ahli, status_ahli) 
            VALUES (?, ?, ?, ?, ?, ?, ?, 'A - Aktif')
        `;
        await db.query(query, [no_kp, nama_penuh, nama_majikan, yuran_bulanan, pilihan_potongan, mula_potongan || null, no_ahli || null]);
        
        res.status(200).json({ success: true, message: "Ahli baharu berjaya didaftarkan secara manual!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pangkalan data." });
    }
};

// ==========================================
// 5. INDUK STAFF (MASTER HR)
// ==========================================
export const senaraiSemuaStaff = async (req, res) => {
    try {
        const query = `
            SELECT m.no_kp, m.nama_pegawai, m.gred_sspa, m.penempatan,
                   k.status_ahli,
                   CASE WHEN k.no_kp IS NOT NULL THEN 1 ELSE 0 END AS is_ahli
            FROM master_penjawat m
            LEFT JOIN keahlian_kelab k ON m.no_kp = k.no_kp
            ORDER BY m.nama_pegawai ASC
        `;
        const [staff] = await db.query(query);
        res.status(200).json({ success: true, data: staff });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menarik senarai staff." });
    }
};

export const tambahStaffBulk = async (req, res) => {
    const { staffList } = req.body;
    if (!staffList || staffList.length === 0) return res.status(400).json({ success: false, message: "Tiada data dihantar." });
    
    try {
        const values = staffList.map(s => [s.no_kp, s.nama_pegawai.toUpperCase(), s.gred_sspa.toUpperCase(), s.penempatan.toUpperCase()]);
        const query = `
            INSERT INTO master_penjawat (no_kp, nama_pegawai, gred_sspa, penempatan) VALUES ? 
            ON DUPLICATE KEY UPDATE 
            nama_pegawai = VALUES(nama_pegawai), gred_sspa = VALUES(gred_sspa), penempatan = VALUES(penempatan)
        `;
        await db.query(query, [values]);
        res.status(200).json({ success: true, message: `${staffList.length} rekod penjawat berjaya disimpan.` });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pangkalan data." });
    }
};

// ==========================================
// 6. PROFIL SAYA & KATA LALUAN
// ==========================================
export const getProfilSaya = async (req, res) => {
    const no_kp = req.user.no_kp || req.user.id || req.user.ic; 
    try {
        const query = `
            SELECT m.nama_pegawai AS nama_penuh, m.no_kp, m.penempatan AS nama_majikan, m.gred_sspa,
                   k.email, k.no_tel, k.saiz_baju, k.gambar, k.status_ahli
            FROM master_penjawat m
            LEFT JOIN keahlian_kelab k ON m.no_kp = k.no_kp
            WHERE m.no_kp = ?
        `;
        const [profil] = await db.query(query, [no_kp]);
        if (profil.length === 0) return res.status(404).json({ success: false, message: "Rekod staf tiada di dalam senarai Induk." });
        res.status(200).json({ success: true, data: profil[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pelayan." });
    }
};

export const kemaskiniProfilSaya = async (req, res) => {
    const no_kp = req.user.no_kp || req.user.id || req.user.ic;
    const { nama_penuh, email, no_tel, saiz_baju, nama_majikan, gambar } = req.body;
    try {
        const query = `
            INSERT INTO keahlian_kelab (no_kp, nama_penuh, nama_majikan, email, no_tel, saiz_baju, gambar, status_ahli)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'Admin')
            ON DUPLICATE KEY UPDATE
                nama_penuh = VALUES(nama_penuh), nama_majikan = VALUES(nama_majikan), email = VALUES(email),
                no_tel = VALUES(no_tel), saiz_baju = VALUES(saiz_baju), gambar = VALUES(gambar)
        `;
        await db.query(query, [no_kp, nama_penuh, nama_majikan, email, no_tel, saiz_baju, gambar]);
        res.status(200).json({ success: true, message: "Profil anda berjaya dikemas kini!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal mengemas kini profil." });
    }
};

export const tukarKatalaluan = async (req, res) => {
    const no_kp = req.user.no_kp || req.user.id || req.user.ic;
    const { kata_laluan_lama, kata_laluan_baru } = req.body;
    try {
        const [users] = await db.query(`SELECT password FROM users WHERE no_kp = ?`, [no_kp]);
        if (users.length === 0) return res.status(404).json({ success: false, message: "Akaun sistem tidak ditemui." });

        const isMatch = await bcrypt.compare(kata_laluan_lama, users[0].password);
        if (!isMatch) return res.status(400).json({ success: false, message: "Kata laluan lama tidak sah." });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(kata_laluan_baru, salt);

        await db.query(`UPDATE users SET password = ? WHERE no_kp = ?`, [hashedPassword, no_kp]);
        res.status(200).json({ success: true, message: "Kata laluan berjaya ditukar!" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Ralat pada pelayan." });
    }
};


export const getAdminStats = async (req, res) => {
    try {
        // 1. Jumlah Ahli Berbayar vs Tidak Berbayar
        const [totalAhli] = await db.query("SELECT COUNT(*) as count FROM keahlian_kelab WHERE status_ahli = 'A - Aktif'");
        const [pendingApproval] = await db.query("SELECT COUNT(*) as count FROM users WHERE status_akaun = 'Menunggu'");
        
        // 2. Ringkasan Bantuan Kebajikan (Berdasarkan Nilai Pekeliling)
        const [pendingWelfare] = await db.query("SELECT COUNT(*) as count FROM bantuan_kebajikan WHERE status_permohonan = 'MENUNGGU'");
        
        // 3. Statistik Gred (Untuk Analisis Yuran)
        const [gredStats] = await db.query("SELECT gred_sspa, COUNT(*) as jumlah FROM master_penjawat GROUP BY gred_sspa");

        res.json({
            success: true,
            data: {
                ahliAktif: totalAhli[0].count,
                menungguPengesahan: pendingApproval[0].count,
                kesKebajikan: pendingWelfare[0].count,
                statistikGred: gredStats
            }
        });
    } catch (error) {
        res.status(500).json({ message: "Gagal memuatkan statistik." });
    }
};


// ==========================================
// 7. LAPORAN & STATISTIK KEAHLIAN (BERBAYAR & TUNGGAKAN)
// ==========================================
export const getStatistikTunggakan = async (req, res) => {
    try {
        const baseJoin = `LEFT JOIN keahlian_kelab k ON m.no_kp = k.no_kp`;
        
        const unpaidWhere = `WHERE k.status_ahli IS NULL OR k.status_ahli != 'A - Aktif'`;
        const paidWhere = `WHERE k.status_ahli = 'A - Aktif'`;

        // Fungsi Bantuan untuk menjana SQL mengikut syarat (Berbayar atau Tidak)
        const getStats = async (whereClause) => {
            const [kumpulan] = await db.query(`
                SELECT 
                    CASE 
                        WHEN m.gred_sspa LIKE '%JUSA%' OR m.gred_sspa LIKE '%VU%' OR m.gred_sspa LIKE '%VK%' THEN 'JUSA / PENGURUSAN TERTINGGI'
                        WHEN m.gred_sspa IS NULL OR m.gred_sspa = '' THEN 'TIADA REKOD'
                        ELSE CONCAT('KUMPULAN ', SUBSTRING(m.gred_sspa, 1, 1))
                    END as label,
                    COUNT(*) as jumlah
                FROM master_penjawat m
                ${baseJoin}
                ${whereClause}
                GROUP BY label
                ORDER BY jumlah DESC
            `);

            const [gred] = await db.query(`
                SELECT IFNULL(m.gred_sspa, 'TIADA REKOD') as label, COUNT(*) as jumlah
                FROM master_penjawat m
                ${baseJoin}
                ${whereClause}
                GROUP BY m.gred_sspa
                ORDER BY jumlah DESC
            `);

            const [cawangan] = await db.query(`
                SELECT IFNULL(m.penempatan, 'TIADA REKOD') as label, COUNT(*) as jumlah
                FROM master_penjawat m
                ${baseJoin}
                ${whereClause}
                GROUP BY m.penempatan
                ORDER BY jumlah DESC
            `);

            const [total] = await db.query(`SELECT COUNT(*) as total FROM master_penjawat m ${baseJoin} ${whereClause}`);
            
            return { total: total[0].total, kumpulan, gred, cawangan };
        };

        // Jalankan kedua-dua pertanyaan serentak
        const tidakBerbayar = await getStats(unpaidWhere);
        const berbayar = await getStats(paidWhere);

        res.status(200).json({
            success: true,
            data: { 
                tidak_berbayar: tidakBerbayar,
                berbayar: berbayar
            }
        });
    } catch (error) {
        console.error("Ralat Statistik Keahlian:", error);
        res.status(500).json({ success: false, message: "Gagal memuatkan statistik keahlian." });
    }
};

// ==========================================
// DAPATKAN SEMUA REKOD RESIT (ADMIN VIEW)
// ==========================================
export const getAllResitBayaran = async (req, res) => {
    try {
        const query = `
            SELECT 
                sb.id, 
                sb.billCode, 
                sb.amaun, 
                sb.status, 
                sb.keterangan, 
                DATE_FORMAT(sb.tarikh_cipta, '%d-%m-%Y %h:%i %p') AS tarikh,
                sb.tarikh_cipta,
                k.nama_penuh, 
                k.no_kp, 
                k.email, 
                k.no_tel,
                k.no_ahli
            FROM sejarah_bayaran sb
            LEFT JOIN keahlian_kelab k ON sb.no_kp = k.no_kp
            ORDER BY sb.tarikh_cipta DESC
        `;
        const [rows] = await db.query(query);
        
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("🔴 [ADMIN API ERROR] Gagal tarik rekod resit:", error.message);
        res.status(500).json({ success: false, message: "Gagal menarik senarai resit." });
    }
};


// ==========================================
// DIREKTORI BERSEPADU (BACA SEMUA DATA senarai_staff)
// ==========================================
export const getDirektoriBersepadu = async (req, res) => {
    try {
        // Guna SELECT * untuk tarik semua lajur
        // Kita letakkan AS nama_penuh & AS email supaya selaras dengan kod Frontend sedia ada
        const query = `
            SELECT 
                *,
                nama_pegawai AS nama_penuh, 
                emel_kelab AS email
            FROM senarai_staff
            ORDER BY nama_pegawai ASC
        `;
        const [rows] = await db.query(query);
        
        // Membersihkan dan menyelaraskan data
        const formattedData = rows.map(row => {
            let potongan = row.pilihan_potongan;
            if (!potongan) {
                if (row.remark && row.remark.toLowerCase().includes('fpx')) {
                    potongan = 'FPX (ToyyibPay)';
                } else if (row.remark && row.remark.toLowerCase().includes('biro angkasa')) {
                    potongan = 'Biro Angkasa';
                } else {
                    potongan = 'TIADA';
                }
            }

            return {
                ...row,
                status_sebenar: row.status_ahli || 'BELUM MENDAFTAR',
                potongan_sebenar: potongan
            };
        });

        res.status(200).json({ success: true, data: formattedData });
    } catch (error) {
        console.error("🔴 [ADMIN API ERROR] Gagal tarik direktori senarai_staff:", error.message);
        res.status(500).json({ success: false, message: "Gagal menarik senarai direktori kakitangan." });
    }
};