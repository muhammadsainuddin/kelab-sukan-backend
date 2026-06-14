import db from '../config/db.js';
import axios from 'axios';

const TOYYIBPAY_URL = 'https://dev.toyyibpay.com/index.php/api/createBill';
const SECRET_KEY = process.env.SECRET_KEY || 'g0jw4dtf-1mgf-l4au-les2-se8kpdg9beoe'; 
const CATEGORY_CODE = process.env.CATEGORY_CODE || 'v4vftvzw'; 

// ==========================================
// 1. CIPTA BIL TOYYIBPAY
// ==========================================
export const ciptaBil = async (req, res) => {
    // ID User diambil dari middleware auth
    const user_id = req.user.id; 
    const { keterangan, amaun, jenis_bayaran } = req.body; // contoh jenis_bayaran: 'Yuran Tahunan'
    
    console.log(`[FPX] Memulakan cipta bil untuk User ID: ${user_id}, Amaun: RM ${amaun}`);

    try {
        // --- SEMAK TRANSAKSI PENDING (15 MINIT BLOCKER) ---
        const [pendingBills] = await db.query(`
            SELECT toyyibpay_bill_code, tarikh_cipta, TIMESTAMPDIFF(MINUTE, tarikh_cipta, NOW()) as minit_berlalu 
            FROM transaksi_pembayaran 
            WHERE user_id = ? AND status_bayaran = 'pending' 
            ORDER BY tarikh_cipta DESC LIMIT 1
        `, [user_id]);

        if (pendingBills.length > 0) {
            const pending = pendingBills[0];
            
            if (pending.minit_berlalu < 15) {
                const bakiMinit = 15 - pending.minit_berlalu;
                return res.status(400).json({ 
                    success: false, 
                    message: `Anda mempunyai transaksi yang sedang diproses oleh bank. Sila tunggu ${bakiMinit} minit lagi.` 
                });
            } else {
                await db.query(
                    `UPDATE transaksi_pembayaran SET status_bayaran = 'gagal' WHERE toyyibpay_bill_code = ?`, 
                    [pending.toyyibpay_bill_code]
                );
            }
        }

        // Ambil data user dari database
        const [users] = await db.query('SELECT no_kp, nama_pegawai, emel, phone FROM users WHERE id = ?', [user_id]);
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: "Data kakitangan tidak dijumpai." });
        }
        const dataAhli = users[0];

        const amountInCents = Math.round(parseFloat(amaun) * 100);
        const currentFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
        const currentBackendUrl = process.env.BACKEND_URL || 'http://localhost:5000';

        // ... (Kekalkan HTML Email Resit seperti biasa)
        const contentEmailResit = `Resit Bayaran FPX...`; 

        const formData = new URLSearchParams();
        formData.append('userSecretKey', SECRET_KEY);
        formData.append('categoryCode', CATEGORY_CODE);
        formData.append('billName', 'Bayaran Kelab PERHILITAN'); 
        formData.append('billDescription', keterangan);
        formData.append('billPriceSetting', 1);
        formData.append('billPayorInfo', 1);
        formData.append('billAmount', amountInCents.toString()); 
        formData.append('billReturnUrl', `${currentFrontendUrl}/ahli/yuran`); 
        formData.append('billCallbackUrl', `${currentBackendUrl}/api/bayaran/callback`); 
        formData.append('billExternalReferenceNo', `INV-${user_id}-${Date.now()}`);
        formData.append('billTo', dataAhli.nama_pegawai);
        formData.append('billEmail', dataAhli.emel || 'kelabperhilitan@gmail.com');
        formData.append('billPhone', dataAhli.phone || '0123456789');
        formData.append('billSplitPayment', 0);
        formData.append('billPaymentChannel', '0'); 
        formData.append('billContentEmail', contentEmailResit); 
        formData.append('billChargeToCustomer', 1);

        const response = await axios.post(TOYYIBPAY_URL, formData.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });
        
        const billCode = response.data[0]?.BillCode;
        if (!billCode) throw new Error("ToyyibPay tidak memulangkan BillCode");

        const billUrl = `https://dev.toyyibpay.com/${billCode}`;

        // Simpan dalam jadual transaksi baharu
        await db.query(
            `INSERT INTO transaksi_pembayaran 
            (user_id, jenis_bayaran, amaun, toyyibpay_bill_code, status_bayaran) 
            VALUES (?, ?, ?, ?, 'pending')`,
            [user_id, jenis_bayaran || keterangan, amaun, billCode]
        );

        res.status(200).json({ success: true, bill_url: billUrl });

    } catch (error) {
        console.error("🔴 [FPX ERROR]:", error?.response?.data || error.message);
        res.status(500).json({ success: false, message: "Gagal memproses pembayaran. Sila cuba lagi." });
    }
};

// ==========================================
// 2. WEBHOOK CALLBACK TOYYIBPAY
// ==========================================
export const toyyibpayCallback = async (req, res) => {
    const { status_id, billcode } = req.body;
    console.log(`[WEBHOOK] Isyarat diterima: BillCode ${billcode}, Status ${status_id}`);

    try {
        if (status_id == 1) { 
            // 1 = Berjaya. Kemaskini status_bayaran.
            // PENTING: MySQL Trigger yang kita bina sebelum ini akan tangkap perubahan ini 
            // dan terus *copy* maklumat ini masuk ke dalam jadual kewangan_kelab secara automatik.
            await db.query(
                `UPDATE transaksi_pembayaran SET status_bayaran = 'berjaya', tarikh_selesai = NOW() 
                 WHERE toyyibpay_bill_code = ? AND status_bayaran != 'berjaya'`, 
                [billcode]
            );

            // Set pengguna menjadi aktif jika mereka sebelum ini tidak aktif
            const [tx] = await db.query('SELECT user_id FROM transaksi_pembayaran WHERE toyyibpay_bill_code = ?', [billcode]);
            if (tx.length > 0) {
                await db.query('UPDATE users SET status_ahli = "aktif" WHERE id = ?', [tx[0].user_id]);
            }

            return res.status(200).send('OK');
        } else {
            // Status Gagal
            await db.query(
                `UPDATE transaksi_pembayaran SET status_bayaran = 'gagal', tarikh_selesai = NOW() 
                 WHERE toyyibpay_bill_code = ?`, 
                [billcode]
            );
            return res.status(200).send('OK');
        }
    } catch (error) {
        console.error('🔴 [WEBHOOK ERROR]:', error);
        return res.status(500).send('Ralat Pelayan Webhook');
    }
};

