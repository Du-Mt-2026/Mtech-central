"""
gmaps_scraper.py — Google Maps scraper using Playwright.

Intercepts the internal RPC responses (`search.json` and `place.json`) which
already contain structured data (name, address, phone, website, rating, etc.).
No Google API key required.

Usage as module:
    from gmaps_scraper import scrape_google_maps
    results = scrape_google_maps(query="restaurantes", city="Curitiba", uf="PR")

Returns a list of dicts with normalized fields.
"""

from __future__ import annotations

import json
import re
import time
import logging
from typing import Any, Dict, List, Optional

from playwright.sync_api import (
    Browser,
    BrowserContext,
    Page,
    Playwright,
    sync_playwright,
)

logger = logging.getLogger("gmaps_scraper")
logger.setLevel(logging.INFO)
if not logger.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s"))
    logger.addHandler(_h)


# ---------------------------------------------------------------------------
# RPC response parsers
# ---------------------------------------------------------------------------

def _safe_get(obj: Any, *path, default=None) -> Any:
    cur = obj
    for key in path:
        if cur is None:
            return default
        if isinstance(key, int):
            if not isinstance(cur, list) or key >= len(cur):
                return default
            cur = cur[key]
        else:
            if not isinstance(cur, dict) or key not in cur:
                return default
            cur = cur[key]
    return cur if cur is not None else default


def _parse_address_components(addr_obj: Optional[dict]) -> Dict[str, Optional[str]]:
    """
    Convert Google Maps internal address components into a normalized dict.
    addr_obj is typically a list of {longText, shortText, types: [...]} entries.
    """
    out: Dict[str, Optional[str]] = {
        "streetNumber": None,
        "route": None,
        "sublocality": None,
        "locality": None,
        "administrativeArea": None,
        "postalCode": None,
        "country": None,
    }
    if not isinstance(addr_obj, list):
        return out
    for comp in addr_obj:
        if not isinstance(comp, dict):
            continue
        types = comp.get("types") or []
        val = comp.get("longText") or comp.get("shortText")
        if not val:
            continue
        if "street_number" in types:
            out["streetNumber"] = val
        elif "route" in types:
            out["route"] = val
        elif any(t.startswith("sublocality") for t in types):
            out["sublocality"] = val
        elif "locality" in types:
            out["locality"] = val
        elif "administrative_area_level_1" in types:
            # Use short text (e.g. "PR") to match UF
            short = comp.get("shortText") or val
            out["administrativeArea"] = short
        elif "postal_code" in types:
            out["postalCode"] = val
        elif "country" in types:
            out["country"] = val
    return out


def _parse_place_from_search(item: List) -> Dict[str, Any]:
    """
    Each result item from search.json is a list (array). The known structure:
    item[0]  = placeId (str)
    item[1]  = [lat, lng] (list of floats) or null
    item[2]  = formatted address line (str)
    item[3]  = ?
    item[7]  = ?
    item[8]  = ? (could be a list of categories)
    item[9]  = name (str)
    item[11] = ? (rating related)
    item[14] = rating (float)
    item[15] = review count (int)
    ...

    This is fragile — Google changes indices. We try to be defensive.
    """
    if not isinstance(item, list) or len(item) < 10:
        return {}

    place_id = item[0] if isinstance(item[0], str) else None
    if not place_id:
        return {}

    # Coordinates
    lat = lng = None
    if isinstance(item[1], list) and len(item[1]) >= 2:
        try:
            lat = float(item[1][0])
            lng = float(item[1][1])
        except (TypeError, ValueError):
            pass

    # Address string
    formatted_address = item[2] if isinstance(item[2], str) else None

    # Name — usually at index 11 in current layout, but try a few
    name = None
    for idx in (11, 9, 8):
        if idx < len(item) and isinstance(item[idx], str):
            name = item[idx]
            break

    # Rating
    rating = None
    for idx in (4, 14, 7):
        if idx < len(item) and isinstance(item[idx], (int, float)):
            try:
                v = float(item[idx])
                if 0 < v <= 5:
                    rating = v
                    break
            except (TypeError, ValueError):
                pass

    # Review count
    user_rating_count = None
    for idx in (15, 5, 8):
        if idx < len(item) and isinstance(item[idx], str):
            try:
                # Strip non-digits
                digits = re.sub(r"\D", "", item[idx])
                if digits:
                    user_rating_count = int(digits)
                    break
            except (TypeError, ValueError):
                pass

    return {
        "placeId": place_id,
        "name": name,
        "formattedAddress": formatted_address,
        "latitude": lat,
        "longitude": lng,
        "rating": rating,
        "userRatingCount": user_rating_count,
    }


