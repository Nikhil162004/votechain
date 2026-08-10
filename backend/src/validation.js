/**
 * Voter registration eligibility rules (demo electoral roll).
 * Only records that pass every check become eligible to vote.
 */

const NAME_RE = /^[A-Za-z][A-Za-z .'-]{1,79}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Accept: 12-digit Aadhaar-like, PAN-like ABCDE1234F, or VOTER-XXXX (8–20 alnum/hyphen)
const NATIONAL_ID_RE = /^(?:\d{12}|[A-Z]{5}\d{4}[A-Z]|VOTER-[A-Z0-9]{4,14}|[A-Z0-9-]{8,20})$/i;
const PIN_RE = /^\d{4,6}$/;
const PHONE_RE = /^[6-9]\d{9}$/; // India mobile

const INDIAN_STATES = new Set([
  "Andhra Pradesh",
  "Arunachal Pradesh",
  "Assam",
  "Bihar",
  "Chhattisgarh",
  "Goa",
  "Gujarat",
  "Haryana",
  "Himachal Pradesh",
  "Jharkhand",
  "Karnataka",
  "Kerala",
  "Madhya Pradesh",
  "Maharashtra",
  "Manipur",
  "Meghalaya",
  "Mizoram",
  "Nagaland",
  "Odisha",
  "Punjab",
  "Rajasthan",
  "Sikkim",
  "Tamil Nadu",
  "Telangana",
  "Tripura",
  "Uttar Pradesh",
  "Uttarakhand",
  "West Bengal",
  "Andaman and Nicobar Islands",
  "Chandigarh",
  "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi",
  "Jammu and Kashmir",
  "Ladakh",
  "Lakshadweep",
  "Puducherry",
  "Pune",
  "Mumbai",
  "Bengaluru",
  "Hyderabad",
  "HQ",
]);

function ageFromDob(dobStr) {
  const d = new Date(dobStr);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - d.getFullYear();
  const m = today.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < d.getDate())) age -= 1;
  return age;
}

/**
 * @returns {{ ok: true, data: object } | { ok: false, errors: string[] }}
 */
function validateRegistration(body = {}) {
  const errors = [];
  const name = String(body.name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const nationalId = String(body.nationalId || "").trim().toUpperCase();
  const phone = String(body.phone || "").trim();
  const region = String(body.region || "").trim();
  const dob = String(body.dob || "").trim();
  const pin = String(body.pin || "").trim();
  const confirmPin = String(body.confirmPin || "").trim();
  const citizenship = body.citizenship === true || body.citizenship === "true" || body.citizenship === "on";
  const declareEligible =
    body.declareEligible === true || body.declareEligible === "true" || body.declareEligible === "on";

  if (!NAME_RE.test(name)) {
    errors.push("Full name must be 2–80 letters (spaces and .'- allowed).");
  }
  if (!EMAIL_RE.test(email)) {
    errors.push("Enter a valid email address.");
  }
  if (!NATIONAL_ID_RE.test(nationalId)) {
    errors.push(
      "National / Voter ID invalid. Use 12-digit Aadhaar, PAN (ABCDE1234F), or VOTER-XXXX (8–20 chars)."
    );
  }
  if (phone && !PHONE_RE.test(phone)) {
    errors.push("Phone must be a valid 10-digit Indian mobile number.");
  }
  if (!phone) {
    errors.push("Mobile number is required.");
  }
  if (!region || region.length < 2 || region.length > 60) {
    errors.push("Region / state is required.");
  }
  const age = ageFromDob(dob);
  if (age === null) {
    errors.push("Date of birth is required (YYYY-MM-DD).");
  } else if (age < 18) {
    errors.push("You must be at least 18 years old to register as a voter.");
  } else if (age > 120) {
    errors.push("Date of birth looks invalid.");
  }
  // Reject future DOB
  if (dob && new Date(dob) > new Date()) {
    errors.push("Date of birth cannot be in the future.");
  }
  if (!PIN_RE.test(pin)) {
    errors.push("PIN must be 4–6 digits.");
  }
  if (pin !== confirmPin) {
    errors.push("PIN and confirm PIN do not match.");
  }
  if (!citizenship) {
    errors.push("You must confirm you are a citizen eligible to vote.");
  }
  if (!declareEligible) {
    errors.push("You must declare that the information provided is true and you are not already registered.");
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    data: {
      name,
      email,
      nationalId,
      phone,
      region,
      dob,
      age,
      pin,
      citizenship: true,
      declareEligible: true,
    },
  };
}

module.exports = {
  validateRegistration,
  ageFromDob,
  INDIAN_STATES: [...INDIAN_STATES].sort(),
  NAME_RE,
  EMAIL_RE,
  NATIONAL_ID_RE,
  PIN_RE,
};
