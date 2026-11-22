// Scroll suave, enlaces internos y aviso de deslizar
(function () {
  var lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({ lerp: 0.09, smoothWheel: true });
    function raf(t) { lenis.raf(t); requestAnimationFrame(raf); }
    requestAnimationFrame(raf);
  }
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      var el = id === '#top' ? document.body : document.querySelector(id);
      if (!el) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(id === '#top' ? 0 : el, { duration: id === '#top' ? 2.4 : 1.4 });
      else el.scrollIntoView({ behavior: 'smooth' });
    });
  });

  var hint = document.querySelector('.hint');
  function upd() { if (hint) hint.classList.toggle('is-gone', (window.scrollY || 0) > 60); }
  addEventListener('scroll', upd, { passive: true });
  setTimeout(function () { if (hint) { hint.classList.add('is-on'); upd(); } }, 900);

  // Aparición suave de las secciones de abajo
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
  }, { rootMargin: '0px 0px -10% 0px' });
  document.querySelectorAll('.card, .steps li, .title, .cta__title').forEach(function (el) { el.classList.add('rise'); io.observe(el); });
})();
