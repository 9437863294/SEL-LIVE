
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      // The Expenses settings screens used to live under /settings as well as inside the module,
      // and the /settings copies had drifted — one of them lost its permission check entirely.
      // They are gone; these keep old links and bookmarks landing on the guarded module pages.
      { source: '/settings/expenses', destination: '/expenses/settings', permanent: true },
      { source: '/settings/expenses/accounts', destination: '/expenses/settings/accounts', permanent: true },
      {
        source: '/settings/expenses/department-serial-no',
        destination: '/expenses/settings/department-serial-no',
        permanent: true,
      },
    ];
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
