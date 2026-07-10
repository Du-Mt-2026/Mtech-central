# Contribuindo com o OctupusZap

## Regra de Deploy (a partir de v2.0.0-stable)

> **TUDO passa pelo CI antes de produção.**

- Não importa quão "rápida" seja a mudança.
- Se não passou no CI (build verification), não vai para produção.
- Exceção apenas para hotfix crítico de outage — com commit + push imediato após.
- Regra implícita é a que mais se quebra sob pressão. Esta é explícita.

## Workflow
1. Branch: git checkout -b feat/minha-feature
2. Push: git push origin feat/minha-feature
3. Abra Pull Request no GitHub
4. Aguarde CI passar
5. Merge para main
6. Deploy: git pull && docker compose build app && docker compose up -d app

## Rollback
git checkout v2.0.0-rollback
docker compose build app && docker compose up -d app