def _parse_place_details(data: Any) -> Dict[str, Any]:
    """
    Parse the place.json response (more detailed). Returns a dict with
    name, address, phone, website, address components, etc.
    """
    out: Dict[str, Any] = {
        "placeId": None,
        "name": None,
        "formattedAddress": None,
        "website": None,
        "phone": None,
        "internationalPhoneNumber": None,
        "rating": None,
        "userRatingCount": None,
        "googleMapsUri": None,
        "businessStatus": None,
        "addressParts": None,
    }

    if not isinstance(data, list):
        return out

    # placeId usually at index 0
    if isinstance(data[0], str):
        out["placeId"] = data[0]

    # Coordinates at index 1
    if isinstance(data[1], list) and len(data[1]) >= 2:
        try:
            out["latitude"] = float(data[1][0])
            out["longitude"] = float(data[1][1])
        except (TypeError, ValueError):
            pass

    # Walk through the list looking for known patterns
    for i, item in enumerate(data):
        if isinstance(item, str):
            # Address (usually long, contains digits / commas)
            if (
                not out["formattedAddress"]
                and i > 1
                and ("," in item or re.search(r"\d{4,5}-?\d{0,3}", item))
                and len(item) > 15
            ):
                out["formattedAddress"] = item
            # Phone pattern (Brazilian or international)
            elif not out["phone"] and re.search(r"\+?\d[\d\s\-()]{7,}", item):
                if item.startswith("+") or re.match(r"^\(\d{2}\)\s?\d", item):
                    out["phone"] = item
                    if item.startswith("+"):
                        out["internationalPhoneNumber"] = item
            # Website URL
            elif (
                not out["website"]
                and re.match(r"^https?://", item)
                and "google" not in item.lower()
            ):
                out["website"] = item
            # Name (typically short, no commas, no URLs)
            elif (
                not out["name"]
                and not item.startswith("+")
                and not re.match(r"^https?://", item)
                and "," not in item
                and len(item) < 200
                and i > 2
            ):
                # Heuristic: take the first non-address string
                if not out["name"]:
                    out["name"] = item

        elif isinstance(item, (int, float)):
            # Rating is typically a float 0..5
            if (
                not out["rating"]
                and isinstance(item, (int, float))
                and 0 < item <= 5
            ):
                out["rating"] = float(item)

    # Address components sometimes appear as a nested list of dicts
    for item in data:
        if isinstance(item, list):
            # Look for the address-components-like structure
            if any(
                isinstance(sub, dict) and "types" in sub for sub in item
            ):
                out["addressParts"] = _parse_address_components(item)
                break

    return out


# ---------------------------------------------------------------------------
# Browser automation
# ---------------------------------------------------------------------------

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)


def _build_search_url(query: str, city: str, uf: str) -> str:
    """Build the Google Maps search URL with a geo-anchored query."""
    q = f"{query} em {city}, {uf}, Brasil"
    return f"https://www.google.com/maps/search/{__import__('urllib').parse.quote(q)}"