// ==========================================
// 3. DAPATKAN SEJARAH PEMBAYARAN AHLI
// ==========================================
export const getSejarahBayaran = async (req, res) => {
    const user_id = req.user.id;

    try {
        // Auto cleanup transaksi pending lebih 15 minit
        await db.query(`
            UPDATE transaksi_pembayaran 
            SET status_bayaran = 'gagal'
            WHERE user_id = ? AND status_bayaran = 'pending' AND TIMESTAMPDIFF(MINUTE, tarikh_cipta, NOW()) >= 15
        `, [user_id]);

        const query = `
            SELECT toyyibpay_bill_code, jenis_bayaran, amaun, status_bayaran, 
                   DATE_FORMAT(tarikh_cipta, '%d-%m-%Y %h:%i %p') AS tarikh
            FROM transaksi_pembayaran 
            WHERE user_id = ? 
            ORDER BY tarikh_cipta DESC
        `;
        const [rows] = await db.query(query, [user_id]);
        
        res.status(200).json({ success: true, data: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: "Gagal menarik sejarah pembayaran." });
    }
};

// ==========================================
// 4. SEMAK STATUS BAYARAN (Manual / Polling)
// ==========================================
export const semakStatusBayaran = async (req, res) => {
    // Boleh terima billcode dari parameter URL (jika semak 1 bil) atau tiada parameter (semak semua pending user)
    const { billcode } = req.params;
    const user_id = req.user.id;

    try {
        // 1. Cari transaksi yang berstatus 'pending' di pangkalan data
        let query = `SELECT id, toyyibpay_bill_code FROM transaksi_pembayaran WHERE status_bayaran = 'pending'`;
        const queryParams = [];

        if (billcode) {
            query += ` AND toyyibpay_bill_code = ? AND user_id = ?`;
            queryParams.push(billcode, user_id);
        } else {
            query += ` AND user_id = ?`;
            queryParams.push(user_id);
        }

        const [pendingTx] = await db.query(query, queryParams);

        if (pendingTx.length === 0) {
            return res.status(200).json({ success: true, message: "Tiada transaksi 'pending' yang perlu disemak." });
        }

        let updatedCount = 0;

        // 2. Loop setiap bil pending dan semak dengan API ToyyibPay
        for (const tx of pendingTx) {
            const formData = new URLSearchParams();
            formData.append('billCode', tx.toyyibpay_bill_code);

            try {
                // Endpoint ToyyibPay untuk dapatkan senarai transaksi bagi sesuatu bil
                const response = await axios.post('https://dev.toyyibpay.com/index.php/api/getBillTransactions', formData.toString(), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });

                const transactions = response.data;

                // Jika ToyyibPay memulangkan data array
                if (transactions && transactions.length > 0) {
                    // Semak jika ada transaksi yang statusnya '1' (Berjaya)
                    // billpaymentStatus: 1=Berjaya, 2=Pending, 3=Gagal, 4=Pending (FPX)
                    const successTx = transactions.find(t => t.billpaymentStatus == '1');

                    if (successTx) {
                        // Update database jika bil didapati berjaya dibayar.
                        // PERHATIAN: Selepas UPDATE ini dijalankan, MySQL Trigger anda 
                        // akan automatik memasukkan rekod ke dalam jadual kewangan_kelab.
                        await db.query(
                            `UPDATE transaksi_pembayaran SET status_bayaran = 'berjaya', tarikh_selesai = NOW() 
                             WHERE toyyibpay_bill_code = ? AND status_bayaran != 'berjaya'`,
                            [tx.toyyibpay_bill_code]
                        );
                        
                        // Aktifkan akaun ahli (jika berkaitan)
                        await db.query('UPDATE users SET status_ahli = "aktif" WHERE id = ?', [user_id]);
                        
                        updatedCount++;
                    } else {
                        // Semak jika transaksi ditolak/gagal terus (status 3)
                        const failedTx = transactions.find(t => t.billpaymentStatus == '3');
                        if (failedTx) {
                            await db.query(
                                `UPDATE transaksi_pembayaran SET status_bayaran = 'gagal', tarikh_selesai = NOW() 
                                 WHERE toyyibpay_bill_code = ?`,
                                [tx.toyyibpay_bill_code]
                            );
                        }
                    }
                }
            } catch (apiError) {
                console.error(`Gagal menyemak bil ${tx.toyyibpay_bill_code} di ToyyibPay:`, apiError?.response?.data || apiError.message);
            }
        }

        res.status(200).json({
            success: true,
            message: `Semakan selesai. ${updatedCount} bil telah disahkan 'berjaya' dan dikemaskini.`
        });

    } catch (error) {
        console.error("🔴 [SEMAK STATUS ERROR]:", error);
        res.status(500).json({ success: false, message: "Ralat semasa menyemak status bayaran dari pelayan." });
    }
};