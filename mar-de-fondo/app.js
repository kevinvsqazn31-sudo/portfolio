// Mar de Fondo · coreografía del scroll (GSAP + ScrollTrigger + Lenis)
(function () {
  var hint = document.querySelector('.hint');
  function updHint() { if (hint) hint.classList.toggle('is-gone', (window.scrollY || 0) > 60); }
  addEventListener('scroll', updHint, { passive: true });

  // Título que se mece con el mar: una letra por elemento
  var swell = document.querySelector('.swell');
  var text = swell.textContent; swell.textContent = '';
  var chars = text.split('').map(function (c) {
    var s = document.createElement('span'); s.className = 'ch'; s.textContent = c === ' ' ? ' ' : c; swell.appendChild(s); return s;
  });

  if (!window.gsap || !window.ScrollTrigger) { if (hint) hint.classList.add('is-on'); return; }
  gsap.registerPlugin(ScrollTrigger);

  // Scroll suave sincronizado con ScrollTrigger (receta oficial de GSAP para Lenis)
  var lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href'); var el = id === '#top' ? 0 : document.querySelector(id);
      if (el === null) return; e.preventDefault();
      if (lenis) lenis.scrollTo(el, { duration: 1.6 }); else if (el === 0) scrollTo(0, 0); else el.scrollIntoView();
    });
  });

  // Un único momento de entrada: el nombre sale del agua letra a letra
  var intro = gsap.timeline({ defaults: { ease: 'expo.out' }, onComplete: function () { if (hint) { hint.classList.add('is-on'); updHint(); } } });
  intro.fromTo(chars, { yPercent: 105, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1.4, stagger: 0.045 }, 0.3)
       .fromTo(['.hero-sub', '.hero-actions'], { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 1, stagger: 0.1 }, 0.95)
       .fromTo('.forecast', { autoAlpha: 0 }, { autoAlpha: 1, duration: 1 }, 1.2);

  // El título sube y baja con el oleaje, desfasado letra a letra
  var bobY = chars.map(function (c) { return gsap.quickSetter(c, 'y', 'px'); });
  var bobAmp = { v: 1 };
  gsap.ticker.add(function (time) {
    if (intro.isActive()) return;
    var fs = parseFloat(getComputedStyle(swell.parentElement).fontSize) || 100;
    for (var i = 0; i < chars.length; i++) bobY[i](Math.sin(i * 0.55 - time * 1.25) * fs * 0.022 * bobAmp.v);
  });

  // La historia mueve el mar: progreso 0..1 del bloque #story
  var forecast = document.querySelector('.forecast');
  var fP = document.getElementById('fPeriod'), fH = document.getElementById('fHeight');
  ScrollTrigger.create({
    trigger: '#story', start: 'top top', end: 'bottom bottom',
    onUpdate: function (self) { if (window.__seaSetProgress) window.__seaSetProgress(self.progress); },
    onLeave: function () { gsap.to(forecast, { autoAlpha: 0, duration: 0.4 }); },
    onEnterBack: function () { gsap.to(forecast, { autoAlpha: 1, duration: 0.4 }); },
  });
  gsap.ticker.add(function () {
    var s = window.__seaState; if (!s) return;
    fP.textContent = Math.round(s.period);
    fH.textContent = s.height.toFixed(1).replace('.', ',');
  });

  // El nombre se hunde al empezar a bajar
  gsap.fromTo('.hero-title', { yPercent: 0, opacity: 1 }, { yPercent: 18, opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.beat--hero', start: 'top top', end: 'bottom 30%', scrub: true } });
  gsap.to(bobAmp, { v: 0, ease: 'none', scrollTrigger: { trigger: '.beat--hero', start: 'top top', end: 'bottom 30%', scrub: true } });
  gsap.fromTo('.hero-fade', { opacity: 1 }, { opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.beat--hero', start: '20% top', end: '60% top', scrub: true } });

  // Cada tramo de la historia aparece y se va con su ola
  gsap.utils.toArray('.beat:not(.beat--hero) .beat__text').forEach(function (el) {
    gsap.timeline({ scrollTrigger: { trigger: el.parentElement, start: 'top 75%', end: 'bottom 25%', scrub: 0.6 } })
      .fromTo(el, { opacity: 0, y: 40 }, { opacity: 1, y: 0, ease: 'power2.out', duration: 0.3 })
      .to(el, { opacity: 1, duration: 0.4 })
      .to(el, { opacity: 0, y: -30, ease: 'power2.in', duration: 0.3 });
  });

  // La ola de la serie entra al llegar a las tablas, y el surfista la coge
  ScrollTrigger.create({
    trigger: '#tablas', start: 'top 85%', end: 'top 10%', scrub: true,
    onUpdate: function (self) { if (window.__seaSetSurf) window.__seaSetSurf(self.progress); },
  });
  // Al pasar a tierra firme, el mar deja de dibujarse (ahorra batería)
  ScrollTrigger.create({
    trigger: '#taller', start: 'top top',
    onEnter: function () { if (window.__seaPause) window.__seaPause(true); },
    onLeaveBack: function () { if (window.__seaPause) window.__seaPause(false); },
  });

  // Elegir tabla: con un clic en el mar o en la tabla; el surfista la cambia en plena ola
  var cards = [].slice.call(document.querySelectorAll('.board[data-board]'));
  function mark(i) {
    cards.forEach(function (c, k) { c.setAttribute('aria-checked', k === i ? 'true' : 'false'); c.tabIndex = k === i ? 0 : -1; });
  }
  function choose(i) { if (window.__seaSetBoard) window.__seaSetBoard(i); mark(i); }
  window.addEventListener('sea:board', function (e) { mark(e.detail); });
  cards.forEach(function (c, k) {
    c.addEventListener('click', function (e) { e.stopPropagation(); choose(k); });
    c.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(k); }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); var n = (k + 1) % cards.length; choose(n); cards[n].focus(); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); var pv = (k + cards.length - 1) % cards.length; choose(pv); cards[pv].focus(); }
    });
  });
  document.getElementById('tablas').addEventListener('click', function (e) {
    if (e.target.closest('.ride__panel')) return;
    if (window.__seaNextBoard) window.__seaNextBoard();
  });

  // Siluetas a escala real entre sí (pulgadas)
  var maxLen = Math.max.apply(null, cards.map(function (b) { return +b.dataset.len; }));
  var compact = matchMedia('(max-width: 560px)').matches;
  cards.forEach(function (b) { var sv = b.querySelector('svg'); sv.style.height = ((compact ? 62 : 118) * +b.dataset.len / maxLen) + 'px'; });

  addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
