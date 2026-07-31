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

    Also handles partial formats like:
      "Shopping Crystal, R. Comendador Araújo, 731 - Sala 321"
      "R. Comendador Araújo, 731 - Sala 321, Curitiba - PR"
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

    # City + UF pattern: "<city> - <UF>" near end (e.g. "Curitiba - PR, Brasil")
    city_m = re.search(
        r",?\s*([^,\-\n]{2,60}?)\s*-\s*([A-Z]{2})(?:\s*,|\s*$|\s+Brasil)",
        text,
    )
    if city_m:
        candidate_city = city_m.group(1).strip()
        # Reject if it's a number or too short
        if candidate_city and not re.match(r"^\d+$", candidate_city) and len(candidate_city) >= 2:
            out["locality"] = candidate_city
            out["administrativeArea"] = city_m.group(2)
    else:
        # Just UF (e.g. "PR" alone at end)
        uf_m = re.search(r"(?:^|[\s,\-])([A-Z]{2})(?:\s*,\s*|\s*$|\s+Brasil)", text)
        if uf_m:
            out["administrativeArea"] = uf_m.group(1)

    # Street pattern — search ANYWHERE in text (not just anchored at start).
    # Handles "Shopping Crystal, R. Comendador Araújo, 731 - Sala 321"
    # where the street is not at the beginning.
    street_m = re.search(
        r"((?:Rua|R\.?|Avenida|Av\.?|Travessa|Trav\.?|Alameda|Al\.?|Praça|Pc\.?|Rod\.?|Estrada|Est\.?|Viela|Beco)\s+[^,]+?)\s*,\s*(\d+)",
        text,
        re.IGNORECASE,
    )
    if street_m:
        out["route"] = street_m.group(1).strip()
        if street_m.group(2):
            out["streetNumber"] = street_m.group(2)
    else:
        # Try without trailing number — just street name
        street_m = re.search(
            r"((?:Rua|R\.?|Avenida|Av\.?|Travessa|Trav\.?|Alameda|Al\.?|Praça|Pc\.?|Rod\.?|Estrada|Est\.?|Viela|Beco)\s+[^,\n]{3,60})",
            text,
            re.IGNORECASE,
        )
        if street_m:
            out["route"] = street_m.group(1).strip()

    # Sublocality (bairro): between " - " and "," — but skip if it's the city
    bairro_m = re.search(r"\s-\s([^,\-\n]{3,40}?)\s*,", text)
    if bairro_m:
        candidate = bairro_m.group(1).strip()
        # Skip pure numbers (e.g. "Sala 321" → no, "321" alone yes)
        if candidate and not re.match(r"^\d+$", candidate):
            # Skip if it matches the city
            if not out.get("locality") or candidate.lower() != out["locality"].lower():
                # Skip common suite/room indicators
                if not re.match(r"^(Sala|Loja|Apto|Ap\.?|Casa|Bloco|Andar|Km)\s", candidate, re.IGNORECASE):
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

    def find_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """
        Find an RPC place by close name match.
        Tries exact (case-insensitive) first, then substring match.
        Used as last-resort fallback when feature_id/place_id don't match.
        """
        if not name:
            return None
        name_lower = name.lower().strip()
        # Exact match
        for p in self.places.values():
            n = p.get("name")
            if n and n.lower().strip() == name_lower:
                return p
        # Substring match (DOM name contains RPC name, or vice-versa)
        for p in self.places.values():
            n = p.get("name")
            if not n:
                continue
            n_lower = n.lower().strip()
            if len(n_lower) >= 5 and (n_lower in name_lower or name_lower in n_lower):
                return p
        return None


# ---------------------------------------------------------------------------
# DOM extraction — source of truth for "what places exist"
# ---------------------------------------------------------------------------

