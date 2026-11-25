import type { Metadata, Viewport } from 'next';
import { Barlow, Barlow_Condensed } from 'next/font/google';
import { I18nProvider } from '@/i18n';
import { BRAND } from '@/config/brand';
import './globals.css';

const text = Barlow({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--nf-text', display: 'swap' });
const display = Barlow_Condensed({ subsets: ['latin'], weight: ['700', '800'], variable: '--nf-display', display: 'swap' });

export const metadata: Metadata = { title: BRAND.name, description: 'Makin tipis, makin tinggi. / Thinner is higher.' };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${text.variable} ${display.variable}`}>
      <body><I18nProvider>{children}</I18nProvider></body>
    </html>
  );
}
