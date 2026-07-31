"""
gmaps_scraper.py — Google Maps scraper using Playwright.

DOM-first hybrid strategy:
1. Extract place cards from the DOM feed — gives us name + googleMapsUri
   + placeId (ChIJ...) + featureId (0x...:0x...) + lat/lng.
2. Hook page.on("response") to capture RPC responses (search.json,
   place.json). Walk them and try to enrich our DOM-derived entries by
   matching feature_id or place_id.
3. Click each place card to trigger place.json — fires the RPC that
   carries phone + website + structured address.
4. If RPC enrichment finds new places not in the DOM (rare), we keep
   them but mark with _featureId only.

The DOM is the source of truth for "what places exist on this page".
RPC is only an enrichment layer.

Usage as module:
    from gmaps_scraper import scrape_google_maps
    results = scrape_google_maps(query="restaurantes", city="Curitiba", uf="PR")
"""

from __future__ import annotations

import json
import re
import time
import logging
import os
import urllib.parse
from typing import Any, Dict, List, Optional, Set

from playwright.sync_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    Response,
    sync_playwright,
)

logger = logging.getLogger("gmaps_scraper")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(_h)


# ---------------------------------------------------------------------------
# Constants & patterns
# ---------------------------------------------------------------------------

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)

PLACE_ID_RE = re.compile(r"^ChIJ[A-Za-z0-9_\-]{16,}$")
FEATURE_ID_RE = re.compile(r"^0x[0-9a-fA-F]+:0x[0-9a-fA-F]+$")
CEP_RE = re.compile(r"\b(\d{5})-(\d{3})\b")

# A phone number must have at least 8 digits (BR landlines: 10, mobile: 11
# with area code, or 8-9 without). We strip non-digits and check.
PHONE_DIGITS_RE = re.compile(r"\d")
# Phone string must start with + or contain digits with separators
PHONE_STRING_RE = re.compile(r"^\+?[\d][\d\s\-()]{6,}$")

URL_RE = re.compile(r"^https?://", re.IGNORECASE)

# Brazilian bounds (rough): lat [-34, +5], lng [-74, -34]
BR_LAT_MIN, BR_LAT_MAX = -34.0, 5.5
BR_LNG_MIN, BR_LNG_MAX = -74.0, -34.0

# Enable RPC dump for debugging (saves first N responses to /tmp/scraper_debug/)
DEBUG_DUMP_RPC = os.getenv("DEBUG_DUMP_RPC", "0") == "1"
DEBUG_DUMP_DIR = "/tmp/scraper_debug"
DEBUG_DUMP_MAX = 3  # cap to avoid filling disk


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

def _build_search_url(query: str, city: str, uf: str) -> str:
    """Build the Google Maps search URL with a geo-anchored query."""
    q = f"{query} em {city}, {uf}, Brasil"
    return f"https://www.google.com/maps/search/{urllib.parse.quote(q)}"


def _parse_uri_for_place(href: str) -> Dict[str, Any]:
    """
    Extract placeId / lat / lng / featureId from a Google Maps place URL.

    Example URL:
      https://www.google.com/maps/place/Quintana+Gastronomia/data=!4m7!3m6!1s0x94dce3890b564277:0x75157260ead42611!8m2!3d-25.441833!4d-49.287054!16s%2Fg%2F1v8j1lc5!19sChIJd0JWC4nj3JQRESbU6mByFXU

    - !3d{lat}!4d{lng}     -> latitude/longitude
    - !1s{feature_id}      -> feature_id (0x...:0x...)
    - !19s{place_id}       -> canonical place_id (ChIJ...)
    """
    out: Dict[str, Any] = {}
    if not href:
        return out

    m = re.search(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)", href)
    if m:
        try:
            lat = float(m.group(1))
            lng = float(m.group(2))
            # Validate bounds
            if BR_LAT_MIN <= lat <= BR_LAT_MAX and BR_LNG_MIN <= lng <= BR_LNG_MAX:
                out["latitude"] = lat
                out["longitude"] = lng
        except ValueError:
            pass

    m = re.search(r"!19s=?(ChIJ[A-Za-z0-9_\-]+)", href)
    if m:
        out["placeId"] = m.group(1)

    m = re.search(r"!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)", href)
    if m:
        out["featureId"] = m.group(1)
    else:
        m = re.search(r"(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)", href)
        if m:
            out["featureId"] = m.group(1)

    m = re.search(r"/place/([^/]+?)(?:/data=|/@|\?|$)", href)
    if m:
        try:
            out["urlName"] = urllib.parse.unquote_plus(m.group(1))
        except Exception:
            pass

    return out


