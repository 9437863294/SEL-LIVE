
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'firebasestorage.googleapis.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'i.pravatar.cc',
        port: '',
        pathname: '/**',
      },
    ],
  },
  devIndicators: false,
  experimental: {
    turbopackFileSystemCacheForDev: false,
    // These are all imported by name across hundreds of files. Without this the
    // barrel entry point is pulled into the shared chunk graph wholesale.
    optimizePackageImports: [
      'lucide-react',
      'date-fns',
      'recharts',
      '@radix-ui/react-icons',
    ],
  },
  env: {
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'module-hub-uc7tw.appspot.com',
  },
};

export default nextConfig;