# Regex for rating in BR format: "4,7" or "4.7" (decimal separator , or .)
RATING_RE = re.compile(r"^\d+[.,]\d$")
# Combined rating+reviews format: "4,7(1.234)" or "4.7 (1.234)" or "4,7 (1.234) opiniões"
# Google often renders them on a single line with NO space between rating and parens.
RATING_REVIEWS_RE = re.compile(
    r"^(\d+[.,]\d)\s*\(([\d.,]+)\)\s*(?:opiniões|reviews|avaliações)?$",
    re.IGNORECASE,
)
# Regex for review count in BR format. Google uses several variants:
#   "(1.234)"
#   "(1.234) opiniões"
#   "1.234 opiniões"
#   "1.234 reviews"
#   "1.234 avaliações"
REVIEWS_PAREN_RE = re.compile(r"^\(([\d.,]+)\)\s*(?:opiniões|reviews|avaliações)?$", re.IGNORECASE)
REVIEWS_BARE_RE = re.compile(r"^([\d.,]+)\s*(?:opiniões|reviews|avaliações)$", re.IGNORECASE)

# Categories that appear in Google Maps cards — used to identify category lines
KNOWN_CATEGORIES = {
    "restaurante", "restaurant", "bar", "café", "cafe", "padaria", "bakery",
    "pizzaria", "pizza", "hotel", "mercado", "supermercado", "farmácia",
    "farmacia", "academia", "gym", "salão", "salon", "barbeiro", "barber",
    "loja", "store", "shop", "shopping", "posto", "banco", "bank",
    "consultório", "consultorio", "clínica", "clinica", "escritório",
    "escritorio", "advogado", "lawyer", "dentista", "dentist",
    "tratamento estético", "estética", "estetica", "italian", "italiana",
    "japonesa", "japanese", "churrascaria", "frutos do mar", "seafood",
}

# Status keywords (used to identify status lines)
STATUS_OPEN_KEYWORDS = {"aberto", "abre", "open", "fecha às", "fecha as", "fecha"}
STATUS_CLOSED_KEYWORDS = {"fechado", "closed", "fecha agora"}


def _is_address_line(line: str) -> bool:
    """
    Heuristic: does this line look like an address?
    Returns True for:
      "Av. do Batel, 1440 - Batel, Curitiba - PR"
      "Rua dos Pinheiros, 123 - Centro, Curitiba - PR, 80000-000"
      "Shopping Crystal, R. Comendador Araújo, 731 - Sala 321"
      "R. Comendador Araújo, 731 - Sala 321"
    Returns False for:
      "Curitiba - PR, Brasil" (too short, only city/UF — no street)
      "Restaurante de frutos do mar · $$ · Shopping Crystal, R. ..."
      "Aberto · Fecha 23h"
    """
    if not line or len(line) < 15:
        return False
    # Must have a comma OR a CEP
    has_comma = "," in line
    has_cep = bool(CEP_RE.search(line))
    if not has_comma and not has_cep:
        return False
    # Skip status lines
    lower = line.lower()
    if any(kw in lower for kw in STATUS_OPEN_KEYWORDS):
        return False
    if any(kw in lower for kw in STATUS_CLOSED_KEYWORDS):
        return False
    # Skip pure rating/reviews
    if RATING_RE.match(line):
        return False
    if RATING_REVIEWS_RE.match(line):
        return False
    if REVIEWS_PAREN_RE.match(line) or REVIEWS_BARE_RE.match(line):
        return False
    # Skip category lines (contain " · " separator with category words)
    if " · " in line and not has_cep:
        # But still accept if there's a clear street pattern after the ·
        if not re.search(
            r"(?:Rua|R\.?|Avenida|Av\.?|Travessa|Trav\.?|Alameda|Al\.?|Praça|Pc\.?|Rod\.?|Estrada|Est\.?|Viela|Beco)\s+[^,]+?,\s*\d+",
            line,
            re.IGNORECASE,
        ):
            return False

    # Street pattern ANYWHERE in the line (not just at start)
    has_street = bool(re.search(
        r"(?:Rua|R\.?|Avenida|Av\.?|Travessa|Trav\.?|Alameda|Al\.?|Praça|Pc\.?|Rod\.?|Estrada|Est\.?|Viela|Beco)\s+[^,]+?,?\s*\d*",
        line,
        re.IGNORECASE,
    ))
    # UF code at end (e.g. "PR", "SP") or followed by "Brasil"
    has_uf = bool(re.search(r"\b[A-Z]{2}\b\s*[,]\s*\d{5}-\d{3}|\b[A-Z]{2}\b\s*$|\b[A-Z]{2}\b\s+Brasil|\b[A-Z]{2}\b\s*,\s*Brasil", line))
    # City - UF pattern
    has_city_uf = bool(re.search(r"[^,\-\n]{2,60}?\s*-\s*[A-Z]{2}\b", line))

    return has_street or has_cep or (has_uf and len(line) >= 20) or (has_city_uf and has_comma and len(line) >= 20)


