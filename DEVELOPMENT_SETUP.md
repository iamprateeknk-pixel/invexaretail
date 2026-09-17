# 👨‍💻 Development Setup Guide

Complete guide for setting up the project locally for development.

---

## Prerequisites

### Required
- **Node.js 20+** - LTS version recommended
- **npm 10+** or **yarn 4+**
- **Docker & Docker Compose** - For containerized development
- **Git** - Version control
- **MySQL 8.0+** (optional if using Docker)

### Recommended
- **VS Code** - Editor with extensions
- **Postman or Insomnia** - API testing
- **DBeaver** - Database GUI
- **Git Bash** (Windows) - POSIX shell

---

## VS Code Extensions

Install these for better development experience:

```json
{
  "recommendations": [
    "ms-vscode.vscode-typescript-vue",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ms-rest-client.rest-client",
    "eamodio.gitlens",
    "ms-azuretools.vscode-docker",
    "prisma.prisma"
  ]
}
```

---

## Project Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-repo/retail-inventory.git
cd retail-inventory
```

### 2. Install Dependencies

#### Option A: Using Docker (Recommended)

```bash
# No local installation needed!
docker-compose up -d
```

#### Option B: Local Node.js Setup

```bash
# Install API dependencies
cd api
npm install
npx prisma generate
cd ..

# Install web dependencies
cd web
npm install
cd ..
```

### 3. Setup Environment Files

```bash
# Copy environment template
cp api/.env.example api/.env

# Edit with your settings (keep defaults for local development)
nano api/.env
```

**Important settings:**
- `DATABASE_URL=mysql://retail:retail_password@localhost:3306/retail_inventory` (leave empty for in-memory seed data)
- `NODE_ENV=development`
- `JWT_SECRET=your-secret-key`

### 4. Setup Database

#### With Docker:
```bash
docker-compose up -d mysql

# Wait for MySQL to be healthy
docker-compose exec mysql mysqladmin ping -h localhost

# Run migrations
docker-compose exec api npm run db:migrate

# Seed demo data
docker-compose exec api npm run db:seed
```

#### Local MySQL:
```bash
cd api
npm run db:migrate
npm run db:seed
cd ..
```

---

## Development Workflow

### Start All Services

#### Using Docker (Recommended)
```bash
docker-compose up
```

Services:
- **Web**: http://localhost:5173
- **API**: http://localhost:4000
- **MySQL**: localhost:3306

#### Manual (Local Node.js + Docker MySQL)
```bash
# Terminal 1: Start MySQL
docker-compose up mysql

# Terminal 2: Start API
cd api
npm run build
npm start

# Terminal 3: Start Web
cd web
npm run dev
```

### Access Application

- **Web Portal**: http://localhost:5173
- **API Health**: http://localhost:4000/health
- **API Docs**: See `API_DOCUMENTATION.md`

### Demo Accounts

```
Admin:
  Email: admin@retail.local
  Password: ChangeMe123!

Store User:
  Email: store@retail.local
  Password: ChangeMe123!

Warehouse Picker:
  Email: picker@retail.local
  Password: ChangeMe123!

Auditor:
  Email: auditor@retail.local
  Password: ChangeMe123!
```

---

## API Development

### Running Tests

```bash
cd api

# Run all tests
npm run test

# Run tests in watch mode
npm run test -- --watch

# Run specific test
npm run test -- src/lib/auth.test.ts

# View coverage
npm run test:coverage
```

### Debugging API

#### Using VS Code Debugger

1. Create `.vscode/launch.json`:
```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/api/src/index.ts",
      "preLaunchTask": "tsc: build",
      "outFiles": ["${workspaceFolder}/api/dist/**/*.js"]
    }
  ]
}
```

2. Add breakpoints and press F5 to debug

#### Using Node Inspector

```bash
cd api
node --inspect-brk dist/index.js
# Open chrome://inspect in Chrome
```

### Testing APIs

#### Using REST Client (VS Code Extension)

Create `api/requests.http`:

```http
### Login
POST http://localhost:4000/api/v1/login
Content-Type: application/json

{
  "email": "admin@retail.local",
  "password": "ChangeMe123!"
}

### Get Stock (after getting token from login response)
GET http://localhost:4000/api/v1/stock/loc-1
Authorization: Bearer YOUR_TOKEN

### Submit Count
POST http://localhost:4000/api/v1/stock-counts
Authorization: Bearer YOUR_TOKEN
Content-Type: application/json

{
  "itemId": "sku-001",
  "locationId": "loc-1",
  "lotNo": "LOT-331",
  "physicalQuantity": 41,
  "mode": "manual"
}
```

Click "Send Request" to test endpoints.

---

## Frontend Development

### Running Web Portal

```bash
cd web
npm run dev
```

Vite will start dev server at http://localhost:5173

### Hot Module Replacement

