/* Layer2D site — progressive enhancement only. The page works without this file. */
(function () {
  "use strict";

  /* Runtime mount hook.
     The WebGL2 runtime calls window.Layer2DRuntimeMount.attach(factory) where
     factory(el, { model }) mounts into #runtime-mount and may return a canvas.
     If the runtime loads first, it can also set window.Layer2DRuntime = factory. */
  var mountEl = document.getElementById("runtime-mount");
  window.Layer2DRuntimeMount = {
    el: mountEl,
    model: mountEl ? mountEl.getAttribute("data-model") : null,
    attach: function (factory) {
      if (!mountEl || typeof factory !== "function") return null;
      var result = factory(mountEl, { model: this.model });
      Promise.resolve(result).then(function () {
        mountEl.classList.add("is-live");
      }, function (err) {
        console.warn("Layer2D runtime failed to mount; keeping poster.", err);
      });
      return result;
    }
  };
  if (typeof window.Layer2DRuntime === "function") {
    window.Layer2DRuntimeMount.attach(window.Layer2DRuntime);
  }

  /* Smooth in-page anchors (offset for the sticky header). */
  var header = document.querySelector(".site-header");
  document.addEventListener("click", function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var target = document.getElementById(a.getAttribute("href").slice(1));
    if (!target) return;
    e.preventDefault();
    var top = target.getBoundingClientRect().top + window.scrollY - (header ? header.offsetHeight : 0);
    window.scrollTo({ top: top, behavior: "smooth" });
    history.replaceState(null, "", a.getAttribute("href"));
  });

  /* Avatar preview lightbox. */
  var dialog = document.getElementById("lightbox");
  if (!dialog || typeof dialog.showModal !== "function") return;
  var img = document.getElementById("lb-img");
  var nameEl = document.getElementById("lb-name");
  var openLink = document.getElementById("lb-open");
  var studioLink = document.getElementById("lb-studio");

  document.querySelectorAll(".avatar-card").forEach(function (card) {
    card.addEventListener("click", function () {
      var name = card.getAttribute("data-name");
      var model = card.getAttribute("data-model");
      img.src = card.getAttribute("data-src");
      img.alt = name;
      nameEl.textContent = name;
      var isDemo = model === "test-signal";
      openLink.href = "player/?model=test-signal.l2d";
      openLink.textContent = isDemo ? "Open in Player" : "Try Demo Player";
      if (studioLink) {
        studioLink.href = "studio/?model=../player/test-signal.l2d";
        studioLink.textContent = isDemo ? "Open in Studio" : "Try Demo Studio";
      }
      dialog.showModal();
    });
  });

  dialog.addEventListener("click", function (e) {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
})();