def _is_category_line(line: str) -> bool:
    """Heuristic: is this line a category (e.g. 'Restaurante · $$')?"""
    if not line or " · " not in line:
        return False
    # Categories don't have street/CEP/UF
    if _is_address_line(line):
        return False
    # Category lines are short-ish
    if len(line) > 120:
        return False
    # First segment should look like a category — NOT a status keyword
    first = line.split(" · ")[0].strip().lower()
    # Reject if first segment is a status word (Aberto, Fechado, etc.)
    status_words = {"aberto", "fechado", "abre", "fecha", "open", "closed",
                    "horário", "horario", "horas", "hoje", "amanhã", "amanha"}
    if first in status_words:
        return False
    # Reject if first segment starts with a status word
    if any(first.startswith(w + " ") or first.startswith(w + ",") for w in status_words):
        return False
    return any(cat in first for cat in KNOWN_CATEGORIES) or len(first) < 50


def _parse_card_text(text: str) -> Dict[str, Any]:
    """
    Parse the inner_text() of a Google Maps result card.

    Returns dict with optional keys:
        rating, userRatingCount, category, formattedAddress, addressParts
    """
    out: Dict[str, Any] = {}
    if not text:
        return out

    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if not lines:
        return out

    consumed: Set[int] = set()

    # Phase 1: Find rating and reviews
    # Try combined format FIRST: "4,7(1.234)" or "4,7 (1.234)"
    for i, line in enumerate(lines):
        if i in consumed:
            continue
        m = RATING_REVIEWS_RE.match(line)
        if m:
            try:
                r = float(m.group(1).replace(",", "."))
                if 1.0 <= r <= 5.0:
                    out["rating"] = r
                    try:
                        count = int(m.group(2).replace(".", "").replace(",", ""))
                        out["userRatingCount"] = count
                    except ValueError:
                        pass
                    consumed.add(i)
                    break
            except ValueError:
                pass

    # Phase 1b: If combined didn't match, try rating alone + look ahead for reviews
    if "rating" not in out:
        for i, line in enumerate(lines):
            if i in consumed:
                continue
            if RATING_RE.match(line):
                try:
                    r = float(line.replace(",", "."))
                    if 1.0 <= r <= 5.0:
                        out["rating"] = r
                        consumed.add(i)
                        # Look ahead 1-3 lines for reviews
                        for j in range(i + 1, min(i + 4, len(lines))):
                            if j in consumed:
                                continue
                            m = REVIEWS_PAREN_RE.match(lines[j])
                            if not m:
                                m = REVIEWS_BARE_RE.match(lines[j])
                            if m:
                                try:
                                    count = int(m.group(1).replace(".", "").replace(",", ""))
                                    out["userRatingCount"] = count
                                    consumed.add(j)
                                    break
                                except ValueError:
                                    pass
                        break
                except ValueError:
                    pass

    # Phase 1c: If we have rating but no reviews, try to find reviews anywhere
    if "rating" in out and "userRatingCount" not in out:
        for i, line in enumerate(lines):
            if i in consumed:
                continue
            m = REVIEWS_PAREN_RE.match(line)
            if not m:
                m = REVIEWS_BARE_RE.match(line)
            if m:
                try:
                    count = int(m.group(1).replace(".", "").replace(",", ""))
                    if 1 <= count <= 5_000_000:
                        out["userRatingCount"] = count
                        consumed.add(i)
                        break
                except ValueError:
                    pass

    # Phase 2: Find category
    # Look for: (a) a pure category line "Restaurante · $$"
    #        or (b) a combined category+address line "Restaurante ·  · Av. do Batel, 1440"
    # In case (b), extract just the category part but DON'T consume the line
    # (Phase 3 still needs it for address extraction).
    for i, line in enumerate(lines):
        if i in consumed:
            continue
        if " · " not in line:
            continue
        # Skip status lines
        lower = line.lower()
        if any(kw in lower for kw in STATUS_OPEN_KEYWORDS):
            continue
        if any(kw in lower for kw in STATUS_CLOSED_KEYWORDS):
            continue
        first = line.split(" · ")[0].strip().lower()
        # Skip if first segment is a status word
        status_words = {"aberto", "fechado", "abre", "fecha", "open", "closed",
                        "horário", "horario", "horas", "hoje", "amanhã", "amanha"}
        if first in status_words or any(first.startswith(w + " ") for w in status_words):
            continue
        # Skip if first segment is a number (e.g. "1.550 Rua Manoel..." from sponsored)
        if re.match(r"^\d", first):
            continue
        # Skip if first segment is too long (probably a description, not a category)
        if len(first) > 50:
            continue
        # Looks like a category — accept it.
        # If the line is ALSO an address line, don't consume it (Phase 3 needs it).
        out["category"] = first
        if not _is_address_line(line):
            consumed.add(i)
        break

    # Phase 3: Find address — scan ALL lines, run _parse_address_from_text
    # on each address-like candidate, pick the one with most non-null fields.
    best_addr_line: Optional[str] = None
    best_addr_parts: Optional[Dict[str, Any]] = None
    best_score = 0
    for i in range(len(lines) - 1, -1, -1):
        if i in consumed:
            continue
        line = lines[i]
        if not _is_address_line(line):
            continue
        parts = _parse_address_from_text(line)
        # Score: count non-null fields (excluding "country" which is always "Brasil")
        score = sum(1 for k, v in parts.items() if v is not None and k != "country")
        if score > best_score:
            best_score = score
            best_addr_line = line
            best_addr_parts = parts

    if best_addr_line and best_addr_parts:
        # If the best address line is combined with category (e.g.
        # "Restaurante ·  · Av. do Batel, 1440"), strip the category prefix
        # to get just the address part for formattedAddress.
        addr_for_display = best_addr_line
        if " · " in best_addr_line:
            segments = best_addr_line.split(" · ")
            # Find the first segment that contains a street pattern or CEP
            for seg in segments:
                seg_stripped = seg.strip()
                if not seg_stripped:
                    continue
                if (re.search(
                    r"(?:Rua|R\.?|Avenida|Av\.?|Travessa|Trav\.?|Alameda|Al\.?|Praça|Pc\.?|Rod\.?|Estrada|Est\.?|Viela|Beco)\s+",
                    seg_stripped, re.IGNORECASE,
                ) or CEP_RE.search(seg_stripped)):
                    addr_for_display = seg_stripped
                    # Re-parse to get fresh parts from the cleaner address
                    re_parts = _parse_address_from_text(seg_stripped)
                    if re_parts:
                        best_addr_parts = re_parts
                    break
        out["formattedAddress"] = addr_for_display
        out["addressParts"] = best_addr_parts
        # Mark the consumed line so we don't re-use it
        for i, line in enumerate(lines):
            if line == best_addr_line:
                consumed.add(i)
                break

    return out


