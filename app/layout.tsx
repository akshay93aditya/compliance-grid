import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Nav } from './_components/nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'Compliance Grid',
  description: 'Internal surfaces for the Canonical Knowledge Graph.',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 antialiased">
        <Nav />
        {children}
      </body>
    </html>
  );
}