def _parse_address_from_text(text: str) -> Dict[str, Any]:
    """
    Best-effort Brazilian address parser.
    Expected BR format from Google Maps:
      "Rua dos Pinheiros, 123 - Centro, Curitiba - PR, 80000-000, Brasil"
      <route>, <number> - <sublocality>, <locality> - <UF>, <CEP>, <country>
    """
    out: Dict[str, Any] = {
        "streetNumber": None,
        "route": None,
        "sublocality": None,
        "locality": None,
        "administrativeArea": None,
        "postalCode": None,
        "country": "Brasil",
    }
    if not text:
        return out

    cep_m = CEP_RE.search(text)
    if cep_m:
        out["postalCode"] = cep_m.group(0)

    uf_m = re.search(r"(?:^|[\s,\-])([A-Z]{2})(?:\s*,\s*|\s*$|\s+Brasil)", text)
    if uf_m:
        out["administrativeArea"] = uf_m.group(1)

    city_m = re.search(
        r",\s*([^,\n]+?)\s*-\s*([A-Z]{2})(?:\s*,|\s*$|\s+Brasil)",
        text,
    )
    if city_m:
        out["locality"] = city_m.group(1).strip()
        out["administrativeArea"] = city_m.group(2)

    street_m = re.search(
        r"((?:Rua|Avenida|Av\.?|Travessa|Trav\.?|Alameda|Al\.?|Praça|Pc\.?|Rod\.?|Estrada|Est\.?|Viela|Beco)\s+[^,]+?)\s*,\s*(\d+)?",
        text,
        re.IGNORECASE,
    )
    if street_m:
        out["route"] = street_m.group(1).strip()
        if street_m.group(2):
            out["streetNumber"] = street_m.group(2)

    bairro_m = re.search(r"\s-\s([^,\-\n]{3,40}?)\s*,", text)
    if bairro_m:
        candidate = bairro_m.group(1).strip()
        if candidate and (not out.get("locality") or candidate.lower() != out["locality"].lower()):
            if not re.match(r"^\d+$", candidate):
                out["sublocality"] = candidate

    return out


def _looks_like_business_name(s: str) -> bool:
    """
    Heuristic: does this string look like a real business name?
    Returns True for 'Quintana Gastronomia', False for 'oulsavanK7zO5OUPvditoAw'
    or 'Av. do Batel, 1440 - Batel'.
    """
    if not s or len(s) < 3 or len(s) > 120:
        return False
    # Has at least one letter
    if not any(c.isalpha() for c in s):
        return False
    # Skip Google's internal IDs
    if PLACE_ID_RE.match(s):
        return False
    if FEATURE_ID_RE.match(s):
        return False
    # Skip long alphanumeric-only strings (likely obfuscated IDs)
    if re.match(r"^[A-Za-z0-9_\-]{20,}$", s) and not " " in s:
        return False
    # Not an address (no comma + digit pattern)
    if re.match(r"^(Rua|Avenida|Av\.?|Travessa|Alameda|Praça|Rod\.?|Estrada)\s", s, re.IGNORECASE):
        return False
    # Not a phone or CEP
    if PHONE_STRING_RE.match(s):
        return False
    if CEP_RE.fullmatch(s):
        return False
    # Not a URL
    if URL_RE.match(s):
        return False
    return True


def _validate_phone(s: str) -> Optional[str]:
    """Return the phone if valid, None otherwise."""
    if not s:
        return None
    # Reject CEPs explicitly (8 digits with dash in CEP format)
    if CEP_RE.fullmatch(s):
        return None
    digits = PHONE_DIGITS_RE.findall(s)
    if len(digits) < 10 or len(digits) > 15:
        return None
    # Must have either + (country code) or be 10-11 digits (BR landline/mobile)
    return s


def _validate_rating(f: float) -> Optional[float]:
    """Return rating if in valid range, None otherwise."""
    if f is None:
        return None
    try:
        f = float(f)
    except (TypeError, ValueError):
        return None
    if 1.0 <= f <= 5.0:
        return f
    return None


