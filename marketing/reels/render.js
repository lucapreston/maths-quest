// Render a reel page to MP4 (or PNG stills) by seeking it frame by frame in headless Chromium.
// usage: node render.js <reel.html> <out.mp4|out-prefix> [fps=30] [stills: t1,t2,... | --audio]
// A page may set window.SFX = [[time, sound, gain?], ...] (sounds in sfx.js); they are mixed into the MP4.
// --audio re-mixes the sound onto an existing <out.mp4> without re-rendering the video.
// Pages are served over a local HTTP server (rooted at this folder) so images can be used as WebGL
// textures; file:// would taint the canvas.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os');
const sfx = require('./sfx');
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
  const events = await p.evaluate(() => window.SFX || null);
  const wav = events && path.join(os.tmpdir(), `reel-sfx-${process.pid}.wav`);
  if (wav) fs.writeFileSync(wav, sfx.mix(events, dur));
  const audioArgs = wav ? ['-i', wav, '-map', '0:v', '-map', '1:a', '-c:a', 'aac', '-b:a', '160k', '-shortest'] : [];
  if (only === '--audio') {
    if (!wav) throw new Error('page has no window.SFX');
    const tmp = out.replace(/\.mp4$/, '.tmp.mp4');
    await new Promise((r, j) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', out, ...audioArgs, '-c:v', 'copy', '-movflags', '+faststart', tmp], { stdio: 'inherit' })
      .on('close', c => c ? j(new Error('ffmpeg failed')) : r()));
    fs.renameSync(tmp, out);
  } else if (only) {
    for (const t of only.split(',')) { await p.evaluate(t => seek(t), +t); await p.screenshot({ path: `${out}-${t}.png` }); }
  } else {
    const ff = spawn('ffmpeg', ['-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', ...audioArgs, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'medium', '-movflags', '+faststart', out], { stdio: ['pipe', 'ignore', 'inherit'] });
    const n = Math.round(dur * fps);
    for (let i = 0; i < n; i++) { await p.evaluate(t => seek(t), i / fps); ff.stdin.write(await p.screenshot({ type: 'png' })); }
    ff.stdin.end(); await new Promise(r => ff.on('close', r));
  }
  if (wav) fs.unlinkSync(wav);
  await b.close(); server.close();
})();
