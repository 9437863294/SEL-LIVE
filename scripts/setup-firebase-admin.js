/**
 * Run this once to extract FIREBASE_PRIVATE_KEY from your service account JSON
 * and write it correctly into .env
 *
 * Usage:
 *   node scripts/setup-firebase-admin.js <path-to-service-account.json>
 *
 * Example:
 *   node scripts/setup-firebase-admin.js "D:\Downloads\module-hub-uc7tw-firebase-adminsdk.json"
 */

const fs = require('fs');
const path = require('path');

const jsonPath = process.argv[2];

if (!jsonPath) {
  console.error('\nUsage: node scripts/setup-firebase-admin.js <path-to-service-account.json>\n');
  process.exit(1);
}

const absPath = path.resolve(jsonPath);
if (!fs.existsSync(absPath)) {
  console.error(`\nFile not found: ${absPath}\n`);
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(fs.readFileSync(absPath, 'utf-8'));
} catch (e) {
  console.error('\nFailed to parse JSON file:', e.message, '\n');
  process.exit(1);
}

if (!sa.private_key || !sa.client_email || !sa.project_id) {
  console.error('\nInvalid service account JSON — missing required fields.\n');
  process.exit(1);
}

const envPath = path.join(__dirname, '..', '.env');
let env = fs.readFileSync(envPath, 'utf-8');

// Escape the private key for .env: replace literal \n with \\n, wrap in quotes
const escapedKey = '"' + sa.private_key.replace(/\n/g, '\\n') + '"';

// Replace FIREBASE_PRIVATE_KEY line
env = env.replace(/^FIREBASE_PRIVATE_KEY=.*$/m, `FIREBASE_PRIVATE_KEY=${escapedKey}`);
// Replace FIREBASE_PROJECT_ID line
env = env.replace(/^FIREBASE_PROJECT_ID=.*$/m, `FIREBASE_PROJECT_ID=${sa.project_id}`);
// Replace FIREBASE_CLIENT_EMAIL line
env = env.replace(/^FIREBASE_CLIENT_EMAIL=.*$/m, `FIREBASE_CLIENT_EMAIL=${sa.client_email}`);
// Clear GOOGLE_APPLICATION_CREDENTIALS since we're using cert() now
env = env.replace(/^GOOGLE_APPLICATION_CREDENTIALS=.*$/m, 'GOOGLE_APPLICATION_CREDENTIALS=');

fs.writeFileSync(envPath, env, 'utf-8');

console.log('\n✅ .env updated successfully!');
console.log(`   project_id   : ${sa.project_id}`);
console.log(`   client_email : ${sa.client_email}`);
console.log(`   private_key  : ${sa.private_key.slice(0, 40)}...\n`);
console.log('Restart your dev server (npm run dev) to apply changes.\n');
