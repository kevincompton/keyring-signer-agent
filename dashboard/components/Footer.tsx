import Image from 'next/image';

export default function Footer() {
  return (
    <footer className="mt-auto border-t border-gray-800 bg-black">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image
              src="/key_ring_logo_lock_v1.svg"
              alt="KeyRing Logo"
              width={24}
              height={24}
              className="opacity-80"
            />
            <span className="text-sm text-gray-400">
              © {new Date().getFullYear()} KeyRing Protocol. All rights reserved.
            </span>
          </div>
          <div className="flex items-center gap-6 text-sm text-gray-400">
            <a
              href="https://keyring.so"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Main Site
            </a>
            <a
              href="https://github.com/kevincompton/KeyRing"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}

