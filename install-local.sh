#!/bin/bash

# XendCode Local Installation Script

echo "🚀 Installing XendCode locally..."

# Build the extension
echo "📦 Building extension..."
npm run compile

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

# Create extensions directory if it doesn't exist
mkdir -p ~/.vscode/extensions

# Remove existing symlink if it exists
if [ -L ~/.vscode/extensions/xendcode ]; then
    echo "🗑️  Removing existing installation..."
    rm ~/.vscode/extensions/xendcode
fi

# Create symlink
echo "🔗 Creating symlink..."
ln -s "$(pwd)" ~/.vscode/extensions/xendcode

echo "✅ XendCode installed successfully!"
echo ""
echo "📝 Next steps:"
echo "1. Reload VSCode (⇧⌘P → 'Developer: Reload Window')"
echo "2. Open Command Palette (⇧⌘P)"
echo "3. Type 'XendCode: Setup Wizard'"
echo "4. Configure your API keys"
echo ""
echo "🎉 You're ready to code with XendCode!"
