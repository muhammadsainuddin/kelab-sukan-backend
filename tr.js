import fs from 'fs';
import csv from 'csv-parser';
import mysql from 'mysql2/promise';

// Sambungan ke database kelab_perhilitan
const db = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '', 
    database: 'kelab_perhilitan',
    charset: 'utf8mb4'
});

// Fungsi untuk ekstrak Tarikh Lahir dari NO K/P
function dapatkanTarikhLahir(ic) {
    if (!ic || ic.length < 6) return null;
    const yy = parseInt(ic.substring(0, 2), 10);
    const mm = ic.substring(2, 4);
    const dd = ic.substring(4, 6);
    
    const year = yy <= 30 ? 2000 + yy : 1900 + yy; 
    return `${year}-${mm}-${dd}`;
}

// Fungsi memecahkan Gred
function pecahkanGred(gredString) {
    if (!gredString) return { skim: null, gred: null, catatan: null };
    gredString = gredString.trim();
    
    const match = gredString.match(/^([A-Za-z]+)(\d+)?(.*)$/);
    if (match) {
        return {
            skim: match[1] || null,
            gred: match[2] || null,
            catatan: match[3] ? match[3].trim() : null
        };
    }
    return { skim: null, gred: null, catatan: gredString };
}

// Fungsi Kira Yuran (Hanya untuk Bayar secara manual)
function kiraYuranBulanan(gred) {
    if (!gred) return 15.00; 
    
    const g = parseInt(gred, 10);
    if (isNaN(g)) return 15.00;
    
    if (g >= 1 && g <= 8) return 5.00;
    if (g === 11) return 5.00;
    if (g >= 9 && g <= 14) return 10.00;
    
    return 15.00; 
}

const mapBiroAngkasa = new Map();
const results = [];
const senaraiPenempatan = new Set(); 

console.log('Mula membaca SENARAI-BERDAFTAR.csv (Data Biro Angkasa)...');

