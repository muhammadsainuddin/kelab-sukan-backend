import db from '../config/db.js';
import axios from 'axios';

// ==========================================
// KONFIGURASI TOYYIBPAY (PERSEKITARAN DEV / SANDBOX)
// ==========================================
const TOYYIBPAY_URL = 'https://dev.toyyibpay.com/index.php/api/createBill';
const SECRET_KEY = process.env.SECRET_KEY || 'g0jw4dtf-1mgf-l4au-les2-se8kpdg9beoe'; 
const CATEGORY_CODE = process.env.CATEGORY_CODE || 'v4vftvzw'; 

// ==========================================
// 1. CIPTA BIL (DIPANGGIL OLEH FRONTEND VUE)
// ==========================================
export const ciptaBil = async (req, res) => {
    const no_kp = req.user.no_kp;
    const { keterangan, amaun } = req.body;
    
    console.log(`[FPX] Memulakan cipta bil untuk IC: ${no_kp}, Amaun: RM ${amaun}`);

    try {
        // --- LOGIK SEMAKAN TRANSAKSI PENDING (15 MINIT BLOCKER) ---
        const [pendingBills] = await db.query(`
            SELECT billCode, tarikh_cipta, TIMESTAMPDIFF(MINUTE, tarikh_cipta, NOW()) as minit_berlalu 
            FROM sejarah_bayaran 
            WHERE no_kp = ? AND status = 'PENDING' 
            ORDER BY tarikh_cipta DESC LIMIT 1
        `, [no_kp]);

        if (pendingBills.length > 0) {
            const pending = pendingBills[0];
            
            if (pending.minit_berlalu < 15) {
                const bakiMinit = 15 - pending.minit_berlalu;
                return res.status(400).json({ 
                    success: false, 
                    message: `Anda mempunyai transaksi yang sedang diproses oleh bank. Sila tunggu ${bakiMinit} minit lagi sebelum mencuba semula, atau tunggu sistem membuat pengesahan automatik.` 
                });
            } else {
                await db.query(
                    `UPDATE sejarah_bayaran SET status = 'DIBATALKAN', keterangan = CONCAT(keterangan, ' (Expired)') WHERE billCode = ?`, 
                    [pending.billCode]
                );
            }
        }

        let [ahli] = await db.query('SELECT nama_penuh, email, no_tel FROM keahlian_kelab WHERE no_kp = ?', [no_kp]);

        if (ahli.length === 0) {
            const [masterData] = await db.query(`
                SELECT m.nama_pegawai, m.penempatan, m.gred_sspa, u.email 
                FROM master_penjawat m
                LEFT JOIN users u ON m.no_kp = u.no_kp
                WHERE m.no_kp = ?
            `, [no_kp]);
            
            if (masterData.length === 0) {
                return res.status(404).json({ success: false, message: "Data kakitangan tidak dijumpai." });
            }

            const namaPenuh = masterData[0].nama_pegawai;
            const emailUser = masterData[0].email || 'kelabperhilitan@gmail.com';
            const penempatan = masterData[0].penempatan || '';
            
            let yuran_bulanan = 15.00;
            const gred = (masterData[0].gred_sspa || '').toUpperCase();
            const match = gred.match(/\d+/);
            if (match) {
                const num = parseInt(match[0], 10);
                if (num >= 1 && num <= 8) yuran_bulanan = 5.00;
                else if (num >= 9 && num <= 14) yuran_bulanan = 10.00;
            }

            await db.query(
                `INSERT INTO keahlian_kelab (no_kp, nama_penuh, nama_majikan, email, status_ahli, pilihan_potongan, yuran_bulanan) 
                 VALUES (?, ?, ?, ?, 'PENDING', 'Potongan FPX (ToyyibPay)', ?)`,
                [no_kp, namaPenuh, penempatan, emailUser, yuran_bulanan]
            );
            ahli = [{ nama_penuh: namaPenuh, email: emailUser, no_tel: '' }];
        }

        const dataAhli = ahli[0];
        const amountInCents = Math.round(parseFloat(amaun) * 100);

        const currentFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const currentBackendUrl = process.env.BACKEND_URL || 'http://localhost:5000';
        const tahunSemasa = new Date().getFullYear();

        const contentEmailResit = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 12px; overflow: hidden;">
                <div style="background-color: #0A192F; color: #ffffff; padding: 24px; text-align: center;">
                    <h2 style="margin: 0; font-size: 18px; letter-spacing: 1px; text-transform: uppercase;">Resit Rasmi Pembayaran</h2>
                    <p style="margin: 4px 0 0; font-size: 11px; color: #8892B0;">KELAB PERHILITAN MALAYSIA</p>
                </div>
                <div style="padding: 24px; color: #333333; line-height: 1.5; font-size: 13px;">
                    <p>Salam Sejahtera <b>${dataAhli.nama_penuh}</b>,</p>
                    <p>Terima kasih kerana telah menjelaskan komitmen yuran tahunan anda. Bayaran anda telah berjaya diproses secara selamat menerusi gerbang FPX ToyyibPay.</p>
                    <div style="background-color: #f8f9fa; border: 1px solid #eaeded; border-radius: 8px; padding: 16px; margin: 20px 0;">
                        <table style="width: 100%; font-size: 12px; border-collapse: collapse;">
                            <tr><td style="padding: 4px 0; color: #7f8c8d; font-weight: bold;">BUTIRAN BIL:</td><td style="padding: 4px 0; font-weight: bold; text-align: right;">${keterangan}</td></tr>
                            <tr><td style="padding: 4px 0; color: #7f8c8d; font-weight: bold;">JUMLAH:</td><td style="padding: 4px 0; font-weight: bold; text-align: right; color: #0A192F; font-size: 14px;">RM ${parseFloat(amaun).toFixed(2)}</td></tr>
                        </table>
                    </div>
                </div>
            </div>
        `;

        const formData = new URLSearchParams();
        formData.append('userSecretKey', SECRET_KEY);
        formData.append('categoryCode', CATEGORY_CODE);
        formData.append('billName', 'Yuran Kelab PERHILITAN'); 
        formData.append('billDescription', `${keterangan} (PPM-006-14-27071985)`);
        formData.append('billPriceSetting', 1);
        formData.append('billPayorInfo', 1);
        formData.append('billAmount', amountInCents.toString()); 
        formData.append('billReturnUrl', `${currentFrontendUrl}/ahli/yuran`); 
        formData.append('billCallbackUrl', `${currentBackendUrl}/api/bayaran/callback`); 
        formData.append('billExternalReferenceNo', `INV-${no_kp}-${Date.now()}`);
        formData.append('billTo', dataAhli.nama_penuh);
        formData.append('billEmail', dataAhli.email || 'kelabperhilitan@gmail.com');
        formData.append('billPhone', dataAhli.no_tel || '0123456789');
        formData.append('billSplitPayment', 0);
        formData.append('billSplitPaymentArgs', '');
        formData.append('billPaymentChannel', '0'); 
        formData.append('billContentEmail', contentEmailResit); 
        formData.append('billChargeToCustomer', 1);

        const response = await axios.post(TOYYIBPAY_URL, formData.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const billCode = response.data[0]?.BillCode;
        if (!billCode) throw new Error("ToyyibPay tidak memulangkan BillCode");

        const billUrl = `https://dev.toyyibpay.com/${billCode}`;

        await db.query(
            'INSERT INTO sejarah_bayaran (no_kp, billCode, amaun, status, keterangan, tarikh_cipta) VALUES (?, ?, ?, ?, ?, NOW())',
            [no_kp, billCode, amaun, 'PENDING', keterangan]
        );

        res.status(200).json({ success: true, bill_url: billUrl });

    } catch (error) {
        console.error("🔴 [FPX ERROR]:", error?.response?.data || error.message);
        res.status(500).json({ success: false, message: "Gagal memproses pembayaran. Sila cuba lagi sebentar lagi." });
    }
};

