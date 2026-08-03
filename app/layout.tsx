import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Sonic Horizon',
  description: 'Deep Music Discovery & Archive Engine',
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/icon.svg',
  },
  manifest: '/manifest.json',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
