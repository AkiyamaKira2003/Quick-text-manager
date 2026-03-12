import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'QuickText Kira',
  description: 'One click, one prompt quick text manager and in-game overlay.',
  generator: 'QuickText',
  icons: {
    icon: [{ url: '/icon.png', type: 'image/png' }],
    apple: '/icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi" suppressHydrationWarning>
      <body className="font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
