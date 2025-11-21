import type { Metadata } from 'next'
import { Epilogue, Krub } from 'next/font/google'
import './globals.css'
import Footer from '../components/Footer'
import { Toaster } from 'sonner'
import Image from 'next/image'

const epilogue = Epilogue({
  variable: '--font-epilogue',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
})

const krub = Krub({
  variable: '--font-krub',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'KeyRing Protocol - Project Dashboard',
  description: 'Monitor your KeyRing certified project, validators, and scheduled transactions',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${epilogue.variable} ${krub.variable}`}>
      <body className={`${krub.className} antialiased flex flex-col min-h-screen`}>
        <div className="flex flex-col min-h-screen">
          <header className="border-b border-gray-800 bg-black">
            <div className="container mx-auto px-4 py-4">
              <div className="flex items-center gap-3">
                <Image
                  src="/key_ring_logo_lock_v1.svg"
                  alt="KeyRing Logo"
                  width={40}
                  height={40}
                  priority
                />
                <div>
                  <h1 className="text-xl font-bold text-white">KeyRing Protocol</h1>
                  <p className="text-sm text-gray-400">Project Dashboard</p>
                </div>
              </div>
            </div>
          </header>
          {children}
          <Footer />
        </div>
        <Toaster 
          position="bottom-right" 
          theme="dark"
          toastOptions={{
            style: {
              background: '#2a2a2a',
              color: '#ffffff',
              border: '1px solid #3a3a3a',
            },
          }}
        />
      </body>
    </html>
  )
}