// LANGKAH 1: Baca fail Biro Angkasa
fs.createReadStream('SENARAI-BERDAFTAR.csv')
  .pipe(csv())
  .on('data', (data) => {
      const ic = data['NO KAD PENGENALAN'] ? data['NO KAD PENGENALAN'].trim() : '';
      const kodMajikan = data['KOD MAJIKAN'] ? data['KOD MAJIKAN'].trim() : null;
      const yuran = data['BAYARAN YURAN'] ? parseFloat(data['BAYARAN YURAN']) : null;
      
      if (ic) {
          mapBiroAngkasa.set(ic, { yuran, kodMajikan });
      }
  })
  .on('end', () => {
      console.log(`Berjaya kumpul ${mapBiroAngkasa.size} rekod Biro Angkasa.`);
      console.log('Mula membaca fail PENYANDANG PERHILITAN...');

      // LANGKAH 2: Baca fail staf
      fs.createReadStream('PENYANDANG PERHILITAN_14.01.2026 2.csv')
        .pipe(csv())
        .on('data', (data) => {
            const rawKp = data['NO. K/P '] || ''; 
            const no_kp = rawKp.replace(/[-\s]/g, '');
            const tarikh_lahir = dapatkanTarikhLahir(no_kp);
            
            const gredAsal = data['GRED PENYANDANG SSPA'];
            const { skim, gred, catatan } = pecahkanGred(gredAsal);
            
            const nama_penempatan = data['PENEMPATAN'] ? data['PENEMPATAN'].trim() : 'TIADA MAKLUMAT';
            senaraiPenempatan.add(nama_penempatan);
            
            const biroData = mapBiroAngkasa.get(no_kp);
            
            // Nama jenis potongan mesti sepadan dengan pilihan ENUM di bawah
            const jenis_potongan = biroData ? 'Potongan Biro angkasa' : 'Bayar secara manual';
            const kod_majikan = biroData ? biroData.kodMajikan : null;
            const yuran_kelab_bulanan = biroData ? biroData.yuran : kiraYuranBulanan(gred);

            results.push({
                id: data['BIL'],
                nama_pegawai: data['NAMA PEGAWAI'],
                penempatan: nama_penempatan,
                gred_hakiki: data['GRED HAKIKI SSPA'],
                gred_penyandang: gredAsal,
                skim: skim,
                gred: gred,
                catatan: catatan,
                no_kp: no_kp,
                tarikh_lahir: tarikh_lahir,
                jenis_potongan: jenis_potongan,
                yuran_kelab_bulanan: yuran_kelab_bulanan,
                kod_majikan: kod_majikan
            });
        })
        .on('end', async () => {
            console.log('Selesai membaca CSV Staf. Menyusun semula struktur database...');
            
            try {
                await db.query(`SET FOREIGN_KEY_CHECKS = 0;`);
                await db.query(`DROP TABLE IF EXISTS users;`);
                await db.query(`DROP TABLE IF EXISTS penempatan;`);
                await db.query(`SET FOREIGN_KEY_CHECKS = 1;`);

                const createPenempatanSql = `
                  CREATE TABLE penempatan (
                      id INT AUTO_INCREMENT PRIMARY KEY,
                      nama_penempatan VARCHAR(255) UNIQUE
                  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                `;
                await db.query(createPenempatanSql);

                // PENAMBAHBAIKAN: Tukar jenis_potongan kepada ENUM ('Potongan Biro angkasa', 'Bayar secara manual')
                const createUsersSql = `
                  CREATE TABLE users (
                      id INT PRIMARY KEY,
                      nama_pegawai VARCHAR(255),
                      no_kp VARCHAR(20) UNIQUE,
                      tarikh_lahir DATE,
                      penempatan_id INT,
                      gred_hakiki_sspa VARCHAR(100),
                      gred_penyandang_sspa VARCHAR(100),
                      skim VARCHAR(10),
                      gred VARCHAR(10),
                      catatan VARCHAR(100),
                      
                      emel VARCHAR(100) NULL,
                      phone VARCHAR(20) NULL,
                      yuran_kelab_bulanan DECIMAL(10,2) NULL,
                      jenis_potongan ENUM('Potongan Biro angkasa', 'Bayar secara manual') DEFAULT 'Bayar secara manual',
                      kod_majikan VARCHAR(50) NULL,
                      saiz_baju VARCHAR(10) NULL,
                      no_akaun_bank VARCHAR(50) NULL,
                      nama_bank VARCHAR(100) NULL,
                      nama_waris VARCHAR(255) NULL,
                      no_phone_waris VARCHAR(20) NULL,
                      akaun_bank_waris VARCHAR(50) NULL,
                      nama_bank_waris VARCHAR(100) NULL,
                      
                      FOREIGN KEY (penempatan_id) REFERENCES penempatan(id) ON DELETE SET NULL
                  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
                `;
                await db.query(createUsersSql);
                
                console.log('Jadual berjaya dicipta dengan ciri preset ENUM. Mula memasukkan data penempatan...');

                const arrayPenempatan = Array.from(senaraiPenempatan);
                for (const tempat of arrayPenempatan) {
                    await db.query(`INSERT IGNORE INTO penempatan (nama_penempatan) VALUES (?)`, [tempat]);
                }

                const [rowsPenempatan] = await db.query(`SELECT id, nama_penempatan FROM penempatan`);
                const mapPenempatan = {};
                rowsPenempatan.forEach(row => {
                    mapPenempatan[row.nama_penempatan] = row.id;
                });

                console.log('Mula memasukkan data pengguna (users)...');
                
                for (const row of results) {
                    const penempatan_id = mapPenempatan[row.penempatan] || null;

                    const insertSql = `
                      INSERT INTO users (
                          id, nama_pegawai, no_kp, tarikh_lahir, penempatan_id, 
                          gred_hakiki_sspa, gred_penyandang_sspa, skim, gred, catatan,
                          jenis_potongan, yuran_kelab_bulanan, kod_majikan
                      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `;
                    
                    const values = [
                        row.id, 
                        row.nama_pegawai, 
                        row.no_kp, 
                        row.tarikh_lahir, 
                        penempatan_id,
                        row.gred_hakiki, 
                        row.gred_penyandang, 
                        row.skim, 
                        row.gred, 
                        row.catatan,
                        row.jenis_potongan,
                        row.yuran_kelab_bulanan,
                        row.kod_majikan
                    ];
                    
                    try {
                        await db.query(insertSql, values);
                    } catch (err) {
                        console.error(`Ralat ID ${row.id} (${row.nama_pegawai}):`, err.message);
                    }
                }
                
                console.log('Tahniah! Semua rekod berjaya diproses.');
            } catch (err) {
                console.error('Ralat pangkalan data:', err.message);
            } finally {
                process.exit();
            }
        });
  });