// ==========================================
// 2. WEBHOOK CALLBACK (DIPANGGIL OLEH BANK SECARA BACKGROUND)
// ==========================================
export const toyyibpayCallback = async (req, res) => {
    const { status_id, billcode, msg } = req.body;
    console.log(`[WEBHOOK] Isyarat diterima: BillCode ${billcode}, Status ${status_id}`);

    try {
        if (status_id == 1) { 
            const [bayaran] = await db.query('SELECT no_kp FROM sejarah_bayaran WHERE billCode = ?', [billcode]);
            
            if (bayaran.length > 0) {
                const no_kp = bayaran[0].no_kp;
                
                // Pilih status, mula_potongan, created_at, DAN no_ahli sedia ada
                const [ahli] = await db.query('SELECT status_ahli, mula_potongan, created_at, no_ahli FROM keahlian_kelab WHERE no_kp = ?', [no_kp]);

                if (ahli.length > 0 && ahli[0].status_ahli !== 'A - Aktif') {
                    
                    let noAhliBaru = ahli[0].no_ahli; // Pegang no_ahli sedia ada dahulu

                    // Jika pengguna ini BENAR-BENAR belum ada nombor ahli (Baru daftar kali pertama)
                    if (!noAhliBaru || noAhliBaru.trim() === '') {
                        let tahun = new Date().getFullYear();
                        const pattern = `KP-%-${tahun}`;
                        const [lastRecord] = await db.query('SELECT no_ahli FROM keahlian_kelab WHERE no_ahli LIKE ? ORDER BY no_ahli DESC LIMIT 1', [pattern]);

                        let nextNum = 1;
                        if (lastRecord.length > 0 && lastRecord[0].no_ahli) {
                            try {
                                const parts = lastRecord[0].no_ahli.split('-'); 
                                if (parts.length >= 3) nextNum = parseInt(parts[1], 10) + 1;
                            } catch (err) { nextNum = 1; }
                        }
                        noAhliBaru = `KP-${nextNum.toString().padStart(4, '0')}-${tahun}`;
                    }

                    // Kemas kini profil ke Aktif, KEKALKAN atau JANA BARU no_ahli
                    await db.query(
                        'UPDATE keahlian_kelab SET status_ahli = "A - Aktif", no_ahli = ?, resit_pembayaran = "FPX_AUTO_PAY" WHERE no_kp = ?', 
                        [noAhliBaru, no_kp]
                    );
                    await db.query('UPDATE users SET status_akaun = "Aktif" WHERE no_kp = ?', [no_kp]);
                }
                // Tandakan resit sebagai berjaya
                await db.query('UPDATE sejarah_bayaran SET status = "BERJAYA" WHERE billCode = ?', [billcode]);
            }
            return res.status(200).send('OK');
        } else {
            await db.query('UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', [billcode]);
            return res.status(200).send('OK');
        }
    } catch (error) {
        console.error('🔴 [WEBHOOK ERROR]:', error);
        return res.status(500).send('Ralat Pelayan Webhook');
    }
};