def _slice_card_from_feed(
    feed_text: str,
    aria_label: str,
    all_aria_labels: List[str],
) -> str:
    """
    Fallback: extract one card's text from the entire feed text by locating
    the aria_label followed by a rating pattern (X,Y or X.Y on its own line).

    Google Maps cards have a consistent shape:
        <name>
        <name>                      (often duplicated)
        <rating>                    (e.g. "4,7")
        <category> ·  · <address>
        <description>
        <status> · <hours>

    We find the first aria_label position that's followed by a rating line
    within 500 chars, then slice until the next DIFFERENT aria_label that's
    ALSO followed by a rating line (to skip action links like "Reservar").
    """
    if not feed_text or not aria_label:
        return ""

    # Find ALL positions where aria_label appears in feed_text
    positions: List[int] = []
    start = 0
    while True:
        p = feed_text.find(aria_label, start)
        if p < 0:
            break
        positions.append(p)
        start = p + 1

    if not positions:
        return ""

    # Rating pattern: newline + digit.digit + newline (e.g. "\n4,7\n")
    RATING_LINE_RE = re.compile(r"\n\d+[.,]\d\n")

    # For each candidate position, check if there's a rating within 500 chars
    # AND no OTHER aria_label appears between the name and the rating.
    best_start = -1
    for p in positions:
        snippet = feed_text[p : p + 500]
        rating_m = RATING_LINE_RE.search(snippet)
        if not rating_m:
            continue
        # Check that no OTHER aria_label appears before the rating in this snippet
        snippet_before_rating = snippet[: rating_m.start()]
        other_label_intercepts = False
        for l in all_aria_labels:
            if not l or l == aria_label or len(l) < 4:
                continue
            if l in snippet_before_rating:
                other_label_intercepts = True
                break
        if not other_label_intercepts:
            best_start = p
            break

    if best_start < 0:
        # Fallback: just use first occurrence
        best_start = positions[0]

    # Find next card start: next DIFFERENT aria_label that's followed by a rating
    next_pos = len(feed_text)
    # Skip past this card's content (aria_label may appear again as title)
    search_from = best_start + len(aria_label) * 2 + 30
    for l in all_aria_labels:
        if not l or l == aria_label or len(l) < 4:
            continue
        # Find occurrences of this other label after search_from
        sp = feed_text.find(l, search_from)
        while sp >= 0 and sp < next_pos:
            # Check if this label is followed by a rating (i.e., it's a real card start)
            snippet = feed_text[sp : sp + 500]
            if RATING_LINE_RE.search(snippet):
                # Verify no other aria_label (other than this one) intercepts before rating
                rating_m = RATING_LINE_RE.search(snippet)
                if rating_m:
                    between = snippet[: rating_m.start()]
                    intercept = False
                    for l2 in all_aria_labels:
                        if not l2 or l2 == l or l2 == aria_label or len(l2) < 4:
                            continue
                        if l2 in between:
                            intercept = True
                            break
                    if not intercept:
                        next_pos = sp
                        break
            sp = feed_text.find(l, sp + 1)

    return feed_text[best_start:next_pos].strip()


