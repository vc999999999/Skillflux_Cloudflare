import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { canonical, signPayload, verifyPayload, safeRelativePath } from '../src/shared.js';

test('signature survives JSON round-trip and rejects altered payload or wrong key', () => {
  const pair = generateKeyPairSync('ed25519');
  const publicKey = pair.publicKey.export({type:'spki', format:'pem'}).toString();
  const privateKey = pair.privateKey.export({type:'pkcs8', format:'pem'}).toString();
  const key = {keyId:'root-1',publicKey};
  const signed = signPayload({version:'1.0', nested:{b:2,a:1}}, privateKey, key.keyId);
  assert.deepEqual(verifyPayload(JSON.parse(JSON.stringify(signed)),key),signed.payload);
  assert.throws(()=>verifyPayload({...signed,payload:{...signed.payload,version:'0.1'}},key));
  assert.throws(()=>verifyPayload(signed,{...key,keyId:'impostor'}));
  assert.equal(canonical({b:1,a:2}),canonical({a:2,b:1}));
  assert.throws(()=>canonical({missing:undefined}));
});

test('cross-platform path policy refuses traversal and special files', () => {
  for (const path of ['../secret','a/../secret','/etc/passwd','C:/file','a\\b','a//b','a/./b','a/','a\u0000b','CON.txt','a/aux','file.','file ']) assert.equal(safeRelativePath(path),false,path);
  for (const path of ['SKILL.md','references/checks.md','assets/template.json']) assert.equal(safeRelativePath(path),true,path);
});
