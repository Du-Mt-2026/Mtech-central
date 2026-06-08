#!/bin/bash
set -e
echo "=== OctupusZap Deploy Hook ==="
echo "Timestamp: $(date)"

cd /opt/octupuszap

echo "📥 Pulling latest changes..."
git fetch origin main
git reset --hard origin/main

echo "🐳 Building Docker image..."
docker compose build app

echo "🚀 Restarting app container..."
docker compose up -d app

echo "✅ Deploy completed!"
