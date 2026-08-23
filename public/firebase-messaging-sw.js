/* eslint-disable no-undef */

/**
 * Firebase Cloud Messaging service worker — web push for the notification system.
 *
 * Browsers can only receive push while the tab is closed through a service worker,
 * and FCM requires it at this exact path (`/firebase-messaging-sw.js`) unless a
 * custom one is registered explicitly. Without this file the web app had no push at
 * all: notifications reached the in-app bell only while a tab was open and focused.
 *
 * The config below is duplicated from src/lib/firebase.ts rather than imported —
 * a service worker runs outside the bundler and cannot import app modules. These
 * values are public client identifiers, not secrets. Keep them in step with
 * src/lib/firebase.ts if that config ever changes.
 *
 * The pinned SDK version should track the `firebase` dependency in package.json.
 * The page mints the token with the bundled SDK and this worker consumes it, so
 * letting the two drift apart risks a token the worker cannot use.
 */

importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.11.0/firebase-messaging-compat.js');

firebase.initializeApp({
  projectId: 'module-hub-uc7tw',
  appId: '1:1098805626846:web:53c37d00f62dbbc19dbf4f',
  storageBucket: 'module-hub-uc7tw.firebasestorage.app',
  apiKey: 'AIzaSyBRnB-SvnQWuNipl2SOnuV4opME0ZmsdPQ',
  authDomain: 'module-hub-uc7tw.firebaseapp.com',
  messagingSenderId: '1098805626846',
});

/**
 * Initialising messaging is what registers the SDK's own push and notificationclick
 * handlers. Messages are sent with a `webpush.notification` block and
 * `webpush.fcmOptions.link` (see src/lib/push-server.ts), so the SDK displays the
 * notification and routes the click to that link on its own.
 *
 * Deliberately no onBackgroundMessage or notificationclick listener here: adding one
 * alongside the SDK's defaults shows the notification twice and can open two tabs
 * for a single click.
 */
firebase.messaging();
