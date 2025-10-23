
import type {NextConfig} from 'next';

const nextConfig: NextConfig = {
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
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
    ],
  },
  env: {
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: 'module-hub-uc7tw.appspot.com',
  },
  webpack: (config, { isServer }) => {
    // This is to prevent the Genkit flow files from triggering the Next.js file watcher.
    // See: https://nextjs.org/docs/app/api-reference/next-config-js/webpack
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        ...config.watchOptions.ignored,
        '**/.firebase/**',
        '**/src/ai/**'
      ],
    }
    return config
  },
};

export default nextConfig;
