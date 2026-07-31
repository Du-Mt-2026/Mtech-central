"""
gmaps_scraper.py — Google Maps scraper using Playwright.

Hybrid strategy:
1. Hook page.on("response") to intercept RPC responses
   (search.json / place.json / listugcposts etc.).
2. Walk the nested JSON arrays to find place entries, identified by
   place_id ("ChIJ...") or feature_id ("0x...:0x...").
3. Click into each place to trigger place.json (carries phone + website
   + full address).
4. DOM extraction as fallback — gets name + googleMapsUri at minimum.
5. Parse googleMapsUri for placeId / lat / lng as a final fallback.

This combines the robustness of RPC interception (rich data) with the
resilience of DOM scraping (always returns something even if RPC layout
changes).

Usage as module:
    from gmaps_scraper import scrape_google_maps
    results = scrape_google_maps(query="restaurantes", city="Curitiba", uf="PR")
"""

from __future__ import annotations

import json
import re
import time
import logging
import urllib.parse
from typing import Any, Dict, List, Optional, Set, Tuple

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

# Place IDs from Google Maps come in two flavors:
#   - place_id  : "ChIJd0JWC4nj3JQRESbU6mByFXU" (canonical, ~27 chars)
#   - feature_id: "0x94dce3890b564277:0x75157260ead42611" (hex lat:lng hash)
PLACE_ID_RE = re.compile(r"^ChIJ[A-Za-z0-9_\-]{16,}$")
FEATURE_ID_RE = re.compile(r"^0x[0-9a-fA-F]+:0x[0-9a-fA-F]+$")
CEP_RE = re.compile(r"\b(\d{5})-(\d{3})\b")
PHONE_RE = re.compile(r"^\+?[\d\s\-()]{8,}$")
URL_RE = re.compile(r"^https?://", re.IGNORECASE)


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

    Example URL structure:
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
        out["latitude"] = float(m.group(1))
        out["longitude"] = float(m.group(2))

    m = re.search(r"!19s=(ChIJ[A-Za-z0-9_\-]+)", href)
    if m:
        out["placeId"] = m.group(1)

    m = re.search(r"!1s(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)", href)
    if m:
        out["featureId"] = m.group(1)
    else:
        m = re.search(r"(0x[0-9a-fA-F]+:0x[0-9a-fA-F]+)", href)
        if m:
            out["featureId"] = m.group(1)

    # Extract name from URL path (after /place/ and before /data= or @)
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
    Returns dict with keys: streetNumber, route, sublocality, locality,
    administrativeArea, postalCode, country.
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

    # UF: ", XX" near end or before "Brasil"
    uf_m = re.search(r",\s*([A-Z]{2})\s*(?:,|\s*$|\s*Brasil)", text)
    if uf_m:
        out["administrativeArea"] = uf_m.group(1)

    # City: between "," and " - UF"
    city_m = re.search(r",\s*([^,\n]+?)\s*-\s*([A-Z]{2})", text)
    if city_m:
        out["locality"] = city_m.group(1).strip()

    # Street + number (Brazilian format)
    street_m = re.search(
        r"((?:Rua|Avenida|Av\.?|Travessa|Trav\.?|Alameda|Al\.?|Praça|Pc\.?|Rod\.?|Estrada|Est\.?|Viela)\s+[^,]+?)(?:,?\s*(\d+))?",
        text,
        re.IGNORECASE,
    )
    if street_m:
        out["route"] = street_m.group(1).strip()
        if street_m.group(2):
            out["streetNumber"] = street_m.group(2)

    # Sublocality (bairro) — heuristic: text after " - " before city/UF
    # This is unreliable without structured input, leave as None unless clearly present
    bairro_m = re.search(r"-\s*([^,\-\n]{3,40}?)\s*,", text)
    if bairro_m:
        candidate = bairro_m.group(1).strip()
        # Skip if it looks like the city (already captured)
        if candidate and out.get("locality") and candidate.lower() != out["locality"].lower():
            out["sublocality"] = candidate

    return out


# ---------------------------------------------------------------------------
# RPC collector — intercepts Google Maps internal XHRs
# ---------------------------------------------------------------------------