def _validate_lat_lng(lat: Any, lng: Any) -> Optional[tuple]:
    """Return (lat, lng) if both are valid BR coords, None otherwise."""
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return None
    # Strict Brazilian bounds (with small margin)
    if -35.5 <= lat_f <= 6.0 and -75.0 <= lng_f <= -33.0:
        return (lat_f, lng_f)
    return None


# ---------------------------------------------------------------------------
# RPC collector — intercepts Google Maps internal XHRs
# ---------------------------------------------------------------------------

class RpcCollector:
    """
    Captures Google Maps internal RPC responses (search.json, place.json).

    Strategy: walk the nested JSON, harvest (place_id, feature_id, and
    surrounding strings/numbers) per "place container". A place container
    is identified by containing BOTH:
      - a feature_id (0x...:0x...) OR place_id (ChIJ...)
      - a string that looks like a business name (per _looks_like_business_name)

    All extracted fields are validated before being stored.
    """

    def __init__(self):
        # Keyed by featureId (preferred) or placeId
        # Values: dict of partial fields
        self.places: Dict[str, Dict[str, Any]] = {}
        self.place_id_index: Dict[str, str] = {}  # placeId -> key in self.places
        self.rpc_count = 0
        self.rpc_search_count = 0
        self.rpc_place_count = 0
        self._dumped = 0

    # ---- response hook ----
    def on_response(self, response: Response):
        try:
            url = response.url or ""
            if "/maps/rpc/" not in url and "/maps/preview/" not in url:
                return
            ct = response.headers.get("content-type", "")
            if "json" not in ct and ".json" not in url:
                return

            try:
                data = response.json()
            except Exception:
                try:
                    raw = response.text()
                    stripped = re.sub(r"^\)\]\}\'?\s*\n?", "", raw)
                    data = json.loads(stripped)
                except Exception:
                    return

            if not data:
                return

            self.rpc_count += 1
            is_search = "search" in url or "listresults" in url
            is_place = "place" in url and "search" not in url
            if is_search:
                self.rpc_search_count += 1
            elif is_place:
                self.rpc_place_count += 1

            # Debug dump first few responses
            if DEBUG_DUMP_RPC and self._dumped < DEBUG_DUMP_MAX:
                self._dump_response(url, data, is_search, is_place)
                self._dumped += 1

            self._extract_places_from_rpc(data)
        except Exception as e:
            logger.debug(f"on_response error: {e}")

    def _dump_response(self, url: str, data: Any, is_search: bool, is_place: bool):
        try:
            os.makedirs(DEBUG_DUMP_DIR, exist_ok=True)
            tag = "search" if is_search else ("place" if is_place else "other")
            path = os.path.join(DEBUG_DUMP_DIR, f"rpc_{self._dumped:02d}_{tag}.json")
            with open(path, "w", encoding="utf-8") as f:
                # Truncate huge responses
                s = json.dumps(data, ensure_ascii=False, default=str)[:200_000]
                f.write(s)
            logger.info(f"[DEBUG] dumped RPC response #{self._dumped} ({tag}) -> {path}")
            # Also log URL for context
            with open(os.path.join(DEBUG_DUMP_DIR, "urls.log"), "a") as f:
                f.write(f"#{self._dumped} {tag}: {url[:200]}\n")
        except Exception as e:
            logger.debug(f"dump failed: {e}")

    # ---- recursive walker ----
    def _extract_places_from_rpc(self, data: Any):
        visited: Set[int] = set()

        def walk(node: Any, depth: int = 0):
            if id(node) in visited:
                return
            visited.add(id(node))
            if depth > 30:
                return

            if isinstance(node, list):
                # Only try parsing as place if list is reasonable size
                # (Google's place entries are typically 10-30 elements)
                if 5 <= len(node) <= 40:
                    place = self._try_parse_place(node)
                    if place:
                        self._merge_place(place)
                for item in node:
                    walk(item, depth + 1)
            elif isinstance(node, dict):
                for v in node.values():
                    walk(v, depth + 1)

        walk(data)

    def _try_parse_place(self, arr: List) -> Optional[Dict[str, Any]]:
        """
        Conservative place parser. Only accepts lists that contain
        BOTH an ID (ChIJ or 0x...:0x...) AND a valid business name.

        Field extraction uses positional heuristics after validation.
        """
        if not arr or len(arr) < 5 or len(arr) > 40:
            return None

        # Harvest scalars (shallow + immediate sub-lists of size 1-4)
        strings: List[str] = []
        floats: List[float] = []
        ints: List[int] = []

        def _harvest(item: Any):
            if isinstance(item, str):
                strings.append(item)
            elif isinstance(item, bool):
                pass
            elif isinstance(item, int):
                ints.append(item)
                floats.append(float(item))
            elif isinstance(item, float):
                floats.append(item)

        for item in arr:
            _harvest(item)
            if isinstance(item, list) and 1 <= len(item) <= 4:
                for sub in item:
                    _harvest(sub)

        # Find IDs
        place_id: Optional[str] = None
        feature_id: Optional[str] = None
        for s in strings:
            if not place_id and PLACE_ID_RE.match(s):
                place_id = s
            if not feature_id and FEATURE_ID_RE.match(s):
                feature_id = s

        if not place_id and not feature_id:
            return None

        # Find business name — must pass _looks_like_business_name
        name: Optional[str] = None
        for s in strings:
            if _looks_like_business_name(s) and not PLACE_ID_RE.match(s) and not FEATURE_ID_RE.match(s):
                # Skip if it's clearly the address
                if CEP_RE.search(s):
                    continue
                name = s
                break

        if not name:
            # Don't return a "place" without a real name — too risky
            return None

        # Address: long string with comma + CEP or street pattern
        address: Optional[str] = None
        for s in strings:
            if s == name or len(s) < 15:
                continue
            if "," not in s:
                continue
            # Skip URLs, IDs, phones
            if URL_RE.match(s) or PHONE_STRING_RE.match(s):
                continue
            if PLACE_ID_RE.match(s) or FEATURE_ID_RE.match(s):
                continue
            # Address should have either CEP, or a street prefix, or end with UF
            if (
                CEP_RE.search(s)
                or re.search(r"\s-\s([A-Z]{2})\s*[,]", s)
                or re.match(r"^(Rua|Avenida|Av\.?|Travessa|Alameda|Praça|Rod\.?|Estrada)\s", s, re.IGNORECASE)
            ):
                address = s
                break

        # Phone: validate strictly
        phone: Optional[str] = None
        for s in strings:
            if s == name or s == address:
                continue
            if PHONE_STRING_RE.match(s) and not CEP_RE.fullmatch(s):
                validated = _validate_phone(s)
                if validated:
                    phone = validated
                    break

        # Website: starts with http(s)://, not google domains
        website: Optional[str] = None
        for s in strings:
            if not URL_RE.match(s):
                continue
            if any(d in s for d in ("google.com", "gstatic", "googleusercontent", "googleapis")):
                continue
            website = s
            break

        # Rating: small float, validated
        rating: Optional[float] = None
        for f in floats:
            r = _validate_rating(f)
            if r is not None:
                rating = r
                break

        # Review count: integer in reasonable range
        review_count: Optional[int] = None
        for i in sorted(ints, reverse=True):
            if 1 <= i <= 5_000_000:
                review_count = i
                break

        # Lat/lng: pair of validated BR coords
        latlng: Optional[tuple] = None
        for i, f in enumerate(floats):
            if i + 1 < len(floats):
                candidate = _validate_lat_lng(f, floats[i + 1])
                if candidate:
                    latlng = candidate
                    break

        place: Dict[str, Any] = {
            "placeId": place_id,
            "name": name,
            "formattedAddress": address,
            "rating": rating,
            "userRatingCount": review_count,
            "website": website,
            "phone": phone,
            "businessStatus": "OPERATIONAL",
            "googleMapsUri": None,
            "addressParts": _parse_address_from_text(address or ""),
        }
        if feature_id:
            place["_featureId"] = feature_id
        if latlng:
            place["latitude"] = latlng[0]
            place["longitude"] = latlng[1]

        return place

    # ---- merge into accumulator ----
    def _merge_place(self, place: Dict[str, Any]):
        pid = place.get("placeId")
        fid = place.get("_featureId")
        # Prefer feature_id as key (more commonly present in search responses)
        key = fid or pid
        if not key:
            return

        if key in self.places:
            existing = self.places[key]
            for k, v in place.items():
                if v is not None and existing.get(k) is None:
                    existing[k] = v
                if k == "addressParts" and isinstance(v, dict):
                    ex_ap = existing.get("addressParts") or {}
                    for sub_k, sub_v in v.items():
                        if sub_v is not None and ex_ap.get(sub_k) is None:
                            ex_ap[sub_k] = sub_v
                    existing["addressParts"] = ex_ap
            if pid and pid not in self.place_id_index:
                self.place_id_index[pid] = key
        else:
            self.places[key] = place
            if pid:
                self.place_id_index[pid] = key

    def find_by_feature_id(self, fid: str) -> Optional[Dict[str, Any]]:
        return self.places.get(fid)

    def find_by_place_id(self, pid: str) -> Optional[Dict[str, Any]]:
        key = self.place_id_index.get(pid)
        if key:
            return self.places.get(key)
        return None


