(function () {
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // A refresh always starts at the top: don't restore scroll, and don't
  // leave #section in the address bar for the next reload to jump to.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  if (location.hash) {
    var landing = document.getElementById(location.hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);
    addEventListener('load', function () { if (landing) landing.scrollIntoView(); });
  } else {
    scrollTo(0, 0);
  }
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    e.preventDefault();
    var id = a.getAttribute('href').slice(1);
    var el = id && document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    else scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
  });

  // Split scrub paragraphs into words
  document.querySelectorAll('.scrub').forEach(function (p) {
    (function walk(node) {
      Array.from(node.childNodes).forEach(function (c) {
        if (c.nodeType === 3) {
          var frag = document.createDocumentFragment();
          c.textContent.split(/(\s+)/).forEach(function (t) {
            if (!t) return;
            if (/^\s+$/.test(t)) { frag.appendChild(document.createTextNode(t)); return; }
            var s = document.createElement('span'); s.className = 'w'; s.textContent = t; frag.appendChild(s);
          });
          c.replaceWith(frag);
        } else walk(c);
      });
    })(p);
  });

  var scrubs = Array.from(document.querySelectorAll('.scrub'));
  var chapters = Array.from(document.querySelectorAll('[data-chap]'));
  var progress = document.getElementById('progress');
  var chapEl = document.getElementById('chap');

  function frame() {
    var vh = innerHeight, doc = document.documentElement;
    scrubs.forEach(function (p) {
      var r = p.getBoundingClientRect();
      var t = Math.max(0, Math.min(1, (vh * .85 - r.top) / (r.height + vh * .4)));
      var words = p.querySelectorAll('.w'), n = reduce ? words.length : Math.round(t * words.length);
      words.forEach(function (w, i) { w.classList.toggle('on', i < n); });
    });
    if (progress) progress.style.transform = 'scaleX(' + (doc.scrollTop / Math.max(1, doc.scrollHeight - vh)) + ')';
    if (chapEl) {
      var current = '';
      chapters.forEach(function (c) { if (c.getBoundingClientRect().top < vh * .5) current = c.dataset.chap; });
      chapEl.textContent = current;
    }
  }
  var ticking = false;
  addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(function () { frame(); ticking = false; });
  }, { passive: true });
  addEventListener('resize', frame);
  frame();

  // Fade-ins and count-ups
  var fmt = new Intl.NumberFormat('en-US');
  function countUp(el) {
    var to = +el.dataset.to, plus = el.hasAttribute('data-plus') ? '+' : '';
    if (reduce) { el.textContent = fmt.format(to) + plus; return; }
    var start = null;
    requestAnimationFrame(function step(ts) {
      if (!start) start = ts;
      var k = Math.min(1, (ts - start) / 1800), e = 1 - Math.pow(1 - k, 4);
      el.textContent = fmt.format(Math.round(to * e)) + (k === 1 ? plus : '');
      if (k < 1) requestAnimationFrame(step);
    });
  }
  var targets = document.querySelectorAll('.fade, [data-to]');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(function (el) { el.classList.add('in'); if (el.dataset.to) countUp(el); });
    return;
  }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      e.target.classList.add('in'); io.unobserve(e.target);
      if (e.target.dataset.to) countUp(e.target);
    });
  }, { rootMargin: '0px 0px -12% 0px' });
  targets.forEach(function (el) { io.observe(el); });
})();

// "The Philippines this week": rendered from the weekly data file.
(function () {
  var root = document.getElementById('ph-weekly');
  if (!root) return;

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function link(url, text) {
    return '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(text) + '</a>';
  }
  function longDate(iso) {
    try {
      return new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Manila' })
        .format(new Date(iso + 'T12:00:00+08:00'));
    } catch (e) { return iso; }
  }

  fetch(root.dataset.src, { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw r; return r.json(); })
    .then(function (d) {
      if (root.dataset.mode === 'strip') {
        // Homepage: just the four numbers, linking to the full page.
        root.innerHTML = '<p class="strip-date">As of ' + esc(longDate(d.updated)) + '</p>' +
          d.indicators.map(function (i) {
            return '<div><span class="ph-k">' + esc(i.label) + '</span><b>' + esc(i.value) + '</b></div>';
          }).join('');
        root.classList.add('ready');
        return;
      }
      var html = '';
      html += '<p class="ph-updated">Updated ' + esc(longDate(d.updated)) + '</p>';

      html += '<div class="ph-ind">' + d.indicators.map(function (i) {
        return '<div><span class="ph-k">' + esc(i.label) + '</span><b>' + esc(i.value) + '</b>' +
          '<span class="ph-note">' + esc(i.note) + '</span></div>';
      }).join('') + '</div>';

      html += '<div class="ph-cols">';
      html += '<div><h4 class="ph-h">Headlines</h4><ol class="ph-list">' + d.headlines.map(function (h) {
        return '<li><a href="' + esc(h.url) + '" target="_blank" rel="noopener"><h3>' + esc(h.title) + '</h3>' +
          (h.line ? '<p>' + esc(h.line) + '</p>' : '') + '<span class="ph-src">' + esc(h.source) + ' ↗</span></a></li>';
      }).join('') + '</ol></div>';

      html += '<div><h4 class="ph-h">Regulation watch</h4><ol class="ph-list">' + d.regulation.map(function (g) {
        return '<li><a href="' + esc(g.url) + '" target="_blank" rel="noopener"><span class="ph-k">' + esc(g.body) + '</span>' +
          '<h3>' + esc(g.title) + '</h3><p>' + esc(g.status) + '</p></a></li>';
      }).join('') + '</ol></div>';
      html += '</div>';

      html += '<h4 class="ph-h">Key dates</h4><ol class="ph-dates">' + d.dates.map(function (k) {
        return '<li><b>' + esc(k.date) + '</b><span>' + esc(k.title) + '</span><span class="ph-k">' + esc(k.type) + '</span></li>';
      }).join('') + '</ol>';

      root.innerHTML = html;
      root.classList.add('ready');
    })
    .catch(function () { (root.closest('section') || root).hidden = true; });
})();
