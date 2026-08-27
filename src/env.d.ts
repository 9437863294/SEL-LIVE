
namespace NodeJS {
    interface ProcessEnv {
        NEXT_PUBLIC_FIREBASE_API_KEY: string;
        NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: string;
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: string;
        NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: string;
        NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: string;
        NEXT_PUBLIC_FIREBASE_APP_ID: string;
        
        FIREBASE_PROJECT_ID: string;
        FIREBASE_CLIENT_EMAIL: string;
        FIREBASE_PRIVATE_KEY: string;
        FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS?: string;
        GOOGLE_APPLICATION_CREDENTIALS?: string;
        GOOGLE_CLOUD_PROJECT?: string;
        APP_BASE_URL?: string;
    }
}