# ---------------------------------------------------------------------------
# DOM extraction — source of truth for "what places exist"
# ---------------------------------------------------------------------------

# Regex for rating in BR format: "4,7" or "4.7" (decimal separator , or .)
RATING_RE = re.compile(r"^\d+[.,]\d$")
# Regex for review count in BR format: "(1.234)" or "(1234)" with parens
REVIEWS_RE = re.compile(r"^\(([\d.,]+)\)$")
# Regex for review count without parens (sometimes shows up)
REVIEWS_NO_PAREN_RE = re.compile(r"^([\d.,]+)\s*(?:opiniões|reviews|avaliações)$", re.IGNORECASE)

# Categories that appear in Google Maps cards — used to identify category lines
KNOWN_CATEGORIES = {
    "restaurante", "restaurant", "bar", "café", "cafe", "padaria", "bakery",
    "pizzaria", "pizza", "hotel", "mercado", "supermercado", "farmácia",
    "farmacia", "academia", "gym", "salão", "salon", "barbeiro", "barber",
    "loja", "store", "shop", "shopping", "posto", "banco", "bank",
    "consultório", "consultorio", "clínica", "clinica", "escritório",
    "escritorio", "advogado", "lawyer", "dentista", "dentist",
    "tratamento estético", "estética", "estetica",
}