def _collect_rpc_responses(page: Page) -> List[Dict[str, Any]]:
    """
    Intercept network responses for search.json and place.json endpoints
    and accumulate parsed place data.
    """
    results: List[Dict[str, Any]] = []
    seen_ids: set[str] = set()

    def on_response(response):
        url = response.url
        try:
            if "/maps/rpc/search" in url or "search.json" in url:
                data = response.json()
                # The data is typically a nested list of items
                items = _extract_search_items(data)
                for item in items:
                    parsed = _parse_place_from_search(item)
                    if (
                        parsed
                        and parsed.get("placeId")
                        and parsed["placeId"] not in seen_ids
                    ):
                        seen_ids.add(parsed["placeId"])
                        results.append(parsed)
            elif "/maps/rpc/place" in url or "place.json" in url:
                data = response.json()
                parsed = _parse_place_details(data)
                if parsed.get("placeId"):
                    # Merge into existing or append
                    pid = parsed["placeId"]
                    if pid in seen_ids:
                        for r in results:
                            if r.get("placeId") == pid:
                                r.update(
                                    {k: v for k, v in parsed.items() if v}
                                )
                                break
                    else:
                        seen_ids.add(pid)
                        results.append(parsed)
        except Exception as e:
            logger.debug(f"Failed to parse response from {url}: {e}")

    page.on("response", on_response)
    return results


def _extract_search_items(data: Any) -> List[List]:
    """
    Drill into the RPC search.json response to find the list of place items.
    The structure varies; we look for a list of lists where each inner list
    starts with a placeId string.
    """
    candidates: List[List] = []

    def walk(node: Any):
        if isinstance(node, list):
            # Heuristic: if any element is a list starting with a 27-char string
            # (Google place IDs are typically "ChIJ..." ~27 chars), treat as items
            if node and isinstance(node[0], list):
                first_inner = node[0]
                if (
                    first_inner
                    and isinstance(first_inner[0], str)
                    and len(first_inner[0]) >= 20
                    and first_inner[0].startswith("0x") is False
                ):
                    # Try to validate: it should look like a place ID
                    if re.match(r"^[A-Za-z0-9_-]{20,}$", first_inner[0]):
                        candidates.extend(
                            sub for sub in node if isinstance(sub, list)
                        )
                        return
            for sub in node:
                walk(sub)
        elif isinstance(node, dict):
            for v in node.values():
                walk(v)

    walk(data)
    return candidates


