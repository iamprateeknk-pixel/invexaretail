# 🚀 Retail Inventory App - Deployment Guide

## Hostinger Cloud Deployment

This guide covers deploying the Retail Inventory Warehouse Transfer App on Hostinger's cloud hosting.

---

## Prerequisites

- Hostinger account with cloud hosting plan (VPS/Cloud recommended)
- Domain name (or use Hostinger's subdomain)
- SSH access to your server
- Basic Linux/command line knowledge

---

## Phase 1: Server Setup

### 1.1 Connect to Your Hostinger Server

```bash
ssh root@your_server_ip
# or use Hostinger's provided SSH credentials
```

### 1.2 Update System

```bash
apt update && apt upgrade -y
```

### 1.3 Install Docker & Docker Compose

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Verify installations
docker --version
docker-compose --version
```

### 1.4 Create Application Directory

```bash
mkdir -p /app/retail-inventory
cd /app/retail-inventory
```

---

## Phase 2: Clone & Prepare Application

### 2.1 Clone Repository

```bash
# If using Git
git clone https://github.com/your-repo/retail-inventory.git .

# OR upload files via SFTP/SCP
```

### 2.2 Create Environment Files

```bash
cat > .env << 'EOF'
# API Environment Variables
DATABASE_URL=mysql://retail:retail_password@mysql:3306/retail_inventory
JWT_SECRET=your-super-secret-jwt-key-change-this
SEED_PASSWORD=ChangeMe123!
NODE_ENV=production
PORT=4000

# MySQL
MYSQL_ROOT_PASSWORD=root_password_change_this
MYSQL_USER=retail
MYSQL_PASSWORD=retail_password_change_this
MYSQL_DATABASE=retail_inventory

# Upload directory
UPLOAD_DIR=/app/uploads
EOF
```

⚠️ **IMPORTANT**: Change all passwords to strong, unique values!

### 2.3 Update docker-compose.yml

```bash
nano docker-compose.yml
```

Update the file with production settings:

```yaml
version: '3.8'

services:
  mysql:
    image: mysql:8.4
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: ${MYSQL_ROOT_PASSWORD}
      MYSQL_USER: ${MYSQL_USER}
      MYSQL_PASSWORD: ${MYSQL_PASSWORD}
      MYSQL_DATABASE: ${MYSQL_DATABASE}
    volumes:
      - mysql_data:/var/lib/mysql
      - ./backups:/backups
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "localhost"]
      interval: 10s
      timeout: 5s
      retries: 5

  api:
    build: ./api
    restart: always
    environment:
      DATABASE_URL: ${DATABASE_URL}
      JWT_SECRET: ${JWT_SECRET}
      NODE_ENV: ${NODE_ENV}
      PORT: ${PORT}
      SEED_PASSWORD: ${SEED_PASSWORD}
    volumes:
      - uploads:/app/uploads
    depends_on:
      mysql:
        condition: service_healthy
    ports:
      - "4000:4000"

  web:
    build: ./web
    restart: always
    depends_on:
      - api
    ports:
      - "5173:80"
    environment:
      - VITE_API_BASE=http://your-domain.com

volumes:
  mysql_data:
  uploads:
```

---

## Phase 3: SSL/TLS & Reverse Proxy Setup

### 3.1 Install Nginx

```bash
apt install -y nginx
systemctl start nginx
systemctl enable nginx
```

### 3.2 Create Nginx Configuration

```bash
cat > /etc/nginx/sites-available/retail-inventory << 'EOF'
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    
    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name your-domain.com www.your-domain.com;

    # SSL Certificates (will add later with Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Gzip compression
    gzip on;
    gzip_types text/html text/css application/json application/javascript;
    gzip_min_length 1000;

    # Security headers
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # Web app (frontend)
    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API
    location /api {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_request_buffering off;
    }
}
EOF
```

### 3.3 Enable Site

```bash
ln -s /etc/nginx/sites-available/retail-inventory /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default

nginx -t  # Test configuration
systemctl reload nginx
```

### 3.4 Setup SSL with Let's Encrypt

```bash
apt install -y certbot python3-certbot-nginx

certbot certonly --standalone -d your-domain.com -d www.your-domain.com

# Update nginx config with certificate paths (done above)
systemctl reload nginx
```

---

## Phase 4: Deploy Application

### 4.1 Start Docker Containers

```bash
cd /app/retail-inventory
docker-compose up -d
```

### 4.2 Verify Containers

```bash
docker-compose ps
docker-compose logs -f api    # Watch API logs
docker-compose logs -f mysql  # Watch MySQL logs
```

### 4.3 Test Application

```bash
# Test API health
curl https://your-domain.com/api/v1/health