# Status keywords (used to identify status lines)
STATUS_OPEN_KEYWORDS = {"aberto", "abre", "open", "fecha às", "fecha as", "fecha"}
STATUS_CLOSED_KEYWORDS = {"fechado", "closed", "fecha agora"}


def _parse_card_text(text: str) -> Dict[str, Any]:
    """
    Parse the inner_text() of a Google Maps result card.

    Typical card layout (after stripping HTML):
        Quintana Gastronomia
        4,7
        (1.234)
        Restaurante · $$
        Aberto · Fecha 23h
        Av. do Batel, 1440 - Batel, Curitiba - PR

    Returns dict with optional keys:
        rating, userRatingCount, category, formattedAddress, addressParts, businessStatus
    """
    out: Dict[str, Any] = {}
    if not text:
        return out

    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return out

    # Track which lines we've consumed to find address at the end
    consumed: Set[int] = set()

    for i, line in enumerate(lines):
        if i in consumed:
            continue

        # Rating: line that is just "X,X" or "X.X" with value 1.0-5.0
        if RATING_RE.match(line):
            try:
                r = float(line.replace(",", "."))
                if 1.0 <= r <= 5.0:
                    out["rating"] = r
                    consumed.add(i)
                    # Look ahead for reviews in next 1-2 lines
                    for j in range(i + 1, min(i + 3, len(lines))):
                        if j in consumed:
                            continue
                        m = REVIEWS_RE.match(lines[j])
                        if m:
                            try:
                                count = int(m.group(1).replace(".", "").replace(",", ""))
                                out["userRatingCount"] = count
                                consumed.add(j)
                                break
                            except ValueError:
                                pass
                        m2 = REVIEWS_NO_PAREN_RE.match(lines[j])
                        if m2:
                            try:
                                count = int(m2.group(1).replace(".", "").replace(",", ""))
                                out["userRatingCount"] = count
                                consumed.add(j)
                                break
                            except ValueError:
                                pass
            except ValueError:
                pass
            continue

    # Category: line with " · " separator and short tokens (e.g. "Restaurante · $$")
    for i, line in enumerate(lines):
        if i in consumed:
            continue
        if " · " in line and len(line) < 80:
            # Check if first token looks like a category
            first = line.split(" · ")[0].strip().lower()
            if any(cat in first for cat in KNOWN_CATEGORIES) or len(first) < 30:
                # Don't overwrite category if already set
                if "category" not in out:
                    out["category"] = first
                    consumed.add(i)

    # Address: look for a line that ends with ", XX" (UF) or has a street prefix
    # Iterate from end backwards — address is usually the last meaningful line
    for i in range(len(lines) - 1, -1, -1):
        if i in consumed:
            continue
        line = lines[i]
        # Skip very short lines
        if len(line) < 15:
            continue
        # Skip status lines
        lower = line.lower()
        if any(kw in lower for kw in STATUS_OPEN_KEYWORDS) or any(kw in lower for kw in STATUS_CLOSED_KEYWORDS):
            continue
        # Skip rating line
        if RATING_RE.match(line):
            continue
        # Skip "·" lines (categories)
        if " · " in line and len(line) < 80:
            continue
        # Address: has comma AND has digits OR ends with UF
        if "," in line:
            if (
                re.search(r"\d", line)  # has a digit (street number or CEP)
                or re.search(r"\b[A-Z]{2}\b", line)  # has UF code
            ):
                out["formattedAddress"] = line
                out["addressParts"] = _parse_address_from_text(line)
                consumed.add(i)
                break

    return out


