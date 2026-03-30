require('dotenv').config();
const { spawn } = require('child_process');
const path = require('path');

const root = process.cwd();
const isWindows = process.platform === 'win32';

const requiredEnv = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'JWT_SECRET',
  'ADMIN_USERNAME',
  'ADMIN_PASSWORD_HASH',
];

const recommendedEnv = [
  'ADMIN_DISPLAY_NAME',
  'ALLOWED_ORIGINS',
  'BULK_USERNAME',
  'BULK_PASSWORD',
  'SECRET_VAULT_KEY',
];

const missingRequired = requiredEnv.filter((key) => !String(process.env[key] || '').trim());
const missingRecommended = recommendedEnv.filter((key) => !String(process.env[key] || '').trim());

const mergedAllowedOrigins = Array.from(new Set([
  'http://localhost:3000',
  'http://localhost:3002',
  ...String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
])).join(',');

const sharedEnv = {
  ...process.env,
  ALLOWED_ORIGINS: mergedAllowedOrigins,
  REACT_APP_API_URL: String(process.env.REACT_APP_API_URL || 'http://localhost:3001').trim() || 'http://localhost:3001',
};

const sanitizedEnv = Object.fromEntries(
  Object.entries(sharedEnv)
    .filter(([key]) => key && !key.startsWith('='))
    .map(([key, value]) => [key, value == null ? '' : String(value)]),
);

function createService(name, cwd, commandLine) {
  if (isWindows) {
    return {
      name,
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
      cwd,
      env: sanitizedEnv,
    };
  }

  const [command, ...args] = commandLine.split(' ');
  return {
    name,
    command,
    args,
    cwd,
    env: sanitizedEnv,
  };
}

const services = [
  createService('backend', root, `"${process.execPath}" server.js`),
  createService('frontend', path.join(root, 'aria-frontend'), isWindows ? 'npm.cmd start' : 'npm start'),
  createService('admin', path.join(root, 'aria-admin'), isWindows ? 'npm.cmd start' : 'npm start'),
];

const children = [];
let shuttingDown = false;

function log(name, message) {
  process.stdout.write(`[${name}] ${message}`);
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  setTimeout(() => process.exit(code), 200);
}

if (missingRequired.length) {
  process.stderr.write(`Missing required .env values: ${missingRequired.join(', ')}\n`);
  process.exit(1);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

process.stdout.write('HELIX XI dev stack starting...\n');
process.stdout.write('Backend:  http://localhost:3001\n');
process.stdout.write('Frontend: http://localhost:3000\n');
process.stdout.write('Admin:    http://localhost:3002\n');
process.stdout.write(`CORS:     ${mergedAllowedOrigins}\n`);

if (missingRecommended.length) {
  process.stdout.write(`Recommended .env values missing: ${missingRecommended.join(', ')}\n`);
}

for (const service of services) {
  const child = spawn(service.command, service.args, {
    cwd: service.cwd,
    env: service.env,
    stdio: ['inherit', 'pipe', 'pipe'],
    shell: false,
  });

  children.push(child);

  child.stdout.on('data', (chunk) => log(service.name, chunk));
  child.stderr.on('data', (chunk) => log(service.name, chunk));

  child.on('exit', (code) => {
    if (shuttingDown) return;
    process.stderr.write(`\n[${service.name}] exited with code ${code}\n`);
    shutdown(code || 1);
  });
}
