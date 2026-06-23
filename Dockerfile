# NAVADA NeuroAtlas — static app + AI proxy
FROM python:3.11-slim

WORKDIR /app
COPY . /app

# server.py uses only the Python standard library (no pip deps).
EXPOSE 8099

# AI key is injected at runtime via env (never baked into the image).
CMD ["python", "server.py"]