def _get_card_text(entry) -> str:
    """
    Get the full text of a Google Maps result card from an <a> element.

    Strategy:
    1. Try entry.inner_text() — sometimes the <a> itself has all the card text
    2. Try parent.inner_text() — go up to find the card container
    3. Try grandparent.inner_text() — one more level up
    Returns whichever has the most lines (most info).
    """
    candidates: List[str] = []
    try:
        candidates.append(entry.inner_text() or "")
    except Exception:
        pass

    try:
        parent = entry.evaluate_handle("el => el.parentElement")
        if parent:
            candidates.append(parent.inner_text() or "")
            grandparent = parent.evaluate_handle("el => el.parentElement")
            if grandparent:
                candidates.append(grandparent.inner_text() or "")
    except Exception:
        pass

    # Pick the candidate with the most newlines (most info)
    if not candidates:
        return ""
    return max(candidates, key=lambda t: t.count("\n"))


def _extract_dom_entries(page: Page) -> List[Dict[str, Any]]:
    """
    Extract place entries from current DOM state.
    Returns list of dicts with: placeId, name, googleMapsUri, lat, lng,
    and (when available) rating, userRatingCount, formattedAddress,
    addressParts, category.
    """
    results: List[Dict[str, Any]] = []
    try:
        entries = page.query_selector_all(
            'div[role="feed"] a[href*="/maps/place/"], '
            'a[role="button"][href*="/maps/place/"]'
        )
    except Exception:
        return results

    seen_hrefs: Set[str] = set()
    for entry in entries:
        try:
            href = entry.get_attribute("href") or ""
            if "/maps/place/" not in href or href in seen_hrefs:
                continue
            seen_hrefs.add(href)

            aria_label = (entry.get_attribute("aria-label") or "").strip()
            name = aria_label or None

            parsed = _parse_uri_for_place(href)
            if parsed.get("urlName") and (not name or len(name) < 3):
                name = parsed["urlName"]

            # Validate name with our heuristic
            if not name or not _looks_like_business_name(name):
                if not parsed.get("urlName"):
                    continue
                name = parsed["urlName"]

            place_id = parsed.get("placeId") or f"dom:{abs(hash(href)) & 0xFFFFFFFF:08x}"

            # Parse card text for rating/reviews/address/category
            card_text = _get_card_text(entry)
            card_data = _parse_card_text(card_text)

            place: Dict[str, Any] = {
                "placeId": place_id,
                "name": name,
                "formattedAddress": card_data.get("formattedAddress"),
                "rating": card_data.get("rating"),
                "userRatingCount": card_data.get("userRatingCount"),
                "googleMapsUri": href.split("?")[0] if href else href,
                "addressParts": card_data.get("addressParts") or {
                    "streetNumber": None,
                    "route": None,
                    "sublocality": None,
                    "locality": None,
                    "administrativeArea": None,
                    "postalCode": None,
                    "country": "Brasil",
                },
                "website": None,
                "phone": None,
                "businessStatus": "OPERATIONAL",
            }
            if parsed.get("featureId"):
                place["_featureId"] = parsed["featureId"]
            if "latitude" in parsed:
                place["latitude"] = parsed["latitude"]
            if "longitude" in parsed:
                place["longitude"] = parsed["longitude"]

            results.append(place)
        except Exception:
            continue

    return results


