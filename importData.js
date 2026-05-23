import fs from 'fs';
import csv from 'csv-parser';
import db from './src/config/db.js'; // Pastikan laluan ini betul mengikut folder anda

// ==========================================
// FUNGSI BANTUAN (PENCUCI DATA)
// ==========================================

// 1. Bersihkan No IC (Hanya ambil nombor)
const bersihkanIC = (ic) => {
    if (!ic) return '';
    return ic.replace(/[^0-9]/g, ''); 
};

// 2. Bersihkan Teks Rosak (Elak ralat Incorrect string value MySQL)
const bersihkanTeks = (teks) => {
    if (!teks) return '';
    return teks.toString()
        .replace(/\uFFFD/g, '') // Buang simbol pelik 
        .replace(/[^\x20-\x7E]/g, '') // Hanya benarkan aksara standard (huruf, nombor, simbol biasa)
        .trim();
};

// 3. Tukar format "102023" menjadi tarikh standard DB "2023-10-01"
const formatTarikhPotongan = (rawDate) => {
    if (!rawDate) return null;
    
    let dateStr = rawDate.toString().trim();
    
    // Semak jika nombor adalah 5 atau 6 digit (Cth: "102023" atau "92023")
    if (/^\d{5,6}$/.test(dateStr)) {
        let month, year;
        
        if (dateStr.length === 6) {
            // "102023" -> Bulan: 10, Tahun: 2023
            month = dateStr.substring(0, 2);
            year = dateStr.substring(2, 6);
        } else if (dateStr.length === 5) {
            // "92023" -> Bulan: 09, Tahun: 2023
            month = '0' + dateStr.substring(0, 1);
            year = dateStr.substring(1, 5);
        }
        
        return `${year}-${month}-01`;
    }
    
    return dateStr; 
};

// ==========================================
// 1. Fungsi Import Master Penjawat
// ==========================================
const importMasterPenjawat = () => {
    return new Promise((resolve, reject) => {
        const senaraiPenjawat = [];
        
        console.log("⏳ Sedang membaca fail PENYANDANG PERHILITAN_14.01.2026.csv...");
        
        fs.createReadStream('PENYANDANG PERHILITAN_14.01.2026.csv')
            .pipe(csv())
            .on('data', (row) => {
                const noKpRaw = row['NO. K/P '] || row['NO. K/P'];
                const no_kp = bersihkanIC(noKpRaw);
                
                if (no_kp && no_kp.length >= 10) {
                    senaraiPenjawat.push([
                        no_kp,
                        bersihkanTeks(row['NAMA PEGAWAI']),
                        bersihkanTeks(row['GRED PENYANDANG SSPA']),
                        bersihkanTeks(row['PENEMPATAN'])
                    ]);
                }
            })
            .on('end', async () => {
                try {
                    if (senaraiPenjawat.length > 0) {
                        console.log("🗑️ Memadam data Master Penjawat lama...");
                        await db.query('DELETE FROM master_penjawat');
                        
                        const query = `INSERT INTO master_penjawat (no_kp, nama_pegawai, gred_sspa, penempatan) VALUES ?`;
                        await db.query(query, [senaraiPenjawat]);
                        
                        console.log(`✅ Berjaya mengimport ${senaraiPenjawat.length} rekod Penjawat.`);
                    } else {
                        console.log("⚠️ Tiada data ditemui dalam fail PENYANDANG.");
                    }
                    resolve();
                } catch (err) {
                    console.error("❌ Ralat DB Penjawat:", err);
                    reject(err);
                }
            });
    });
};

// ==========================================
// 2. Fungsi Import Ahli Berdaftar (Kelab)
// ==========================================
const importAhliKelab = () => {
    return new Promise((resolve, reject) => {
        const senaraiAhli = [];
        
        console.log("⏳ Sedang membaca fail SENARAI-BERDAFTAR.csv...");
        
        fs.createReadStream('SENARAI-BERDAFTAR.csv')
            .pipe(csv())
            .on('data', (row) => {
                const no_kp = bersihkanIC(row['NO KAD PENGENALAN']);
                
                if (no_kp && no_kp.length >= 10) {
                    const tarikhMulaPotongan = formatTarikhPotongan(row['MULA POTONGAN']);

                    senaraiAhli.push([
                        no_kp,
                        bersihkanTeks(row['NAMA PENUH']),
                        bersihkanTeks(row['NAMA MAJIKAN']),
                        bersihkanTeks(row['BAYARAN YURAN']),
                        bersihkanTeks(row['STATUS AHLI']),
                        tarikhMulaPotongan
                    ]);
                }
            })
            .on('end', async () => {
                try {
                    if (senaraiAhli.length > 0) {
                        console.log("🗑️ Memadam data Ahli Kelab lama...");
                        await db.query('DELETE FROM keahlian_kelab');
                        
                        const query = `
                            INSERT INTO keahlian_kelab 
                            (no_kp, nama_penuh, nama_majikan, yuran_bulanan, status_ahli, mula_potongan) 
                            VALUES ?
                        `;
                        await db.query(query, [senaraiAhli]);
                        
                        console.log(`✅ Berjaya mengimport ${senaraiAhli.length} rekod Ahli Kelab berserta Tarikh Mula Potongan.`);
                    } else {
                        console.log("⚠️ Tiada data ditemui dalam fail SENARAI-BERDAFTAR.");
                    }
                    resolve();
                } catch (err) {
                    console.error("❌ Ralat DB Ahli Kelab:", err);
                    reject(err);
                }
            });
    });
};

// ==========================================
// Jalankan Proses Utama
// ==========================================
const jalankanImport = async () => {
    try {
        console.log("🚀 Memulakan proses import data...");
        
        // 1. Matikan semakan kunci asing (Foreign Key) untuk benarkan pemadaman data
        await db.query('SET FOREIGN_KEY_CHECKS = 0;');
        
        // 2. Jalankan fungsi import secara berurutan
        await importMasterPenjawat();
        await importAhliKelab();
        
        // 3. Hidupkan semula semakan kunci asing
        await db.query('SET FOREIGN_KEY_CHECKS = 1;');
        
        console.log("🎉 SEMUA DATA LAMA TELAH DIPADAM & DATA BAHARU BERJAYA DIIMPORT!");
        process.exit(0);
    } catch (error) {
        console.error("Gagal melaksanakan skrip import.", error);
        
        // Wajib hidupkan semula semakan kunci asing walaupun ralat berlaku
        await db.query('SET FOREIGN_KEY_CHECKS = 1;');
        process.exit(1);
    }
};

jalankanImport();