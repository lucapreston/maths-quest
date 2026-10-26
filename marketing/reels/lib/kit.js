// Reel kit: shared 3D stage + overlay helpers for Maths Quest reels.
// Everything is a pure function of time `t` so frames render deterministically (window.seek(t)).
(function () {
  const W = 1080, H = 1920;
  const C = {
    gold: 0xe8b84a, navy: 0x1b2238, ink: 0xf5f6fa, neg: 0xff2d55, pos: 0x14d672, paper: 0xeef0f5,
    css: { gold: "#ffd23f", neg: "#ff6b86", pos: "#4ff0a0", ink: "#f5f6fa", dim: "#8a90a6" },
  };

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
    html,body{margin:0;width:${W}px;height:${H}px;overflow:hidden;background:radial-gradient(ellipse 80% 55% at 50% 38%,#17213a 0%,#0b1120 55%,#05070d 100%);}
    body{font-family:"Inter Display",Inter,sans-serif;color:${C.css.ink};position:relative}
    canvas#gl{position:absolute;inset:0}
    #ov{position:absolute;inset:0;pointer-events:none}
    .brand{position:absolute;left:64px;top:96px;font:700 26px Inter;letter-spacing:5px;color:#c9cede;display:flex;align-items:center;gap:14px;opacity:.85}
    .brand i{width:30px;height:30px;border-radius:50%;background:radial-gradient(circle,#ffe58a,#e8b84a 60%,#8a6a1f);box-shadow:0 0 18px #e8b84a88}
    .bar{position:absolute;left:64px;right:64px;top:52px;height:7px;border-radius:9px;background:#ffffff26}
    .bar b{display:block;height:100%;border-radius:9px;background:#fff}
    .cap{position:absolute;left:60px;right:60px;text-align:center;font-weight:700;font-size:72px;line-height:1.12;letter-spacing:-1px;text-shadow:0 6px 30px #000a}
    .cap .w{display:inline-block;white-space:pre}
    .cap .box{background:rgba(6,8,15,.82);padding:8px 26px;border-radius:26px;-webkit-box-decoration-break:clone;box-decoration-break:clone;line-height:1.4}
    .ring{position:absolute;border-radius:50%;border:7px solid ${C.css.gold};box-shadow:0 0 30px #ffd23f66, inset 0 0 30px #ffd23f33}
    .btn{position:absolute;left:150px;right:150px;height:140px;border-radius:999px;background:${C.css.gold};color:#11131a;font:900 54px "Inter Display";
      display:flex;align-items:center;justify-content:center;letter-spacing:-1px;box-shadow:0 20px 60px #ffd23f40}
    .gold{color:${C.css.gold}}.neg{color:${C.css.neg}}.pos{color:${C.css.pos}}.dim{color:${C.css.dim}}`;

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
      ctx.clearRect(0, 0, pw, ph); fn(ctx, pw, ph); tex.needsUpdate = true;
    };
    tex.redraw(draw, "init");
    return tex;
  }
  // a flat textured plane (labels, paper faces, screens)
  function plane(w, h, pw, ph, draw, opts = {}) {
    const tex = canvasTex(pw, ph, draw);
    const mat = opts.lit
      ? new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.85, metalness: 0 })
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
    g.center(); g.computeVertexNormals(); return g;
  }
  const mats = {
    gold: () => new THREE.MeshStandardMaterial({ color: C.gold, metalness: 0.9, roughness: 0.28 }),
    navy: () => new THREE.MeshStandardMaterial({ color: C.navy, metalness: 0.3, roughness: 0.45 }),
    paper: () => new THREE.MeshStandardMaterial({ color: C.paper, metalness: 0, roughness: 0.9 }),
    glossy: c => new THREE.MeshStandardMaterial({ color: c, metalness: 0.1, roughness: 0.32, emissive: c, emissiveIntensity: 0.06, envMapIntensity: 0.55 }),
  };

  // a phone whose screen is a redrawable canvas (screen draw fn gets ctx, w, h, state)
  function phone(drawScreen) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(roundedBox(3.3, 6.8, 0.36, 0.16), new THREE.MeshStandardMaterial({ color: 0x0e121c, metalness: 0.6, roughness: 0.3 }));
    const rim = new THREE.Mesh(roundedBox(3.38, 6.88, 0.3, 0.16), mats.gold());
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
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, W / H, 0.1, 200);
    // shift the frame so subjects sit in the upper-middle, leaving room for captions below
    camera.setViewOffset(W, H, 0, opts.lift ?? 280, W, H);

    // studio environment for metal reflections
    const env = new THREE.Scene();
    const box = (w, h, x, y, z, col, ry = 0, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); env.add(m); };
    box(30, 30, 0, 0, -20, 0x05070d); box(10, 4, 0, 9, 0, 0xffffff, 0, Math.PI / 2); box(6, 10, -10, 2, 2, 0xffe2a8, Math.PI / 2); box(6, 10, 10, 1, -2, 0x6f86c9, -Math.PI / 2); box(14, 6, 0, -2, 12, 0x2a3350);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(env, 0.04).texture;

    scene.add(new THREE.HemisphereLight(0xb8c6ff, 0x0b0d14, 0.5));
    const key = new THREE.DirectionalLight(0xfff1d6, 1.6); key.position.set(4, 7, 6); scene.add(key);
    const rimL = new THREE.PointLight(0xffd27a, 2.2, 30); rimL.position.set(-5, 3, -4); scene.add(rimL);

    // soft gold glow behind subjects
    const glowTex = canvasTex(256, 256, (c, w, h) => { const g = c.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, "rgba(255,200,90,0.55)"); g.addColorStop(1, "rgba(255,200,90,0)"); c.fillStyle = g; c.fillRect(0, 0, w, h); });
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.22 }));
    glow.scale.set(13, 13, 1); scene.add(glow);

    // drifting dust particles
    const R = rng(7), N = 160, base = [];
    const pg = new THREE.BufferGeometry(), pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) base.push([(R() - 0.5) * 30, (R() - 0.5) * 30, -4 - R() * 18, R() * 6.28]);
    pg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const dotTex = canvasTex(64, 64, (c) => { const g = c.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(1, "rgba(255,255,255,0)"); c.fillStyle = g; c.fillRect(0, 0, 64, 64); });
    const pts = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.14, map: dotTex, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xcfd8ff }));
    scene.add(pts);

    // overlay
    const ov = el("div", null, document.body); ov.id = "ov";
    const style = el("style", null, document.head); style.textContent = css;
    el("div", "brand", ov, `<i></i>MATHS QUEST`);
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
      pts.material.opacity = 0.4 + 0.15 * Math.sin(t * 2);
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
    const api = { scene, camera, renderer, ov, ring, camPath, project, glow, onFrame: fn => { update = fn; } };
    api.start = () => {
      if (!navigator.webdriver) { const t0 = performance.now(); (function loop() { render(((performance.now() - t0) / 1000) % duration); requestAnimationFrame(loop); })(); }
      else render(0);
    };
    return api;
  }

  // phone quiz screen. q = {pills, question: [lines], options: [{text} | {frac:[num,den]}], why: [lines]}
  // state = {wrong, right, xp, why}
  function quiz(q) {
    const X = 60, OY = q.optionsTop ?? 600, OH = 200, GAP = 30;
    const optY = i => OY + i * (OH + GAP);
    function draw(c, w, h, s = {}) {
      c.fillStyle = "#121624"; roundRect(c, 0, 0, w, h, 96); c.fill();
      c.fillStyle = "#8a90a6"; c.font = "600 34px Inter"; c.fillText("9:41", 90, 84);
      c.font = '900 56px "Inter Display"'; c.fillStyle = "#f5f6fa"; c.fillText("Maths", X, 210);
      c.fillStyle = "#ffd23f"; c.fillText("Quest", X + c.measureText("Maths ").width, 210);
      if (s.xp) { c.textAlign = "right"; c.font = "800 44px Inter"; c.fillText("+20 XP", w - X, 206); c.textAlign = "left"; }
      let px = X; c.font = "600 30px Inter";
      q.pills.forEach(p => { const pw = c.measureText(p).width + 44; c.fillStyle = "#22283a"; roundRect(c, px, 260, pw, 58, 29); c.fill(); c.fillStyle = "#9aa0b6"; c.fillText(p, px + 22, 300); px += pw + 14; });
      c.fillStyle = "#f5f6fa"; c.font = "700 50px Inter";
      q.question.forEach((l, i) => c.fillText(l, X, 410 + i * 66));
      q.options.forEach((o, i) => {
        const y = optY(i), wrong = s.wrong === i, right = s.right === i;
        c.fillStyle = wrong ? "rgba(255,92,122,.14)" : right ? "rgba(62,224,143,.14)" : "#171c2b";
        roundRect(c, X, y, w - 2 * X, OH, 40); c.fill();
        c.lineWidth = 6; c.strokeStyle = wrong ? "#ff5c7a" : right ? "#3ee08f" : "#2a3043"; c.stroke();
        c.fillStyle = "#f5f6fa"; c.font = '700 66px "JetBrains Mono"';
        if (o.frac) frac(c, o.frac[0], o.frac[1], X + 50, y + OH / 2 + 10, 72);
        else c.fillText(o.text, X + 50, y + OH / 2 + 24);
        if (wrong || right) { c.font = "900 64px Inter"; c.fillStyle = wrong ? "#ff5c7a" : "#3ee08f"; c.textAlign = "right"; c.fillText(wrong ? "✗" : "✓", w - X - 50, y + OH / 2 + 22); c.textAlign = "left"; }
      });
      if (s.why && q.why) {
        const y = optY(q.options.length) + 20;
        c.fillStyle = "rgba(255,92,122,.14)"; roundRect(c, X, y, w - 2 * X, 70 + q.why.length * 54, 36); c.fill();
        c.strokeStyle = "#ff5c7a"; c.lineWidth = 4; c.stroke();
        c.font = "600 40px Inter";
        q.why.forEach((l, i) => { c.fillStyle = i ? "#f5f6fa" : "#ff6b86"; c.fillText(l, X + 40, y + 76 + i * 54); });
      }
      const done = s.right >= 0;
      c.fillStyle = done ? "#ffd23f" : "#22283a"; roundRect(c, X, h - 250, w - 2 * X, 150, 75); c.fill();
      c.fillStyle = done ? "#11131a" : "#6b7189"; c.font = '900 52px "Inter Display"'; c.textAlign = "center";
      c.fillText(done ? "Next question →" : "Check answer", w / 2, h - 158); c.textAlign = "left";
    }
    // centre of option i in canvas pixels
    return { draw, optionCenter: i => [459, optY(i) + OH / 2], markPoint: i => [918 - X - 80, optY(i) + OH / 2] };
  }
  // convert a phone-screen canvas point to a world position
  function screenPoint(ph, cx, cy) {
    const v = new THREE.Vector3((cx / 918 - 0.5) * 3.06, (0.5 - cy / 1968) * 6.56, 0.2);
    ph.updateWorldMatrix(true, false); return ph.localToWorld(v).toArray();
  }

  window.Kit = { W, H, C, clamp, prog, smooth, outCubic, outBack, lerp, lerp3, rng, el, canvasTex, plane, frac, roundRect, roundedBox, mats, phone, quiz, screenPoint, stage };
})();
