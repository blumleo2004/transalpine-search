import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Transalpine Suchmaschine – KI-Suche für „Servus. Grüezi. Hallo.“',
  description: 'Durchsuche das gesamte Archiv des ZEIT-Podcasts „Servus. Grüezi. Hallo.“ semantisch nach Themen, erhalte präzise Transkripte mit Sprechererkennung und springe direkt zum Audio-Player.',
  keywords: ['Podcast', 'ZEIT ONLINE', 'Servus Grüezi Hallo', 'Semantische Suche', 'KI', 'Transkript', 'Alpen', 'Politik'],
  authors: [{ name: 'Antigravity AI' }],
  openGraph: {
    title: 'Transalpine Suchmaschine',
    description: 'Durchsuche das Archiv von „Servus. Grüezi. Hallo.“ — semantische Suche über 94.595 Gesprächsabschnitte aus 411 Episoden.',
    images: ['/og-image.svg'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <head>
        {/* Preconnect to Google Fonts */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Playfair Display for editorial headers, Inter for readable body text */}
        <link 
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&display=swap" 
          rel="stylesheet" 
        />
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
