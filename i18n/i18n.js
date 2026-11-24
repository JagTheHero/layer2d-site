/* Layer2D site localization runtime — zero-dependency static i18n with RTL & live switching. */
(function () {
  "use strict";

  var STORAGE_KEY = "layer2d_lang";
  var LOCALES = [
    { code: "en", label: "English", short: "EN", englishName: "English", dir: "ltr" },
    { code: "ja", label: "日本語", short: "日本語", englishName: "Japanese", dir: "ltr", font: "https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;600;700&display=swap" },
    { code: "zh-CN", label: "简体中文", short: "中文", englishName: "Chinese (Simplified)", dir: "ltr", font: "https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&display=swap" },
    { code: "hi", label: "हिन्दी", short: "हिन्दी", englishName: "Hindi", dir: "ltr", font: "https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap" },
    { code: "es", label: "Español", short: "ES", englishName: "Spanish", dir: "ltr" },
    { code: "ar", label: "العربية", short: "AR", englishName: "Arabic", dir: "rtl", font: "https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700&display=swap" },
    { code: "fr", label: "Français", short: "FR", englishName: "French", dir: "ltr" }
  ];

  var LOCALE_MAP = Object.create(null);
  LOCALES.forEach(function (loc) {
    LOCALE_MAP[loc.code.toLowerCase()] = loc;
  });

  var LANG_ALIASES = {
    en: "en",
    english: "en",
    ja: "ja",
    jp: "ja",
    japanese: "ja",
    zh: "zh-CN",
    "zh-cn": "zh-CN",
    "zh-hans": "zh-CN",
    cn: "zh-CN",
    chinese: "zh-CN",
    hi: "hi",
    hindi: "hi",
    es: "es",
    spanish: "es",
    ar: "ar",
    arabic: "ar",
    fr: "fr",
    french: "fr"
  };

  function normalizeLang(raw) {
    if (!raw || typeof raw !== "string") return null;
    var s = raw.trim().replace(/_/g, "-").toLowerCase();
    if (!s) return null;
    if (LOCALE_MAP[s]) return LOCALE_MAP[s].code;
    if (Object.prototype.hasOwnProperty.call(LANG_ALIASES, s)) return LANG_ALIASES[s];
    if (s.indexOf("zh-") === 0) return "zh-CN";
    var base = s.split("-")[0];
    if (LOCALE_MAP[base]) return LOCALE_MAP[base].code;
    if (Object.prototype.hasOwnProperty.call(LANG_ALIASES, base)) return LANG_ALIASES[base];
    return null;
  }

  function parseLangFromParams(qp) {
    var fromLangParam = normalizeLang(qp.get("lang"));
    if (fromLangParam) return fromLangParam;
    var matched = null;
    qp.forEach(function (val, key) {
      if (matched) return;
      if (val !== "" && val !== "1" && val.toLowerCase() !== "true") return;
      var norm = normalizeLang(key);
      if (norm) matched = norm;
    });
    return matched;
  }

  function detectLangFromUrl() {
    try {
      var rawSearch = window.location.search || "";
      // Handle literal "?jp" appended onto a URL that already had a "?" (e.g. /player/?model=nori.l2d?jp)
      var extraQ = rawSearch.indexOf("?", 1);
      if (extraQ >= 0) {
        var tail = rawSearch.slice(extraQ + 1);
        var fromTail = parseLangFromParams(new URLSearchParams(tail));
        if (fromTail) {
          var headSearch = rawSearch.slice(0, extraQ);
          try {
            window.history.replaceState(null, "", window.location.pathname + headSearch + window.location.hash);
          } catch (_) {}
          return fromTail;
        }
      }
      var qp = new URLSearchParams(rawSearch);
      var found = parseLangFromParams(qp);
      if (found) return found;
      var hash = window.location.hash || "";
      var hq = hash.indexOf("?");
      if (hq >= 0) {
        var hqp = new URLSearchParams(hash.slice(hq + 1));
        var fromHash = parseLangFromParams(hqp);
        if (fromHash) {
          try {
            var cleanHash = hash.slice(0, hq);
            window.history.replaceState(null, "", window.location.pathname + window.location.search + cleanHash);
          } catch (_) {}
          return fromHash;
        }
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function getLocaleMeta(code) {
    var norm = normalizeLang(code) || "en";
    return LOCALE_MAP[norm.toLowerCase()] || LOCALES[0];
  }

  function getBaseUrl() {
    var cs = document.currentScript;
    if (cs && cs.src) {
      try {
        return new URL("./", cs.src).href;
      } catch (_) {}
    }
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      if (scripts[i].src && /\/i18n\.js(\?|#|$)/.test(scripts[i].src)) {
        try {
          return new URL("./", scripts[i].src).href;
        } catch (_) {}
      }
    }
    return "./i18n/";
  }

  var BASE_URL = getBaseUrl();
  var cache = Object.create(null); // cache[lang][ns] = dict
  var inflight = Object.create(null);
  var loadedFonts = Object.create(null);
  var listeners = [];
  var dict = Object.create(null);
  var fallbackDict = Object.create(null);
  var domOriginals = new WeakMap();
  var metaOriginal = null;
  var switchers = [];

  function parseNamespaces() {
    var attr = document.documentElement.getAttribute("data-i18n-ns") || "common";
    return attr.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
  }

  var namespaces = parseNamespaces();

  function detectInitialLang() {
    var fromUrl = detectLangFromUrl();
    if (fromUrl) {
      try { window.localStorage.setItem(STORAGE_KEY, fromUrl); } catch (_) {}
      return fromUrl;
    }
    try {
      var stored = normalizeLang(window.localStorage.getItem(STORAGE_KEY));
      if (stored) return stored;
    } catch (_) {}
    return "en";
  }

  var currentLang = detectInitialLang();

  function ensureFontFor(code) {
    var meta = getLocaleMeta(code);
    if (!meta.font || loadedFonts[meta.code]) return;
    loadedFonts[meta.code] = true;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = meta.font;
    (document.head || document.documentElement).appendChild(link);
  }

  function applyDocAttrs(code) {
    var meta = getLocaleMeta(code);
    document.documentElement.setAttribute("lang", meta.code);
    document.documentElement.setAttribute("dir", meta.dir);
    document.documentElement.setAttribute("data-lang", meta.code);
    ensureFontFor(meta.code);
  }

  applyDocAttrs(currentLang);
  if (currentLang !== "en") {
    document.documentElement.classList.add("i18n-loading");
    setTimeout(function () {
      document.documentElement.classList.remove("i18n-loading");
    }, 600);
  }

  function fetchNamespace(lang, ns) {
    if (cache[lang] && cache[lang][ns]) {
      return Promise.resolve(cache[lang][ns]);
    }
    var key = lang + "::" + ns;
    if (inflight[key]) return inflight[key];
    var url = BASE_URL + "locales/" + encodeURIComponent(lang) + "/" + encodeURIComponent(ns) + ".json";
    inflight[key] = fetch(url, { cache: "no-cache" })
      .then(function (r) {
        if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
        return r.json();
      })
      .then(function (data) {
        if (!cache[lang]) cache[lang] = Object.create(null);
        cache[lang][ns] = data || Object.create(null);
        delete inflight[key];
        return cache[lang][ns];
      })
      .catch(function (err) {
        delete inflight[key];
        console.warn("Layer2D i18n failed to load " + url, err);
        return Object.create(null);
      });
    return inflight[key];
  }

  function loadAllNamespaces(lang) {
    var nsList = parseNamespaces();
    namespaces = nsList;
    return Promise.all(nsList.map(function (ns) { return fetchNamespace(lang, ns); }))
      .then(function (parts) {
        var merged = Object.create(null);
        parts.forEach(function (part) {
          if (!part) return;
          Object.keys(part).forEach(function (k) { merged[k] = part[k]; });
        });
        return merged;
      });
  }

  function interpolate(str, vars) {
    if (!vars || typeof str !== "string") return str;
    return str.replace(/\{([a-zA-Z0-9_]+)\}/g, function (m, k) {
      return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] !== undefined && vars[k] !== null
        ? String(vars[k])
        : m;
    });
  }

  function t(key, vars, fallback) {
    var val = Object.prototype.hasOwnProperty.call(dict, key) ? dict[key]
      : (Object.prototype.hasOwnProperty.call(fallbackDict, key) ? fallbackDict[key] : undefined);
    if (val === undefined) {
      val = fallback !== undefined ? fallback : key;
    }
    return interpolate(val, vars);
  }

  function snapshotElement(el) {
    if (domOriginals.has(el)) return domOriginals.get(el);
    var orig = {
      text: el.textContent,
      html: el.innerHTML,
      attrs: Object.create(null)
    };
    var attrSpec = el.getAttribute("data-i18n-attr");
    if (attrSpec) {
      attrSpec.split(",").forEach(function (pair) {
        var idx = pair.indexOf(":");
        if (idx < 0) return;
        var aName = pair.slice(0, idx).trim();
        if (aName) orig.attrs[aName] = el.getAttribute(aName);
      });
    }
    domOriginals.set(el, orig);
    return orig;
  }

  function snapshotMeta() {
    if (metaOriginal) return metaOriginal;
    var descEl = document.querySelector('meta[name="description"]');
    var ogTitleEl = document.querySelector('meta[property="og:title"]');
    var ogDescEl = document.querySelector('meta[property="og:description"]');
    metaOriginal = {
      title: document.title,
      description: descEl ? descEl.getAttribute("content") : null,
      ogTitle: ogTitleEl ? ogTitleEl.getAttribute("content") : null,
      ogDescription: ogDescEl ? ogDescEl.getAttribute("content") : null
    };
    return metaOriginal;
  }

  function applyTranslations(root) {
    var scope = root || document;
    var isEn = currentLang === "en";

    if (!root) {
      var mo = snapshotMeta();
      var newTitle = Object.prototype.hasOwnProperty.call(dict, "meta.title") ? dict["meta.title"] : (isEn ? mo.title : null);
      if (newTitle && !document.documentElement.hasAttribute("data-i18n-keep-title")) {
        document.title = newTitle;
      }
      var descEl = document.querySelector('meta[name="description"]');
      if (descEl) {
        var newDesc = Object.prototype.hasOwnProperty.call(dict, "meta.description") ? dict["meta.description"] : (isEn ? mo.description : null);
        if (newDesc !== null) descEl.setAttribute("content", newDesc);
      }
      var ogTitleEl = document.querySelector('meta[property="og:title"]');
      if (ogTitleEl) {
        var newOgT = Object.prototype.hasOwnProperty.call(dict, "meta.ogTitle") ? dict["meta.ogTitle"]
          : (Object.prototype.hasOwnProperty.call(dict, "meta.title") ? dict["meta.title"] : (isEn ? mo.ogTitle : null));
        if (newOgT !== null) ogTitleEl.setAttribute("content", newOgT);
      }
      var ogDescEl = document.querySelector('meta[property="og:description"]');
      if (ogDescEl) {
        var newOgD = Object.prototype.hasOwnProperty.call(dict, "meta.ogDescription") ? dict["meta.ogDescription"]
          : (Object.prototype.hasOwnProperty.call(dict, "meta.description") ? dict["meta.description"] : (isEn ? mo.ogDescription : null));
        if (newOgD !== null) ogDescEl.setAttribute("content", newOgD);
      }
    }

    scope.querySelectorAll("[data-i18n]").forEach(function (el) {
      var orig = snapshotElement(el);
      var key = el.getAttribute("data-i18n");
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(dict, key)) {
        el.textContent = dict[key];
      } else if (isEn) {
        el.textContent = orig.text;
      } else if (Object.prototype.hasOwnProperty.call(fallbackDict, key)) {
        el.textContent = fallbackDict[key];
      }
    });

    scope.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      var orig = snapshotElement(el);
      var key = el.getAttribute("data-i18n-html");
      if (!key) return;
      if (Object.prototype.hasOwnProperty.call(dict, key)) {
        el.innerHTML = dict[key];
      } else if (isEn) {
        el.innerHTML = orig.html;
      } else if (Object.prototype.hasOwnProperty.call(fallbackDict, key)) {
        el.innerHTML = fallbackDict[key];
      }
    });

    scope.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      var orig = snapshotElement(el);
      var spec = el.getAttribute("data-i18n-attr");
      if (!spec) return;
      spec.split(",").forEach(function (pair) {
        var idx = pair.indexOf(":");
        if (idx < 0) return;
        var aName = pair.slice(0, idx).trim();
        var key = pair.slice(idx + 1).trim();
        if (!aName || !key) return;
        if (Object.prototype.hasOwnProperty.call(dict, key)) {
          el.setAttribute(aName, dict[key]);
        } else if (isEn && orig.attrs[aName] !== null && orig.attrs[aName] !== undefined) {
          el.setAttribute(aName, orig.attrs[aName]);
        } else if (Object.prototype.hasOwnProperty.call(fallbackDict, key)) {
          el.setAttribute(aName, fallbackDict[key]);
        }
      });
    });

    syncSwitchers();
  }

  /* ---------- Language Switcher Controls ---------- */
  var GLOBE_SVG = '<svg class="lang-globe" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" aria-hidden="true"><circle cx="8" cy="8" r="6.25"/><path d="M1.75 8h12.5M8 1.75c1.9 1.75 2.9 4 2.9 6.25s-1 4.5-2.9 6.25C6.1 12.5 5.1 10.25 5.1 8S6.1 3.5 8 1.75Z"/></svg>';
  var CHEV_SVG = '<svg class="lang-chev" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5"/></svg>';
  var CHECK_SVG = '<svg class="lang-check" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.5 7.5 5.5 10.5 11.5 3.5"/></svg>';

  function closeAllMenus(exceptWrap) {
    switchers.forEach(function (sw) {
      if (sw.type === "dropdown" && sw.wrap !== exceptWrap) {
        sw.menu.hidden = true;
        sw.btn.setAttribute("aria-expanded", "false");
        sw.wrap.classList.remove("open");
      }
    });
  }

  function buildDropdownSwitcher(wrap) {
    if (wrap.dataset.langBuilt === "1") return;
    wrap.dataset.langBuilt = "1";
    wrap.classList.add("lang-switcher");

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.innerHTML = GLOBE_SVG + '<span class="lang-code"></span>' + CHEV_SVG;

    var menu = document.createElement("div");
    menu.className = "lang-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;

    var items = [];
    LOCALES.forEach(function (loc) {
      var opt = document.createElement("button");
      opt.type = "button";
      opt.className = "lang-opt";
      opt.setAttribute("role", "option");
      opt.setAttribute("data-lang-opt", loc.code);
      opt.setAttribute("lang", loc.code);
      opt.setAttribute("dir", loc.dir);
      opt.innerHTML =
        '<span class="lang-opt-main">' +
          '<span class="lang-opt-native">' + loc.label + "</span>" +
          '<span class="lang-opt-en">' + (loc.code === "en" ? "Default" : loc.englishName) + "</span>" +
        "</span>" +
        CHECK_SVG;
      opt.addEventListener("click", function (e) {
        e.stopPropagation();
        closeAllMenus();
        setLanguage(loc.code, true);
        btn.focus();
      });
      menu.appendChild(opt);
      items.push(opt);
    });

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var opening = menu.hidden;
      closeAllMenus(wrap);
      menu.hidden = !opening;
      btn.setAttribute("aria-expanded", opening ? "true" : "false");
      wrap.classList.toggle("open", opening);
      if (opening) {
        var active = menu.querySelector('[aria-selected="true"]') || items[0];
        if (active) active.focus();
      }
    });

    menu.addEventListener("keydown", function (e) {
      var idx = items.indexOf(document.activeElement);
      if (e.key === "Escape") {
        e.preventDefault();
        closeAllMenus();
        btn.focus();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        items[(idx + 1) % items.length].focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
      }
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    switchers.push({ type: "dropdown", wrap: wrap, btn: btn, menu: menu, items: items });
  }

  function buildSelectSwitcher(sel) {
    if (sel.dataset.langBuilt === "1") return;
    sel.dataset.langBuilt = "1";
    sel.innerHTML = "";
    LOCALES.forEach(function (loc) {
      var opt = document.createElement("option");
      opt.value = loc.code;
      opt.textContent = loc.label;
      sel.appendChild(opt);
    });
    sel.value = currentLang;
    sel.addEventListener("change", function () {
      setLanguage(sel.value, true);
    });
    switchers.push({ type: "select", el: sel });
  }

  function mountSwitchers() {
    document.querySelectorAll("[data-lang-switcher]").forEach(buildDropdownSwitcher);
    document.querySelectorAll("select[data-lang-select]").forEach(buildSelectSwitcher);
    syncSwitchers();
  }

  function syncSwitchers() {
    var meta = getLocaleMeta(currentLang);
    var ariaLbl = t("lang.switch", null, "Language");
    switchers.forEach(function (sw) {
      if (sw.type === "dropdown") {
        var codeEl = sw.btn.querySelector(".lang-code");
        if (codeEl) codeEl.textContent = meta.short;
        sw.btn.setAttribute("aria-label", ariaLbl + ": " + meta.label);
        sw.btn.title = ariaLbl + ": " + meta.label;
        sw.menu.setAttribute("aria-label", ariaLbl);
        sw.items.forEach(function (opt) {
          var isSel = opt.getAttribute("data-lang-opt") === meta.code;
          opt.setAttribute("aria-selected", isSel ? "true" : "false");
          opt.classList.toggle("active", isSel);
        });
      } else if (sw.type === "select") {
        sw.el.value = meta.code;
        sw.el.setAttribute("aria-label", ariaLbl);
        sw.el.title = ariaLbl;
      }
    });
  }

  document.addEventListener("click", function () { closeAllMenus(); });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAllMenus();
  });

  function notifyListeners() {
    var meta = getLocaleMeta(currentLang);
    var detail = { lang: meta.code, dir: meta.dir, label: meta.label };
    listeners.slice().forEach(function (fn) {
      try { fn(detail); } catch (e) { console.error(e); }
    });
    try {
      window.dispatchEvent(new CustomEvent("layer2d:langchange", { detail: detail }));
    } catch (_) {}
  }

  var loadSeq = 0;

  function setLanguage(rawCode, persist) {
    var norm = normalizeLang(rawCode) || "en";
    var seq = ++loadSeq;
    ensureFontFor(norm);
    if (persist) {
      try { window.localStorage.setItem(STORAGE_KEY, norm); } catch (_) {}
      try {
        var u = new URL(window.location.href);
        var changed = false;
        if (u.searchParams.has("lang")) {
          if (norm === "en") u.searchParams.delete("lang");
          else u.searchParams.set("lang", norm);
          changed = true;
        }
        var bareKeys = [];
        u.searchParams.forEach(function (val, key) {
          if ((val === "" || val === "1" || val.toLowerCase() === "true") && normalizeLang(key)) {
            bareKeys.push(key);
          }
        });
        if (bareKeys.length) {
          bareKeys.forEach(function (k) { u.searchParams.delete(k); });
          changed = true;
        }
        if (changed) {
          var nextSearch = u.searchParams.toString();
          window.history.replaceState(null, "", u.pathname + (nextSearch ? "?" + nextSearch : "") + u.hash);
        }
      } catch (_) {}
    }

    var tasks = [loadAllNamespaces(norm)];
    if (norm !== "en" && Object.keys(fallbackDict).length === 0) {
      tasks.push(loadAllNamespaces("en").then(function (enMerged) { fallbackDict = enMerged; }));
    }
    return Promise.all(tasks).then(function (res) {
      if (seq !== loadSeq) return currentLang;
      currentLang = norm;
      dict = res[0] || Object.create(null);
      if (norm === "en") fallbackDict = dict;
      applyDocAttrs(norm);
      if (document.readyState !== "loading") {
        mountSwitchers();
        applyTranslations();
      }
      document.documentElement.classList.remove("i18n-loading");
      notifyListeners();
      return norm;
    });
  }

  window.addEventListener("hashchange", function () {
    var fromHash = detectLangFromUrl();
    if (fromHash && fromHash !== currentLang) {
      setLanguage(fromHash, true);
    }
  });

  var initialPromise = new Promise(function (resolve) {
    var startLoad = function () {
      return setLanguage(currentLang, false).then(resolve, function () {
        document.documentElement.classList.remove("i18n-loading");
        resolve(currentLang);
      });
    };
    if (document.readyState === "loading") {
      var loadP = loadAllNamespaces(currentLang);
      var enP = currentLang !== "en" ? loadAllNamespaces("en") : loadP;
      document.addEventListener("DOMContentLoaded", function () {
        mountSwitchers();
        Promise.all([loadP, enP]).then(function (res) {
          dict = res[0] || Object.create(null);
          fallbackDict = res[1] || dict;
          applyDocAttrs(currentLang);
          applyTranslations();
          document.documentElement.classList.remove("i18n-loading");
          notifyListeners();
          resolve(currentLang);
        }, function () {
          document.documentElement.classList.remove("i18n-loading");
          resolve(currentLang);
        });
      }, { once: true });
    } else {
      mountSwitchers();
      startLoad();
    }
  });

  window.Layer2DI18n = {
    locales: LOCALES.slice(),
    get lang() { return currentLang; },
    get dir() { return getLocaleMeta(currentLang).dir; },
    ready: initialPromise,
    t: t,
    setLanguage: function (code) { return setLanguage(code, true); },
    apply: applyTranslations,
    mountSwitchers: mountSwitchers,
    onChange: function (fn) {
      if (typeof fn === "function") listeners.push(fn);
      return function () {
        var i = listeners.indexOf(fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    }
  };
})();
