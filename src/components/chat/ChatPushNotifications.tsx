'use client';

import { useEffect, useRef } from 'react';
import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/AuthProvider';
import { ToastAction } from '@/components/ui/toast';
import { useToast } from '@/hooks/use-toast';
import { openAndroidAppSettings } from '@/lib/native-android-settings';
import { registerChatPushDevice } from '@/lib/chat-push-client';

const CHAT_CHANNEL_ID = 'sel_chat_messages';
const PERMISSION_STATUS_KEY = 'sel_chat_notification_permission';

export function ChatPushNotifications() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const deniedToastShown = useRef(false);

  useEffect(() => {
    if (!user?.id || !Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
      return;
    }

    let disposed = false;
    let registeredForSession = false;
    const listenerHandles: PluginListenerHandle[] = [];

    const showPermissionHelp = () => {
      if (deniedToastShown.current) return;
      deniedToastShown.current = true;
      toast({
        title: 'Chat notifications are off',
        description: 'Allow notifications in Android Settings to receive new-message alerts.',
        action: (
          <ToastAction altText="Open Android notification settings" onClick={() => void openAndroidAppSettings()}>
            Settings
          </ToastAction>
        ),
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

      listenerHandles.push(
        await PushNotifications.addListener('registration', ({ value }) => {
          if (disposed) return;
          void registerChatPushDevice(value).catch((error) => {
            console.error('Unable to save chat push token:', error);
          });
        }),
        await PushNotifications.addListener('registrationError', (error) => {
          console.error('Android push registration failed:', error.error);
          registeredForSession = false;
        }),
        await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const data = action.notification.data as Record<string, unknown> | undefined;
          const conversationId = typeof data?.conversationId === 'string' ? data.conversationId : '';
          router.push(
            conversationId
              ? `/chat-system?conversation=${encodeURIComponent(conversationId)}`
              : '/chat-system'
          );
        }),
        await CapacitorApp.addListener('appStateChange', ({ isActive }) => {
          if (isActive && !disposed) void checkPermissionAndRegister();
        })
      );

      await checkPermissionAndRegister();
    };

    void setup().catch((error) => {
      console.error('Unable to initialize Android chat notifications:', error);
    });

    return () => {
      disposed = true;
      listenerHandles.forEach((handle) => void handle.remove());
    };
  }, [router, toast, user?.id]);

  return null;
}

