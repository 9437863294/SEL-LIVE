import { spawnSync } from 'node:child_process';

const [targetArg = 'driver', actionArg = 'sync', platformArg = 'android'] = process.argv.slice(2);
const target = String(targetArg).trim().toLowerCase();
const action = String(actionArg).trim().toLowerCase();
const platform = String(platformArg).trim().toLowerCase();

const validTargets = new Set(['driver', 'full']);
const validActions = new Set(['sync', 'copy', 'open', 'run']);

if (!validTargets.has(target)) {
  console.error(`Unsupported mobile target "${target}". Use "driver" or "full".`);
  process.exit(1);
}

if (!validActions.has(action)) {
  console.error(`Unsupported capacitor action "${action}". Use one of: ${Array.from(validActions).join(', ')}.`);
  process.exit(1);
}

const targetConfig =
  target === 'full'
    ? {
        APP_TARGET: 'full',
        CAPACITOR_APP_ID: 'com.sel.full',
        CAPACITOR_APP_NAME: 'SEL Live',
        CAPACITOR_START_PATH: '/',
      }
    : {
        APP_TARGET: 'driver',
        CAPACITOR_APP_ID: 'com.sel.driver',
        CAPACITOR_APP_NAME: 'SEL Driver',
        CAPACITOR_START_PATH: '/driver-management/mobile-hub',
      };

const mergedEnv = {
  ...process.env,
  ...targetConfig,
  CAPACITOR_APP_ID: process.env.CAPACITOR_APP_ID || targetConfig.CAPACITOR_APP_ID,
  CAPACITOR_APP_NAME: process.env.CAPACITOR_APP_NAME || targetConfig.CAPACITOR_APP_NAME,
  CAPACITOR_START_PATH: process.env.CAPACITOR_START_PATH || targetConfig.CAPACITOR_START_PATH,
};

const args = ['cap', action];
if (platform) {
  args.push(platform);
}

console.log(
  `[mobile-target] target=${target}, action=${action}, platform=${platform}, appId=${mergedEnv.CAPACITOR_APP_ID}, startPath=${mergedEnv.CAPACITOR_START_PATH}`
);

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  env: mergedEnv,
  shell: process.platform === 'win32',
});

if (typeof result.status === 'number') {
  process.exit(result.status);
}
if (result.error) {
  console.error(result.error);
}
process.exit(1);
