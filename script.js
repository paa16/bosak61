/* ==========================================================
   Bosak 61 Dental Care — behaviour
   ========================================================== */

(function () {
  "use strict";

  // ----- Clinic settings (edit here) -----
  const CLINIC = {
    whatsappNumber: "233546097561",   // country code + number, no + or spaces
    email: "bosakdental@gmail.com",
    // Time slots offered in the booking form (24h "HH:MM")
    slotStart: "08:00",
    slotEnd: "17:30",
    slotMinutes: 30,
    closedDays: [0]                   // 0 = Sunday. Add 6 for Saturday if closed.
  };

  // ----- Helpers -----
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function pad(n) { return String(n).padStart(2, "0"); }

  function formatTime(hhmm) {
    const [h, m] = hhmm.split(":").map(Number);
    const period = h >= 12 ? "pm" : "am";
    const hour12 = ((h + 11) % 12) + 1;
    return `${hour12}:${pad(m)} ${period}`;
  }

  // ----- Footer year -----
  const yearEl = $("#year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ----- Mobile navigation -----
  const navToggle = $("#navToggle");
  const nav = $("#nav");

  function setNav(open) {
    nav.classList.toggle("open", open);
    navToggle.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", String(open));
    navToggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  }

  navToggle.addEventListener("click", () => setNav(!nav.classList.contains("open")));
  $$(".nav a").forEach(link => link.addEventListener("click", () => setNav(false)));
  document.addEventListener("keydown", e => { if (e.key === "Escape") setNav(false); });

  // ----- Header shadow on scroll -----
  const header = $(".site-header");
  const onScroll = () => header.classList.toggle("scrolled", window.scrollY > 10);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ----- Reveal elements as they enter the viewport -----
  const revealEls = $$(".reveal");
  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12 });
    revealEls.forEach(el => observer.observe(el));
  } else {
    revealEls.forEach(el => el.classList.add("visible"));
  }

  // ----- Booking form -----
  const form = $("#bookingForm");
  const dateInput = $("#date");
  const timeSelect = $("#time");
  const successBox = $("#formSuccess");

  // Earliest bookable date is today; default to tomorrow-ish
  const today = new Date();
  const minDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  dateInput.min = `${minDate.getFullYear()}-${pad(minDate.getMonth() + 1)}-${pad(minDate.getDate())}`;

  // Build time slots
  function buildSlots() {
    const [sh, sm] = CLINIC.slotStart.split(":").map(Number);
    const [eh, em] = CLINIC.slotEnd.split(":").map(Number);
    let minutes = sh * 60 + sm;
    const end = eh * 60 + em;
    while (minutes <= end) {
      const hhmm = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
      const opt = document.createElement("option");
      opt.value = hhmm;
      opt.textContent = formatTime(hhmm);
      timeSelect.appendChild(opt);
      minutes += CLINIC.slotMinutes;
    }
  }
  buildSlots();

  // Block closed days (e.g. Sundays) in the date picker
  dateInput.addEventListener("input", () => {
    if (!dateInput.value) return;
    const day = new Date(dateInput.value + "T00:00:00").getDay();
    if (CLINIC.closedDays.includes(day)) {
      showError("date", "Sorry, we are closed that day. Please choose another date.");
      dateInput.value = "";
    } else {
      showError("date", "");
    }
  });

  // Validation helpers
  function setInvalid(fieldName, invalid) {
    const input = form.elements[fieldName];
    if (!input) return;
    input.closest(".field").classList.toggle("invalid", invalid);
    input.setAttribute("aria-invalid", String(invalid));
  }

  function showError(fieldName, message) {
    const el = $(`[data-error-for="${fieldName}"]`, form);
    if (el) el.textContent = message;
    setInvalid(fieldName, Boolean(message));
  }

  function validate() {
    const data = new FormData(form);
    const errors = {};

    const name = (data.get("name") || "").trim();
    const phone = (data.get("phone") || "").replace(/[\s\-()]/g, "");
    const email = (data.get("email") || "").trim();
    const service = data.get("service");
    const date = data.get("date");
    const time = data.get("time");

    if (name.length < 2) errors.name = "Please enter your full name.";
    if (!/^(\+?233|0)\d{9}$/.test(phone)) {
      errors.phone = "Enter a valid Ghana phone number, e.g. 024 000 0000.";
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = "That email address does not look right.";
    }
    if (!service) errors.service = "Please choose a service.";
    if (!date) {
      errors.date = "Please choose a date.";
    } else {
      const day = new Date(date + "T00:00:00").getDay();
      if (CLINIC.closedDays.includes(day)) errors.date = "We are closed that day. Please pick another date.";
    }
    if (!time) errors.time = "Please choose a time.";

    return errors;
  }

  // Clear errors as the user types
  form.addEventListener("input", e => {
    const name = e.target.name;
    if (name) showError(name, "");
  });

  form.addEventListener("submit", e => {
    e.preventDefault();
    successBox.hidden = true;

    const fields = ["name", "phone", "email", "service", "date", "time"];
    fields.forEach(f => showError(f, ""));

    const errors = validate();
    const errorKeys = Object.keys(errors);

    if (errorKeys.length) {
      errorKeys.forEach(key => showError(key, errors[key]));
      const firstInvalid = form.querySelector(".field.invalid input, .field.invalid select");
      if (firstInvalid) firstInvalid.focus();
      return;
    }

    const data = new FormData(form);
    const lines = [
      "Hello Bosak 61 Dental Care, I'd like to book an appointment.",
      "",
      `Name: ${data.get("name").trim()}`,
      `Phone: ${data.get("phone").trim()}`,
      data.get("email") ? `Email: ${data.get("email").trim()}` : null,
      `Service: ${data.get("service")}`,
      `Preferred date: ${data.get("date")}`,
      `Preferred time: ${formatTime(data.get("time"))}`,
      data.get("notes") ? `Notes: ${data.get("notes").trim()}` : null
    ].filter(Boolean);

    const url = `https://wa.me/${CLINIC.whatsappNumber}?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(url, "_blank", "noopener");

    successBox.hidden = false;
    form.reset();
    dateInput.min = dateInput.min; // keep min date after reset
  });
})();
