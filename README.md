# Canvas Collab - Papan Tulis Kolaboratif Real-Time

Aplikasi papan tulis kolaboratif berbasis Web yang dibangun menggunakan **ElysiaJS** dan **React 19** dengan pola **Bun Fullstack Dev Server** (tanpa bundler eksternal seperti Vite/Webpack) dan **HTML5 Canvas** yang tersinkronisasi via **WebSocket**.

Aplikasi ini dapat berjalan **100% offline** (tanpa ketergantungan CDN eksternal) dan otomatis di-host pada antarmuka **0.0.0.0** sehingga dapat diakses oleh perangkat lain yang terhubung ke jaringan WiFi/LAN yang sama.

## Fitur Utama

- **Kustomisasi Identitas / Nama Pengguna**: Pengguna dapat mengubah nama mereka secara langsung melalui lencana profil di bilah atas, dan nama baru langsung tersinkronisasi ke seluruh pengguna lain via WebSocket.
- **Fitur Zoom In / Zoom Out & Pan**:
  - Kontrol pembesaran kanvas dari 25% hingga 400% (`ZoomIn` & `ZoomOut`).
  - Pintasan reset zoom cepat kembali ke 100% (`RotateCcw`).
  - Dukungan perbesaran langsung menggunakan roda mouse (*Scroll Wheel Zoom* terpusat pada kursor).
  - **Geser Kanvas dengan Klik Kanan (Right-Click Pan)**: Menahan klik kanan dan menggeser (*right-click drag*) otomatis berfungsi sebagai alat geser (*pan*), dan context menu bawaan browser telah dinonaktifkan secara penuh.
  - Alat geser kanvas (`Hand` tool) dan klik tengah mouse (*middle click drag*) juga tersedia untuk bernavigasi.
  - Transformasi koordinat dunia (*world coordinate mapping*) sehingga pengguna dengan tingkat zoom berbeda tetap melihat goresan dan kursor pada titik yang sinkron.
- **Real-Time Synchronous Drawing**: Goresan titik koordinat dikirimkan secara instan ke pengguna lain melalui WebSocket tanpa jeda.
- **Multiplayer Live Cursors**: Pointer mouse pengguna lain ditampilkan secara real-time lengkap dengan label nama dan warna unik.
- **In-Memory Stroke History**: Pengguna yang baru membuka aplikasi langsung melihat riwayat gambar yang sudah dibuat sebelumnya.
- **Drawing Tools**:
  - **Pena (Pen)**: Goresan solid dengan rendering halus (anti patah-patah).
  - **Stabilo (Highlighter)**: Efek semi-transparan luminous untuk menandai objek.
  - **Penghapus (Eraser)**: Menghapus goresan pada area kanvas tertentu.
  - **Palet Warna**: Preset warna kontras modern dan custom color picker (HEX).
  - **Slider Ukuran Kuas**: Pengaturan ketebalan goresan dengan pratinjau visual.
  - **Batalkan (Undo)**: Menghapus goresan terakhir yang dibuat oleh pengguna saat ini.
  - **Bersihkan Kanvas (Clear)**: Menghapus seluruh goresan kanvas dengan konfirmasi popover.
  - **Unduh Kanvas (Export PNG)**: Menyimpan hasil gambar kanvas ke format gambar PNG berkualitas tinggi.
- **Status Jaringan & Kolaborator**: Indikator koneksi WebSocket (Online / Reconnecting) dan jumlah pengguna aktif.
- **100% Offline & Mandiri**: Tidak menggunakan CDN luar (Google Fonts / Tailwind Browser CDN telah dihapus). Seluruh aset di-bundle secara offline oleh Bun.
- **Bebas Emoji**: Seluruh elemen antarmuka menggunakan ikon profesional dari `lucide-react`.

## Teknologi

- **Runtime**: [Bun](https://bun.com) v1.4+ (Fast native bundler & dev server)
- **Backend**: [ElysiaJS](https://elysiajs.com) v1.4+ dengan endpoint WebSocket bawaan
- **Frontend**: [React 19](https://react.dev) + `@elysia/static` Bun Fullstack Dev Server
- **Icons**: [`lucide-react`](https://lucide.dev)
- **Styling**: Tailwind CSS v4 (dikompilasi mandiri via `bun-plugin-tailwind`)

## Cara Menjalankan

1. Pastikan dependensi sudah terpasang:
   ```bash
   bun install
   ```

2. Jalankan server:
   ```bash
   bun run dev
   ```

3. Server akan otomatis mendengarkan di seluruh antarmuka jaringan (`0.0.0.0`):
   - Akses dari komputer lokal: `http://localhost:3000`
   - Akses dari perangkat lain di WiFi yang sama: `http://<IP-LAN-ANDA>:3000` (alamat IP otomatis tertera di konsol terminal saat server dinyalakan).
