(function () {
  var root = document.documentElement;
  var motionOff = root.dataset.motion === 'off';
  var finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var hint = document.querySelector('.hint');

  // ---- Botón de movimiento (se guarda por visitante) ----
  var toggle = document.getElementById('motionToggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', motionOff ? 'true' : 'false');
    toggle.querySelector('b').textContent = motionOff ? 'OFF' : 'ON';
    toggle.addEventListener('click', function () {
      try { localStorage.setItem('asf_motion', motionOff ? 'on' : 'off'); } catch (e) {}
      var url = location.pathname + location.search.replace(/([?&])motion=0&?/, '$1').replace(/[?&]$/, '');
      location.href = url;
    });
  }

  // ---- Aviso de deslizar: visible arriba del todo, se esconde al moverse ----
  function updateHint() {
    if (!hint) return;
    var y = window.scrollY || 0;
    hint.classList.toggle('is-gone', y > 60);
  }
  function showHint() { if (hint) { hint.classList.add('is-on'); updateHint(); } }
  window.addEventListener('scroll', updateHint, { passive: true });

  // Partir el texto en caracteres o palabras
  function splitChars(el) {
    var t = el.textContent; el.textContent = '';
    t.split('').forEach(function (c) { var s = document.createElement('span'); s.className = 'ch'; s.textContent = c; el.appendChild(s); });
    return el.querySelectorAll('.ch');
  }
  function splitWords(el) {
    var t = el.textContent.trim().replace(/\s+/g, ' '); el.textContent = '';
    t.split(' ').forEach(function (w, i, a) {
      var s = document.createElement('span'); s.className = 'w'; s.textContent = w; el.appendChild(s);
      if (i < a.length - 1) el.appendChild(document.createTextNode(' '));
    });
    return el.querySelectorAll('.w');
  }

  var chars = splitChars(document.querySelector('.hero__title .split'));
  var words = splitWords(document.querySelector('[data-words]'));

  if (!window.gsap || !window.ScrollTrigger) {
    root.classList.add('no-gsap');
    var lo = document.querySelector('.loader'); if (lo) lo.style.display = 'none';
    var hm = document.querySelector('.hero__media'); if (hm) hm.style.clipPath = 'none';
    showHint();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  // ---- Scroll suave ----
  var lenis = null;
  if (!motionOff && window.Lenis) {
    lenis = new Lenis({ lerp: 0.1, smoothWheel: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add(function (t) { lenis.raf(t * 1000); });
    gsap.ticker.lagSmoothing(0);
  }
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href'); var target = id === '#top' ? 0 : document.querySelector(id);
      if (target === null) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(target, { offset: 0, duration: 1.4 });
      else if (target === 0) window.scrollTo(0, 0);
      else target.scrollIntoView();
    });
  });

  var heroImg = document.querySelector('.hero__media img');

  // ---- Precarga + entrada de la portada ----
  function heroIn() {
    var tl = gsap.timeline({ onComplete: showHint });
    tl.to('.hero__media', { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.3, ease: 'expo.inOut' })
      .to(heroImg, { scale: 1.05, duration: 1.6, ease: 'expo.out' }, 0.2)
      .from(chars, { yPercent: 110, duration: 1.1, ease: 'expo.out', stagger: 0.05 }, 0.55)
      .from(['.hero__meta', '.hero__tag'], { opacity: 0, y: 16, duration: 0.8, ease: 'power3.out', stagger: 0.1 }, 0.9);
  }

  if (motionOff) {
    gsap.set(heroImg, { scale: 1.05 });
    showHint();
  } else {
    if (lenis) lenis.stop();
    var counter = { v: 0 };
    var countEl = document.getElementById('count');
    var loader = gsap.timeline({
      onComplete: function () {
        document.querySelector('.loader').style.display = 'none';
        if (lenis) lenis.start();
      }
    });
    loader.to(counter, { v: 100, duration: 1.2, ease: 'power2.inOut', onUpdate: function () { countEl.textContent = String(Math.round(counter.v)).padStart(3, '0'); } })
      .to('.loader__word span', { yPercent: -105, duration: 0.7, ease: 'expo.out', stagger: 0.04 }, 0.35)
      .to('.loader', { yPercent: -100, duration: 0.9, ease: 'expo.inOut' }, '+=0.15')
      .add(heroIn, '-=0.45');
  }

  // ---- Portada al hacer scroll: la foto baja y el título se separa ----
  gsap.to(heroImg, { yPercent: 14, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.to('.hero__title', { yPercent: 35, opacity: 0.2, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });

  // ---- Cinta: avanza sola y acelera/gira con el scroll ----
  var band = gsap.to('.band__track', { xPercent: -50, duration: 22, ease: 'none', repeat: -1 });
  if (motionOff) band.pause();
  else {
    ScrollTrigger.create({
      onUpdate: function (self) {
        var v = self.getVelocity() / 300;
        var dir = self.direction;
        gsap.to(band, { timeScale: dir * Math.min(6, 1 + Math.abs(v)), duration: 0.3, overwrite: true });
        gsap.to(band, { timeScale: dir, duration: 1.2, delay: 0.3 });
      }
    });
  }

  // ---- Manifiesto: las palabras se encienden al leer ----
  if (!motionOff) {
    gsap.to(words, {
      color: '#f2f0ec', stagger: 0.08, ease: 'none',
      scrollTrigger: { trigger: '.manifesto__text', start: 'top 80%', end: 'bottom 45%', scrub: true }
    });
    gsap.from('.manifesto__detail', { clipPath: 'inset(100% 0 0 0)', duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: '.manifesto__detail', start: 'top 85%' } });
  }

  // ---- Lookbook horizontal anclado ----
  var track = document.querySelector('.look__track');
  if (!motionOff && track) {
    var dist = function () { return Math.max(0, track.scrollWidth - window.innerWidth); };
    var hTween = gsap.to(track, {
      x: function () { return -dist(); }, ease: 'none',
      scrollTrigger: { trigger: '.look', pin: '.look__pin', start: 'top top', end: function () { return '+=' + dist(); }, scrub: 1, invalidateOnRefresh: true }
    });
    gsap.to('.look__progress span', { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.look', start: 'top top', end: function () { return '+=' + dist(); }, scrub: true } });
    document.querySelectorAll('.look__img img').forEach(function (img) {
      gsap.fromTo(img, { xPercent: -8 }, { xPercent: 8, ease: 'none', scrollTrigger: { trigger: img.parentElement, containerAnimation: hTween, start: 'left right', end: 'right left', scrub: true } });
    });
    gsap.to('.look__hint', { opacity: 0, scrollTrigger: { trigger: '.look', start: function () { return 'top+=' + dist() * 0.75 + ' top'; }, end: function () { return 'top+=' + dist() * 0.9 + ' top'; }, scrub: true } });
  }

  // ---- Menú en oscuro sobre la zona clara ----
  var navEl = document.querySelector('.nav');
  ScrollTrigger.create({
    trigger: '.drop', start: 'top 40px', endTrigger: 'html', end: 'bottom bottom',
    onToggle: function (self) { navEl.classList.toggle('is-light', self.isActive); }
  });

  // ---- Prendas y cierre ----
  if (!motionOff) {
    gsap.from('.drop', { borderRadius: '0px', scrollTrigger: { trigger: '.drop', start: 'top bottom', end: 'top 40%', scrub: true } });
    gsap.from('.drop__title', { yPercent: 40, opacity: 0, duration: 1, ease: 'expo.out', scrollTrigger: { trigger: '.drop__title', start: 'top 85%' } });
    gsap.from('.prod', { y: 80, opacity: 0, duration: 1, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: '.drop__grid', start: 'top 85%' } });
    gsap.from('.outro__title span', { yPercent: 60, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.12, scrollTrigger: { trigger: '.outro', start: 'top 75%' } });
  }

  // ---- Cursor y botones magnéticos (solo con ratón) ----
  if (finePointer) {
    var cur = document.querySelector('.cursor');
    var xTo = gsap.quickTo(cur, 'x', { duration: 0.35, ease: 'power3' });
    var yTo = gsap.quickTo(cur, 'y', { duration: 0.35, ease: 'power3' });
    window.addEventListener('pointermove', function (e) { cur.style.opacity = 1; xTo(e.clientX); yTo(e.clientY); }, { passive: true });
    document.querySelectorAll('[data-cursor]').forEach(function (el) {
      el.addEventListener('pointerenter', function () { cur.classList.add('is-big'); });
      el.addEventListener('pointerleave', function () { cur.classList.remove('is-big'); });
    });
    if (!motionOff) {
      document.querySelectorAll('[data-magnetic]').forEach(function (b) {
        b.addEventListener('pointermove', function (e) {
          var r = b.getBoundingClientRect();
          gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * 0.35, y: (e.clientY - r.top - r.height / 2) * 0.35, duration: 0.4, ease: 'power3' });
        });
        b.addEventListener('pointerleave', function () { gsap.to(b, { x: 0, y: 0, duration: 0.7, ease: 'elastic.out(1, .4)' }); });
      });
    }
  }

  window.addEventListener('load', function () { ScrollTrigger.refresh(); });
})();
