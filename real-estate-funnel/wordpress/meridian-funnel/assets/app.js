/* Meridian CRE Funnel — form logic. Posts leads to the theme's REST endpoint
   (window.MERIDIAN.endpoint, injected by wp_localize_script). */
(function () {
  "use strict";

  var form = document.getElementById("lead-form");
  if (!form) return;

  var steps = Array.prototype.slice.call(form.querySelectorAll(".step"));
  var stepLabel = document.getElementById("step-label");
  var labels = {
    1: "Step 1 / 2 — The Property",
    2: "Step 2 / 2 — Where to Send It",
  };
  var current = 1;

  function showStep(n) {
    current = n;
    steps.forEach(function (s) {
      s.classList.toggle("active", +s.dataset.step === n);
    });
    stepLabel.textContent = labels[n];
  }

  function setError(field, on) {
    field.closest(".field").classList.toggle("show-err", on);
    if (field.tagName === "INPUT") field.classList.toggle("invalid", on);
  }

  function validateStep(n) {
    var ok = true;
    if (n === 1) {
      var addr = document.getElementById("address");
      var badAddr = addr.value.trim().length < 5;
      setError(addr, badAddr);
      var asset = document.getElementById("asset");
      var badAsset = !asset.value;
      asset.closest(".field").classList.toggle("show-err", badAsset);
      ok = !(badAddr || badAsset);
    }
    if (n === 2) {
      var name = document.getElementById("name");
      var email = document.getElementById("email");
      var phone = document.getElementById("phone");
      var badName = name.value.trim().length < 2;
      var badEmail = !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.value.trim());
      var badPhone = phone.value.replace(/\D/g, "").length < 10;
      setError(name, badName);
      setError(email, badEmail);
      setError(phone, badPhone);
      ok = !(badName || badEmail || badPhone);
    }
    return ok;
  }

  form.addEventListener("click", function (e) {
    if (e.target.matches("[data-next]")) {
      if (validateStep(current)) showStep(current + 1);
    }
    if (e.target.matches("[data-back]")) showStep(current - 1);
  });

  document.querySelector("[data-pills=asset]").addEventListener("click", function (e) {
    if (!e.target.classList.contains("pill")) return;
    this.querySelectorAll(".pill").forEach(function (p) { p.classList.remove("selected"); });
    e.target.classList.add("selected");
    var asset = document.getElementById("asset");
    asset.value = e.target.textContent;
    asset.closest(".field").classList.remove("show-err");
  });

  document.getElementById("phone").addEventListener("input", function (e) {
    var d = e.target.value.replace(/\D/g, "").slice(0, 10);
    var out = d;
    if (d.length > 6) out = "(" + d.slice(0, 3) + ") " + d.slice(3, 6) + "-" + d.slice(6);
    else if (d.length > 3) out = "(" + d.slice(0, 3) + ") " + d.slice(3);
    else if (d.length > 0) out = "(" + d;
    e.target.value = out;
  });

  form.addEventListener("input", function (e) {
    if (e.target.matches("input")) setError(e.target, false);
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!validateStep(2)) return;

    var btn = document.getElementById("submit-btn");
    btn.disabled = true;
    btn.textContent = "Sending…";

    var lead = {
      address: document.getElementById("address").value.trim(),
      asset: document.getElementById("asset").value,
      name: document.getElementById("name").value.trim(),
      email: document.getElementById("email").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      company: document.getElementById("company").value, // honeypot
    };

    fetch(window.MERIDIAN.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lead),
    })
      .catch(function (err) {
        // Never strand a real lead on a network hiccup — the email/CPT may
        // still have landed; log for debugging and show success regardless.
        console.error("Lead submit failed:", err, lead);
      })
      .then(function () {
        form.style.display = "none";
        stepLabel.style.display = "none";
        document.getElementById("form-title").textContent = "Request received";
        document.getElementById("form-sub").style.display = "none";
        document.getElementById("success").classList.add("active");
      });
  });

  /* Scroll-to-form buttons */
  function scrollToForm() {
    document.getElementById("lead-form-card").scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(function () {
      document.getElementById("address").focus({ preventScroll: true });
    }, 500);
  }
  document.querySelectorAll("[data-scroll-form]").forEach(function (b) {
    b.addEventListener("click", scrollToForm);
  });

  /* Hide sticky CTA while the form is on screen */
  var stickyCta = document.getElementById("sticky-cta");
  new IntersectionObserver(function (entries) {
    stickyCta.style.display = entries[0].isIntersecting ? "none" : "";
  }, { threshold: 0.2 }).observe(document.getElementById("lead-form-card"));
})();
