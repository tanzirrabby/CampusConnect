#!/bin/bash
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║       CampusConnect — Full-Stack Launcher        ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Check Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required. Please install it first."
    exit 1
fi

echo "✅ Python 3 found"
echo "🚀 Starting backend server on http://localhost:8000"
echo "🌐 Open your browser to: http://localhost:8000"
echo ""
echo "📋 Demo accounts:"
echo "   Student ID: STU-2024-0001 to STU-2024-0005"
echo "   Password: pass123"
echo ""
echo "Press Ctrl+C to stop the server."
echo ""

# Run from backend dir so DB is created there
cd "$(dirname "$0")/backend"
python3 server.py
