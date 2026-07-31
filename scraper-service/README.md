# OctopusZap Scraper Service

Microsserviço Python (FastAPI + Playwright) que substitui a Google Places API.
Faz scraping direto do Google Maps sem chave de API.

## Endpoints

| Método | Rota       | Descrição                                   |
|--------|------------|---------------------------------------------|
| GET    | `/health`  | Health check — `{"ok": true, ...}`          |
| POST   | `/scrape`  | Dispara um scrape e retorna JSON            |
| GET    | `/docs`    | Swagger UI                                  |

### POST /scrape

Request body:
```json
{
  "query": "restaurantes",
  "city": "Curitiba",
  "uf": "PR",
  "max_results": 60,
  "headless": true,
  "max_scrolls": 25,
  "lang": "pt-BR"
}
```

Response:
```json
{
  "leads": [
    {
      "placeId": "ChIJ...",
      "name": "Restaurante XYZ",
      "formattedAddress": "Rua ABC, 123 - Centro, Curitiba - PR, 80000-000",
      "website": "https://xyz.com.br",
      "phone": "+55 41 3333-3333",
      "rating": 4.5,
      "userRatingCount": 1234,
      "addressParts": {
        "streetNumber": "123",
        "route": "Rua ABC",
        "sublocality": "Centro",
        "locality": "Curitiba",
        "administrativeArea": "PR",
        "postalCode": "80000-000",
        "country": "Brasil"
      },
      "latitude": -25.4284,
      "longitude": -49.2733
    }
  ],
  "count": 1,
  "query": "restaurantes",
  "city": "Curitiba",
  "uf": "PR",
  "elapsed_ms": 18500
}
```

## Desenvolvimento local

```bash
cd scraper-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
playwright install chromium
uvicorn app:app --host 0.0.0.0 --port 5000 --reload
```

## Docker

O container é buildado automaticamente pelo `docker-compose.yml` na raiz
do projeto. Não exponha a porta 5000 publicamente — o Next.js fala com o
scraper pela rede interna do Docker (`http://scraper:5000`).
