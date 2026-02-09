# 🚀 XendCode v1.0.0 - Publishing Guide

## ✅ Package Created Successfully!

Your extension is packaged and ready: **`xendcode-1.0.0.vsix`** (722.71 KB)

---

## 📦 To Publish to VS Code Marketplace

### Step 1: Create a Publisher Account (if you don't have one)

1. Go to: https://marketplace.visualstudio.com/manage
2. Click **"Create publisher"**
3. Fill in:
   - **Publisher ID**: `saicharan-govindaraj` (matches your package.json)
   - **Name**: Saicharan Govindaraj
   - **Email**: Your email

### Step 2: Get a Personal Access Token (PAT)

1. Go to: https://dev.azure.com/
2. Click **User Settings** (top right) → **Personal Access Tokens**
3. Click **"New Token"**
4. Configure:
   - **Name**: "VS Code Marketplace - XendCode"
   - **Organization**: All accessible organizations
   - **Expiration**: 90 days (or custom)
   - **Scopes**: Custom defined → Check **"Marketplace (Publish)"**
5. Click **Create** and **COPY THE TOKEN** (you won't see it again!)

### Step 3: Login with vsce

```bash
cd /Users/saicharan/Documents/GitHub/XendCode
npx vsce login saicharan-govindaraj
```

When prompted, paste your Personal Access Token.

### Step 4: Publish!

```bash
npx vsce publish
```

That's it! Your extension will be live in ~5-10 minutes.

---

## 🔄 Alternative: Manual Upload

If you prefer manual upload:

1. Go to: https://marketplace.visualstudio.com/manage/publishers/saicharan-govindaraj
2. Click **"New extension"** → **"Visual Studio Code"**
3. Upload: `xendcode-1.0.0.vsix`
4. Fill in any additional details
5. Click **"Upload"**

---

## 📊 What Gets Published

```
✅ Extension Package: xendcode-1.0.0.vsix
✅ Size: 722.71 KB (optimized!)
✅ Files: 46 files total
   - Compiled code (dist/) - 2.67 MB minified
   - Icon (resources/icon.png) - 163 KB
   - Documentation (README, LICENSE, CHANGELOG)
   - Package metadata

✅ Version: 1.0.0
✅ Publisher: saicharan-govindaraj
✅ Author: Saicharan Govindaraj
✅ License: MIT
✅ Repository: github.com/saicharangovindaraj/XendCode
```

---

## 🎯 After Publishing

### Verify Your Extension

1. Search in VS Code marketplace: "XendCode"
2. Install: `ext install saicharan-govindaraj.xendcode`
3. Check the listing at: 
   https://marketplace.visualstudio.com/items?itemName=saicharan-govindaraj.xendcode

### Share Your Extension

- **VS Code Command**: `ext install saicharan-govindaraj.xendcode`
- **Marketplace Link**: Add to your README after publishing
- **Badge**: Add to README:
  ```markdown
  ![Version](https://img.shields.io/visual-studio-marketplace/v/saicharan-govindaraj.xendcode)
  ![Installs](https://img.shields.io/visual-studio-marketplace/i/saicharan-govindaraj.xendcode)
  ![Rating](https://img.shields.io/visual-studio-marketplace/r/saicharan-govindaraj.xendcode)
  ```

---

## 🔧 Troubleshooting

### "Publisher not found"
- Create publisher account at marketplace.visualstudio.com/manage
- Ensure publisher ID matches: `saicharan-govindaraj`

### "Invalid token"
- Token must have **Marketplace (Publish)** scope
- Token must be for **All accessible organizations**
- Try creating a new token

### "Icon not found"
- ✅ Already fixed! Icon is at `resources/icon.png`

### "Missing README"
- ✅ Already included! README.md is packaged

---

## 🎉 You're Ready!

Your extension is **production-ready** and packaged. Just follow Steps 1-4 above to publish!

**Quick Publish Command:**
```bash
# After getting your PAT token:
cd /Users/saicharan/Documents/GitHub/XendCode
npx vsce login saicharan-govindaraj
# Paste your token when prompted
npx vsce publish
```

Good luck! 🚀
