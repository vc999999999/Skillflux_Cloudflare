import { generateKeyPairSync, randomBytes, sign, verify } from 'node:crypto';
import { chmod, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { PublicKeyInfo } from '../shared.js';
import { canonical, sha256 } from '../shared.js';

export interface RegistryKeys extends PublicKeyInfo {
  privateKey: string;
}

interface DecisionTokenPayload {
  v: 1;
  decisionId: string;
  nonce: string;
  expiresAt: string;
  uses: ['impression', 'hide', 'report', 'click'];
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicPrivateWrite(path: string, value: string, mode: number): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, value, { encoding: 'utf8', mode, flag: 'wx' });
  await rename(temporary, path);
  await chmod(path, mode);
}

export async function loadOrCreateRegistryKeys(dataDir: string): Promise<RegistryKeys> {
  const keysDir = join(dataDir, 'keys');
  const privatePath = join(keysDir, 'registry-ed25519-private.pem');
  const publicPath = join(keysDir, 'registry-ed25519-public.pem');
  const privateExists = await exists(privatePath);
  const publicExists = await exists(publicPath);

  if (privateExists !== publicExists) {
    throw new Error('Registry signing key pair is incomplete');
  }

  if (!privateExists) {
    const pair = generateKeyPairSync('ed25519');
    const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    await atomicPrivateWrite(privatePath, privateKey, 0o600);
    try {
      await atomicPrivateWrite(publicPath, publicKey, 0o644);
    } catch (error) {
      throw new Error(`Failed to persist registry public key: ${(error as Error).message}`);
    }
  }

  const [privateKey, publicKey] = await Promise.all([
    readFile(privatePath, 'utf8'),
    readFile(publicPath, 'utf8'),
  ]);
  const keyId = `ed25519:${sha256(publicKey).slice(0, 24)}`;
  const challenge = Buffer.from('skillflux-registry-key-check');
  const signature = sign(null, challenge, privateKey);
  if (!verify(null, challenge, publicKey, signature)) {
    throw new Error('Registry signing key pair does not match');
  }
  return { keyId, publicKey, privateKey };
}

function encode(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

function decode(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}

export function issueDecisionToken(decisionId: string, expiresAt: string, privateKey: string): string {
  const payload: DecisionTokenPayload = {
    v: 1,
    decisionId,
    nonce: randomBytes(18).toString('base64url'),
    expiresAt,
    uses: ['impression', 'hide', 'report', 'click'],
  };
  const encodedPayload = encode(canonical(payload));
  const signature = sign(null, Buffer.from(encodedPayload), privateKey);
  return `${encodedPayload}.${encode(signature)}`;
}

export function verifyDecisionToken(token: string, publicKey: string): DecisionTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error('Malformed decision token');
  const [encodedPayload, encodedSignature] = parts;
  const decodedPayload = decode(encodedPayload);
  const decodedSignature = decode(encodedSignature);
  if (encode(decodedPayload) !== encodedPayload || encode(decodedSignature) !== encodedSignature) {
    throw new Error('Non-canonical decision token encoding');
  }
  if (!verify(null, Buffer.from(encodedPayload), publicKey, decodedSignature)) {
    throw new Error('Invalid decision token signature');
  }
  let value: unknown;
  try {
    value = JSON.parse(decodedPayload.toString('utf8'));
  } catch {
    throw new Error('Malformed decision token payload');
  }
  if (!value || typeof value !== 'object') throw new Error('Malformed decision token payload');
  const candidate = value as Partial<DecisionTokenPayload>;
  if (
    candidate.v !== 1 ||
    typeof candidate.decisionId !== 'string' ||
    typeof candidate.nonce !== 'string' ||
    typeof candidate.expiresAt !== 'string' ||
    !Array.isArray(candidate.uses) ||
    candidate.uses.join(',') !== 'impression,hide,report,click'
  ) {
    throw new Error('Malformed decision token payload');
  }
  return candidate as DecisionTokenPayload;
}
