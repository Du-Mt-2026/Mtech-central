"""
gmaps_scraper.py — Google Maps scraper using Playwright.

Strategy:
1. Open Google Maps search URL with the query anchored to city/UF.
2. Wait for the results feed (`div[role="feed"]`) to render.
3. Scroll the feed to load more entries.
4. For each result entry (`a[href*="/maps/place/"]`), extract:
   - placeId (from the href's `0x...:0x...` format)
   - name (from aria-label of the link)
   - formattedAddress, rating, reviewCount, category (from inner text)
5. Optionally click into each entry to load phone + website.

This DOM-based approach is much more robust than parsing the internal
RPC responses (which Google changes frequently).

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
# Helpers
# ---------------------------------------------------------------------------

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)


def _build_search_url(query: str, city: str, uf: str) -> str:
    """Build the Google Maps search URL with a geo-anchored query."""
    q = f"{query} em {city}, {uf}, Brasil"
    return f"https://www.google.com/maps/search/{urllib.parse.quote(q)}"


def _extract_place_id_from_href(href: str) -> Optional[str]:
    """
    Google Maps place URLs contain a place ID in the `0x...:0x...` format
    in the URL path, OR a `ChIJ...` style ID in query params.

    Examples:
      https://www.google.com/maps/place/Restaurante+XYZ/@-25.4,-49.2,17z/data=...
      https://www.google.com/maps/place/?q=place_id:ChIJ...

    We use the page's URL when we click into the place to extract the
    canonical place_id from the URL.
    """
    # The "0x94..." format is the hex-encoded lat:lng pair, not the placeId.
    # We need to construct a synthetic placeId since the DOM doesn't expose it directly.
    # Use the full href as the unique key — it contains the place name + coords.
    return None


def _parse_address_from_text(text: str) -> Dict[str, Any]:
    """
    Try to parse Brazilian address components from a free-form address string.
    Best-effort — won't be perfect.
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

    # CEP: \d{5}-\d{3}
    cep_m = re.search(r"\b(\d{5})-(\d{3})\b", text)
    if cep_m:
        out["postalCode"] = cep_m.group(0)

    # UF: ", XX" at end of string (2-letter uppercase)
    uf_m = re.search(r",\s*([A-Z]{2})\s*(?:,|\s*$|\s*Brasil)", text)
    if uf_m:
        out["administrativeArea"] = uf_m.group(1)

    # City: text between " - " and ", UF"
    city_m = re.search(r",\s*([^,]+?)\s*-\s*([A-Z]{2})", text)
    if city_m:
        out["locality"] = city_m.group(1).strip()

    return out


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
    results: List[Dict[str, Any]] = []
    seen_keys: set[str] = set()
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

        # ============================================================
        # Scroll + extract loop
        # ============================================================
        def extract_from_dom() -> int:
            """
            Extract place entries from the current DOM state.
            Returns the number of NEW entries added.
            """
            new_count = 0
            # Each result entry is an <a> with href containing "/maps/place/"
            # OR a div with role="article" inside the feed.
            entries = page.query_selector_all(
                'div[role="feed"] a[href*="/maps/place/"], '
                'a[role="button"][href*="/maps/place/"]'
            )
            logger.info(f"DOM extraction: found {len(entries)} link entries")

            for entry in entries:
                try:
                    href = entry.get_attribute("href") or ""
                    if "/maps/place/" not in href:
                        continue

                    # Use href as unique key (it contains place name + coords)
                    if href in seen_keys:
                        continue

                    # aria-label usually contains "Place name · rating · reviews · category · address"
                    aria_label = entry.get_attribute("aria-label") or ""

                    # Get the text content of the entry for parsing
                    text_content = entry.inner_text() or aria_label

                    # Name: try aria-label first (cleaner), then first line of text
                    name = aria_label.strip() if aria_label else None
                    if not name:
                        # First non-empty line of text_content
                        for line in text_content.split("\n"):
                            line = line.strip()
                            if line and len(line) > 1:
                                name = line
                                break

                    if not name:
                        continue

                    # Parse rating and review count from text
                    rating = None
                    user_rating_count = None
                    rating_m = re.search(r"(\d+[.,]\d)\s*\(", text_content)
                    if rating_m:
                        try:
                            rating = float(rating_m.group(1).replace(",", "."))
                        except ValueError:
                            pass
                        # Review count is in parentheses after rating
                        reviews_m = re.search(r"\(([\d.,]+)\)", text_content[rating_m.end()-1:])
                        if reviews_m:
                            try:
                                user_rating_count = int(
                                    reviews_m.group(1).replace(".", "").replace(",", "")
                                )
                            except ValueError:
                                pass

                    # Address: usually the last meaningful line in the entry
                    address = None
                    lines = [l.strip() for l in text_content.split("\n") if l.strip()]
                    if lines:
                        # Try to find a line that looks like an address
                        for line in reversed(lines):
                            if (
                                "," in line
                                and not line.startswith("·")
                                and not re.match(r"^\d+[.,]\d\s*\(", line)
                                and len(line) > 10
                            ):
                                # Skip if it's just the rating line
                                if not re.match(r"^\d+\s*\(?\d*", line):
                                    address = line
                                    break

                    address_parts = _parse_address_from_text(address or "")

                    place = {
                        "placeId": f"dom:{hash(href) & 0xFFFFFFFF:08x}",  # synthetic ID
                        "name": name,
                        "formattedAddress": address,
                        "rating": rating,
                        "userRatingCount": user_rating_count,
                        "googleMapsUri": href.split("?")[0] if href else None,
                        "addressParts": address_parts,
                        "website": None,
                        "phone": None,
                        "businessStatus": "OPERATIONAL",
                    }

                    seen_keys.add(href)
                    results.append(place)
                    new_count += 1

                except Exception as e:
                    logger.debug(f"Error extracting entry: {e}")
                    continue

            return new_count

        # Initial extraction
        extract_from_dom()

        # Scroll loop
        last_count = len(results)
        stable_rounds = 0
        for i in range(max_scrolls):
            if len(results) >= max_results:
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
            page.wait_for_timeout(2000)

            # Extract after each scroll
            extract_from_dom()

            if len(results) == last_count:
                stable_rounds += 1
                if stable_rounds >= 3:
                    logger.info(
                        f"Results stable at {len(results)} — stopping scroll"
                    )
                    break
            else:
                stable_rounds = 0
            last_count = len(results)
            logger.info(f"Scroll {i+1}: {len(results)} places so far")

        # ============================================================
        # Click into each place to get phone + website (optional)
        # ============================================================
        detail_limit = min(len(results), 10)  # limit to avoid being flagged
        for r in results[:detail_limit]:
            if len(results) >= max_results:
                break
            if r.get("phone") and r.get("website"):
                continue
            try:
                href = r.get("googleMapsUri")
                if not href:
                    continue
                # Find the link with this href
                link = page.query_selector(f'a[href*="{href}"]')
                if not link:
                    continue
                link.click(timeout=5000)
                # Wait for place details panel to load
                page.wait_for_timeout(3000)

                # Extract phone and website from the details panel
                try:
                    # Phone: look for buttons with tel: links or "phone" in aria-label
                    phone_el = page.query_selector(
                        'button[data-item-id*="phone"] a, '
                        'a[href^="tel:"], '
                        'button[aria-label*="Telefone" i], '
                        'button[aria-label*="phone" i]'
                    )
                    if phone_el:
                        href_val = phone_el.get_attribute("href") or ""
                        if href_val.startswith("tel:"):
                            r["phone"] = href_val.replace("tel:", "").strip()
                        else:
                            aria = phone_el.get_attribute("aria-label") or ""
                            phone_m = re.search(r"\+?[\d\s\-()]{8,}", aria)
                            if phone_m:
                                r["phone"] = phone_m.group(0).strip()
                except Exception:
                    pass

                try:
                    # Website: look for buttons with website links
                    web_el = page.query_selector(
                        'a[data-item-id*="authority"], '
                        'a[aria-label*="Site" i], '
                        'a[aria-label*="Website" i]'
                    )
                    if web_el:
                        web_href = web_el.get_attribute("href") or ""
                        if web_href.startswith("http"):
                            r["website"] = web_href
                except Exception:
                    pass

                # Update address if we have a better one now
                try:
                    addr_el = page.query_selector(
                        'button[data-item-id*="address"], '
                        'div[data-item-id*="address"]'
                    )
                    if addr_el:
                        addr_text = addr_el.inner_text().strip()
                        if addr_text and len(addr_text) > 5:
                            r["formattedAddress"] = addr_text
                            r["addressParts"] = _parse_address_from_text(addr_text)
                except Exception:
                    pass

            except Exception as e:
                logger.debug(f"click into place failed: {e}")

        browser.close()

    # Truncate to max_results
    if len(results) > max_results:
        results = results[:max_results]

    logger.info(
        f"Collected {len(results)} places for '{query}' in {city}/{uf}"
    )
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
