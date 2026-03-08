import type { Metadata } from 'next';
import { Space_Grotesk, Space_Mono } from 'next/font/google';
import './globals.css';
import Providers from './providers';
import Navbar from '@/components/Navbar';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-grotesk',
  display: 'swap',
});

const spaceMono = Space_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'honey.trade — The Honey Network DEX',
  description:
    'Trade, stake, mint NFTs, and explore the Honey Network. Post-quantum security with ML-DSA-65. Native AMM with real-time Pyth oracle prices.',
  themeColor: '#39ff14',
  openGraph: {
    type: 'website',
    url: 'https://honey.trade',
    title: 'honey.trade — The Honey Network DEX',
    description:
      'Decentralized exchange on Honey Network. Swap tokens, stake HNY, mint NFTs, and trade with post-quantum security.',
    siteName: 'honey.trade',
  },
  twitter: {
    card: 'summary_large_image',
    site: '@HoneyNetwork',
    title: 'honey.trade — The Honey Network DEX',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${spaceMono.variable}`}>
      <body>
        <Providers>
          <Navbar />
          <main>{children}</main>
        </Providers>
      </body>
    </html>
  );
}
