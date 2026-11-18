// "Chip in" donation box + thank-you pop-up, shared by every page.
// Inline mode (RSVP / What to Bring): the page reads Donate.value() and sends it with its own form.
// Standalone mode (Who's Coming, pop-up): the box has its own "I sent it" button that records the pledge.
(function () {
  var CASH = [["christinalarie", "$christinalarie"], ["ShannonMoceri", "$ShannonMoceri"]];
  var ZELLE = [["zelle-christina", "Christina", "(954) 854-2207", "9548542207"], ["zelle-shannon", "Shannon", "(754) 244-1524", "7542441524"]];
  var GIFT = '<svg class="gift" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-2.2A3 3 0 0 0 12 3.8 3 3 0 0 0 6.2 7H4a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h1v8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-8h1a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1Zm-5-2a1 1 0 0 1 0 2h-2V6a1 1 0 0 1 2-1ZM9 5a1 1 0 0 1 1 1v1H8a1 1 0 0 1 1-2Zm-4 4h6v1H5Zm2 3h4v7H7Zm6 7v-7h4v7Zm6-9h-6V9h6Z"/></svg>';

  function boxHTML(id, standalone) {
    return '<div class="donate-card" id="' + id + '">' +
      '<div class="donate-head">' + GIFT + '<div><h3 class="chip-title"><span class="shine">Chip in</span></h3><p class="opt">Optional</p></div></div>' +
      '<p class="donate-copy">Hosting a party this size adds up, so we may need a little extra to cover costs. If you’d like to pitch in, instead of a dish or on top of one, we’d be so grateful. <b>It’s never required</b>, just come hungry!</p>' +
      '<p class="suggest"></p>' +
      '<div class="amounts" role="group" aria-label="Donation amount"></div>' +
      '<p class="pay-label">Cash App</p><div class="pay-row">' +
        CASH.map(function (c) { return '<a class="btn btn-secondary pay cash" data-pay="' + c[0] + '" href="https://cash.app/$' + c[0] + '" target="_blank" rel="noopener">' + c[1] + "</a>"; }).join("") +
      '</div><p class="pay-label">Zelle <span>(tap to copy the number)</span></p><div class="pay-row">' +
        ZELLE.map(function (z) { return '<button type="button" class="btn btn-secondary pay zelle" data-pay="' + z[0] + '" data-num="' + z[3] + '"><span>' + z[1] + "</span><small>" + z[2] + "</small></button>"; }).join("") +
      "</div>" +
      (standalone
        ? '<div class="donate-who"><input type="text" class="d-name" placeholder="Your name" autocomplete="name" aria-label="Your name"></div>' +
          '<button type="button" class="btn btn-primary btn-block d-sent">I sent it, thank you!</button><p class="error d-err" role="alert"></p>'
        : '<p class="pay-foot">Pick an amount, send it on Cash App or Zelle, and we’ll see it with your submission. Only the hosts see donations.</p>') +
      "</div>";
  }

  var AMOUNTS = { dish: [10, 20, 30], nodish: [20, 30, 50] };
  function renderAmounts(root, state, noDish) {
    var box = root.querySelector(".amounts"), prevOther = box.querySelector(".amt-other");
    var otherVal = prevOther ? prevOther.value : "";
    var list = noDish === true ? AMOUNTS.nodish : AMOUNTS.dish;
    box.innerHTML = list.map(function (a) {
      return '<button type="button" class="amt" data-amt="' + a + '" aria-pressed="false">$' + a + (noDish === true && a === 20 ? "<small>suggested</small>" : "") + "</button>";
    }).join("") + '<input type="number" class="amt-other" inputmode="numeric" min="1" max="1000" placeholder="Other" aria-label="Other amount" value="' + otherVal + '">';
    root.querySelector(".suggest").innerHTML = noDish === true
      ? "<b>Not bringing a dish?</b> We suggest <b>$20 or more</b>."
      : noDish === false ? "" : "<b>Not bringing a dish?</b> We suggest <b>$20 or more</b>.";
    root.querySelector(".suggest").classList.toggle("hidden", noDish === false);
    state.noDish = noDish;
  }

  function wire(root, state, onChange, noDish) {
    renderAmounts(root, state, noDish);
    function other() { return root.querySelector(".amt-other"); }
    function set(v) {
      state.amount = Math.max(0, Math.min(1000, parseInt(v, 10) || 0));
      root.querySelectorAll(".amt").forEach(function (b) { b.setAttribute("aria-pressed", String(+b.dataset.amt === state.amount && !other().value)); });
      root.querySelectorAll(".cash").forEach(function (a) { a.href = "https://cash.app/$" + a.dataset.pay + (state.amount ? "/" + state.amount : ""); });
      onChange && onChange();
    }
    // Delegated so the amount buttons can be re-drawn when the suggestion changes.
    root.querySelector(".amounts").addEventListener("click", function (e) {
      var b = e.target.closest(".amt"); if (!b) return;
      other().value = ""; set(+b.dataset.amt === state.amount ? 0 : b.dataset.amt);
    });
    root.querySelector(".amounts").addEventListener("input", function (e) { if (e.target.classList.contains("amt-other")) set(e.target.value); });
    state.setNoDish = function (nd) { if (state.noDish === nd) return; renderAmounts(root, state, nd); set(other().value || state.amount); };
    root.querySelectorAll(".pay").forEach(function (el) {
      el.addEventListener("click", function () {
        state.payTo = el.dataset.pay;
        root.querySelectorAll(".pay").forEach(function (p) { p.classList.toggle("chosen", p === el); });
        if (el.dataset.num) {
          var done = function () { var s = el.querySelector("small"), t = s.textContent; s.textContent = "Copied!"; setTimeout(function () { s.textContent = t; }, 1800); };
          try { navigator.clipboard.writeText(el.dataset.num).then(done, done); } catch (e) { done(); }
        }
        onChange && onChange();
      });
    });
    state.reset = function () { other().value = ""; state.payTo = ""; root.querySelectorAll(".pay").forEach(function (p) { p.classList.remove("chosen"); }); set(0); };
    return set;
  }

  async function record(name, contact, amount, payTo) {
    var r = await fetch("/api/donate", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, contact: contact || "", amount: amount, payTo: payTo }) });
    var j = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(j.error || "Couldn’t save that. Please try again.");
  }

  function standalone(root, opts) {
    var st = { amount: 0, payTo: "" };
    wire(root, st, null, opts ? opts.noDish : undefined);
    var nameI = root.querySelector(".d-name"), err = root.querySelector(".d-err"), btn = root.querySelector(".d-sent");
    try { var g = JSON.parse(localStorage.getItem("basted-guest") || "null"); if (g && g.name) nameI.value = g.name; } catch (e) {}
    if (opts && opts.name) { nameI.value = opts.name; root.querySelector(".donate-who").classList.add("hidden"); }
    btn.addEventListener("click", async function () {
      err.textContent = "";
      if (!st.amount) { err.textContent = "Pick an amount first."; return; }
      if (!nameI.value.trim()) { err.textContent = "Add your name so we can thank you."; nameI.focus(); return; }
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        await record(nameI.value, opts && opts.contact, st.amount, st.payTo);
        root.innerHTML = '<div class="donate-thanks">' + GIFT + "<h3>Thank you!</h3><p>You’re the best. See you on the 21st!</p></div>";
        opts && opts.onDone && opts.onDone();
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = "I sent it, thank you!"; }
    });
  }

  var inlineState = { amount: 0, payTo: "" };
  window.Donate = {
    value: function () { return { donation: inlineState.amount, payTo: inlineState.payTo }; },
    reset: function () { inlineState.reset && inlineState.reset(); },
    // true = guest isn't bringing anything yet (suggest $20+), false = they are, undefined = unknown.
    setNoDish: function (nd) { inlineState.setNoDish && inlineState.setNoDish(nd); },
    // Pop-up after a submit. Shown at most once per page visit, and never if they just donated.
    prompt: function (opts) {
      if (window.__bastedAsked) return; window.__bastedAsked = true;
      var wrap = document.createElement("div");
      wrap.className = "donate-modal";
      wrap.innerHTML = '<div class="donate-dialog" role="dialog" aria-modal="true" aria-labelledby="dm-h">' +
        '<p class="dm-kicker" id="dm-h">' + (opts.headline || "You’re all set! One more thing…") + "</p>" +
        boxHTML("donate-pop", true) +
        '<button type="button" class="btn-text dm-later">Maybe later</button></div>';
      document.body.appendChild(wrap);
      var close = function () { wrap.remove(); document.removeEventListener("keydown", esc); };
      var esc = function (e) { if (e.key === "Escape") close(); };
      document.addEventListener("keydown", esc);
      wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
      wrap.querySelector(".dm-later").addEventListener("click", close);
      standalone(wrap.querySelector(".donate-card"), { name: opts.name, contact: opts.contact, noDish: opts.noDish, onDone: function () {
        var later = wrap.querySelector(".dm-later"); later.textContent = "Close"; later.focus();
      } });
      wrap.querySelector(".amt").focus();
    },
  };

  document.querySelectorAll(".donate-mount").forEach(function (m, i) {
    var solo = m.dataset.mode === "standalone";
    m.innerHTML = boxHTML("donate-" + i, solo);
    if (solo) standalone(m.firstChild);
    else wire(m.firstChild, inlineState, function () { window.dispatchEvent(new Event("donate-change")); });
  });
})();
