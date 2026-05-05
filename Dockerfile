FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements-server.txt .
RUN pip install --no-cache-dir -r requirements-server.txt

COPY . .

EXPOSE 7860

CMD ["gunicorn", "--bind", "0.0.0.0:7860", "--workers", "1", "--threads", "1", "--timeout", "300", "server:app"]
