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

  /* Live WebGL2 embed for public open-source Test Signal card. */
  var dialog = document.getElementById("lightbox");
  var liveFrames = new Map();
  window.addEventListener("message", function (e) {
    if (!e.data || e.data.type !== "layer2d:ready") return;
    liveFrames.forEach(function (container, frame) {
      if (frame.contentWindow === e.source) container.classList.add("is-live");
    });
  });

  function setCardFramesPaused(wantPaused) {
    liveFrames.forEach(function (container, frame) {
      if (container.classList.contains("avatar-card") && container.classList.contains("is-live") && frame.contentWindow) {
        try { frame.contentWindow.postMessage({ type: "layer2d:pause", paused: wantPaused }, "*"); } catch (_) {}
      }
    });
  }

  function t(key, vars, fallback) {
    if (window.Layer2DI18n && typeof window.Layer2DI18n.t === "function") {
      return window.Layer2DI18n.t(key, vars, fallback);
    }
    var s = fallback !== undefined ? fallback : key;
    if (vars) {
      s = s.replace(/\{([a-zA-Z0-9_]+)\}/g, function (m, k) {
        return Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m;
      });
    }
    return s;
  }

  function mountLiveCard(card) {
    if (card.dataset.liveMounted) return;
    var url = card.getAttribute("data-live-url");
    var portrait = card.querySelector(".portrait");
    if (!url || !portrait) return;
    card.dataset.liveMounted = "1";
    var frame = document.createElement("iframe");
    frame.className = "live-avatar";
    frame.src = url;
    frame.title = t("avatars.livePreviewTitle", { name: card.getAttribute("data-name") || "Avatar" }, "{name} live WebGL2 preview");
    frame.setAttribute("allowtransparency", "true");
    frame.setAttribute("tabindex", "-1");
    liveFrames.set(frame, card);
    portrait.appendChild(frame);
  }

  var liveCards = document.querySelectorAll(".avatar-card[data-live-url]");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (ent) {
        if (ent.isIntersecting) {
          mountLiveCard(ent.target);
          var f = ent.target.querySelector("iframe.live-avatar");
          if (f && f.contentWindow && ent.target.classList.contains("is-live") && (!dialog || !dialog.open)) {
            try { f.contentWindow.postMessage({ type: "layer2d:pause", paused: false }, "*"); } catch (_) {}
          }
        } else if (ent.target.classList.contains("is-live")) {
          var f2 = ent.target.querySelector("iframe.live-avatar");
          if (f2 && f2.contentWindow) {
            try { f2.contentWindow.postMessage({ type: "layer2d:pause", paused: true }, "*"); } catch (_) {}
          }
        }
      });
    }, { rootMargin: "600px 0px" });
    liveCards.forEach(function (c) { io.observe(c); });
  } else {
    liveCards.forEach(mountLiveCard);
  }

  /* Avatar preview lightbox. */
  if (!dialog || typeof dialog.showModal !== "function") return;
  var lbStage = dialog.querySelector(".lb-stage");
  var img = document.getElementById("lb-img");
  var nameEl = document.getElementById("lb-name");
  var openLink = document.getElementById("lb-open");
  var studioLink = document.getElementById("lb-studio");
  var lbFrame = null;

  function clearLightboxLive() {
    if (lbFrame) {
      liveFrames.delete(lbFrame);
      lbFrame.remove();
      lbFrame = null;
    }
    if (lbStage) lbStage.classList.remove("is-live");
    setCardFramesPaused(false);
  }

  document.querySelectorAll(".avatar-card").forEach(function (card) {
    card.addEventListener("click", function () {
      clearLightboxLive();
      var name = card.getAttribute("data-name");
      var model = card.getAttribute("data-model");
      var liveUrl = card.getAttribute("data-live-url");
      img.src = card.getAttribute("data-src");
      img.alt = name;
      nameEl.textContent = name;
      var isDemo = model === "test-signal";
      openLink.href = "player/?model=test-signal.l2d";
      openLink.setAttribute("data-i18n", isDemo ? "lightbox.openPlayer" : "lightbox.tryDemoPlayer");
      openLink.textContent = isDemo
        ? t("lightbox.openPlayer", null, "Open in Player")
        : t("lightbox.tryDemoPlayer", null, "Try Demo Player");
      if (studioLink) {
        studioLink.href = "studio/?model=../player/test-signal.l2d";
        studioLink.setAttribute("data-i18n", isDemo ? "lightbox.openStudio" : "lightbox.tryDemoStudio");
        studioLink.textContent = isDemo
          ? t("lightbox.openStudio", null, "Open in Studio")
          : t("lightbox.tryDemoStudio", null, "Try Demo Studio");
      }
      dialog.showModal();
      if (isDemo && liveUrl && lbStage) {
        setCardFramesPaused(true);
        lbFrame = document.createElement("iframe");
        lbFrame.className = "lb-live";
        lbFrame.src = liveUrl;
        lbFrame.title = t("avatars.interactivePreviewTitle", { name: name }, "{name} interactive WebGL2 preview");
        lbFrame.setAttribute("allowtransparency", "true");
        liveFrames.set(lbFrame, lbStage);
        lbStage.insertBefore(lbFrame, lbStage.querySelector(".lb-close"));
      }
    });
  });

  dialog.addEventListener("close", clearLightboxLive);
  dialog.addEventListener("click", function (e) {
    if (e.target === dialog || e.target.closest("[data-close]")) dialog.close();
  });
})();
