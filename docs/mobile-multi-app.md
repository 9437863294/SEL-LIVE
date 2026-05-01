# Mobile Multi-App Targets

This project can build two Android app targets from the same codebase:

- `driver`: Driver-only mobile app shell
- `full`: Full SEL app shell (all modules based on user permission)

## Commands

- Sync driver app: `npm run mobile:target:driver:sync:android`
- Open driver app in Android Studio: `npm run mobile:target:driver:open:android`
- Run driver app on device/emulator: `npm run mobile:target:driver:run:android`

- Sync full app: `npm run mobile:target:full:sync:android`
- Open full app in Android Studio: `npm run mobile:target:full:open:android`
- Run full app on device/emulator: `npm run mobile:target:full:run:android`

## Defaults per target

- Driver target:
  - `APP_TARGET=driver`
  - `CAPACITOR_APP_ID=com.sel.driver`
  - `CAPACITOR_APP_NAME=SEL Driver`
  - `CAPACITOR_START_PATH=/driver-management/mobile-hub`

- Full target:
  - `APP_TARGET=full`
  - `CAPACITOR_APP_ID=com.sel.full`
  - `CAPACITOR_APP_NAME=SEL Live`
  - `CAPACITOR_START_PATH=/`

You can still override `CAPACITOR_APP_ID`, `CAPACITOR_APP_NAME`, and `CAPACITOR_START_PATH` from environment variables.
