
'use server';

import { db } from './firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

interface LogData {
  userId: string;
  action: string;
  details: Record<string, any>;
}

export async function logUserActivity(logData: LogData) {
  try {
    await addDoc(collection(db, 'userLogs'), {
      ...logData,
      timestamp: serverTimestamp(),
    });
  } catch (error) {
    console.error("Error logging user activity:", error);
    // In a real app, you might have more robust error handling,
    // like sending to a dedicated logging service.
  }
}

    