- Changes to `.jsx` files auto-reload browser
- CSS changes are instant
- Component state is preserved

### Building for Production

```bash
cd web
npm run build
npm run preview  # Test production build locally
```

### Linting

```bash
cd web
npm run lint  # Run oxlint
```

---

## Database Development

### Prisma Setup

```bash
cd api

# Generate Prisma client
npx prisma generate

# View database in visual editor
npx prisma studio

# Create migration
npx prisma migrate dev --name add_new_table

# Reset database (⚠️ DELETES DATA)
npx prisma migrate reset

# Push schema changes
npx prisma db push
```

### Direct Database Access

```bash
# Docker MySQL
docker-compose exec mysql mysql -u retail -p retail_inventory

# Local MySQL
mysql -u retail -p retail_inventory

# Common queries
SELECT * FROM users;
SELECT * FROM locations;
SELECT * FROM stock_counts LIMIT 10;
SELECT * FROM transfers;
```

### Backup Database

```bash
# Docker
docker-compose exec -T mysql mysqldump -u retail -p retail_inventory > backup.sql

# Restore
docker-compose exec mysql mysql -u retail -p retail_inventory < backup.sql
```

---

## Docker Development

### Useful Commands

```bash
# View logs
docker-compose logs -f api
docker-compose logs -f mysql
docker-compose logs -f web

# Execute command in container
docker-compose exec api npm run db:seed
docker-compose exec mysql mysql -u retail -p retail_inventory

# Rebuild images
docker-compose build

# Remove volumes (reset database)
docker-compose down -v

# Stop services
docker-compose stop

# Start services
docker-compose start
```

### Container Shell Access

```bash
# Access API container
docker-compose exec api sh

# Access MySQL container
docker-compose exec mysql bash
```

---

## Git Workflow

### Branch Naming

```
feature/add-pdf-export
bugfix/fix-auth-error
docs/update-readme
refactor/improve-performance
```

### Commit Messages

```
feat: add PDF export functionality
fix: resolve authentication timeout
docs: update API documentation
style: improve CSS styling
refactor: optimize database queries
test: add unit tests for auth
```

### Pull Request Process

1. Create feature branch from `main`
2. Make changes & commit regularly
3. Push branch to remote
4. Create Pull Request with description
5. Code review & tests pass
6. Merge to `main`

---

## Troubleshooting

### Issue: "Cannot find module"

```bash
# Clear node_modules and reinstall
cd api
rm -rf node_modules package-lock.json
npm install
```

### Issue: "Port already in use"

```bash
# Find process using port
lsof -i :4000  # API
lsof -i :5173  # Web
lsof -i :3306  # MySQL

# Kill process (get PID from above)
kill -9 PID

# Or change port in .env
PORT=4001
```

### Issue: "Database connection refused"

```bash
# Check MySQL is running
docker-compose ps mysql

# Restart MySQL
docker-compose restart mysql

# Check connection string
cat api/.env | grep DATABASE_URL
```

### Issue: "Module parse error"

```bash
# Clear Vite cache
rm -rf web/.vite

# Rebuild
npm run build
```

### Issue: "Out of memory"

```bash
# Increase Docker memory
# Edit docker-compose.yml:
services:
  api:
    mem_limit: 2g  # Add this line
```

---

## Performance Tips

### Database
- Add indexes for frequently queried columns
- Use EXPLAIN to analyze queries
- Monitor slow query log

### API
- Use pagination for large datasets
- Cache responses where appropriate
- Minimize database queries per request

### Web
- Code split components
- Lazy load routes
- Optimize images
- Monitor bundle size

---

## Code Quality

### TypeScript
```bash
cd api
npx tsc --noEmit  # Type check
```

### Testing
```bash
cd api
npm run test -- --coverage
```

### Code Review Checklist
- [ ] Code follows project conventions
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] No console errors/warnings
- [ ] Performance acceptable
- [ ] Security implications reviewed

---

## IDE Setup

### VS Code Settings

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "files.exclude": {
    "node_modules": true,
    ".next": true,
    "dist": true
  },
  "search.exclude": {
    "node_modules": true,
    "dist": true
  }
}
```

### Debugging Shortcuts
- F5: Start/continue debugging
- F6: Pause
- F7: Step into
- F8: Step over
- F9: Toggle breakpoint

---

## Development Resources

- [Node.js Documentation](https://nodejs.org/docs/)
- [React 19 Docs](https://react.dev/)
- [Express.js Guide](https://expressjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
- [Docker Docs](https://docs.docker.com/)
- [MySQL 8.0 Reference](https://dev.mysql.com/doc/refman/8.0/en/)

---

## Next Steps

1. Run `docker-compose up`
2. Login at http://localhost:5173
3. Test different roles & workflows
4. Make your first code change
5. Submit a pull request!

---

**Happy Coding! 🚀**

