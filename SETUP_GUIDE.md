# XendCode Setup Guide

This guide will walk you through setting up XendCode to maximize your free AI usage and minimize costs.

## 🎯 Strategy: Maximize Free Tiers

The key to using XendCode effectively is to set up **multiple free tier accounts** across different AI providers. This gives you:

1. **Redundancy**: If one service is down, use another
2. **Rate limit distribution**: Spread requests across providers
3. **Zero cost**: Stay within free tiers for most usage
4. **Best tool for job**: Different models excel at different tasks

## 📋 Quick Start (5 minutes)

### Minimum Setup (100% Free)
Get started with just **one free API key**:

1. **Get Google Gemini API Key** (RECOMMENDED)
   - Go to: https://makersuite.google.com/app/apikey
   - Sign in with Google account
   - Click "Get API Key" or "Create API Key"
   - Copy the key

2. **Configure XendCode**
   - Open VSCode
   - Press `Ctrl+,` (Settings)
   - Search "xendcode"
   - Paste key in `XendCode > Models > Gemini > Api Key`

3. **Start Coding!**
   - Click XendCode icon in sidebar
   - Ask a question
   - You're using free AI! 🎉

**Why Gemini First?**
- 60 requests per minute (very generous!)
- 1 million token context window
- Completely free, no credit card
- Excellent quality

## 🚀 Optimal Setup (15 minutes, Still Free!)

For best results, configure multiple providers:

### Step 1: Google Gemini ⭐
**Priority: HIGHEST**
```
URL: https://makersuite.google.com/app/apikey
Free Tier: 60 requests/minute
Cost: $0/month
Best For: Everything! Code completion, chat, explanations
```

### Step 2: grok (Fast!)
**Priority: HIGH**
```
URL: https://console.grok.com
Free Tier: 30 requests/minute
Cost: $0/month
Best For: Quick responses, chat
```

### Step 3: OpenAI (New Users)
**Priority: MEDIUM**
```
URL: https://platform.openai.com
Free Tier: $5 credit for new accounts
Cost: $0 initially (~50k tokens)
Best For: Code explanations, refactoring
Note: Credit expires after 3 months
```

### Step 4: Cohere
**Priority: MEDIUM**
```
URL: https://dashboard.cohere.com
Free Tier: Trial with 100 API calls
Cost: $0/month trial
Best For: Documentation, general text
```

### Configuration File
Add all keys to VSCode settings:

```json
{
  "xendcode.models.gemini.apiKey": "YOUR_GEMINI_KEY",
  "xendcode.models.grok.apiKey": "YOUR_grok_KEY",
  "xendcode.models.openai.apiKey": "YOUR_OPENAI_KEY",
  "xendcode.models.cohere.apiKey": "YOUR_COHERE_KEY",
  "xendcode.routing.preferFreeTier": true,
  "xendcode.routing.strategy": "cost-optimized",
  "xendcode.tokenManagement.aggressiveOptimization": true
}
```

## 💎 Advanced Setup (Add Paid Options)

If you want best-in-class quality for complex tasks, add these **low-cost** options:

### Anthropic Claude (High Quality)
```
URL: https://console.anthropic.com
Cost: $0.00025 per 1k tokens (Haiku model)
Best For: Complex refactoring, architecture
Monthly Cost: ~$1-2 for heavy use
```

### DeepSeek (Code Specialist)
```
URL: https://platform.deepseek.com
Cost: $0.0001 per 1k tokens (cheapest!)
Best For: Code completion, debugging
Monthly Cost: ~$0.50-1 for heavy use
```

Even with these paid options, total monthly cost: **$1-3** vs. $20 for Cursor Pro!

## 🎛️ Fine-Tuning Settings

### Cost-Conscious (Default)
```json
{
  "xendcode.routing.strategy": "cost-optimized",
  "xendcode.routing.preferFreeTier": true,
  "xendcode.tokenManagement.maxContextTokens": 4000,
  "xendcode.tokenManagement.aggressiveOptimization": true
}
```

### Quality-First
```json
{
  "xendcode.routing.strategy": "performance-optimized",
  "xendcode.routing.preferFreeTier": false,
  "xendcode.tokenManagement.maxContextTokens": 8000,
  "xendcode.tokenManagement.aggressiveOptimization": false
}
```

### Balanced
```json
{
  "xendcode.routing.strategy": "balanced",
  "xendcode.routing.preferFreeTier": true,
  "xendcode.tokenManagement.maxContextTokens": 6000,
  "xendcode.tokenManagement.aggressiveOptimization": true
}
```

## 📊 Understanding the Dashboard

Open dashboard with: `Ctrl+Shift+P` → "XendCode: Show Usage Dashboard"

### Key Metrics

**Savings**: Amount saved vs. $20/month subscription
**Total Cost**: Your actual spend (often $0!)
**Per-Model Usage**: See which models you use most

### Reading Token Usage

```
Gemini Flash: 45,234 tokens
├─ Requests: 127
├─ Cost: $0.00
└─ Percent Used: 15% of free tier
```

**What this means:**
- You've made 127 requests to Gemini
- Used 45k tokens (about 180k characters)
- Still have 85% of free tier available
- Spent: $0.00 ✅

## 🔥 Pro Tips

### 1. Rotate Models to Extend Free Tiers
XendCode automatically does this! When one model hits rate limit, it switches to another.

### 2. Use Aggressive Optimization
Reduces token usage by ~60% with minimal quality impact:
```json
"xendcode.tokenManagement.aggressiveOptimization": true
```

### 3. Start with Gemini Only
You can do 99% of your work with just Gemini's free tier. Add others as needed.

### 4. Monitor Your Usage
Check the sidebar "Token Usage" panel regularly. If you see costs rising, adjust settings.

### 5. Code in Bursts
Instead of many small requests, gather questions and ask in one conversation for better token efficiency.

## ⚠️ Common Issues

### "No available model found"
**Problem**: No API keys configured or all invalid
**Solution**: Add at least one valid API key (start with Gemini)

### Rate Limit Errors
**Problem**: Hit free tier limit on all models
**Solution**: 
- Wait 1 minute for rate limits to reset
- Add more model providers
- Reduce request frequency

### High Costs
**Problem**: Using paid models too much
**Solution**:
- Set `preferFreeTier: true`
- Use `cost-optimized` strategy
- Enable aggressive optimization

### Slow Responses
**Problem**: Free tier models being throttled
**Solution**:
- Add grok for faster responses
- Use multiple providers for distribution

## 📈 Usage Projections

### Light User (10k tokens/month)
- **Gemini only**: $0/month ✅
- **Time to exhaust free tier**: Never

### Medium User (50k tokens/month)
- **Gemini + grok**: $0/month ✅
- **Time to exhaust free tier**: Never
- **Paid plan equivalent**: $10-20/month

### Heavy User (200k tokens/month)
- **Free tiers + DeepSeek**: ~$0.50-1.20/month ✅
- **Time to exhaust free tier**: Need rotation
- **Paid plan equivalent**: $20-50/month
- **Savings**: 95%+

## 🎓 Learn More

- Read the [README.md](README.md) for features
- Check [API Documentation](docs/API.md)
- Join discussions on GitHub

## 🆘 Need Help?

1. Check [Troubleshooting](#common-issues) above
2. Open an issue on GitHub
3. Ask in GitHub Discussions

---

**Ready to code smarter, not harder?** 🚀

*Remember: The best AI coding assistant is one you can actually afford to use every day.*
