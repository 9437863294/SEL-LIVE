# Firebase Studio

This is a NextJS starter in Firebase Studio.

To get started, take a look at src/app/page.tsx.

## Driver Mobile App (Capacitor)

This project now includes a Capacitor-based mobile shell for the Driver module.

### Environment variables

Add these values in `.env`:

```env
CAPACITOR_APP_ID=com.sel.driver
CAPACITOR_APP_NAME=SEL Driver
CAPACITOR_DRIVER_START_PATH=/driver-management/mobile-hub
CAPACITOR_LIVE_URL=https://your-live-domain.com
```

`CAPACITOR_LIVE_URL` should be your deployed web app domain. The app will open directly to the driver module route.

### Mobile commands

```bash
npm run mobile:add:android
npm run mobile:add:ios
npm run mobile:sync
npm run mobile:open:android
npm run mobile:open:ios
```

### Driver trip tracking in mobile app

Driver trip tracking now uses a native-aware geolocation layer:

- Uses `@capacitor/geolocation` on native Android/iOS app
- Falls back to browser geolocation on web
- Reads vehicle tracking interval from Vehicle Management Settings
