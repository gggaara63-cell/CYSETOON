/** Satu tempat untuk mengganti nama produk. Nama tampil dari env NEXT_PUBLIC_APP_NAME (atur di Vercel), tanpa ubah kode.
 *  Kunci penyimpanan lokal memakai slug; ganti slug hanya bila rela kehilangan preferensi pemain yang tersimpan. */
export const BRAND = {
  name: process.env.NEXT_PUBLIC_APP_NAME || 'Nanjak',
  slug: process.env.NEXT_PUBLIC_APP_SLUG || 'nanjak',
};
