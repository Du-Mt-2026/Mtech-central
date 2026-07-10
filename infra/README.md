# Infraestrutura OctupusZap

## evolution-proxy/
Proxy reverso que troca global API key por instance token nas chamadas pra Evolution Go.
Necessário porque o manager UI da Evolution Go usa global key, mas a API exige instance token.

- server.js: servidor Node com axios
- Dockerfile: build da imagem

### Como restaurar:
cd /opt/evolution-proxy
docker build -t evolution-proxy .
docker run -d \
  --name evolution-proxy \
  --network duda-bot_duda-network \
  -p 3001:3001 \
  -e GLOBAL_API_KEY="${GLOBAL_API_KEY}" \
  --restart unless-stopped \
  evolution-proxy

### Traefik config:
No /opt/duda-bot/traefik/dynamic.yml, o service evolution-go aponta pra http://evolution-proxy:3001

## kvm4-1/
Backup do docker-compose.yml da KVM4-1 (VPS que roda o Postgres na rede WireGuard 10.0.0.1).
Importante: tem command: postgres -c max_connections=500 que previne "too many clients".
