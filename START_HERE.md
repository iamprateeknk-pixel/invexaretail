# 🚀 START HERE

Welcome to the Retail Inventory Warehouse Transfer App! This is your quick start guide.

---

## ⚡ 5-Minute Quick Start

### 1. Clone & Setup
```bash
git clone https://github.com/your-repo/retail-inventory.git
cd retail-inventory
```

### 2. Start with Docker
```bash
docker-compose up
```

### 3. Access Application
- **Web Portal**: http://localhost:5173
- **API**: http://localhost:4000/api/v1

### 4. Login
```
Email: admin@retail.local
Password: ChangeMe123!
```

Done! 🎉

---

## 📚 Documentation

**Choose based on your role:**

### I want to...

- **Run the app locally** → [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md)
- **Deploy to Hostinger** → [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
- **Use the REST API** → [API_DOCUMENTATION.md](API_DOCUMENTATION.md)
- **Understand mobile plan** → [MOBILE_APP_PLAN.md](MOBILE_APP_PLAN.md)
- **Get full overview** → [README.md](README.md)

---

## 🎯 Key Features

✅ **Inventory Management** - Real-time stock visibility  
✅ **Blind Counting** - Variance detection without book quantity visibility  
✅ **Warehouse Transfers** - Multi-step transfer workflow with picking  
✅ **Role-Based Access** - Admin, Store User, Picker, Auditor roles  
✅ **Audit Logging** - Complete action trail  
✅ **Web Portal** - Modern React interface  
✅ **REST API** - Fully documented endpoints  
✅ **Docker Ready** - One-command deployment  

---

## 👥 Demo Accounts

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@retail.local | ChangeMe123! |
| Store User | store@retail.local | ChangeMe123! |
| Warehouse Picker | picker@retail.local | ChangeMe123! |
| Auditor | auditor@retail.local | ChangeMe123! |

**Test each role to see different features!**

---

## 🛠️ Tech Stack

**Backend**: Node.js + Express + Prisma + MySQL  
**Frontend**: React 19 + Vite  
**Deployment**: Docker + Nginx + Let's Encrypt  
**Mobile**: React Native (planned)

---

## 📁 Project Structure

```
retail-inventory/
├── api/              ← Backend (Node.js + Express)
├── web/              ← Frontend (React)
├── docker-compose.yml ← All-in-one startup
├── README.md         ← Full overview
├── API_DOCUMENTATION.md
├── DEPLOYMENT_GUIDE.md
├── MOBILE_APP_PLAN.md
├── DEVELOPMENT_SETUP.md
└── START_HERE.md     ← You are here
```

---

## 🔥 Common Tasks

### Start Development
```bash
docker-compose up
# or follow DEVELOPMENT_SETUP.md for local setup
```

### Run Tests
```bash
docker-compose exec api npm run test
```

### View Database
```bash
docker-compose exec api npx prisma studio
```

### Check API
```bash
curl http://localhost:4000/health
```

### View Logs
```bash
docker-compose logs -f api
docker-compose logs -f mysql
```

---

## 🚀 Deployment

### For Testing
```bash
docker-compose up
# Test at http://localhost:5173
```

### For Production (Hostinger)
```bash
# Follow DEPLOYMENT_GUIDE.md step-by-step
# Takes ~30 minutes to deploy
```

---

## ❓ Troubleshooting

### Port Already In Use?
```bash
# Change in docker-compose.yml or kill process
lsof -i :5173  # Find process on port 5173
kill -9 PID    # Kill it
```

### Database Connection Error?
```bash
docker-compose restart mysql
docker-compose exec api npm run db:migrate
```

### Can't Login?
```bash
docker-compose exec api npm run db:seed
```

**More issues?** See [DEVELOPMENT_SETUP.md - Troubleshooting](DEVELOPMENT_SETUP.md#troubleshooting)

---

## 📞 Need Help?

1. **First Time Setup** → [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md)
2. **API Questions** → [API_DOCUMENTATION.md](API_DOCUMENTATION.md)
3. **Deployment Issues** → [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)
4. **Code Problems** → Check project README.md
5. **Still Stuck?** → Create a GitHub issue

---

## 🎓 Learning Path

### Day 1: Get Familiar
- [ ] Read README.md
- [ ] Start app with `docker-compose up`
- [ ] Test all 4 demo accounts
- [ ] Understand blind count workflow
- [ ] Understand transfer workflow

### Day 2: Deep Dive
- [ ] Read API_DOCUMENTATION.md
- [ ] Test API endpoints with Postman
- [ ] Explore database with Prisma Studio
- [ ] Review source code structure
- [ ] Run tests

### Day 3: Start Coding
- [ ] Create a feature branch
- [ ] Make a small improvement
- [ ] Write/update tests
- [ ] Submit pull request

---

## 🔐 Security Checklist

Before deploying:
- [ ] Change all default passwords
- [ ] Update JWT_SECRET in .env
- [ ] Enable HTTPS/SSL
- [ ] Configure CORS correctly
- [ ] Review environment variables
- [ ] Enable database backups
- [ ] Setup monitoring & alerts

---

## 📈 Next Steps

1. **Understand the System**
   - Read README.md thoroughly
   - Explore the web portal
   - Test different roles

2. **Set Up Development**
   - Follow DEVELOPMENT_SETUP.md
   - Run the test suite
   - Configure your IDE

3. **Make Your First Change**
   - Pick a small bug or feature
   - Create a feature branch
   - Submit a pull request

4. **Deploy to Production**
   - Follow DEPLOYMENT_GUIDE.md
   - Setup Hostinger account
   - Deploy application
   - Monitor logs

5. **Build Mobile App** (Later)
   - Review MOBILE_APP_PLAN.md
   - Setup React Native project
   - Implement core features

---

## 🎯 Success Criteria

✅ You've succeeded when:
- App runs locally on your machine
- You can log in as different roles
- You understand the workflows
- You can make code changes
- You can deploy to Hostinger
- You can read and understand the API docs

---

## 💡 Pro Tips

1. **Use Docker** - Don't install MySQL locally, use `docker-compose`
2. **Read API Docs** - [API_DOCUMENTATION.md](API_DOCUMENTATION.md) is your friend
3. **Use REST Client** - VS Code extension for testing APIs
4. **Check Logs** - Use `docker-compose logs -f service` for debugging
5. **Test Different Roles** - Each role has different features
6. **Backup Before Changes** - `docker-compose exec -T mysql mysqldump`

---

## 🚦 Status

| Component | Status |
|-----------|--------|
| Backend API | ✅ Complete |
| Web Portal | ✅ Complete |
| Deployment Guide | ✅ Complete |
| Mobile App Plan | ✅ Complete |
| Documentation | ✅ Complete |
| Mobile App Implementation | 📅 Planned Q4 2026 |

---

**Ready to get started?** Run this:

```bash
docker-compose up
```

Then open http://localhost:5173 and login!

---

**Questions?** See [DEVELOPMENT_SETUP.md](DEVELOPMENT_SETUP.md) or review the [README.md](README.md)

🚀 **Happy coding!**