def _get_card_text(
    entry,
    page: Optional[Page] = None,
    all_aria_labels: Optional[List[str]] = None,
) -> str:
    """
    Get the full text of a Google Maps result card from an <a> element.

    Strategy:
    1. Walk up the DOM via JS, collecting innerText from each ancestor.
    2. For each candidate, validate it looks like a single card (3-25 lines,
       contains the place name, doesn't contain feed navigation markers,
       has ≤8 middle dots — single cards have 1-3, multi-card feeds have 10+).
    3. Among valid candidates, prefer the one with the most lines.
    4. FALLBACK: If no valid candidate (ancestors are either too small or the
       entire feed), slice the feed text using the aria_label to extract just
       this card's text. This is robust to DOM structure changes.

    A Google Maps card usually has 5-15 lines:
        Name
        Rating
        Reviews
        Category
        Status
        Address (maybe 1-3 lines)
    """
    # Get aria_label first (we need it to validate candidates)
    try:
        aria_label = (entry.get_attribute("aria-label") or "").strip()
    except Exception:
        aria_label = ""

    # Collect innerText from entry + up to 6 ancestors
    try:
        texts = entry.evaluate("""
            (el) => {
              const texts = [];
              let node = el;
              for (let i = 0; i < 7 && node; i++) {
                try {
                  texts.push({
                    level: i,
                    text: node.innerText || '',
                    childCount: node.children ? node.children.length : 0
                  });
                } catch (e) {}
                node = node.parentElement;
              }
              return texts;
            }
        """)
    except Exception:
        texts = []

    if not isinstance(texts, list) or not texts:
        # Fallback: just entry.inner_text()
        try:
            return entry.inner_text() or ""
        except Exception:
            return ""

    # Validate each candidate
    candidates: List[str] = []
    for item in texts:
        if not isinstance(item, dict):
            continue
        t = (item.get("text") or "").strip()
        if not t:
            continue
        line_count = t.count("\n") + 1
        # Skip if too short (just the link itself, 1-2 lines)
        if line_count < 3:
            continue
        # Skip if too long (likely the entire feed)
        if line_count > 25:
            continue
        # Skip if doesn't contain the aria-label (card name) somewhere
        if aria_label and aria_label not in t:
            continue
        # Skip if contains feed-navigation markers (means we went too high)
        feed_markers = [
            "Ver mais", "Ver tudo", "Mostrar mais", "Show more", "Ver resultados",
            "Atualizar resultados", "Aproveite ao máximo", "Fazer login",
            "visualização limitada",
        ]
        if any(m in t for m in feed_markers):
            continue
        # Skip if it contains the names of OTHER place entries (multiple cards)
        # Heuristic: count "·" — single card has 1-5, multi-card feed has 10+
        if t.count("·") > 8:
            continue
        candidates.append(t)

    if candidates:
        return max(candidates, key=lambda t: t.count("\n"))

    # FALLBACK: slice feed text using aria_label
    # This handles cases where the DOM has no intermediate container between
    # the <a> and the entire feed (Google Maps sometimes does this).
    if page and aria_label and all_aria_labels:
        try:
            feed_text = page.evaluate("""
                () => {
                  const el = document.querySelector('div[role="feed"]');
                  return el ? el.innerText : '';
                }
            """)
            if feed_text and aria_label in feed_text:
                sliced = _slice_card_from_feed(feed_text, aria_label, all_aria_labels)
                if sliced and 3 <= (sliced.count("\n") + 1) <= 30:
                    logger.debug(
                        f"Used feed-slice fallback for '{aria_label}' "
                        f"({sliced.count(chr(10))+1} lines)"
                    )
                    return sliced
        except Exception as e:
            logger.debug(f"feed-slice fallback failed: {e}")

    # Last resort: return the longest text we got (even if invalid)
    # so we can debug it via the card dump
    all_texts = [item.get("text", "") for item in texts if isinstance(item, dict)]
    all_texts = [t for t in all_texts if t]
    if all_texts:
        return max(all_texts, key=len)
    return ""


