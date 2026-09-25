#!/bin/bash

# Local Backend Start Script
# Run this to test the backend locally before deployment

echo "🚀 Starting Invexaretail Backend..."
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 22+ first."
    echo "   Download from: https://nodejs.org/en/download"
    exit 1
fi

NODE_VERSION=$(node -v)
echo "✅ Node.js $NODE_VERSION found"

# Check if dist exists, build if not
if [ ! -d "dist" ]; then
    echo ""
    echo "📦 Building backend..."
    npm install || exit 1
    npm run build || exit 1
fi

echo ""
echo "✅ Starting server on http://localhost:4000"
echo ""
echo "Test the server by visiting:"
echo "  - http://localhost:4000/health"
echo ""
echo "To point the web app at this local API, add this to frontend .env:"
echo "  VITE_API_BASE=http://localhost:4000"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Set environment variables and start
export NODE_ENV=development
export PORT=4000
export ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000,https://invexaretail.com
export JWT_SECRET=dev-secret-change-in-production

node dist/index.js