def _scroll_results_panel(page: Page, max_scrolls: int = 20, wait_ms: int = 1500):
    """
    Scroll the results sidebar to load more places.
    """
    for _ in range(max_scrolls):
        try:
            page.evaluate(
                """
                () => {
                  const el = document.querySelector(
                    'div[role="feed"]'
                  ) || document.querySelector(
                    'div[aria-label*="Results" i]'
                  );
                  if (el) {
                    el.scrollBy(0, el.clientHeight * 0.8);
                  }
                }
                """
            )
        except Exception:
            pass
        page.wait_for_timeout(wait_ms)


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

    Args:
        query: business type or name (e.g. "restaurantes", "academias")
        city: city name (e.g. "Curitiba")
        uf: 2-letter state code (e.g. "PR")
        max_results: stop after collecting this many places
        headless: run browser in headless mode
        timeout_ms: per-page navigation timeout
        max_scrolls: max number of sidebar scrolls
        lang: browser language

    Returns:
        List of normalized dicts with keys:
            placeId, name, formattedAddress, website, phone, rating,
            userRatingCount, googleMapsUri, businessStatus, addressParts,
            latitude, longitude
    """
    results: List[Dict[str, Any]] = []
    url = _build_search_url(query, city, uf)
    logger.info(f"Scraping: {url}")

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

        # Attach RPC interceptor (writes into `results`)
        seen_ids: set[str] = set()

        def on_response(response):
            nonlocal results, seen_ids
            u = response.url
            try:
                if "/maps/rpc/search" in u or "search.json" in u:
                    data = response.json()
                    items = _extract_search_items(data)
                    for item in items:
                        parsed = _parse_place_from_search(item)
                        if (
                            parsed
                            and parsed.get("placeId")
                            and parsed["placeId"] not in seen_ids
                        ):
                            seen_ids.add(parsed["placeId"])
                            results.append(parsed)
                elif "/maps/rpc/place" in u or "place.json" in u:
                    data = response.json()
                    parsed = _parse_place_details(data)
                    pid = parsed.get("placeId")
                    if pid:
                        if pid in seen_ids:
                            for r in results:
                                if r.get("placeId") == pid:
                                    r.update(
                                        {k: v for k, v in parsed.items() if v}
                                    )
                                    break
                        else:
                            seen_ids.add(pid)
                            results.append(parsed)
            except Exception as e:
                logger.debug(f"parse error for {u}: {e}")

        page.on("response", on_response)

        try:
            page.goto(url, wait_until="domcontentloaded")
        except Exception as e:
            logger.warning(f"goto failed: {e}")

        # Accept cookies banner if present (common in EU/BR)
        try:
            page.wait_for_selector(
                'button[aria-label*="Accept" i], button[aria-label*="Aceitar" i]',
                timeout=4000,
            )
            page.click('button[aria-label*="Accept" i], button[aria-label*="Aceitar" i]')
        except Exception:
            pass

        # Wait for results panel to appear
        try:
            page.wait_for_selector('div[role="feed"], a[href*="/maps/place/"]', timeout=15000)
        except Exception:
            logger.warning("Results panel did not appear in time")

        # Scroll to load more
        last_count = 0
        stable_rounds = 0
        for i in range(max_scrolls):
            if len(results) >= max_results:
                break
            try:
                page.evaluate(
                    """
                    () => {
                      const el = document.querySelector('div[role="feed"]')
                        || document.querySelector('div[aria-label*="Results" i]');
                      if (el) el.scrollBy(0, el.clientHeight * 0.85);
                    }
                    """
                )
            except Exception:
                pass
            page.wait_for_timeout(1800)

            if len(results) == last_count:
                stable_rounds += 1
                if stable_rounds >= 4:
                    logger.info(f"Results stable at {len(results)} — stopping scroll")
                    break
            else:
                stable_rounds = 0
            last_count = len(results)

        # For each result missing phone/website, click into the place to load details
        # Limit to the first N to avoid being flagged
        detail_limit = min(len(results), 25)
        for r in results[:detail_limit]:
            if len(results) >= max_results:
                break
            if r.get("phone") or r.get("website"):
                continue
            try:
                # Find the place link by placeId in href
                pid = r.get("placeId")
                if not pid:
                    continue
                # Click the entry — try multiple selectors
                clicked = False
                try:
                    link = page.query_selector(
                        f'a[href*="{pid}"], a[href*="/maps/place/"]'
                    )
                    if link:
                        link.click(timeout=5000)
                        clicked = True
                except Exception:
                    pass
                if not clicked:
                    continue
                # Wait for place details panel
                page.wait_for_timeout(2500)
            except Exception as e:
                logger.debug(f"click into place failed: {e}")

        browser.close()

    # Truncate to max_results
    if len(results) > max_results:
        results = results[:max_results]

    logger.info(f"Collected {len(results)} places for '{query}' in {city}/{uf}")
    return results


# ---------------------------------------------------------------------------
# CLI entry point (for testing)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    import sys

    p = argparse.ArgumentParser()
    p.add_argument("--query", required=True)
    p.add_argument("--city", required=True)
    p.add_argument("--uf", required=True)
    p.add_argument("--max", type=int, default=60)
    p.add_argument("--headed", action="store_true")
    args = p.parse_args()

    out = scrape_google_maps(
        args.query, args.city, args.uf,
        max_results=args.max,
        headless=not args.headed,
    )
    json.dump(out, sys.stdout, ensure_ascii=False, indent=2)
    print()
