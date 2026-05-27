import mysql from 'mysql2/promise';

async function ciptaJadualLengkap() {
  try {
    // 1. Sambungan ke database
    const connection = await mysql.createConnection({
      host: '127.0.0.1',
      user: 'root', // Gantikan dengan pengguna anda
      password: '', // Gantikan dengan kata laluan anda
      database: 'kelab_sukan'
    });

    console.log('Berjaya menyambung ke pangkalan data.');

    // 2. Padam jadual lama (jika ada) untuk elak ralat jika nak run kod berulang kali
    await connection.query('DROP TABLE IF EXISTS jadual_gabungan_lengkap');

    // 3. Kod SQL dengan pengiraan yuran_bulanan sebagai Integer
    const sql = `
      CREATE TABLE jadual_gabungan_lengkap (
          id INT AUTO_INCREMENT PRIMARY KEY
      ) AS
      SELECT 
          m.no_kp,
          m.nama_pegawai,
          m.gred_sspa,
          m.penempatan,
          m.kategori_staf,
          k.nama_majikan,
          k.email AS emel_kelab,
          k.no_tel,
          k.saiz_baju,
          k.gambar,
          
          -- Logik Tentukan Yuran Bulanan (INTEGER)
          -- Huruf 'RM' dibuang. Nombor 5, 10, 15 ditulis tanpa tanda petik (') supaya ia menjadi Integer
          CASE 
              WHEN m.gred_sspa REGEXP '[0-9]+' THEN
                  CASE 
                      WHEN CAST(REGEXP_SUBSTR(m.gred_sspa, '[0-9]+') AS UNSIGNED) BETWEEN 1 AND 8 THEN 5
                      WHEN CAST(REGEXP_SUBSTR(m.gred_sspa, '[0-9]+') AS UNSIGNED) BETWEEN 9 AND 14 THEN 10
                      ELSE 15
                  END
              ELSE 15 
          END AS yuran_bulanan,
          
          k.resit_pembayaran,
          k.bank_ahli,
          k.pilihan_potongan,
          k.mula_potongan,
          k.status_ahli,
          k.ulasan_admin,
          k.tarikh_lulus,
          k.no_ahli,
          k.negeri_bertugas,
          k.nama_waris,
          k.hubungan_waris,
          k.no_tel_waris,
          k.no_acc_waris,
          k.bank_waris,
          k.no_acc_bank,
          k.nama_ptj,
          k.klasifikasi_jawatan,
          
          -- Logik Dapatkan Tarikh Lahir
          STR_TO_DATE(SUBSTRING(m.no_kp, 1, 6), '%y%m%d') AS tarikh_lahir,
          
          -- Logik Remark FPX / Biro Angkasa
          CASE 
              WHEN k.no_kp IS NULL THEN 'Bayaran melalui fpx'
              ELSE 'Potongan biro angkasa'
          END AS remark
          
      FROM 
          master_penjawat m
      LEFT JOIN 
          keahlian_kelab k ON m.no_kp = k.no_kp;
    `;

    // 4. Laksanakan arahan SQL
    await connection.query(sql);
    console.log('Jadual gabungan berjaya dicipta! Yuran bulanan kini ditetapkan sebagai nombor (Integer).');

    // 5. Tutup sambungan
    await connection.end();

  } catch (error) {
    console.error('Ralat berlaku:', error.message);
  }
}

ciptaJadualLengkap();