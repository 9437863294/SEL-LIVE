
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  async redirects() {
    return [
      // Driver Management held copies of other pages. Each now lives in one place; these keep old
      // links, bookmarks and installed driver apps landing on it. Not permanent: browsers and the
      // Android WebView would cache a 308 for good.
      //  - The driver app's screens were served twice, here and under Vehicle Management.
      //  - The Driver Mobile hub was a second dashboard; its figures are on the Overview, and driver
      //    APKs built before 2026-10-23 still start at it.
      //  - Trip Management was Vehicle Management's page shown in both modules.
      //  - Employee Trips was the reimbursement register that My Trips and claims replaced.
      //  - Daily Status was retired (2026-10-24); its old logs stay in the database.
      { source: '/vehicle-management/driver-mobile', destination: '/driver-management', permanent: false },
      { source: '/vehicle-management/driver-mobile/:path*', destination: '/driver-management/:path*', permanent: false },
      { source: '/driver-management/mobile-hub', destination: '/driver-management', permanent: false },
      { source: '/driver-management/trip-management', destination: '/vehicle-management/trips', permanent: false },
      { source: '/driver-management/employee-trips', destination: '/driver-management/my-trips', permanent: false },
      // GPS recording moved onto My Trips: the trip you drive is the trip you claim, so there is no
      // longer a separate screen that measures a journey no claim can reach.
      { source: '/driver-management/trips', destination: '/driver-management/my-trips', permanent: false },
      { source: '/driver-management/daily-status', destination: '/driver-management', permanent: false },
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
