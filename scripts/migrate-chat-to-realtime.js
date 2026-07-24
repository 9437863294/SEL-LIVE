/* eslint-disable no-console */
const { applicationDefault, cert, getApps, initializeApp } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { initializeFirestore } = require('firebase-admin/firestore');
require('dotenv').config({ path: '.env' });

const projectId = process.env.FIREBASE_PROJECT_ID || 'module-hub-uc7tw';
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
const databaseURL =
  process.env.FIREBASE_DATABASE_URL ||
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  `https://${projectId}-default-rtdb.firebaseio.com`;
const force = process.argv.includes('--force');
const dryRun = process.argv.includes('--dry-run');

const credential =
  clientEmail && privateKey
    ? cert({ projectId, clientEmail, privateKey })
    : applicationDefault();

const app =
  getApps()[0] ||
  initializeApp({
    credential,
    projectId,
    databaseURL,
  });

function toRealtimeValue(value) {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (Array.isArray(value)) return value.map(toRealtimeValue);
  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, toRealtimeValue(nestedValue)])
  );
}

async function migrate() {
  const firestore = initializeFirestore(app, { preferRest: true });
  const database = getDatabase(app);
  console.log('Loading Firestore chat conversations...');
  const conversations = await firestore.collection('chatConversations').get();
  console.log(`Found ${conversations.size} Firestore conversations.`);
  let migrated = 0;
  let skipped = 0;
  let messageCount = 0;

  for (const conversationDocument of conversations.docs) {
    const conversationId = conversationDocument.id;
    const existing = await database.ref(`chatConversations/${conversationId}`).once('value');
    if (existing.exists() && !force) {
      console.log(`Skipped ${conversationId}: already exists in Realtime Database.`);
      skipped += 1;
      continue;
    }

    const sourceConversation = toRealtimeValue(conversationDocument.data());
    const memberIds = Array.isArray(sourceConversation.memberIds)
      ? sourceConversation.memberIds.filter((memberId) => typeof memberId === 'string')
      : [];
    const realtimeConversation = {
      ...sourceConversation,
      memberIds: Object.fromEntries(memberIds.map((memberId) => [memberId, true])),
    };
    const messages = await conversationDocument.ref.collection('messages').get();
    const updates = {
      [`chatConversations/${conversationId}`]: realtimeConversation,
    };

    memberIds.forEach((memberId) => {
      updates[`chatUserConversations/${memberId}/${conversationId}`] = true;
    });
    messages.docs.forEach((messageDocument) => {
      updates[`chatMessages/${conversationId}/${messageDocument.id}`] = toRealtimeValue(
        messageDocument.data()
      );
    });

    if (!dryRun) await database.ref().update(updates);
    migrated += 1;
    messageCount += messages.size;
    console.log(`${dryRun ? 'Would migrate' : 'Migrated'} ${conversationId} (${messages.size} messages).`);
  }

  console.log(
    `${dryRun ? 'Dry run complete' : 'Migration complete'}: ${migrated} conversations and ${messageCount} messages ${dryRun ? 'ready to copy' : 'copied'}; ${skipped} skipped.`
  );
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('Chat migration failed:', error);
    process.exit(1);
  });
