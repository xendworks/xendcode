#!/bin/bash
# XendCode v1.0.0 - Quick Publish Script

echo "🚀 XendCode Publishing Script"
echo "=============================="
echo ""

# Navigate to project directory
cd "$(dirname "$0")"

echo "✅ Location: $(pwd)"
echo "✅ Package: xendcode-1.0.0.vsix ($(ls -lh xendcode-1.0.0.vsix | awk '{print $5}'))"
echo ""

echo "📋 To publish, you need a Personal Access Token (PAT)"
echo ""
echo "Get your PAT here:"
echo "👉 https://dev.azure.com/"
echo "   → User Settings → Personal Access Tokens → New Token"
echo "   → Scope: Marketplace (Publish)"
echo ""

read -p "Do you have your PAT ready? (y/n): " ready

if [ "$ready" != "y" ]; then
    echo ""
    echo "⚠️  Please get your PAT first, then run this script again."
    echo "Opening Azure DevOps for you..."
    open "https://dev.azure.com/"
    exit 1
fi

echo ""
echo "🔐 Logging in to VS Code Marketplace..."
echo ""

npx vsce login Xendworks

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Login failed. Please check your PAT and try again."
    exit 1
fi

echo ""
echo "✅ Login successful!"
echo ""
echo "📤 Publishing XendCode v1.0.0..."
echo ""

npx vsce publish

if [ $? -eq 0 ]; then
    echo ""
    echo "🎉 SUCCESS! XendCode v1.0.0 is published!"
    echo ""
    echo "View your extension at:"
    echo "👉 https://marketplace.visualstudio.com/items?itemName=Xendworks.xendcode"
    echo ""
    echo "Install command:"
    echo "ext install Xendworks.xendcode"
    echo ""
else
    echo ""
    echo "❌ Publishing failed. Check the error messages above."
    exit 1
fi
