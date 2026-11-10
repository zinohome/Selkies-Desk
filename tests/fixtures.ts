import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';

export class MockDesktop {
  server: http.Server | https.Server;
  origin = '';
  streams = 0;
  webSockets = 0;
  receivedForeignAuth = false;
  receivedForeignCookie = false;
  foreignRequests = 0;
  failedAuth = 0;
  foreignOrigin = '';
  private sockets = new Set<import('node:net').Socket>();
  constructor(tls?: { key: Buffer; cert: Buffer }) {
    const handler = (request: IncomingMessage, response: ServerResponse) => this.handle(request, response);
    this.server = tls ? https.createServer(tls, handler) : http.createServer(handler);
    this.server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    const webSockets = new WebSocketServer({ noServer: true });
    this.server.on('upgrade', (request, socket, head) => {
      const auth = Buffer.from(request.headers.authorization?.slice(6) || '', 'base64').toString();
      if (!['alice:fixture-pass', 'bob:fixture-pass'].includes(auth)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Mock Desktop"\r\n\r\n');
        return;
      }
      webSockets.handleUpgrade(request, socket, head, connection => {
        this.webSockets++;
        connection.send('stream-ready');
        connection.on('close', () => this.webSockets--);
      });
    });
  }
  async start(port = 0) {
    await new Promise<void>(resolve => this.server.listen(port, '127.0.0.1', resolve));
    const address = this.server.address() as AddressInfo;
    this.origin = `${this.server instanceof https.Server ? 'https' : 'http'}://127.0.0.1:${address.port}`;
    return this;
  }
  async stop() {
    for (const socket of this.sockets) socket.destroy();
    await new Promise<void>(resolve => this.server.close(() => resolve()));
  }
  private handle(request: IncomingMessage, response: ServerResponse) {
    if (request.url === '/foreign') {
      this.receivedForeignAuth ||= !!request.headers.authorization;
      this.receivedForeignCookie ||= !!request.headers.cookie;
      if (request.method === 'GET') this.foreignRequests++;
      response.setHeader('Access-Control-Allow-Origin', request.headers.origin || '*');
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Allow-Headers', 'authorization');
      response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
      response.end('foreign');
      return;
    }
    const basic = request.headers.authorization?.startsWith('Basic ')
      ? Buffer.from(request.headers.authorization.slice(6), 'base64').toString() : '';
    const [username, password] = basic.split(':');
    if (!['alice', 'bob'].includes(username) || password !== 'fixture-pass') {
      if (basic) this.failedAuth++;
      response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Mock Desktop"' });
      response.end('Authentication required');
      return;
    }
    if (request.url === '/events') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      response.write('data: ready\n\n');
      this.streams++;
      request.on('close', () => this.streams--);
      return;
    }
    if (request.url === '/redirect') {
      response.writeHead(302, { Location: `${this.foreignOrigin}/foreign` });
      response.end();
      return;
    }
    if (request.url === '/download') {
      response.writeHead(200, { 'Content-Disposition': 'attachment; filename="desktop-demo.txt"', 'Content-Type': 'text/plain' });
      response.end('Mock desktop download');
      return;
    }
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(`<!doctype html><html lang="zh-CN"><head><title>模拟桌面 · ${username}</title>
      <style>body{background:#172432;color:#ddeaf3;font:16px system-ui;padding:32px}input{font:24px system-ui;padding:10px;width:80%}button,a{margin:12px;padding:8px;color:#36d5c0}#target{position:absolute;right:50px;bottom:50px;width:120px;height:80px;background:#176659}</style>
      </head><body><h1>本地模拟桌面 · ${username}</h1><p>此页面只测试客户端行为，不代表 Selkies 流媒体验收。</p>
      <p id="isolation"></p><input aria-label="远端输入" placeholder="中文输入与键盘测试"><p id="key"></p>
      <button id="settings">切换 DPI 设置</button><button id="copy">写入剪贴板</button><button id="paste">读取剪贴板</button><p id="clip"></p>
      <a href="/download">下载文件</a><input type="file" aria-label="上传文件"><a href="/redirect">跨源跳转</a>
      <a href="https://example.com" target="_blank">新窗口</a><button id="target">坐标测试</button><p id="point"></p>
      <script>
      // What the page finds in its storage when its own script starts, the way the Selkies client reads its picks.
      window.videoAtStart = Object.fromEntries(Object.keys(localStorage).filter(key => /_(encoder|framerate|rate_control_mode|rate_control_mode_explicit_choice|video_bitrate)$/.test(key)).map(key => [key, localStorage.getItem(key)]));
      const previous = localStorage.getItem('account'); document.querySelector('#isolation').textContent = 'previous=' + previous + '; cookie=' + document.cookie;
      localStorage.setItem('account', '${username}'); document.cookie='account=${username}; SameSite=Lax; Max-Age=86400';
      window.stream = new EventSource('/events');
      window.socket = new WebSocket(location.origin.replace('http','ws')+'/socket');
      document.querySelector('input').addEventListener('keydown',event=>document.querySelector('#key').textContent=event.key);
      document.querySelector('#settings').onclick=()=>localStorage.setItem('dpi','${username === 'alice' ? '2' : '1'}');
      document.querySelector('#copy').onclick=async()=>{try{await navigator.clipboard.writeText('模拟剪贴板 中文');document.querySelector('#clip').textContent='copied'}catch{document.querySelector('#clip').textContent='denied'}};
      document.querySelector('#paste').onclick=async()=>{try{document.querySelector('#clip').textContent=await navigator.clipboard.readText()}catch{document.querySelector('#clip').textContent='denied'}};
      document.querySelector('#target').onclick=event=>document.querySelector('#point').textContent=event.offsetX+','+event.offsetY;
      ${this.foreignOrigin ? `fetch('${this.foreignOrigin}/foreign', {credentials:'include',headers:{Authorization:'Basic '+btoa('alice:fixture-pass')}});` : ''}
      </script></body></html>`);
  }
}

export function certificate(directory: string, name: string) {
  const key = join(directory, `${name}.key`);
  const cert = join(directory, `${name}.crt`);
  execFileSync(process.platform === 'darwin' ? '/usr/bin/openssl' : 'openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', `/CN=${name}`, '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' });
  return { key: readFileSync(key), cert: readFileSync(cert) };
}
