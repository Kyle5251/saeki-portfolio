(function () {
  "use strict";

  // 公開前にこの値を true にすると、編集モードの機能自体が無効化されます。
  var SITE_LOCKED = false;

  if (SITE_LOCKED) return;

  var TEXT_SELECTOR =
    ".page-header h1, .page-lead, .profile-summary__text h1, .profile-summary__text p, " +
    ".detail-section h2, .detail-section p, .detail-section li, .nav-card__label, " +
    ".digest-caption, .photo-gallery figcaption";
  var IMG_SELECTOR =
    ".banner img, .profile-summary__photo img, .detail-section img.section-thumb, " +
    ".detail-section .photo-digest img, .profile-summary__photo img, .photo-grid img, " +
    ".photo-gallery img";
  var BG_SELECTOR = ".nav-card--photo";
  // 縦横比を保ったまま拡大縮小したい画像（丸アイコン・バッジ系）
  var SQUARE_SELECTOR = ".photo-digest img, .profile-summary__photo img";

  var RADIUS_STEPS = ["", "8px", "16px", "50%"];

  var pageKey = location.pathname;
  var onKey = "editModeOn";

  function isEditOn() {
    var v = localStorage.getItem(onKey);
    return v === null ? true : v === "1";
  }

  function setEditOn(v) {
    localStorage.setItem(onKey, v ? "1" : "0");
  }

  function storageKey(type, index) {
    return "edit:" + type + ":" + pageKey + ":" + index;
  }

  function getComputedTranslate(el) {
    var t = getComputedStyle(el).transform;
    if (!t || t === "none") return { dx: 0, dy: 0 };
    var m = t.match(/matrix\(([^)]+)\)/);
    if (!m) return { dx: 0, dy: 0 };
    var parts = m[1].split(",").map(function (s) {
      return parseFloat(s);
    });
    return { dx: parts[4] || 0, dy: parts[5] || 0 };
  }

  function applyImgStyle(el, style) {
    if (!style) return;
    if (style.w) {
      el.style.width = style.w + "px";
      if (el.matches(SQUARE_SELECTOR)) {
        el.style.height = style.w + "px";
      }
    }
    if (style.radius !== undefined) el.style.borderRadius = style.radius;
    var tx = style.dx || 0;
    var ty = style.dy || 0;
    el.style.transform = "translate(" + tx + "px, " + ty + "px)";
    if (tx || ty) el.style.position = "relative";
  }

  function readImgStyle(el) {
    var t = getComputedTranslate(el);
    return {
      w: parseInt(el.style.width, 10) || null,
      radius: el.style.borderRadius || "",
      dx: t.dx,
      dy: t.dy,
    };
  }

  function saveImgStyle(el, index) {
    localStorage.setItem(storageKey("imgstyle", index), JSON.stringify(readImgStyle(el)));
  }

  function restore() {
    var texts = document.querySelectorAll(TEXT_SELECTOR);
    texts.forEach(function (el, i) {
      var saved = localStorage.getItem(storageKey("text", i));
      if (saved !== null) el.textContent = saved;
    });

    var imgs = document.querySelectorAll(IMG_SELECTOR);
    imgs.forEach(function (el, i) {
      var saved = localStorage.getItem(storageKey("img", i));
      if (saved !== null) el.src = saved;
      var savedStyle = localStorage.getItem(storageKey("imgstyle", i));
      if (savedStyle) {
        try {
          applyImgStyle(el, JSON.parse(savedStyle));
        } catch (err) {
          /* ignore malformed data */
        }
      }
    });

    var bgs = document.querySelectorAll(BG_SELECTOR);
    bgs.forEach(function (el, i) {
      var saved = localStorage.getItem(storageKey("bg", i));
      if (saved !== null) el.style.backgroundImage = "url('" + saved + "')";
    });
  }

  function resizeImageFile(file, maxDim, quality, callback) {
    var reader = new FileReader();
    reader.onload = function (e) {
      var img = new Image();
      img.onload = function () {
        var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        var w = Math.round(img.width * scale);
        var h = Math.round(img.height * scale);
        var canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        callback(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  var fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  var pendingTarget = null;

  fileInput.addEventListener("change", function () {
    if (!fileInput.files || !fileInput.files[0] || !pendingTarget) return;
    resizeImageFile(fileInput.files[0], 900, 0.85, function (dataUrl) {
      var type = pendingTarget.editType;
      var idx = pendingTarget.editIndex;
      if (type === "bg") {
        pendingTarget.el.style.backgroundImage = "url('" + dataUrl + "')";
      } else {
        pendingTarget.el.src = dataUrl;
      }
      localStorage.setItem(storageKey(type, idx), dataUrl);
      pendingTarget = null;
      fileInput.value = "";
    });
  });

  function applyEditability() {
    var on = isEditOn();
    document.body.classList.toggle("edit-mode-active", on);

    var texts = document.querySelectorAll(TEXT_SELECTOR);
    texts.forEach(function (el) {
      el.contentEditable = on ? "true" : "false";
    });

    var imgs = document.querySelectorAll(IMG_SELECTOR);
    imgs.forEach(function (el, i) {
      el.dataset.editType = "img";
      el.dataset.editIndex = i;
      el.style.cursor = on ? "grab" : "";
      el.style.touchAction = on ? "none" : "";
    });

    var bgs = document.querySelectorAll(BG_SELECTOR);
    bgs.forEach(function (el, i) {
      el.dataset.editType = "bg";
      el.dataset.editIndex = i;
      el.style.cursor = on ? "pointer" : "";
    });

    if (!on) closeToolbar();
  }

  function attachTextSaveHandlers() {
    var texts = document.querySelectorAll(TEXT_SELECTOR);
    texts.forEach(function (el, i) {
      el.addEventListener("blur", function () {
        if (!isEditOn()) return;
        localStorage.setItem(storageKey("text", i), el.textContent);
      });
    });
  }

  // --- 画像ツールバー（サイズ・枠・位置調整） ---
  var toolbar = null;
  var activeImg = null;

  function closeToolbar() {
    if (toolbar) toolbar.remove();
    toolbar = null;
    activeImg = null;
  }

  function nudge(el, dx, dy, index) {
    var cur = readImgStyle(el);
    cur.dx = (cur.dx || 0) + dx;
    cur.dy = (cur.dy || 0) + dy;
    applyImgStyle(el, cur);
    saveImgStyle(el, index);
  }

  function resizeBy(el, delta, index) {
    var current = el.getBoundingClientRect().width;
    var next = Math.max(32, Math.min(900, Math.round(current + delta)));
    var cur = readImgStyle(el);
    cur.w = next;
    applyImgStyle(el, cur);
    saveImgStyle(el, index);
  }

  function cycleRadius(el, index) {
    var cur = readImgStyle(el);
    var curIdx = RADIUS_STEPS.indexOf(cur.radius || "");
    var next = RADIUS_STEPS[(curIdx + 1) % RADIUS_STEPS.length];
    cur.radius = next;
    applyImgStyle(el, cur);
    saveImgStyle(el, index);
  }

  function openToolbar(el) {
    if (!isEditOn()) return;
    if (activeImg === el) {
      closeToolbar();
      return;
    }
    closeToolbar();
    activeImg = el;
    var index = el.dataset.editIndex;
    var isBg = el.classList.contains("nav-card--photo");

    toolbar = document.createElement("div");
    toolbar.className = "edit-img-toolbar";
    toolbar.innerHTML =
      '<button type="button" data-act="smaller" title="縮小">－</button>' +
      '<button type="button" data-act="bigger" title="拡大">＋</button>' +
      '<button type="button" data-act="radius" title="枠の形を変更">枠</button>' +
      '<button type="button" data-act="up" title="上へ">↑</button>' +
      '<button type="button" data-act="down" title="下へ">↓</button>' +
      '<button type="button" data-act="left" title="左へ">←</button>' +
      '<button type="button" data-act="right" title="右へ">→</button>' +
      '<button type="button" data-act="replace" title="画像を変更">📷</button>' +
      '<button type="button" data-act="close" title="閉じる">✕</button>';
    document.body.appendChild(toolbar);

    function place() {
      var rect = el.getBoundingClientRect();
      var top = window.scrollY + rect.top - toolbar.offsetHeight - 6;
      var left = window.scrollX + rect.left;
      if (top < window.scrollY) top = window.scrollY + rect.bottom + 6;
      toolbar.style.top = top + "px";
      toolbar.style.left = left + "px";
    }
    place();

    if (!isBg) {
      toolbar.querySelector('[data-act="smaller"]').addEventListener("click", function () {
        resizeBy(el, -16, index);
        place();
      });
      toolbar.querySelector('[data-act="bigger"]').addEventListener("click", function () {
        resizeBy(el, 16, index);
        place();
      });
      toolbar.querySelector('[data-act="radius"]').addEventListener("click", function () {
        cycleRadius(el, index);
      });
      ["up", "down", "left", "right"].forEach(function (dir) {
        toolbar.querySelector('[data-act="' + dir + '"]').addEventListener("click", function () {
          var step = 10;
          var map = { up: [0, -step], down: [0, step], left: [-step, 0], right: [step, 0] };
          nudge(el, map[dir][0], map[dir][1], index);
          place();
        });
      });
    } else {
      ["smaller", "bigger", "radius", "up", "down", "left", "right"].forEach(function (act) {
        var btn = toolbar.querySelector('[data-act="' + act + '"]');
        if (btn) btn.style.display = "none";
      });
    }

    toolbar.querySelector('[data-act="replace"]').addEventListener("click", function () {
      pendingTarget = { el: el, editType: isBg ? "bg" : "img", editIndex: index };
      fileInput.click();
    });
    toolbar.querySelector('[data-act="close"]').addEventListener("click", closeToolbar);
  }

  function attachImageClickHandlers() {
    document.addEventListener("click", function (e) {
      if (!isEditOn()) return;
      if (e.target.closest(".edit-img-toolbar")) return;
      if (suppressNextClick) {
        suppressNextClick = false;
        return;
      }
      var target = e.target.closest(IMG_SELECTOR + ", " + BG_SELECTOR);
      if (!target) {
        closeToolbar();
        return;
      }
      e.preventDefault();
      openToolbar(target);
    });

    window.addEventListener("scroll", closeToolbar, true);
  }

  // --- 画像のドラッグ移動 ---
  var suppressNextClick = false;
  var DRAG_THRESHOLD = 4;

  function attachImageDragHandlers() {
    var drag = null;

    document.addEventListener("pointerdown", function (e) {
      if (!isEditOn()) return;
      var target = e.target.closest(IMG_SELECTOR);
      if (!target) return;
      var cur = readImgStyle(target);
      drag = {
        el: target,
        index: target.dataset.editIndex,
        startX: e.clientX,
        startY: e.clientY,
        baseDx: cur.dx || 0,
        baseDy: cur.dy || 0,
        moved: false,
        pointerId: e.pointerId,
      };
      target.setPointerCapture(e.pointerId);
      target.classList.add("edit-img-dragging");
    });

    document.addEventListener("pointermove", function (e) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      var dx = e.clientX - drag.startX;
      var dy = e.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      closeToolbar();
      var style = readImgStyle(drag.el);
      style.dx = drag.baseDx + dx;
      style.dy = drag.baseDy + dy;
      applyImgStyle(drag.el, style);
    });

    function endDrag(e) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      drag.el.classList.remove("edit-img-dragging");
      if (drag.moved) {
        saveImgStyle(drag.el, drag.index);
        suppressNextClick = true;
      }
      drag = null;
    }

    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);
  }

  function buildPanel() {
    var panel = document.createElement("div");
    panel.className = "edit-panel";
    panel.innerHTML =
      '<span class="edit-panel__label">編集モード</span>' +
      '<button type="button" data-action="toggle"></button>' +
      '<button type="button" data-action="export">保存(ダウンロード)</button>' +
      '<button type="button" data-action="reset">リセット</button>';
    document.body.appendChild(panel);

    var toggleBtn = panel.querySelector('[data-action="toggle"]');

    function refreshToggleLabel() {
      toggleBtn.textContent = isEditOn() ? "ON" : "OFF";
    }
    refreshToggleLabel();

    toggleBtn.addEventListener("click", function () {
      setEditOn(!isEditOn());
      applyEditability();
      refreshToggleLabel();
    });

    panel.querySelector('[data-action="export"]').addEventListener("click", function () {
      closeToolbar();
      var clone = document.documentElement.cloneNode(true);
      var editPanel = clone.querySelector(".edit-panel");
      if (editPanel) editPanel.remove();
      var script = clone.querySelector('script[src="edit-mode.js"]');
      if (script) script.remove();
      var html = "<!doctype html>\n" + clone.outerHTML;
      var blob = new Blob([html], { type: "text/html" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (pageKey.replace(/^\//, "") || "index.html").replace(/\/$/, "index.html");
      document.body.appendChild(a);
      a.click();
      a.remove();
    });

    panel.querySelector('[data-action="reset"]').addEventListener("click", function () {
      if (!confirm("このページの編集内容をすべて元に戻しますか？")) return;
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf("edit:") === 0 && k.indexOf(":" + pageKey + ":") > -1) keys.push(k);
      }
      keys.forEach(function (k) {
        localStorage.removeItem(k);
      });
      location.reload();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    restore();
    applyEditability();
    attachTextSaveHandlers();
    attachImageClickHandlers();
    attachImageDragHandlers();
    buildPanel();
  });
})();