# ---------------------------------------------------------------------------
# Main scraper
# ---------------------------------------------------------------------------

def scrape_google_maps(
    query: str,
    city: str,
    uf: str,
    *,
    max_results: int = 60,
    headless: bool = True,
    timeout_ms: int = 30000,
    max_scrolls: int = 25,
    lang: str = "pt-BR",
) -> List[Dict[str, Any]]:
    """
    Scrape Google Maps for businesses matching the query in the given city/UF.

    Returns a list of normalized dicts with keys:
        placeId, name, formattedAddress, website, phone, rating,
        userRatingCount, googleMapsUri, businessStatus, addressParts,
        latitude, longitude
    """
    url = _build_search_url(query, city, uf)
    logger.info(f"Scraping: {url}")

    collector = RpcCollector()

    with sync_playwright() as pw:
        browser: Browser = pw.chromium.launch(
            headless=headless,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-blink-features=AutomationControlled",
                "--disable-dev-shm-usage",
            ],
        )
        context: BrowserContext = browser.new_context(
            user_agent=USER_AGENT,
            locale=lang,
            timezone_id="America/Sao_Paulo",
            viewport={"width": 1440, "height": 900},
        )
        page: Page = context.new_page()
        page.set_default_timeout(timeout_ms)

        page.on("response", collector.on_response)

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            logger.warning(f"goto failed: {e}")

        # Accept cookies
        try:
            page.wait_for_selector(
                'button[aria-label*="Accept" i], button[aria-label*="Aceitar" i]',
                timeout=4000,
            )
            page.click('button[aria-label*="Accept" i], button[aria-label*="Aceitar" i]')
            logger.info("Cookies banner accepted")
        except Exception:
            pass

        # Wait for results panel
        try:
            page.wait_for_selector(
                'div[role="feed"] a[href*="/maps/place/"], a[role="button"][href*="/maps/place/"]',
                timeout=20000,
            )
            logger.info("Results panel appeared")
        except Exception:
            logger.warning("Results panel did not appear in time")

        # Give RPC time to fire
        page.wait_for_timeout(3000)

        # Initial DOM extraction
        dom_places = _extract_dom_entries(page)
        logger.info(
            f"Initial: DOM={len(dom_places)} entries, "
            f"RPC={len(collector.places)} places "
            f"(rpc_total={collector.rpc_count}, "
            f"search_calls={collector.rpc_search_count}, "
            f"place_calls={collector.rpc_place_count})"
        )

        # ============================================================
        # Scroll loop
        # ============================================================
        last_rpc_count = len(collector.places)
        last_dom_count = len(dom_places)
        stable_rounds = 0
        for i in range(max_scrolls):
            if len(dom_places) >= max_results:
                break
            try:
                page.evaluate(
                    """
                    () => {
                      const el = document.querySelector('div[role="feed"]');
                      if (el) el.scrollBy(0, el.clientHeight * 0.85);
                    }
                    """
                )
            except Exception:
                pass
            page.wait_for_timeout(2200)

            dom_places = _extract_dom_entries(page)

            new_rpc_count = len(collector.places)
            new_dom_count = len(dom_places)
            if new_rpc_count == last_rpc_count and new_dom_count == last_dom_count:
                stable_rounds += 1
                if stable_rounds >= 3:
                    logger.info(
                        f"Results stable at RPC={new_rpc_count}, "
                        f"DOM={new_dom_count} — stopping scroll"
                    )
                    break
            else:
                stable_rounds = 0
            last_rpc_count = new_rpc_count
            last_dom_count = new_dom_count
            if (i + 1) % 3 == 0:
                logger.info(
                    f"Scroll {i+1}: RPC={new_rpc_count}, DOM={new_dom_count}"
                )

        # ============================================================
        # Click into a few places to trigger place.json (enrichment)
        # Cap at 3 clicks to keep total runtime reasonable (~10-15s)
        # ============================================================
        # Pick top 3 DOM entries that are missing phone/website
        click_targets = [
            dp for dp in dom_places
            if not dp.get("phone") or not dp.get("website") or not dp.get("formattedAddress")
        ][:3]

        logger.info(f"Clicking into {len(click_targets)} places to fetch details...")

        for idx, target in enumerate(click_targets):
            target_name = target.get("name")
            if not target_name:
                continue
            try:
                links = page.query_selector_all(
                    'div[role="feed"] a[href*="/maps/place/"]'
                )
                link = None
                for l in links:
                    aria = (l.get_attribute("aria-label") or "").strip()
                    if aria == target_name:
                        link = l
                        break
                if not link:
                    # Try partial match
                    for l in links:
                        aria = (l.get_attribute("aria-label") or "").strip()
                        if target_name.lower() in aria.lower():
                            link = l
                            break
                if not link:
                    continue

                link.click(timeout=5000)
                # Shorter wait — place.json usually fires within 1s
                page.wait_for_timeout(1800)
                logger.info(
                    f"[{idx+1}/{len(click_targets)}] clicked '{target_name}' — "
                    f"RPC places now: {len(collector.places)}"
                )
            except Exception as e:
                logger.debug(f"click into '{target_name}' failed: {e}")
                continue

        # Final DOM extraction
        dom_places = _extract_dom_entries(page)

        # ============================================================
        # Merge: DOM is primary, RPC enriches
        # ============================================================
        results: List[Dict[str, Any]] = []

        for dp in dom_places:
            ap = dp.get("addressParts") or {}

            # Find matching RPC entry by featureId or placeId
            rpc_place: Optional[Dict[str, Any]] = None
            fid = dp.get("_featureId")
            pid = dp.get("placeId")
            if fid:
                rpc_place = collector.find_by_feature_id(fid)
            if not rpc_place and pid and pid.startswith("ChIJ"):
                rpc_place = collector.find_by_place_id(pid)

            if rpc_place:
                # Enrich DOM entry with RPC data
                for k in ("formattedAddress", "rating", "userRatingCount",
                          "website", "phone", "businessStatus"):
                    if rpc_place.get(k) is not None and not dp.get(k):
                        dp[k] = rpc_place[k]
                # Merge addressParts
                rpc_ap = rpc_place.get("addressParts") or {}
                for sub_k, sub_v in rpc_ap.items():
                    if sub_v is not None and not ap.get(sub_k):
                        ap[sub_k] = sub_v
                # Lat/lng (RPC may have it even if URL didn't)
                if not dp.get("latitude") and rpc_place.get("latitude") is not None:
                    dp["latitude"] = rpc_place["latitude"]
                if not dp.get("longitude") and rpc_place.get("longitude") is not None:
                    dp["longitude"] = rpc_place["longitude"]

            # Fill defaults
            ap["locality"] = ap.get("locality") or city
            ap["administrativeArea"] = ap.get("administrativeArea") or uf
            ap["country"] = ap.get("country") or "Brasil"
            dp["addressParts"] = ap

            # Build fallback formattedAddress
            if not dp.get("formattedAddress"):
                parts = []
                if ap.get("route"):
                    route = ap["route"]
                    if ap.get("streetNumber"):
                        route += f", {ap['streetNumber']}"
                    parts.append(route)
                if ap.get("sublocality"):
                    parts.append(ap["sublocality"])
                loc = ap.get("locality") or city
                uf_v = ap.get("administrativeArea") or uf
                parts.append(f"{loc} - {uf_v}")
                if ap.get("postalCode"):
                    parts.append(ap["postalCode"])
                parts.append(ap.get("country") or "Brasil")
                dp["formattedAddress"] = ", ".join(parts)

            results.append(dp)

        # Truncate
        if len(results) > max_results:
            results = results[:max_results]

        browser.close()

    logger.info(
        f"Collected {len(results)} places for '{query}' in {city}/{uf} "
        f"(RPC enriched: {len(collector.places)} candidates)"
    )
    return results


# ---------------------------------------------------------------------------
# CLI entry point (for testing)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import sys

    logging.basicConfig(level=logging.INFO)

    p = argparse.ArgumentParser()
    p.add_argument("--query", required=True)
    p.add_argument("--city", required=True)
    p.add_argument("--uf", required=True)
    p.add_argument("--max", type=int, default=60)
    p.add_argument("--headed", action="store_true")
    p.add_argument("--debug", action="store_true")
    args = p.parse_args()

    if args.debug:
        logger.setLevel(logging.DEBUG)
        os.environ["DEBUG_DUMP_RPC"] = "1"

    out = scrape_google_maps(
        args.query, args.city, args.uf,
        max_results=args.max,
        headless=not args.headed,
    )
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    print()
