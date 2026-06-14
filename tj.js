import mysql from 'mysql2/promise';

async function setupModulBaru() {
    // Sambungan ke database kelab_perhilitan
    const db = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '', 
        database: 'kelab_perhilitan',
        multipleStatements: true // Membenarkan pelaksanaan pelbagai arahan SQL serentak
    });

    try {
        console.log('Mula mengemaskini pangkalan data...');

        // 1. Kemaskini jadual 'users' (Tambah Role, Password, Status)
        // Gunakan ALTER IGNORE atau semak dahulu supaya tidak ralat jika dah wujud
        const alterUsersSql = `
            ALTER TABLE users 
            ADD COLUMN IF NOT EXISTS password VARCHAR(255) NULL AFTER no_kp,
            ADD COLUMN IF NOT EXISTS role ENUM('Super Admin', 'Admin', 'Bendahari', 'Ahli') DEFAULT 'Ahli' AFTER password,
            ADD COLUMN IF NOT EXISTS status_ahli ENUM('aktif', 'tidak aktif') DEFAULT 'aktif' AFTER role;
        `;
        await db.query(alterUsersSql);
        console.log('✔ Jadual users berjaya dikemaskini dengan Role dan Password.');

        // 2. Cipta jadual 'kewangan_kelab'
        const createKewanganSql = `
            CREATE TABLE IF NOT EXISTS kewangan_kelab (
                id INT AUTO_INCREMENT PRIMARY KEY,
                jenis_transaksi ENUM('masuk', 'keluar'),
                kategori VARCHAR(100),
                keterangan TEXT,
                amaun DECIMAL(10,2),
                tarikh_transaksi DATETIME DEFAULT CURRENT_TIMESTAMP,
                direkod_oleh INT NULL, -- NULL bermaksud sistem/trigger yang rekod
                FOREIGN KEY (direkod_oleh) REFERENCES users(id) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;
        await db.query(createKewanganSql);
        console.log('✔ Jadual kewangan_kelab berjaya dicipta.');

        // 3. Cipta jadual 'transaksi_pembayaran'
        const createTransaksiSql = `
            CREATE TABLE IF NOT EXISTS transaksi_pembayaran (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT,
                jenis_bayaran VARCHAR(100),
                amaun DECIMAL(10,2),
                toyyibpay_bill_code VARCHAR(100) NULL,
                status_bayaran ENUM('pending', 'berjaya', 'gagal') DEFAULT 'pending',
                tarikh_cipta DATETIME DEFAULT CURRENT_TIMESTAMP,
                tarikh_selesai DATETIME NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `;
        await db.query(createTransaksiSql);
        console.log('✔ Jadual transaksi_pembayaran berjaya dicipta.');

        // 4. Cipta MySQL TRIGGER untuk automasi masuk rekod ke kewangan_kelab
        // Padam trigger lama jika ada supaya boleh dicipta semula
        await db.query(`DROP TRIGGER IF EXISTS selepas_bayaran_berjaya`);
        
        const createTriggerSql = `
            CREATE TRIGGER selepas_bayaran_berjaya
            AFTER UPDATE ON transaksi_pembayaran
            FOR EACH ROW
            BEGIN
                -- Jika status bertukar dari pending/gagal kepada 'berjaya'
                IF NEW.status_bayaran = 'berjaya' AND OLD.status_bayaran != 'berjaya' THEN
                    INSERT INTO kewangan_kelab (
                        jenis_transaksi, 
                        kategori, 
                        keterangan, 
                        amaun, 
                        tarikh_transaksi, 
                        direkod_oleh
                    ) VALUES (
                        'masuk', 
                        NEW.jenis_bayaran, 
                        CONCAT('Bayaran online ToyyibPay (Bill: ', NEW.toyyibpay_bill_code, ') - User ID: ', NEW.user_id), 
                        NEW.amaun, 
                        NOW(), 
                        NULL
                    );
                END IF;
            END;
        `;
        await db.query(createTriggerSql);
        console.log('✔ MySQL Trigger (selepas_bayaran_berjaya) berjaya diaktifkan.');

        console.log('🎉 Selesai! Struktur database sedia untuk sistem pembayaran online.');
    } catch (error) {
        console.error('Ralat ketika setup:', error.message);
    } finally {
        await db.end();
        process.exit();
    }
}

setupModulBaru();