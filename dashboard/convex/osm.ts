// OpenStreetMap helpers for the Lead Agent (free, no API key).
// Uses Nominatim for both:
// - geocoding: "Lahore, Pakistan" -> bounding box
// - business search: "dentist" inside that box, with phone/website/email tags
// Nominatim policy: max 1 request/second, identify yourself, keep volume small.

const USER_AGENT = "AadilCommandCenter/1.0 (TechVersa lead research; support@techversa.co)";
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const REQUEST_TIMEOUT_MS = 25000;
const NOMINATIM_PAUSE_MS = 1200; // stay under 1 request/second
const PAGE_SIZE = 40; // Nominatim max
const MAX_PAGES_PER_TERM = 3;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type Category = {
  label: string;
  searchTerms: string[]; // what to search for inside the city box
  value: number; // 0-20: how valuable this business type is as a client
  problem: string; // the business pain, in outcome terms
  solution: string; // the TechVersa package that fixes it
};

// Pitch = outcomes (missed calls, bookings, no-shows), not "you need a website".
// To add a business type: add an entry here, then add rows for it in leadTargets.
export const CATEGORIES: Record<string, Category> = {
  dentist: {
    label: "Dental clinic",
    searchTerms: ["dentist"],
    value: 20,
    problem:
      "Calls go unanswered during treatments and after hours, and there's no online booking — every missed call is a missed patient.",
    solution:
      "AI voice receptionist that answers every call and books appointments 24/7, WhatsApp reminders to cut no-shows, and a booking-ready website.",
  },
  clinic: {
    label: "Medical clinic",
    searchTerms: ["clinic", "doctors"],
    value: 18,
    problem:
      "Front desk is swamped with calls; patients who can't get through or book after hours go elsewhere.",
    solution:
      "AI voice receptionist for calls and bookings, automated WhatsApp reminders and follow-ups, and an online booking website.",
  },
  real_estate: {
    label: "Real estate agency",
    searchTerms: ["estate agent"],
    value: 18,
    problem:
      "Buyer and tenant enquiries arrive at all hours; slow replies and missed calls lose deals to faster agencies.",
    solution:
      "AI voice and WhatsApp assistant that answers and qualifies enquiries 24/7, automated follow-ups, and a listings website.",
  },
  lawyer: {
    label: "Law firm",
    searchTerms: ["lawyer"],
    value: 16,
    problem:
      "Prospective clients call once — if nobody answers, they call the next firm.",
    solution:
      "AI intake receptionist that answers, screens and books consultations, automated intake workflow, and a professional website.",
  },
  gym: {
    label: "Gym / fitness centre",
    searchTerms: ["gym", "fitness centre"],
    value: 14,
    problem:
      "Membership enquiries and class bookings are handled manually; interested leads go cold before anyone replies.",
    solution:
      "AI voice and WhatsApp assistant for enquiries and class bookings, automated renewal reminders, and a sign-up website.",
  },
  car_rental: {
    label: "Car rental",
    searchTerms: ["car rental"],
    value: 14,
    problem:
      "Bookings come in by phone only; missed or after-hours calls are lost rentals.",
    solution:
      "AI voice agent that takes bookings 24/7, WhatsApp booking confirmations and reminders, and a booking website with availability.",
  },
  beauty_salon: {
    label: "Beauty salon",
    searchTerms: ["beauty salon"],
    value: 10,
    problem:
      "Staff are busy with clients and miss booking calls; no-shows leave empty slots.",
    solution:
      "AI receptionist for calls, WhatsApp booking and reminders to cut no-shows, plus a simple booking page and Google profile.",
  },
  hair_salon: {
    label: "Hair salon",
    searchTerms: ["hairdresser"],
    value: 8,
    problem:
      "Bookings only by phone or walk-in; calls missed during appointments are lost customers.",
    solution:
      "AI receptionist and WhatsApp booking with automatic reminders, plus a booking link and Google Business Profile.",
  },
};

