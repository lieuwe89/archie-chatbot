# Fly.io Redis Setup for Archie Multi-Instance

This directory contains the Redis deployment configuration for Archie on Fly.io. Redis enables session sharing across multiple Archie instances.

## Setup Steps

### 1. Deploy Redis app
```bash
cd archie-redis-fly
fly deploy --app archie-redis
```

### 2. Create persistent volume (one-time)
```bash
fly volumes create redis_data --app archie-redis --region ams --size 1
```

### 3. Set up private networking
```bash
fly networks create --app archie-redis
fly networks create --app archie-chatbot
```

### 4. Configure Archie to use Redis
```bash
fly secrets set REDIS_URL='redis://archie-redis.internal:6379' --app archie-chatbot
```

### 5. Deploy Archie
```bash
cd ..
fly deploy
```

## Verification

Check Redis is running:
```bash
fly status --app archie-redis
```

Check Archie is using Redis:
```bash
fly logs --app archie-chatbot | grep "\[Sessions\]"
```

Should show: `[Sessions] Connected to Redis`

## Troubleshooting

**Redis connection fails:**
- Verify private networking: `fly networks list --app archie-redis`
- Check DNS: `fly ssh console --app archie-chatbot -c "nslookup archie-redis.internal"`

**Sessions not syncing:**
- Restart Archie: `fly apps restart archie-chatbot`
- Check Redis: `fly ssh console --app archie-redis -c "redis-cli ping"`