// ==========================================
// 3. DAPATKAN SEJARAH PEMBAYARAN AHLI (AUTO CLEANUP)
// ==========================================
export const getSejarahBayaran = async (req, res) => {
    const no_kp = req.user.no_kp;

    try {
        await db.query(`
            UPDATE sejarah_bayaran 
            SET status = 'DIBATALKAN', keterangan = CONCAT(keterangan, ' (Expired)')
            WHERE no_kp = ? AND status = 'PENDING' AND TIMESTAMPDIFF(MINUTE, tarikh_cipta, NOW()) >= 15
        `, [no_kp]);

        const query = `
            SELECT billCode, amaun, status, keterangan, 
                   DATE_FORMAT(tarikh_cipta, '%d-%m-%Y %h:%i %p') AS tarikh
            FROM sejarah_bayaran 
            WHERE no_kp = ? 
            ORDER BY tarikh_cipta DESC
        `;
        const [rows] = await db.query(query, [no_kp]);
        
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        console.error("🔴 [API ERROR] Gagal tarik sejarah:", error.message);
        res.status(500).json({ success: false, message: "Gagal menarik sejarah pembayaran." });
    }
};



// ==========================================
// 4. SEMAKAN MANUAL API (DIGUNAKAN OLEH AUTO-POLLING FRONTEND)
// ==========================================
export const semakStatusBayaran = async (req, res) => {
    const { billcode } = req.params;

    try {
        const formData = new URLSearchParams();
        formData.append('billCode', billcode);

        const toyyibRes = await axios.post('https://dev.toyyibpay.com/index.php/api/getBillTransactions', formData.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!toyyibRes.data || toyyibRes.data.length === 0) {
            return res.status(200).json({ success: true, status: 'PENDING' });
        }

        const successfulTx = toyyibRes.data.find(tx => tx.billpaymentStatus == '1');

        if (successfulTx) {
            const [bayaran] = await db.query('SELECT no_kp, status FROM sejarah_bayaran WHERE billCode = ?', [billcode]);
            
            if (bayaran.length > 0 && bayaran[0].status !== 'BERJAYA') {
                const no_kp = bayaran[0].no_kp;
                
                // Semak status DAN no_ahli
                const [ahli] = await db.query('SELECT status_ahli, no_ahli FROM keahlian_kelab WHERE no_kp = ?', [no_kp]);

                if (ahli.length > 0 && ahli[0].status_ahli !== 'A - Aktif') {
                    
                    let noAhliBaru = ahli[0].no_ahli;

                    // Logik penjanaan HANYA JIKA no_ahli adalah null atau kosong
                    if (!noAhliBaru || noAhliBaru.trim() === '') {
                        let tahun = new Date().getFullYear();
                        const pattern = `KP-%-${tahun}`;
                        const [lastRecord] = await db.query('SELECT no_ahli FROM keahlian_kelab WHERE no_ahli LIKE ? ORDER BY no_ahli DESC LIMIT 1', [pattern]);

                        let nextNum = 1;
                        if (lastRecord.length > 0 && lastRecord[0].no_ahli) {
                            try {
                                const parts = lastRecord[0].no_ahli.split('-'); 
                                if (parts.length >= 3) nextNum = parseInt(parts[1], 10) + 1;
                            } catch (err) { nextNum = 1; }
                        }
                        noAhliBaru = `KP-${nextNum.toString().padStart(4, '0')}-${tahun}`;
                    }

                    await db.query(
                        'UPDATE keahlian_kelab SET status_ahli = "A - Aktif", no_ahli = ?, resit_pembayaran = "FPX_AUTO_PAY" WHERE no_kp = ?', 
                        [noAhliBaru, no_kp]
                    );
                    await db.query('UPDATE users SET status_akaun = "Aktif" WHERE no_kp = ?', [no_kp]);
                }
                await db.query('UPDATE sejarah_bayaran SET status = "BERJAYA" WHERE billCode = ?', [billcode]);
            }
            return res.status(200).json({ success: true, status: 'BERJAYA' });
        } else {
            const failedTx = toyyibRes.data.find(tx => tx.billpaymentStatus == '3');
            if (failedTx) {
                await db.query('UPDATE sejarah_bayaran SET status = "GAGAL" WHERE billCode = ?', [billcode]);
                return res.status(200).json({ success: true, status: 'GAGAL' });
            }
            return res.status(200).json({ success: true, status: 'PENDING' });
        }
    } catch (error) {
        return res.status(500).json({ success: false, status: 'PENDING' }); // Anggap pending jika ralat server/bank
    }
};