# Test database connection
docker-compose exec api npm run db:validate

# View seeded data
docker-compose exec mysql mysql -u retail -p${MYSQL_PASSWORD} retail_inventory -e "SELECT * FROM users;"
```

---

## Phase 5: Backup & Maintenance

### 5.1 Database Backup Script

```bash
cat > /app/retail-inventory/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/app/retail-inventory/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
docker-compose exec -T mysql mysqldump -u retail -p${MYSQL_PASSWORD} retail_inventory > $BACKUP_DIR/retail_inventory_$TIMESTAMP.sql

# Compress
gzip $BACKUP_DIR/retail_inventory_$TIMESTAMP.sql

# Keep only last 30 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "Backup completed: $BACKUP_DIR/retail_inventory_$TIMESTAMP.sql.gz"
EOF

chmod +x /app/retail-inventory/backup.sh
```

### 5.2 Cron Job for Daily Backups

```bash
(crontab -l 2>/dev/null; echo "0 2 * * * /app/retail-inventory/backup.sh") | crontab -
```

### 5.3 Monitor Disk Space

```bash
# Check disk usage
df -h

# Monitor container logs
docker-compose logs --tail=100 api
```

---

## Phase 6: Performance Optimization

### 6.1 Configure MySQL for Production

```bash
docker-compose exec mysql mysql -u root -p${MYSQL_ROOT_PASSWORD} -e "
SET GLOBAL max_connections = 1000;
SET GLOBAL query_cache_size = 268435456;
SET GLOBAL innodb_buffer_pool_size = 1073741824;
"
```

### 6.2 Enable API Caching

Update `.env`:
```
CACHE_TTL=3600
```

### 6.3 Setup CDN (Optional)

- Use Cloudflare for free CDN and DDoS protection
- Point domain to Cloudflare nameservers
- Enable HTTP/2, Brotli compression

---

## Phase 7: Monitoring & Alerts

### 7.1 Setup Log Monitoring

```bash
# Watch real-time logs
docker-compose logs -f

# View specific service logs
docker-compose logs api
docker-compose logs mysql
```

### 7.2 Health Checks

```bash
# Create health check script
cat > /app/retail-inventory/health-check.sh << 'EOF'
#!/bin/bash
API_URL="https://your-domain.com/api/v1/health"
STATUS=$(curl -s -o /dev/null -w "%{http_code}" $API_URL)

if [ $STATUS -ne 200 ]; then
  # Send alert (email, Slack, etc.)
  echo "API Health Check Failed: HTTP $STATUS"
fi
EOF

chmod +x /app/retail-inventory/health-check.sh

# Add to crontab for every 5 minutes
(crontab -l 2>/dev/null; echo "*/5 * * * * /app/retail-inventory/health-check.sh") | crontab -
```

---

## Troubleshooting

### Issue: Database connection failed

```bash
# Check MySQL logs
docker-compose logs mysql

# Verify connection
docker-compose exec api mysql -h mysql -u retail -p${MYSQL_PASSWORD} -e "SELECT 1"
```

### Issue: Container won't start

```bash
# Check logs
docker-compose logs [service_name]

# Restart service
docker-compose restart [service_name]
```

### Issue: SSL certificate errors

```bash
# Renew certificate
certbot renew --dry-run

# Force renewal
certbot renew --force-renewal
```

---

## Maintenance Checklist

- [ ] Backup database daily
- [ ] Monitor disk space
- [ ] Update system packages monthly
- [ ] Rotate SSL certificates (auto with certbot)
- [ ] Review application logs
- [ ] Test disaster recovery
- [ ] Update Docker images periodically
- [ ] Monitor API response times

---

## Upgrade Guide

When deploying updates:

```bash
cd /app/retail-inventory

# Backup current state
docker-compose exec -T mysql mysqldump -u retail -p${MYSQL_PASSWORD} retail_inventory > backup_before_update.sql

# Pull latest code
git pull origin main

# Rebuild images
docker-compose build

# Start updated services
docker-compose up -d

# Verify upgrade
curl https://your-domain.com/api/v1/health
```

---

## Support & Resources

- API Documentation: `/docs/API.md`
- Troubleshooting: `/docs/TROUBLESHOOTING.md`
- Docker Docs: https://docs.docker.com/
- Hostinger Support: https://support.hostinger.com/

---

**Last Updated**: 2026-09-08

