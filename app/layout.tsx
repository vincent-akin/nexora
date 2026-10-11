import type { Metadata, Viewport } from 'next';
import './globals.css';
import Backdrop from '@/components/Backdrop';

export const metadata: Metadata = {
  title: 'Nexora',
  description: 'A hybrid game platform: play, compete, rise.',
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600;700&family=Nunito:wght@500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <Backdrop />
        {children}
      </body>
    </html>
  );
}
