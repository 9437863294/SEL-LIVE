# Firebase Admin in local development

This application needs the Firebase Admin SDK for greytHR preview/sync, employee linking, and user
creation. When the organization blocks service-account key creation, use short-lived Application
Default Credentials (ADC); do not request or copy a private key around the policy.

## Recommended: service-account impersonation

An organization administrator must grant the developer `Service Account Token Creator` on the
runtime service account. The account itself must already have the Firestore and Firebase
Authentication permissions used by the application.

1. Install and initialize the [Google Cloud CLI](https://cloud.google.com/sdk/docs/install-sdk).
2. In a new PowerShell window, run:

   ```powershell
   gcloud config set project module-hub-uc7tw
   gcloud auth application-default login --impersonate-service-account=firebase-adminsdk-uc7tw@module-hub-uc7tw.iam.gserviceaccount.com
   ```

3. Add this opt-in to `.env` (keep the existing `FIREBASE_PROJECT_ID`):

   ```text
   FIREBASE_USE_APPLICATION_DEFAULT_CREDENTIALS=true
   ```

   Do not set `GOOGLE_APPLICATION_CREDENTIALS` when using the credential stored by `gcloud`.

4. Verify both services, then restart Next.js:

   ```powershell
   npm run firebase:admin-check
   npm run dev
   ```

The check performs a read-only Firestore probe and a read-only Firebase Authentication user-list
probe. It does not print any application or user data.

## If impersonation is not permitted

Plain `gcloud auth application-default login` may be sufficient for Firestore, but Firebase
Authentication does not accept the default Google Cloud CLI end-user OAuth credential. For the full
user-creation workflow, ask the administrator for impersonation access, a dedicated development
project, or test in a deployed environment that already has an attached service account.

The Firebase Emulator Suite is another option only after the app is configured to use both the Auth
and Firestore emulators; setting `FIRESTORE_EMULATOR_HOST` alone does not emulate Authentication.