# Counter for dumping cards (debug only)
_CARD_DUMP_COUNTER = [0]


def _extract_dom_entries(page: Page) -> List[Dict[str, Any]]:
    """
    Extract place entries from current DOM state.
    Returns list of dicts with: placeId, name, googleMapsUri, lat, lng,
    and (when available) rating, userRatingCount, formattedAddress,
    addressParts, category.
    """
    results: List[Dict[str, Any]] = []
    debug_dump = os.getenv("DEBUG_DUMP_CARDS", "0") == "1"
    if debug_dump:
        try:
            os.makedirs(DEBUG_DUMP_DIR, exist_ok=True)
        except Exception:
            pass

    try:
        entries = page.query_selector_all(
            'div[role="feed"] a[href*="/maps/place/"], '
            'a[role="button"][href*="/maps/place/"]'
        )
    except Exception:
        return results

    # Pre-compute all aria_labels for the _get_card_text fallback (feed slicing)
    all_aria_labels: List[str] = []
    try:
        for e in entries:
            l = (e.get_attribute("aria-label") or "").strip()
            if l and l not in all_aria_labels:
                all_aria_labels.append(l)
    except Exception:
        pass

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
            card_text = _get_card_text(entry, page=page, all_aria_labels=all_aria_labels)
            card_data = _parse_card_text(card_text)

            # Debug: dump first 5 cards for inspection
            if debug_dump and _CARD_DUMP_COUNTER[0] < 5 and card_text:
                _CARD_DUMP_COUNTER[0] += 1
                try:
                    path = os.path.join(
                        DEBUG_DUMP_DIR,
                        f"card_{_CARD_DUMP_COUNTER[0]:02d}_{name[:30]}.txt",
                    )
                    # Sanitize filename
                    path = re.sub(r"[^A-Za-z0-9_/.-]", "_", path)
                    with open(path, "w", encoding="utf-8") as f:
                        f.write(f"=== NAME: {name} ===\n")
                        f.write(f"=== HREF: {href} ===\n\n")
                        f.write("=== CARD TEXT ===\n")
                        f.write(card_text)
                        f.write(f"\n\n=== PARSED ===\n")
                        f.write(json.dumps(card_data, ensure_ascii=False, indent=2, default=str))
                    logger.info(f"[DEBUG] dumped card #{_CARD_DUMP_COUNTER[0]} -> {path}")
                except Exception as e:
                    logger.debug(f"card dump failed: {e}")

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
    debug: bool = False,
) -> List[Dict[str, Any]]:
    """
    Scrape Google Maps for businesses matching the query in the given city/UF.

    Returns a list of normalized dicts with keys:
        placeId, name, formattedAddress, website, phone, rating,
        userRatingCount, googleMapsUri, businessStatus, addressParts,
        latitude, longitude
    """
    # Enable debug dumps for this request if requested
    if debug:
        os.environ["DEBUG_DUMP_RPC"] = "1"
        os.environ["DEBUG_DUMP_CARDS"] = "1"
        # Reset card dump counter
        _CARD_DUMP_COUNTER[0] = 0
        # Clear debug dir
        try:
            import shutil
            if os.path.exists(DEBUG_DUMP_DIR):
                shutil.rmtree(DEBUG_DUMP_DIR)
            os.makedirs(DEBUG_DUMP_DIR, exist_ok=True)
        except Exception:
            pass
        logger.setLevel(logging.DEBUG)
        logger.info(f"[DEBUG] Enabled card+RPC dump to {DEBUG_DUMP_DIR}")
        # Force module-level flags to refresh from env
        global DEBUG_DUMP_RPC
        DEBUG_DUMP_RPC = True

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

            # Find matching RPC entry by featureId or placeId (then name fallback)
            rpc_place: Optional[Dict[str, Any]] = None
            fid = dp.get("_featureId")
            pid = dp.get("placeId")
            if fid:
                rpc_place = collector.find_by_feature_id(fid)
            if not rpc_place and pid and pid.startswith("ChIJ"):
                rpc_place = collector.find_by_place_id(pid)
            # Last-resort: match by name (only if still missing key fields)
            if not rpc_place:
                dp_name = dp.get("name") or ""
                needs_enrichment = (
                    not dp.get("phone")
                    or not dp.get("website")
                    or not dp.get("formattedAddress")
                    or not ap.get("route")
                )
                if needs_enrichment and dp_name:
                    rpc_place = collector.find_by_name(dp_name)
                    if rpc_place:
                        logger.debug(
                            f"Name-based RPC match for '{dp_name}' "
                            f"(fid={fid}, pid={pid})"
                        )

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