class RpcCollector:
    """
    Collects Google Maps internal RPC responses (search.json, place.json).

    Google Maps makes XHR calls to endpoints like:
      /maps/rpc/search.json   — search results list
      /maps/rpc/place.json    — place details (when clicked)
      /maps/rpc/listugcposts  — reviews (we don't need this)

    Each response is a nested JSON array (NOT a JSON object). We walk
    the tree recursively, looking for "place entries" — lists that
    contain a place_id (ChIJ...) or feature_id (0x...:0x...).
    """

    def __init__(self):
        # placeId -> dict of fields (accumulated across responses)
        self.places: Dict[str, Dict[str, Any]] = {}
        # featureId -> placeId (so we can merge search results with place details)
        self.feature_to_place: Dict[str, str] = {}
        # Counters for logging
        self.rpc_count = 0
        self.rpc_search_count = 0
        self.rpc_place_count = 0

    # ---- response hook ----
    def on_response(self, response: Response):
        try:
            url = response.url or ""
            # Filter to Google Maps RPC endpoints
            if "/maps/rpc/" not in url and "/maps/preview/" not in url:
                return
            # Only JSON-like responses
            ct = response.headers.get("content-type", "")
            if "json" not in ct and ".json" not in url:
                return

            # Try to parse JSON. Google Maps prefixes responses with
            # XSSI protection like ")]}'\n" — Playwright's response.json()
            # usually handles this automatically.
            try:
                data = response.json()
            except Exception:
                # Try manual XSSI strip
                try:
                    raw = response.text()
                    stripped = re.sub(r"^\)\]\}\'?\s*\n?", "", raw)
                    data = json.loads(stripped)
                except Exception:
                    return

            if not data:
                return

            self.rpc_count += 1
            if "search" in url or "listresults" in url:
                self.rpc_search_count += 1
            elif "place" in url:
                self.rpc_place_count += 1

            self._extract_places_from_rpc(data)
        except Exception as e:
            logger.debug(f"on_response error: {e}")

    # ---- recursive walker ----
    def _extract_places_from_rpc(self, data: Any):
        """Walk the nested JSON looking for place entries."""
        visited: Set[int] = set()

        def walk(node: Any, parent_list: Optional[List] = None, depth: int = 0):
            if id(node) in visited:
                return
            visited.add(id(node))

            if depth > 30:
                return

            if isinstance(node, list):
                # Try to parse this list as a place entry
                place = self._try_parse_place(node)
                if place:
                    self._merge_place(place)

                # Recurse into children
                for item in node:
                    walk(item, node, depth + 1)
            elif isinstance(node, dict):
                for v in node.values():
                    walk(v, node, depth + 1)

        walk(data)

    def _try_parse_place(self, arr: List) -> Optional[Dict[str, Any]]:
        """
        Try to interpret a list as a Google Maps place entry.

        Returns None if the list doesn't look like a place.
        Returns a dict with at least placeId and name otherwise.
        """
        if not arr or len(arr) < 3:
            return None

        # Collect all scalar values from this list (shallow scan)
        strings: List[str] = []
        floats: List[float] = []
        ints: List[int] = []

        for item in arr:
            if isinstance(item, str):
                strings.append(item)
            elif isinstance(item, bool):
                continue
            elif isinstance(item, int):
                ints.append(item)
                floats.append(float(item))
            elif isinstance(item, float):
                floats.append(item)

        # Need a place_id (ChIJ...) or feature_id (0x...:0x...)
        place_id: Optional[str] = None
        feature_id: Optional[str] = None
        for s in strings:
            if not place_id and PLACE_ID_RE.match(s):
                place_id = s
            if not feature_id and FEATURE_ID_RE.match(s):
                feature_id = s

        if not place_id and not feature_id:
            return None

        # Find name — first non-trivial string that isn't an ID/URL/phone
        name: Optional[str] = None
        address: Optional[str] = None
        phone: Optional[str] = None
        website: Optional[str] = None
        category: Optional[str] = None

        # Sort candidates by length descending — names tend to be longer than
        # categories, but addresses are the longest. We'll classify carefully.
        candidates = [
            s for s in strings
            if s and not PLACE_ID_RE.match(s) and not FEATURE_ID_RE.match(s)
        ]

        # Phone: starts with + or matches phone pattern
        for s in candidates:
            if PHONE_RE.match(s) and ("+" in s or s.count("-") >= 1 or s.count(" ") >= 1):
                phone = s
                break

        # Website: starts with http(s):// and not google.com
        for s in candidates:
            if URL_RE.match(s) and "google.com" not in s and "gstatic" not in s and "googleusercontent" not in s:
                website = s
                break

        # Address: long string with comma + digit (CEP or street number)
        # AND not a phone, not a URL, not a place_id
        addr_candidates = [
            s for s in candidates
            if "," in s
            and len(s) > 15
            and not PHONE_RE.match(s)
            and not URL_RE.match(s)
            and (CEP_RE.search(s) or re.search(r"\d+", s))
        ]
        if addr_candidates:
            # Pick the longest address-like string
            address = max(addr_candidates, key=len)

        # Name: first non-trivial string that isn't address/phone/website/category
        # Prefer strings that look like business names (Title Case, no comma at end)
        name_candidates = [
            s for s in candidates
            if s != address
            and s != phone
            and s != website
            and not PHONE_RE.match(s)
            and not URL_RE.match(s)
            and len(s) >= 3
            and len(s) <= 200
            # Avoid strings that are clearly just hex/IDs
            and not re.match(r"^[0-9a-f]+$", s)
            and not s.startswith("0x")
        ]
        # Prefer strings that have a space and Title Case (likely names)
        title_like = [s for s in name_candidates if " " in s and any(c.isupper() for c in s)]
        if title_like:
            # Pick a middle-length one (avoid super long or super short)
            name = sorted(title_like, key=len)[len(title_like) // 2]
        elif name_candidates:
            name = name_candidates[0]

        if not name:
            return None

        # Rating: small float in [0.5, 5.0]
        rating: Optional[float] = None
        for f in floats:
            if 0.5 <= f <= 5.0:
                rating = f
                break

        # Review count: integer in (0, 1_000_000), prefer ones >= 1
        review_count: Optional[int] = None
        for i in sorted(ints, reverse=True):
            if 1 <= i <= 1_000_000:
                review_count = i
                break

        # Lat/lng: a pair of floats where one is in [-90, 90] and
        # the next is in [-180, 180]
        lat: Optional[float] = None
        lng: Optional[float] = None
        for i, f in enumerate(floats):
            if -90.0 <= f <= 90.0 and i + 1 < len(floats):
                nxt = floats[i + 1]
                if -180.0 <= nxt <= 180.0:
                    # Filter out rating (0-5) — lat is typically abs > 5 in Brazil
                    if abs(f) > 0.5 or abs(nxt) > 0.5:
                        lat = f
                        lng = nxt
                        break

        place: Dict[str, Any] = {
            "placeId": place_id or (f"feat:{feature_id}" if feature_id else None),
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
        if lat is not None and lng is not None:
            place["latitude"] = lat
            place["longitude"] = lng

        return place

    # ---- merge into accumulator ----
    def _merge_place(self, place: Dict[str, Any]):
        """Merge a parsed place into our accumulator, keyed by placeId."""
        pid = place.get("placeId")
        if not pid:
            return

        # If we already have this place by placeId, merge fields
        if pid in self.places:
            existing = self.places[pid]
            for k, v in place.items():
                if v is not None and existing.get(k) is None:
                    existing[k] = v
                # Special case: addressParts — merge subfields
                if k == "addressParts" and isinstance(v, dict):
                    ex_ap = existing.get("addressParts") or {}
                    for sub_k, sub_v in v.items():
                        if sub_v is not None and ex_ap.get(sub_k) is None:
                            ex_ap[sub_k] = sub_v
                    existing["addressParts"] = ex_ap
            # Re-link featureId
            fid = place.get("_featureId")
            if fid and pid and pid not in self.feature_to_place.values():
                self.feature_to_place[fid] = pid
            return

        # New place — store it
        self.places[pid] = place
        fid = place.get("_featureId")
        if fid:
            self.feature_to_place[fid] = pid


# ---------------------------------------------------------------------------
# DOM extraction (fallback)
# ---------------------------------------------------------------------------

def _extract_dom_entries(page: Page) -> List[Dict[str, Any]]:
    """
    Extract place entries from current DOM state.
    Returns list of dicts with at minimum: placeId, name, googleMapsUri.
    """
    results: List[Dict[str, Any]] = []
    try:
        entries = page.query_selector_all(
            'div[role="feed"] a[href*="/maps/place/"], '
            'a[role="button"][href*="/maps/place/"]'
        )
    except Exception:
        return results

    seen: Set[str] = set()
    for entry in entries:
        try:
            href = entry.get_attribute("href") or ""
            if "/maps/place/" not in href or href in seen:
                continue
            seen.add(href)

            aria_label = (entry.get_attribute("aria-label") or "").strip()
            name = aria_label or None

            if not name:
                try:
                    text = (entry.inner_text() or "").strip()
                    for line in text.split("\n"):
                        line = line.strip()
                        if line and len(line) > 1:
                            name = line
                            break
                except Exception:
                    pass

            if not name:
                continue

            # Parse href for placeId / lat / lng
            parsed = _parse_uri_for_place(href)
            # Prefer URL-decoded name from path if aria-label is missing or short
            if parsed.get("urlName") and (not name or len(name) < 3):
                name = parsed["urlName"]

            place_id = parsed.get("placeId") or f"dom:{abs(hash(href)) & 0xFFFFFFFF:08x}"

            place = {
                "placeId": place_id,
                "name": name,
                "formattedAddress": None,
                "rating": None,
                "userRatingCount": None,
                "googleMapsUri": href.split("?")[0] if href else href,
                "addressParts": {
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

        # Hook RPC responses — primary data source
        page.on("response", collector.on_response)

        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            logger.warning(f"goto failed: {e}")

        # Accept cookies banner if present
        try:
            page.wait_for_selector(
                'button[aria-label*="Accept" i], button[aria-label*="Aceitar" i]',
                timeout=4000,
            )
            page.click('button[aria-label*="Accept" i], button[aria-label*="Aceitar" i]')
            logger.info("Cookies banner accepted")
        except Exception:
            pass

        # Wait for results panel to appear
        try:
            page.wait_for_selector(
                'div[role="feed"] a[href*="/maps/place/"], a[role="button"][href*="/maps/place/"]',
                timeout=20000,
            )
            logger.info("Results panel appeared")
        except Exception:
            logger.warning("Results panel did not appear in time")

        # Give RPC time to fire after results panel renders
        page.wait_for_timeout(3000)

        # Initial DOM extraction (always do — gives us googleMapsUri)
        dom_places = _extract_dom_entries(page)
        logger.info(
            f"Initial: DOM={len(dom_places)} entries, "
            f"RPC={len(collector.places)} places "
            f"(search calls: {collector.rpc_search_count}, "
            f"place calls: {collector.rpc_place_count})"
        )

        # ============================================================
        # Scroll loop — load more results, fire more search RPCs
        # ============================================================
        last_rpc_count = len(collector.places)
        last_dom_count = len(dom_places)
        stable_rounds = 0
        for i in range(max_scrolls):
            if len(collector.places) >= max_results and len(dom_places) >= max_results:
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

            # Refresh DOM after each scroll
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
            logger.info(
                f"Scroll {i+1}: RPC={new_rpc_count}, DOM={new_dom_count}"
            )

        # ============================================================
        # Click into each place to trigger place.json
        # (gets us phone + website + full address)
        # ============================================================
        # Build DOM index by name for matching with RPC results
        dom_by_name: Dict[str, Dict[str, Any]] = {}
        for dp in dom_places:
            if dp.get("name"):
                dom_by_name.setdefault(dp["name"], dp)

        # If RPC found places, click each one missing phone/website/address.
        # If RPC found nothing, click each DOM entry to trigger place.json.
        if collector.places:
            click_targets = list(collector.places.values())
        else:
            click_targets = dom_places

        detail_limit = min(len(click_targets), 12)  # cap to avoid being flagged
        logger.info(f"Clicking into {detail_limit} places to fetch details...")

        for idx, target in enumerate(click_targets[:detail_limit]):
            # Skip if we already have rich data
            if (
                target.get("phone")
                and target.get("website")
                and target.get("formattedAddress")
            ):
                continue

            target_name = target.get("name")
            if not target_name:
                continue

            try:
                # Find the DOM link whose aria-label matches the target name
                link = None
                try:
                    links = page.query_selector_all(
                        'div[role="feed"] a[href*="/maps/place/"]'
                    )
                except Exception:
                    links = []
                for l in links:
                    aria = (l.get_attribute("aria-label") or "").strip()
                    if aria == target_name:
                        link = l
                        break

                if not link:
                    # Fallback: try partial match
                    for l in links:
                        aria = (l.get_attribute("aria-label") or "").strip()
                        if target_name.lower() in aria.lower() or aria.lower() in target_name.lower():
                            link = l
                            break

                if not link:
                    logger.debug(f"[{idx+1}/{detail_limit}] no link for '{target_name}'")
                    continue

                link.click(timeout=5000)
                # Wait for place.json RPC to fire and be processed
                page.wait_for_timeout(2500)

                logger.debug(
                    f"[{idx+1}/{detail_limit}] clicked '{target_name}' — "
                    f"RPC places now: {len(collector.places)}"
                )
            except Exception as e:
                logger.debug(f"click into '{target_name}' failed: {e}")
                continue

        # Final DOM extraction (in case more entries loaded after clicks)
        dom_places = _extract_dom_entries(page)
        for dp in dom_places:
            if dp.get("name"):
                dom_by_name.setdefault(dp["name"], dp)

        # ============================================================
        # Merge: RPC is primary, DOM fills in googleMapsUri + lat/lng
        # ============================================================
        results: List[Dict[str, Any]] = []

        if collector.places:
            # RPC mode — merge DOM data into RPC entries
            for r in collector.places.values():
                # Find matching DOM entry by name
                dp = dom_by_name.get(r["name"])
                if dp:
                    if not r.get("googleMapsUri"):
                        r["googleMapsUri"] = dp.get("googleMapsUri")
                    # Fill missing lat/lng from URL
                    if not r.get("latitude") and dp.get("googleMapsUri"):
                        parsed = _parse_uri_for_place(dp["googleMapsUri"])
                        if parsed.get("latitude"):
                            r["latitude"] = parsed["latitude"]
                        if parsed.get("longitude"):
                            r["longitude"] = parsed["longitude"]
                    # If RPC placeId is synthetic (feat:), use real one from URL
                    if r.get("placeId", "").startswith("feat:") and dp.get("googleMapsUri"):
                        parsed = _parse_uri_for_place(dp["googleMapsUri"])
                        if parsed.get("placeId"):
                            r["placeId"] = parsed["placeId"]
                    # Fill missing address parts from DOM default
                    if not r.get("addressParts"):
                        r["addressParts"] = dp.get("addressParts", {})
                # Ensure addressParts has all keys
                ap = r.get("addressParts") or {}
                default_ap = {
                    "streetNumber": None,
                    "route": None,
                    "sublocality": None,
                    "locality": None,
                    "administrativeArea": None,
                    "postalCode": None,
                    "country": "Brasil",
                }
                for k, v in default_ap.items():
                    ap.setdefault(k, v)
                r["addressParts"] = ap
                # Fill administrativeArea from uf if missing
                if not ap.get("administrativeArea"):
                    ap["administrativeArea"] = uf
                # Fill locality from city if missing
                if not ap.get("locality"):
                    ap["locality"] = city
                # Fill country
                if not ap.get("country"):
                    ap["country"] = "Brasil"
                # Fill formattedAddress fallback
                if not r.get("formattedAddress"):
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
                    r["formattedAddress"] = ", ".join(parts)
                results.append(r)
        else:
            # DOM-only fallback — already have name + googleMapsUri + lat/lng
            logger.warning(
                "RPC interception returned 0 places — using DOM-only results"
            )
            for dp in dom_places:
                ap = dp.get("addressParts") or {}
                ap["locality"] = ap.get("locality") or city
                ap["administrativeArea"] = ap.get("administrativeArea") or uf
                ap["country"] = ap.get("country") or "Brasil"
                dp["addressParts"] = ap
                # Build a fallback formattedAddress
                if not dp.get("formattedAddress"):
                    parts = [city, uf, "Brasil"]
                    dp["formattedAddress"] = ", ".join(parts)
                results.append(dp)

        # Truncate to max_results
        if len(results) > max_results:
            results = results[:max_results]

        browser.close()

    logger.info(
        f"Collected {len(results)} places for '{query}' in {city}/{uf} "
        f"(RPC: {len(collector.places)}, DOM: {len(dom_places)})"
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

    out = scrape_google_maps(
        args.query, args.city, args.uf,
        max_results=args.max,
        headless=not args.headed,
    )
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    print()
