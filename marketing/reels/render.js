const { chromium } = require('playwright');
const { spawn } = require('child_process');
const [,, html, out, fps = 30, only] = process.argv;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + html); await p.evaluate(() => document.fonts.ready);
  const dur = await p.evaluate(() => window.DURATION);
  if (only) { for (const t of only.split(',')) { await p.evaluate(t => seek(t), +t); await p.screenshot({ path: `${out}-${t}.png` }); } await b.close(); return; }
  const ff = spawn('ffmpeg', ['-y','-f','image2pipe','-framerate',String(fps),'-i','-','-c:v','libx264','-pix_fmt','yuv420p','-crf','18','-preset','medium','-movflags','+faststart',out], { stdio: ['pipe','ignore','inherit'] });
  const n = Math.round(dur * fps);
  for (let i = 0; i < n; i++) { await p.evaluate(t => seek(t), i / fps); ff.stdin.write(await p.screenshot({ type: 'png' })); }
  ff.stdin.end(); await new Promise(r => ff.on('close', r)); await b.close();
})();
