// Alisio · vuelo fotorrealista: un único plano de vídeo que avanza con el scroll
(function () {
  var flight = document.getElementById('flight');
  var video = document.getElementById('flightVideo');
  var panels = [].slice.call(document.querySelectorAll('[data-from]'));
  var hudAlt = document.getElementById('hudAlt'), hudHdg = document.getElementById('hudHdg'), hudSpd = document.getElementById('hudSpd');
  var routeDot = document.getElementById('routeDot');

  function clamp(v, a, b) { return Math.min(b === undefined ? 1 : b, Math.max(a || 0, v)); }
  function smooth(a, b, v) { var t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); }
  function track(keys) {
    return function (p) {
      if (p <= keys[0][0]) return keys[0][1];
      for (var i = 0; i < keys.length - 1; i++) {
        var a = keys[i], b = keys[i + 1];
        if (p <= b[0]) return a[1] + (b[1] - a[1]) * smooth(a[0], b[0], p);
      }
      return keys[keys.length - 1][1];
    };
  }
  // Instrumentos de cabina (decorativos, siguen la historia del vuelo)
  var alt = track([[0, 2550], [0.25, 2900], [0.5, 3050], [0.72, 2200], [0.9, 600], [1, 320]]);
  var hdg = track([[0, 208], [0.3, 214], [0.55, 221], [0.8, 236], [1, 252]]);
  var spd = track([[0, 205], [0.5, 220], [0.8, 190], [1, 160]]);

  // ---- Vídeo como blob: siempre se puede saltar a cualquier fotograma ----
  var src = video.dataset.src;
  if (!src) return;
  fetch(src).then(function (r) { return r.blob(); }).then(function (b) {
    video.src = URL.createObjectURL(b);
    video.load();
  }).catch(function () { video.src = src; });
  var ready = false;
  video.addEventListener('loadeddata', function () {
    ready = true; document.documentElement.classList.add('video-ready');
  });
  // iOS: hay que "despertar" el vídeo con un toque para que pinte fotogramas al buscar
  function prime() {
    var pr = video.play(); if (pr && pr.then) pr.then(function () { video.pause(); }).catch(function () {});
    removeEventListener('touchstart', prime);
  }
  addEventListener('touchstart', prime, { passive: true });

  var target = 0, prog = 0, last = performance.now();
  function readScroll() {
    var r = flight.getBoundingClientRect();
    var total = flight.offsetHeight - innerHeight;
    target = clamp(-r.top / Math.max(1, total));
  }
  addEventListener('scroll', readScroll, { passive: true });
  addEventListener('resize', readScroll);
  readScroll(); prog = target;

  function updateUI(p) {
    panels.forEach(function (el) {
      var a = +el.dataset.from, b = +el.dataset.to, f = 0.035;
      var fin = a <= 0 ? 1 : smooth(a, a + f, p);
      var fout = b >= 1 ? 1 : 1 - smooth(b - f, b, p);
      var op = Math.min(fin, fout);
      el.style.opacity = op.toFixed(3);
      el.style.transform = 'translateY(' + ((1 - op) * 24).toFixed(1) + 'px)';
      el.style.visibility = op < 0.01 ? 'hidden' : 'visible';
    });
    if (routeDot) routeDot.style.top = (p * 100).toFixed(2) + '%';
    if (hudAlt) {
      hudAlt.textContent = Math.round(alt(p) / 10) * 10 >= 1000 ? (Math.round(alt(p) / 10) * 10).toLocaleString('es-ES') + ' m' : Math.round(alt(p)) + ' m';
      hudHdg.textContent = String(Math.round(hdg(p))).padStart(3, '0') + '°';
      hudSpd.textContent = Math.round(spd(p)) + ' km/h';
    }
  }

  function frame(now) {
    var dt = Math.min((now - last) / 1000, 0.05); last = now;
    prog += (target - prog) * (1 - Math.pow(0.002, dt)); // inercia suave
    if (Math.abs(target - prog) < 0.0002) prog = target;
    if (ready && video.duration) {
      var t = prog * (video.duration - 0.05);
      // No encadenar búsquedas: si el decodificador sigue buscando, esperamos al siguiente fotograma
      if (!video.seeking && Math.abs(video.currentTime - t) > 0.01) video.currentTime = t;
    }
    updateUI(prog);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
