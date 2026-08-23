'use client';

import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { useAuthorization } from '@/hooks/useAuthorization';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { openAndroidAppSettings } from '@/lib/native-android-settings';
import { registerNativePushDevice } from '@/lib/chat-push-client';

/**
 * Native push registration for the mobile apps.
 *
 * Generalised from the chat-only version. Two things changed, both of which were
 * blocking module notifications from ever reaching a phone:
 *
 *  - Registration is no longer gated on Chat System permission. It used to actively
 *    *unregister* the device when the user could not see chat, so anyone without
 *    chat access had no push token at all and could not receive any alert from any
 *    module. Chat permission now travels with the device record instead, and the
 *    chat notifier honours it — see `chatEnabled` in lib/chat-push-client.
 *  - iOS is included. The previous platform check was `!== 'android'`, which meant
 *    the iOS app registered nothing. iOS delivery additionally needs an APNs auth
 *    key uploaded to Firebase; without it FCM rejects the send and the token is
 *    pruned as invalid.
 */

const CHAT_CHANNEL_ID = 'sel_chat_messages';
const MODULE_CHANNEL_ID = 'sel_module_alerts';
const PERMISSION_STATUS_KEY = 'sel_chat_notification_permission';

export function NativePushNotifications() {
  const { user } = useAuth();
  const { can, isLoading } = useAuthorization();
  const router = useRouter();
  const { toast } = useToast();
  const deniedToastShown = useRef(false);

  const canReceiveChatNotifications =
    can('View Module', 'Chat System') &&
    can('View', 'Chat System.Conversations');

  useEffect(() => {
    if (isLoading || !user?.id || !Capacitor.isNativePlatform()) return;

    let disposed = false;
    let registeredForSession = false;
    const listenerHandles: PluginListenerHandle[] = [];

    const showPermissionHelp = () => {
      if (deniedToastShown.current) return;
      deniedToastShown.current = true;
      toast({
        title: 'Notifications are off',
        description: 'Allow notifications in Settings to receive approvals, alerts and messages.',
        action: Capacitor.getPlatform() === 'android' ? (
          <ToastAction altText="Open notification settings" onClick={() => void openAndroidAppSettings()}>
            Settings
          </ToastAction>
        ) : undefined,
      });
    };

    const checkPermissionAndRegister = async () => {
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
        permission = await PushNotifications.requestPermissions();
      }

      localStorage.setItem(PERMISSION_STATUS_KEY, permission.receive);
      if (permission.receive !== 'granted') {
        registeredForSession = false;
        showPermissionHelp();
        return;
      }

      deniedToastShown.current = false;
      if (!registeredForSession) {
        registeredForSession = true;
        await PushNotifications.register();
      }
    };

    const setup = async () => {
      // Channels are Android-only; calling this on iOS throws "not implemented".
      if (Capacitor.getPlatform() === 'android') {
        await PushNotifications.createChannel({
          id: CHAT_CHANNEL_ID,
          name: 'Chat messages',
          description: 'Alerts for new direct and group chat messages',
          importance: 4,
          visibility: 0,
          vibration: true,
          lights: true,
          lightColor: '#7C3AED',
        });
        // Separate channel so a user can silence module alerts without losing chat,
        // and so Android groups the two apart in the shade.
        await PushNotifications.createChannel({
          id: MODULE_CHANNEL_ID,
          name: 'Approvals & alerts',
          description: 'Approvals, escalations, reminders and workflow updates',
          importance: 4,
          visibility: 0,
          vibration: true,
          lights: true,
          lightColor: '#4F46E5',
        });
      }

      listenerHandles.push(
        await PushNotifications.addListener('registration', ({ value }) => {
          if (disposed) return;
          void registerNativePushDevice(value, canReceiveChatNotifications).catch((error) => {
            console.error('Unable to save push token:', error);
          });
        }),
        await PushNotifications.addListener('registrationError', (error) => {
          console.error('Native push registration failed:', error.error);
          registeredForSession = false;
        }),
        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const data = action.notification.data as Record<string, unknown> | undefined;
          const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : '';
          if (conversationId) {
            router.push(`/chat-system?conversation=${encodeURIComponent(conversationId)}`);
            return;
          }
          // Module alerts carry the destination as `link`. Only in-app paths are
          // followed — a push claiming an absolute URL should not be able to send
          // the WebView to another origin.
          const link = typeof data?.link === 'string' ? data.link : '';
          router.push(link.startsWith('/') ? link : '/');
        }),
        await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive && !disposed) void checkPermissionAndRegister();
        })
      );

      await checkPermissionAndRegister();
    };

    void setup().catch((error) => {
      console.error('Unable to initialize native notifications:', error);
    });

    return () => {
      disposed = true;
      listenerHandles.forEach((handle) => void handle.remove());
    };
  }, [canReceiveChatNotifications, isLoading, router, toast, user?.id]);

  // Sign-out cleanup lives in AuthProvider, which calls unregisterCurrentPushDevice
  // as part of the teardown. Doing it here as well would also fire on first mount,
  // before the user has loaded, and unregister the device that had just registered.
  return null;
}
