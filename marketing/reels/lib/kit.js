// Reel kit: shared 3D stage + overlay helpers for Maths Quest reels.
// Everything is a pure function of time `t` so frames render deterministically (window.seek(t)).
(function () {
  const W = 1080, H = 1920;
  // Maths Quest brand palette (sampled from the app)
  const C = {
    bg: 0xecba4f, ink: 0x141414, navy: 0x172775, red: 0xd2392b, green: 0x2e8b3d, cream: 0xf1f0ea, white: 0xffffff,
    css: { bg: "#ecba4f", ink: "#141414", navy: "#172775", red: "#d2392b", green: "#2e8b3d", cream: "#f1f0ea", dim: "rgba(20,20,20,.62)" },
  };
  // hex colours are sRGB, as in the app
  THREE.ColorManagement.legacyMode = false;

  // ---------- easing / timing ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const smooth = x => x * x * x * (x * (x * 6 - 15) + 10);
  const outCubic = x => 1 - Math.pow(1 - x, 3);
  const outBack = x => { const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const lerp = (a, b, p) => a + (b - a) * p;
  const lerp3 = (a, b, p) => [lerp(a[0], b[0], p), lerp(a[1], b[1], p), lerp(a[2], b[2], p)];
  function rng(seed) { return () => { seed |= 0; seed = seed + 0x6d2b79f5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; }; }

  // ---------- DOM overlay ----------
  const css = `
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(ellipse 85% 60% at 50% 38%,#f6cf75 0%,${C.css.bg} 55%,#d9a240 100%);}
    body{font-family:Bricolage,"Inter Display",sans-serif;color:${C.css.ink};position:relative}
    canvas#gl{position:absolute;inset:0}
    #ov{position:absolute;inset:0;pointer-events:none}
    .brand{position:absolute;left:56px;top:82px;font:800 34px Bricolage;letter-spacing:-0.5px;color:${C.css.ink};display:flex;align-items:center;gap:12px}
    .brand img{width:76px;height:76px}
    .bar{position:absolute;left:64px;right:64px;top:46px;height:16px;border-radius:9px;background:${C.css.cream};border:4px solid ${C.css.ink};box-sizing:border-box;overflow:hidden}
    .bar b{display:block;height:100%;background:${C.css.navy}}
    .cap{position:absolute;left:56px;right:56px;text-align:center;font-weight:800;font-size:76px;line-height:1.1;letter-spacing:-1.5px}
    .cap .w{display:inline-block;white-space:pre}
    .cap .box{background:${C.css.cream};border:5px solid ${C.css.ink};padding:4px 26px;border-radius:30px;box-shadow:0 8px 0 ${C.css.ink};-webkit-box-decoration-break:clone;box-decoration-break:clone;line-height:1.45}
    .ring{position:absolute;border-radius:50%;border:10px solid ${C.css.red};box-shadow:0 0 0 4px ${C.css.ink}, inset 0 0 0 4px ${C.css.ink}}
    .btn{position:absolute;left:150px;right:150px;height:140px;border-radius:999px;background:${C.css.navy};color:#fff;font:800 56px Bricolage;border:6px solid ${C.css.ink};
      display:flex;align-items:center;justify-content:center;letter-spacing:-1px;box-shadow:0 12px 0 ${C.css.ink}}
    .gold{color:${C.css.navy}}.neg{color:${C.css.red}}.pos{color:${C.css.green}}.dim{color:${C.css.dim}}`;

  function el(tag, cls, parent, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; parent.appendChild(e); return e; }

  // ---------- canvas textures ----------
  function canvasTex(pw, ph, draw) {
    const cv = document.createElement("canvas"); cv.width = pw; cv.height = ph;
    const ctx = cv.getContext("2d");
    const tex = new THREE.CanvasTexture(cv);
    tex.encoding = THREE.sRGBEncoding; tex.anisotropy = 8;
    let last = null;
    tex.redraw = (fn = draw, key) => {
      if (key !== undefined && key === last) return; last = key;
      ctx.clearRect(0, 0, pw, ph); ctx.save(); fn(ctx, pw, ph); ctx.restore(); tex.needsUpdate = true;
    };
    tex.redraw(draw, "init");
    return tex;
  }
  // a flat textured plane (labels, paper faces, screens)
  function plane(w, h, pw, ph, draw, opts = {}) {
    const tex = canvasTex(pw, ph, draw);
    const mat = opts.lit
      ? new THREE.MeshToonMaterial({ map: tex, transparent: true, gradientMap: toonRamp() })
      : new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.tex = tex; return m;
  }
  // stacked fraction drawn on a 2D canvas, centred vertically on y
  function frac(ctx, num, den, x, y, size) {
    ctx.save(); ctx.font = ctx.font.replace(/\d+px/, Math.round(size * 0.8) + "px");
    const w = Math.max(ctx.measureText(num).width, ctx.measureText(den).width) + size * 0.3;
    ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
    ctx.fillText(num, x + w / 2, y - size * 0.18);
    ctx.fillText(den, x + w / 2, y + size * 0.68);
    ctx.fillRect(x, y - size * 0.06, w, Math.max(3, size * 0.07));
    ctx.restore(); return w;
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

  // ---------- geometry ----------
  function roundedBox(w, h, d, r = 0.1) {
    const s = new THREE.Shape(), x = -w / 2 + r, y = -h / 2 + r, iw = w - 2 * r, ih = h - 2 * r, rr = Math.min(r, iw / 2, ih / 2) * 0.999;
    s.moveTo(x, y + rr); s.lineTo(x, y + ih - rr); s.quadraticCurveTo(x, y + ih, x + rr, y + ih);
    s.lineTo(x + iw - rr, y + ih); s.quadraticCurveTo(x + iw, y + ih, x + iw, y + ih - rr);
    s.lineTo(x + iw, y + rr); s.quadraticCurveTo(x + iw, y, x + iw - rr, y); s.lineTo(x + rr, y); s.quadraticCurveTo(x, y, x, y + rr);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, d - 2 * r), bevelEnabled: true, bevelSize: r, bevelThickness: r, bevelSegments: 5, curveSegments: 10 });
    g.center(); g.computeVertexNormals(); g.userData.box = [w, h, d, r]; return g;
  }
  // flat cartoon shading to match the app's illustration style
  let ramp;
  function toonRamp() {
    if (!ramp) { ramp = new THREE.DataTexture(new Uint8Array([120, 200, 255]), 3, 1, THREE.RedFormat); ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true; }
    return ramp;
  }
  const toon = c => new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp() });
  const mats = { toon, ink: () => toon(C.ink), navy: () => toon(C.navy), red: () => toon(C.red), green: () => toon(C.green), cream: () => toon(C.cream), white: () => toon(C.white) };
  // thick ink outline (inverted hull pushed out along normals), like the app's outlined shapes
  const outlineMats = {};
  let hullMat;
  function outline(mesh, w = 0.035) {
    // rounded boxes get an exact, even outline: a slightly bigger rounded box drawn inside-out
    const box = mesh.geometry.userData.box;
    if (box) {
      hullMat = hullMat || new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });
      const [bw, bh, bd, br] = box;
      mesh.add(new THREE.Mesh(roundedBox(bw + 2 * w, bh + 2 * w, bd + 2 * w, br + w), hullMat));
      return mesh;
    }
    if (!outlineMats[w]) {
      const m = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });
      m.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `vec3 transformed = position + normalize(normal) * ${w.toFixed(4)};`); };
      outlineMats[w] = m;
    }
    mesh.add(new THREE.Mesh(mesh.geometry, outlineMats[w]));
    return mesh;
  }

  // a phone whose screen is a redrawable canvas (screen draw fn gets ctx, w, h, state)
  function phone(drawScreen) {
    const g = new THREE.Group();
    const body = outline(new THREE.Mesh(roundedBox(3.3, 6.8, 0.36, 0.16), mats.ink()), 0.05);
    const rim = new THREE.Mesh(roundedBox(3.38, 6.88, 0.3, 0.16), mats.ink());
    const screen = plane(3.06, 6.56, 918, 1968, (c, w, h) => drawScreen(c, w, h, {}));
    screen.position.z = 0.19;
    g.add(rim, body, screen);
    g.screen = screen;
    return g;
  }

  // ---------- stage ----------
  function stage(opts = {}) {
    const duration = opts.duration;
    const canvas = el("canvas", null, document.body); canvas.id = "gl";
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(W, H, false);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 200);
    // shift the frame so subjects sit in the upper-middle, leaving room for captions below
    camera.setViewOffset(W, H, 0, opts.lift ?? 280, W, H);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 0.45); key.position.set(4, 7, 6); scene.add(key);

    // soft cream glow behind subjects
    const glowTex = canvasTex(256, 256, (c, w, h) => { const g = c.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, "rgba(255,246,220,0.6)"); g.addColorStop(1, "rgba(255,246,220,0)"); c.fillStyle = g; c.fillRect(0, 0, w, h); });
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, depthWrite: false, transparent: true, opacity: 0.5 }));
    glow.scale.set(13, 13, 1); scene.add(glow);

    // drifting four-point sparkles, like the ones around the app's Start button
    const R = rng(7), N = 70, base = [];
    const pg = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) base.push([(R() - 0.5) * 30, (R() - 0.5) * 30, -4 - R() * 18, R() * 6.28]);
    pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sparkTex = canvasTex(64, 64, (c) => {
      c.fillStyle = "#fffaf0"; c.beginPath(); c.moveTo(32, 2);
      [[38, 26], [62, 32], [38, 38], [32, 62], [26, 38], [2, 32], [26, 26]].forEach(([x, y]) => c.lineTo(x, y)); c.closePath(); c.fill();
    });
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.42, map: sparkTex, transparent: true, opacity: 0.85, depthWrite: false }));
    scene.add(pts);

    // overlay
    const ov = el("div", null, document.body); ov.id = "ov";
    const style = el("style", null, document.head); style.textContent = css;
    el("div", "brand", ov, `<img src="${opts.base ?? "../lib/"}assets/mascot.png">Maths Quest`);
    const barFill = el("b", null, el("div", "bar", ov));

    // captions: [start, end, html, top?]. Words pop in one after another.
    const capEls = (opts.captions || []).map(([a, b, html, top]) => {
      const e = el("div", "cap", ov);
      e.style.top = (top ?? 1320) + "px";
      const words = html.replace(/(<[^>]+>)|([^<\s]+)/g, (m, tag, word) => tag ? tag : `<span class="w">${word}</span>`);
      // captionBox: dark backing for captions that sit over bright objects
      e.innerHTML = opts.captionBox ? `<span class="box">${words}</span>` : words;
      return { a, b, e, words: [...e.querySelectorAll(".w")] };
    });
    function drawCaptions(t) {
      capEls.forEach(({ a, b, e, words }) => {
        const vis = t >= a - 0.01 && t < b;
        e.style.display = vis ? "block" : "none";
        if (!vis) return;
        e.style.opacity = Math.min(prog(t, a, a + 0.12), 1 - prog(t, b - 0.18, b));
        words.forEach((w, i) => {
          const p = prog(t, a + i * 0.07, a + i * 0.07 + 0.22);
          w.style.opacity = p; w.style.transform = `translateY(${(1 - outBack(p)) * 24}px)`;
        });
      });
    }

    // highlight rings that track a world point
    const rings = [];
    function ring(at, until, getPoint, radius = 150) { const e = el("div", "ring", ov); rings.push({ at, until, getPoint, radius, e }); }
    const v = new THREE.Vector3();
    function project(p) { v.set(p[0], p[1], p[2]).project(camera); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; }
    function drawRings(t) {
      camera.updateMatrixWorld();
      rings.forEach(r => {
        const on = t >= r.at && t < r.until;
        r.e.style.display = on ? "block" : "none"; if (!on) return;
        const p = outBack(prog(t, r.at, r.at + 0.35)), out = prog(t, r.until - 0.25, r.until);
        const [x, y] = project(r.getPoint(t)); const rad = r.radius * (0.4 + 0.6 * p) * (1 + out * 0.2);
        Object.assign(r.e.style, { left: x - rad + "px", top: y - rad + "px", width: rad * 2 + "px", height: rad * 2 + "px", opacity: Math.min(prog(t, r.at, r.at + 0.2), 1 - out) });
      });
    }

    // camera path: keys [{t, pos, look, dur?}] — arrive at each pose at time t, moving over the
    // `dur` seconds before it (default: the whole gap since the previous key). Slight float on top.
    function camPath(t, keys) {
      let pos = keys[0].pos, look = keys[0].look;
      for (let k = 1; k < keys.length; k++) {
        const A = keys[k - 1], B = keys[k], start = B.t - (B.dur ?? B.t - A.t);
        if (t < start) break;
        const p = smooth(prog(t, start, B.t));
        pos = lerp3(A.pos, B.pos, p); look = lerp3(A.look, B.look, p);
      }
      camera.position.set(pos[0] + Math.sin(t * 0.7) * 0.06, pos[1] + Math.sin(t * 0.9) * 0.05, pos[2]);
      camera.lookAt(look[0], look[1], look[2]);
    }

    let update = () => {};
    function render(t) {
      for (let i = 0; i < N; i++) { const b = base[i]; pos[i * 3] = b[0] + Math.sin(t * 0.2 + b[3]) * 0.6; pos[i * 3 + 1] = ((b[1] + 15 + t * 0.25) % 30) - 15; pos[i * 3 + 2] = b[2]; }
      pg.attributes.position.needsUpdate = true;
      pts.material.opacity = 0.7 + 0.2 * Math.sin(t * 2);
      barFill.style.width = clamp(t / duration) * 100 + "%";
      update(t);
      // dust and glow travel with the camera so every shot sits in the same atmosphere
      pts.position.copy(camera.position);
      glow.position.set(camera.position.x, camera.position.y - 0.4, camera.position.z - 16);
      drawCaptions(t); drawRings(t);
      renderer.render(scene, camera);
    }
    window.DURATION = duration;
    window.seek = t => render(t);
    window.READY = false;
    // redraw every canvas texture (e.g. once brand fonts have loaded)
    const refreshTextures = () => scene.traverse(o => o.tex && o.tex.redraw(undefined, "refresh"));
    const api = { scene, camera, renderer, ov, ring, camPath, project, glow, refreshTextures, onFrame: fn => { update = fn; } };
    api.start = () => {
      if (!navigator.webdriver) { const t0 = performance.now(); (function loop() { render(((performance.now() - t0) / 1000) % duration); requestAnimationFrame(loop); })(); }
      else render(0);
      window.READY = true;
    };
    return api;
  }

  // ---------- Maths Quest app screens ----------
  // Recreates the real app's question screen (mustard background, cream cards with thick ink outlines
  // and offset shadows). Layout is in the app screenshot's 919×1999 space, scaled onto the phone canvas.
  const MQ = { bg: "#ecba4f", cream: "#f1f0ea", white: "#ffffff", ink: "#141414", navy: "#172775", red: "#d2392b",
    redFill: "#f8d9d3", green: "#2e8b3d", greenFill: "#dcefd8", grey: "#5e5a50" };
  const SX = 918 / 919 * 0.985, SY = 1968 / 1999, OX = (918 - 919 * SX) / 2;
  const toCanvas = (x, y) => [OX + x * SX, y * SY];
  const SANS = 'Bricolage', SERIF = 'Caladea';
  function font(c, weight, size, family = SANS, stretch = "normal") { c.font = `${weight} ${size}px ${family}`; c.fontStretch = stretch; }
  function card(c, x, y, w, h, r, fill, opts = {}) {
    const lw = opts.lw ?? 5, sh = opts.shadow ?? 9;
    if (sh) { c.fillStyle = MQ.ink; roundRect(c, x, y + sh, w, h, r); c.fill(); }
    c.fillStyle = fill; roundRect(c, x, y, w, h, r); c.fill();
    c.lineWidth = lw; c.strokeStyle = opts.stroke ?? MQ.ink; c.stroke();
  }
  function statusBar(c, island) {
    font(c, 700, 36, "Inter"); c.fillStyle = MQ.ink; c.fillText("9:41", 108, 88);
    if (island) { c.fillStyle = "#000"; roundRect(c, 318, 32, 284, 82, 41); c.fill(); }
    c.fillStyle = MQ.ink; [0, 1, 2, 3].forEach(k => { roundRect(c, 658 + k * 13, 80 - (k + 1) * 7, 9, (k + 1) * 7, 2); c.fill(); });
    roundRect(c, 775, 60, 54, 28, 9); c.fill(); c.fillStyle = MQ.bg; font(c, 800, 20, "Inter"); c.fillText("80", 787, 81);
  }
  // inline run of [text, "sans"|"serif"] parts
  function runs(c, parts, x, y, size) {
    parts.forEach(([t, f]) => { if (f === "serif") font(c, 400, size * 1.08, SERIF); else font(c, 700, size); c.fillStyle = MQ.ink; c.fillText(t, x, y); x += c.measureText(t).width; });
  }
  // q = {title, step, question: [lines of [text, "sans"|"serif"] runs], options: [{text}|{frac:[n,d]}], why: [heading, line], good: [heading, line]}
  // s = {wrong, right, why, good, tap: {i, p}}
  function mqQuestion(q) {
    const OY = 734, OH = 118, OG = 140, n = q.options.length;
    function draw(c, w, h, s = {}) {
      c.save(); c.fillStyle = MQ.bg; c.fillRect(0, 0, w, h);
      c.translate(OX, 0); c.scale(SX, SY);
      statusBar(c, true);
      card(c, 37, 162, 104, 104, 52, MQ.cream, { shadow: 7 });
      c.strokeStyle = MQ.ink; c.lineWidth = 9; c.lineCap = "round"; c.beginPath(); c.moveTo(74, 199); c.lineTo(104, 229); c.moveTo(104, 199); c.lineTo(74, 229); c.stroke();
      font(c, 700, 46); c.fillStyle = MQ.ink; c.textAlign = "center"; c.fillText(q.title ?? "5 a day", 459, 232);
      card(c, 752, 184, 130, 64, 32, MQ.cream, { shadow: 5, lw: 4 }); font(c, 700, 30); c.fillStyle = MQ.ink; c.fillText(q.step ?? "1 of 5", 817, 227); c.textAlign = "left";
      for (let k = 0; k < 5; k++) card(c, 36 + k * 171.5, 308, 159, 40, 20, k === 0 ? MQ.navy : MQ.cream, { shadow: 6, lw: 4 });
      const cardH = OY + n * OG + 44 - 398;
      card(c, 36, 398, 846, cardH, 50, MQ.cream, { shadow: 10 });
      q.question.forEach((line, k) => runs(c, line, 76, 478 + k * 58, 42));
      font(c, 500, 28); c.fillStyle = MQ.grey; c.fillText("Report", 765, 554);
      c.strokeStyle = MQ.grey; c.lineWidth = 3; c.beginPath(); c.moveTo(724, 556); c.lineTo(724, 530); c.lineTo(744, 533); c.lineTo(740, 543); c.lineTo(744, 550); c.lineTo(724, 548); c.stroke();
      card(c, 72, 588, 774, 124, 40, MQ.cream, { shadow: 9 });
      c.strokeStyle = MQ.navy; c.lineWidth = 4; c.beginPath(); c.moveTo(114, 646); c.quadraticCurveTo(128, 632, 128, 645); c.quadraticCurveTo(116, 664, 132, 660); c.moveTo(140, 664); c.lineTo(158, 638); c.stroke();
      font(c, 700, 34); c.fillStyle = MQ.ink; c.fillText("Workings", 182, 664);
      c.strokeStyle = MQ.ink; c.lineWidth = 4; c.beginPath(); c.moveTo(672, 645); c.lineTo(685, 658); c.lineTo(698, 645); c.stroke();
      c.lineWidth = 4; c.beginPath(); c.arc(765, 652, 44, 0, 7); c.stroke();
      c.beginPath(); c.moveTo(750, 637); c.lineTo(780, 667); c.moveTo(750, 637); c.lineTo(750, 650); c.moveTo(750, 637); c.lineTo(763, 637); c.moveTo(780, 667); c.lineTo(780, 654); c.moveTo(780, 667); c.lineTo(767, 667); c.stroke();
      q.options.forEach((o, i) => {
        const y = OY + i * OG, wrong = s.wrong === i, right = s.right === i;
        card(c, 72, y, 774, OH, 40, wrong ? MQ.redFill : right ? MQ.greenFill : MQ.white, { shadow: 0, stroke: wrong ? MQ.red : right ? MQ.green : MQ.ink, lw: wrong || right ? 7 : 5 });
        c.fillStyle = MQ.ink;
        if (o.frac) { font(c, 400, 54, SERIF); frac(c, o.frac[0], o.frac[1], 108, y + OH / 2 + 6, 54); }
        else { font(c, 400, 40, "Inter"); c.fillText(o.text, 110, y + OH / 2 + 14); }
        if (wrong || right) { c.fillStyle = wrong ? MQ.red : MQ.green; c.beginPath(); c.arc(790, y + OH / 2, 26, 0, 7); c.fill();
          c.strokeStyle = "#fff"; c.lineWidth = 6; c.lineCap = "round"; c.beginPath();
          if (wrong) { c.moveTo(780, y + OH / 2 - 10); c.lineTo(800, y + OH / 2 + 10); c.moveTo(800, y + OH / 2 - 10); c.lineTo(780, y + OH / 2 + 10); }
          else { c.moveTo(778, y + OH / 2); c.lineTo(787, y + OH / 2 + 10); c.lineTo(803, y + OH / 2 - 10); }
          c.stroke(); }
      });
      // feedback card under the question card
      const fy = 398 + cardH + 40;
      const fb = s.good ? { col: MQ.green, fill: MQ.greenFill, lines: q.good } : s.why ? { col: MQ.red, fill: MQ.redFill, lines: q.why } : null;
      if (fb) {
        const a = s.fbIn ?? 1; c.globalAlpha = a; c.save(); c.translate(0, (1 - a) * 60);
        card(c, 36, fy, 846, 300, 44, MQ.cream, { shadow: 10 });
        c.fillStyle = fb.col; c.beginPath(); c.arc(100, fy + 74, 30, 0, 7); c.fill();
        font(c, 800, 44); c.fillStyle = fb.col; c.fillText(fb.lines[0], 148, fy + 90);
        font(c, 500, 34); c.fillStyle = MQ.ink; c.fillText(fb.lines[1], 72, fy + 160);
        card(c, 72, fy + 196, 774, 76, 38, s.good ? MQ.navy : MQ.cream, { shadow: 6, lw: 4 });
        font(c, 700, 32); c.fillStyle = s.good ? "#fff" : MQ.ink; c.textAlign = "center";
        c.fillText(s.good ? "Next question →" : "Try again", 459, fy + 246); c.textAlign = "left";
        if (s.good) { card(c, 676, fy + 46, 170, 60, 30, MQ.bg, { shadow: 4, lw: 4 }); font(c, 800, 30); c.fillStyle = MQ.navy; c.fillText("+20 XP", 702, fy + 87); }
        c.restore(); c.globalAlpha = 1;
      }
      if (s.tap) { const [x, y] = s.tap.xy; c.fillStyle = `rgba(20,20,20,${0.25 * (1 - s.tap.p)})`; c.beginPath(); c.arc(x, y, 30 + s.tap.p * 50, 0, 7); c.fill(); }
      c.restore();
    }
    const optMid = i => OY + i * OG + OH / 2;
    return { draw, markPoint: i => toCanvas(790, optMid(i)), optionPoint: i => [459, optMid(i)] };
  }
  // Phone script: the real "5 a day" screenshot, tap Start, push to the question, tap wrong, tap right.
  // T = {start, push, wrong, right}; returns an update(t) that redraws the phone screen.
  function mqScript(ph, quiz, img, T) {
    const startXY = [459 * 918 / 919, 1150 * SY]; // Start button in the screenshot, drawn full-canvas
    return t => {
      const push = smooth(prog(t, T.push, T.push + 0.4));
      const tapAt = (at, xy) => t >= at && t < at + 0.4 ? { xy, p: prog(t, at, at + 0.4) } : null;
      const s = { wrong: t >= T.wrong ? 0 : -1, right: t >= T.right ? 1 : -1, why: t >= T.wrong + 0.25 && t < T.right, good: t >= T.right + 0.25,
        fbIn: outCubic(t >= T.right + 0.25 ? prog(t, T.right + 0.25, T.right + 0.55) : prog(t, T.wrong + 0.25, T.wrong + 0.55)),
        tap: tapAt(T.wrong, quiz.optionPoint(0)) || tapAt(T.right, quiz.optionPoint(1)) };
      const moving = push > 0 && push < 1, anim = moving || s.tap || (s.fbIn > 0 && s.fbIn < 1) || (t >= T.start && t < T.start + 0.4);
      ph.screen.tex.redraw((c, w, h) => {
        c.save(); roundRect(c, 0, 0, w, h, 96); c.clip();
        if (push < 1) {
          c.save(); c.translate(-push * w * 0.3, 0); c.drawImage(img, 0, 0, w, h);
          const tp = prog(t, T.start, T.start + 0.4);
          if (tp > 0 && tp < 1) { c.fillStyle = `rgba(255,255,255,${0.35 * (1 - tp)})`; c.beginPath(); c.arc(startXY[0], startXY[1], 40 + tp * 160, 0, 7); c.fill(); }
          c.fillStyle = `rgba(0,0,0,${push * 0.3})`; c.fillRect(0, 0, w, h); c.restore();
        }
        if (push > 0) { c.save(); c.translate((1 - push) * w, 0); quiz.draw(c, w, h, s); c.restore(); }
        c.restore();
      }, anim ? t.toFixed(3) : JSON.stringify([push > 0, s.wrong, s.right, s.why, s.good]));
    };
  }
  function loadImage(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
  async function loadBrand(base) {
    const ff = new FontFace("Bricolage", `url(${base}fonts/BricolageGrotesque.ttf)`, { weight: "200 800", stretch: "75% 100%" });
    document.fonts.add(await ff.load());
    return { fiveADay: await loadImage(`${base}assets/five-a-day.png`), startPoint: [459 * 918 / 919, 1150 * SY] };
  }

  // convert a phone-screen canvas point to a world position
  function screenPoint(ph, cx, cy) {
    const v = new THREE.Vector3((cx / 918 - 0.5) * 3.06, (0.5 - cy / 1968) * 6.56, 0.2);
    ph.updateWorldMatrix(true, false); return ph.localToWorld(v).toArray();
  }

  window.Kit = { W, H, C, clamp, prog, smooth, outCubic, outBack, lerp, lerp3, rng, el, canvasTex, plane, frac, roundRect, roundedBox, mats, outline, phone, mqQuestion, mqScript, loadBrand, screenPoint, stage };
})();
