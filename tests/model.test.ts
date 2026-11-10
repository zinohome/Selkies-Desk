import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConnection, parseImport, Store, matchesOrigin, matchesNetworkOrigin, trustedCertificate } from '../src/model';
import { Vault } from '../src/vault';
import { Permissions } from '../src/permissions';
import { desktopBounds } from '../src/layout';

const input = { name: '工作台', url: 'https://example.test:8443', group: '开发', notes: '', username: 'alice' };

test('地址只接受 HTTP(S) 且不接受 URL 凭据或可能泄露凭据的参数', () => {
  assert.equal(parseConnection(input).url, 'https://example.test:8443/');
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'https://alice:secret@example.test', 'https://example.test/?token=secret', 'https://example.test/#secret']) {
    assert.throws(() => parseConnection({ ...input, url }));
  }
  assert.throws(() => parseConnection({ ...input, name: '' }));
});

test('同主机不同端口保留为独立连接，导入冲突不覆盖或复用会话 ID', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-model-'));
  try {
    const store = new Store(directory);
    const first = store.save(input);
    store.save({ ...input, url: 'https://example.test:8444' });
    const exported = store.export();
    const imported = store.import(parseImport(exported));
    assert.equal(store.connections.length, 4);
    assert.equal(imported.length, 2);
    assert.notEqual(imported[0].id, first.id);
    assert.equal(imported[0].name, '工作台（导入 2）');
    assert.equal(new Store(directory).connections.length, 4);
    assert.ok(!exported.includes('password'));
    assert.ok(!exported.includes('certificate'));
    assert.throws(() => parseImport('{"version":2,"connections":[]}'));
    assert.throws(() => parseImport(JSON.stringify({ version: 1, connections: [{ ...first, password: 'never-export' }] })));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('信任同时绑定连接、精确 origin 与 SHA256 指纹，改址会撤销', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-trust-'));
  try {
    const store = new Store(directory);
    const connection = store.save(input);
    store.trust(connection.id, 'https://example.test:8443', 'AB:CD');
    assert.equal(trustedCertificate(store, connection.id, 'https://example.test:8443', 'AB:CD'), true);
    assert.equal(trustedCertificate(store, connection.id, 'https://example.test:8444', 'AB:CD'), false);
    assert.equal(trustedCertificate(store, connection.id, 'https://example.test:8443', 'EF:01'), false);
    assert.equal(trustedCertificate(store, 'another-id', 'https://example.test:8443', 'AB:CD'), false);
    store.save({ ...connection, url: 'https://example.test:8444' });
    assert.equal(trustedCertificate(store, connection.id, 'https://example.test:8443', 'AB:CD'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('origin 比较包含协议和端口，拒绝异常地址', () => {
  assert.equal(matchesOrigin('https://example.test:8443/path', 'https://example.test:8443/'), true);
  assert.equal(matchesOrigin('https://example.test:8444/', 'https://example.test:8443/'), false);
  assert.equal(matchesOrigin('http://example.test:8443/', 'https://example.test:8443/'), false);
  assert.equal(matchesOrigin('not a url', input.url), false);
});

test('同来源 WebSocket 握手沿用 HTTP(S) 来源，其他端口仍被排除', () => {
  assert.equal(matchesNetworkOrigin('wss://example.test:8443/socket', input.url), true);
  assert.equal(matchesNetworkOrigin('wss://example.test:8444/socket', input.url), false);
  assert.equal(matchesNetworkOrigin('ws://example.test:8443/socket', input.url), false);
});

test('加密不可用只存本次会话；更新 origin、用户名或清除后不再返回密码', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-vault-'));
  try {
    const unavailable = { isAsyncEncryptionAvailable: async () => false, encryptStringAsync: async () => { throw Error('unavailable'); }, decryptStringAsync: async () => { throw Error('unavailable'); } };
    const store = new Store(directory);
    const connection = store.save(input);
    const vault = new Vault(directory, unavailable);
    assert.equal(await vault.set(connection, 'test-only-secret', true), false);
    assert.equal((await vault.get(connection))?.password, 'test-only-secret');
    assert.equal(await new Vault(directory, unavailable).get(connection), undefined);
    assert.equal(await vault.get({ ...connection, username: 'bob' }), undefined);
    assert.equal(await vault.get({ ...connection, url: 'https://elsewhere.test' }), undefined);
    assert.ok(!readFileSync(join(directory, 'connections.json'), 'utf8').includes('test-only-secret'));
    vault.clear(connection.id);
    assert.equal(await vault.get(connection), undefined);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('异步加密过程中清除密码不会被迟到的保存重新写回', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-race-'));
  try {
    let complete!: (buffer: Buffer) => void;
    let started!: () => void;
    const encrypting = new Promise<void>(resolve => { started = resolve; });
    const cipher = {
      isAsyncEncryptionAvailable: async () => true,
      encryptStringAsync: async () => {
        started();
        return new Promise<Buffer>(resolve => { complete = resolve; });
      },
      decryptStringAsync: async () => { throw Error('unused'); }
    };
    const connection = new Store(directory).save(input);
    const vault = new Vault(directory, cipher);
    const saving = vault.set(connection, 'fixture-race-secret', true);
    await encrypting;
    vault.clear(connection.id);
    complete(Buffer.from('encrypted-fixture'));
    await saving;
    assert.equal(vault.hasSaved(connection.id), false);
    assert.equal(await vault.get(connection), undefined);
    assert.equal(readFileSync(join(directory, 'credentials.enc.json'), 'utf8'), '{}');
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('权限绑定连接及 origin，允许音频不会隐式允许摄像头', () => {
  const permissions = new Permissions();
  const connection = { ...parseConnection(input), id: 'fixture-connection' };
  assert.equal(permissions.allows(connection, input.url, 'clipboard-read'), false);
  permissions.grant(connection, 'clipboard-read');
  permissions.grant(connection, 'media', ['audio']);
  assert.equal(permissions.allows(connection, input.url, 'clipboard-read'), true);
  assert.equal(permissions.allows(connection, input.url, 'media', 'audio'), true);
  assert.equal(permissions.allows(connection, input.url, 'media', 'video'), false);
  assert.equal(permissions.allows(connection, 'https://example.test:8444', 'clipboard-read'), false);
  assert.equal(permissions.allows({ ...connection, id: 'other' }, input.url, 'clipboard-read'), false);
  assert.equal(permissions.allows({ ...connection, url: 'https://elsewhere.test' }, 'https://elsewhere.test', 'clipboard-read'), false);
});

test('侧栏和工具栏分别收起后，远端获得全部释放的真实视图空间', () => {
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: true, toolbar: true }), { x: 232, y: 52, width: 1048, height: 748 });
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: false, toolbar: true }), { x: 0, y: 52, width: 1280, height: 748 });
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: true, toolbar: false }), { x: 232, y: 0, width: 1048, height: 800 });
  assert.deepEqual(desktopBounds(1280, 800, { sidebar: false, toolbar: false }), { x: 0, y: 0, width: 1280, height: 800 });
});

test('布局选择在重启后恢复，配置导出不包含本机布局偏好', () => {
  const directory = mkdtempSync(join(tmpdir(), 'selkies-layout-'));
  try {
    const store = new Store(directory);
    assert.deepEqual(store.layout, { sidebar: true, toolbar: true });
    store.setLayout({ sidebar: false, toolbar: false });
    assert.deepEqual(new Store(directory).layout, { sidebar: false, toolbar: false });
    assert.equal(store.export().includes('layout'), false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