// OSM entries named just "Dentist", "Clinic", etc. — no real business name to pitch.
const GENERIC_NAMES = new Set([
  "dentist", "dental", "dental clinic", "dental care", "clinic", "doctor", "doctors",
  "medical clinic", "medical centre", "medical center", "hospital", "pharmacy",
  "hairdresser", "hair salon", "barber", "barbershop", "salon", "beauty salon",
  "beauty parlour", "beauty parlor", "gym", "fitness", "fitness centre", "fitness center",
  "car rental", "rent a car", "lawyer", "law office", "advocate", "real estate",
  "estate agent", "property dealer", "office", "shop",
]);

export function isGenericName(name: string, categoryKey?: string): boolean {
  const n = name.trim().toLowerCase();
  if (n.length < 3) return true;
  if (GENERIC_NAMES.has(n)) return true;
  const cat = categoryKey ? CATEGORIES[categoryKey] : undefined;
  if (cat && (n === cat.label.toLowerCase() || cat.searchTerms.includes(n))) return true;
  return false;
}

export type OsmBusiness = {
  osmUrl: string; // unique id we dedupe on
  name: string;
  phone?: string;
  email?: string;
  website?: string;
  socialUrl?: string;
  address?: string;
};

/** GET JSON with our identity and a hard timeout. */
async function getJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** "Lahore, Pakistan" -> [south, west, north, east] */
export async function geocodeCity(city: string): Promise<number[]> {
  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(city)}&format=json&limit=1`;
  const results = (await getJson(url)) as { boundingbox?: string[] }[];
  const bb = results[0]?.boundingbox;
  if (!bb || bb.length !== 4) throw new Error(`Could not find city "${city}"`);

  // Nominatim gives [south, north, west, east]
  const [south, north, west, east] = bb.map(Number);
  return [south, west, north, east];
}

function pick(tags: Record<string, string>, keys: string[]): string | undefined {
  for (const k of keys) if (tags[k]) return String(tags[k]).trim();
  return undefined;
}

function buildAddress(addr: Record<string, string> | undefined): string | undefined {
  if (!addr) return undefined;
  const street = [addr.house_number, addr.road].filter(Boolean).join(" ");
  const area = addr.suburb || addr.neighbourhood || addr.city_district || addr.quarter;
  const parts = [street, area].filter(Boolean);
  return parts.length ? parts.join(", ") : undefined;
}

/** All named businesses of a category inside a bounding box. */
export async function findBusinesses(
  bbox: number[],
  categoryKey: string
): Promise<OsmBusiness[]> {
  const category = CATEGORIES[categoryKey];
  if (!category) throw new Error(`Unknown category "${categoryKey}"`);

  const [s, w, n, e] = bbox;
  const viewbox = `${w},${n},${e},${s}`; // Nominatim viewbox: left,top,right,bottom

  const found = new Map<string, OsmBusiness>();
  const seenPlaceIds: number[] = [];

  for (const term of category.searchTerms) {
    for (let page = 0; page < MAX_PAGES_PER_TERM; page++) {
      const params = new URLSearchParams({
        q: term,
        format: "jsonv2",
        viewbox,
        bounded: "1",
        limit: String(PAGE_SIZE),
        extratags: "1",
        addressdetails: "1",
      });
      if (seenPlaceIds.length) params.set("exclude_place_ids", seenPlaceIds.join(","));

      const results = (await getJson(`${NOMINATIM_URL}?${params}`)) as any[];
      await sleep(NOMINATIM_PAUSE_MS);

      for (const r of results) {
        if (r.place_id) seenPlaceIds.push(r.place_id);
        if (!r.name || !r.osm_type || !r.osm_id) continue;
        if (isGenericName(r.name, categoryKey)) continue; // no real name to pitch

        const tags: Record<string, string> = r.extratags ?? {};
        const osmUrl = `https://www.openstreetmap.org/${r.osm_type}/${r.osm_id}`;
        if (found.has(osmUrl)) continue;

        found.set(osmUrl, {
          osmUrl,
          name: r.name,
          phone: pick(tags, ["phone", "contact:phone", "mobile", "contact:mobile"]),
          email: pick(tags, ["email", "contact:email"]),
          website: pick(tags, ["website", "contact:website", "url"]),
          socialUrl: pick(tags, ["contact:facebook", "facebook", "contact:instagram", "instagram"]),
          address: buildAddress(r.address),
        });
      }

      if (results.length < PAGE_SIZE) break; // no more pages for this term
    }
  }

  return [...found.values()];
}
