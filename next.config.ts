
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
      // Role Management is gone. Access Management edits the same `roles` collection with the same
      // permission registry, so every old route has an exact counterpart there; these keep saved
      // links, bookmarks and the odd hard-coded href landing on it instead of a 404.
      { source: '/settings/role-management', destination: '/settings/access-management', permanent: true },
      {
        source: '/settings/role-management/add',
        destination: '/settings/access-management/roles/new',
        permanent: true,
      },
      {
        source: '/settings/role-management/edit/:roleId',
        destination: '/settings/access-management/roles/:roleId',
        permanent: true,
      },
      // User Management is gone the same way. The register it offered is the Users tab, and editing
      // the user record itself — the one thing the additive layer would not touch — now lives on
      // that user's access profile, so the per-user routes have exact counterparts.
      { source: '/settings/user-management', destination: '/settings/access-management', permanent: true },
      {
        source: '/settings/user-management/greythr-linking',
        destination: '/settings/access-management/greythr-linking',
        permanent: true,
      },
      {
        source: '/settings/user-management/:userId/logs',
        destination: '/settings/access-management/users/:userId/logs',
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
