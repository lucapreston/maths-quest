// Render a reel page to MP4 (or PNG stills) by seeking it frame by frame in headless Chromium.
// usage: node render.js <reel.html> <out.mp4|out-prefix> [fps=30] [stills: t1,t2,...]
// Pages are served over a local HTTP server (rooted at this folder) so images can be used as WebGL
// textures; file:// would taint the canvas.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path');
const [,, html, out, fps = 30, only] = process.argv;

const ROOT = __dirname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png', '.ttf': 'font/ttf', '.json': 'application/json' };
function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

(async () => {
  const server = await serve();
  const url = `http://127.0.0.1:${server.address().port}/${path.relative(ROOT, path.resolve(html)).split(path.sep).join('/')}`;
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  p.on('pageerror', e => console.error('page error:', e.message));
  await p.goto(url); await p.evaluate(() => document.fonts.ready);
  // pages that load assets set READY=false until they are ready to draw
  await p.waitForFunction(() => window.READY !== false, null, { timeout: 60000 });
  const dur = await p.evaluate(() => window.DURATION);
  if (only) {
    for (const t of only.split(',')) { await p.evaluate(t => seek(t), +t); await p.screenshot({ path: `${out}-${t}.png` }); }
  } else {
    const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'inherit'] });
    const n = Math.round(dur * fps);
    for (let i = 0; i < n; i++) { await p.evaluate(t => seek(t), i / fps); ff.stdin.write(await p.screenshot({ type: 'png' })); }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
  }
  await b.close(); server.close();
})();
