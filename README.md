# XendCode - Budget-Friendly AI Coding Assistant

> **The AI coding assistant that won't break the bank** 💰

XendCode is a VSCode extension that intelligently manages multiple AI models' free tiers to provide you with a powerful coding assistant at minimal cost. By leveraging free tokens from providers like Google Gemini, grok, OpenAI, Anthropic, and others, XendCode can reduce your AI coding costs by up to **95%** compared to paid subscriptions.

## 🌟 Features

### 🧙‍♂️ One-Click Setup Wizard (NEW!)
- **90-Second Setup**: Get started faster than any competitor
- **Auto Browser Integration**: One click opens the right API page
- **Smart Clipboard Detection**: Automatically detects copied API keys
- **Instant Validation**: Tests keys before saving
- **Visual Progress**: See your setup completion in real-time
- **Priority Guidance**: Know which models to add first

### Multi-Model Intelligence
- **6+ AI Models**: Google Gemini, OpenAI GPT-3.5, Claude Haiku, grok Llama, Cohere, DeepSeek
- **Smart Model Selection**: Automatically chooses the best model for each task
- **Free Tier Optimization**: Prioritizes free-tier models to minimize costs

### Token Management
- **Aggressive Optimization**: Reduces token usage by up to 60%
- **Context Compression**: Smart context selection to maximize relevance
- **Usage Tracking**: Real-time monitoring of token consumption per model

### Cost Transparency
- **Live Usage Dashboard**: See exactly how much you're spending (or saving!)
- **Per-Model Analytics**: Track which models you use most
- **Savings Calculator**: Compare your costs vs. paid subscriptions

### Developer Experience
- **Chat Interface**: Natural conversation with AI
- **⚡ One-Click Code Application**: Apply AI suggestions instantly to your code
- **Smart Apply Detection**: Apply button only shows when making changes, not explanations
- **Intelligent Code Matching**: Finds and replaces specific functions/methods automatically
- **Code Actions**: Explain, refactor, fix code with right-click menu
- **Diagnostics Integration**: AI aware of your current errors
- **Context Aware**: Understands your workspace and active files
- **Strict Prompting**: AI knows when to explain vs when to provide code changes

## 📦 Installation

### From VSIX (Recommended)
1. Download the latest `.vsix` file from releases
2. Open VSCode
3. Go to Extensions (Ctrl+Shift+X)
4. Click `...` menu → "Install from VSIX"
5. Select the downloaded file

### From Source
```bash
git clone https://github.com/yourusername/xendcode.git
cd xendcode
npm install
npm run compile
```

Then press F5 to open a new VSCode window with the extension loaded.

## 🔑 Setup & Configuration

### ⚡ The Easy Way: Setup Wizard (Recommended!)

**New in v0.1.1!** Our interactive setup wizard makes configuration **75% faster**:

1. **Install XendCode** and open VSCode
2. **Wizard opens automatically** on first run!
   - Or press `Ctrl+Shift+P` → "XendCode: Setup Wizard"
3. **Click "Get API Key"** for each provider
   - Opens the signup page in your browser
   - No searching for URLs!
4. **Copy the key** from browser
   - Wizard auto-detects from clipboard!
   - Or paste manually
5. **Click "Validate & Save"**
   - Tests the key instantly
   - ✅ Done in 90 seconds!

### 📋 The Manual Way: Get Your Free API Keys

If you prefer manual setup, here's how to get free API keys:

#### Google Gemini (⭐ HIGHLY RECOMMENDED - 100% FREE!)
- Visit: https://makersuite.google.com/app/apikey
- Click "Get API Key"
- Free tier: **60 requests/minute**, 1M token context!
- **Cost: $0.00/month** ✅

#### grok (Fast & Free)
- Visit: https://console.grok.com
- Sign up and get API key
- Free tier: 30 requests/minute
- **Cost: $0.00/month** ✅

#### OpenAI (New Users Get $5 Credit)
- Visit: https://platform.openai.com
- Sign up and get $5 free credits
- ~50,000 tokens with credit
- **Cost: $0.00 (then ~$0.002/1k tokens)**

#### Anthropic Claude
- Visit: https://console.anthropic.com
- Get API key
- Claude Haiku is very affordable
- **Cost: ~$0.00025/1k tokens**

#### DeepSeek (Cheapest Paid Option)
- Visit: https://platform.deepseek.com
- Best for code-specific tasks
- **Cost: ~$0.0001/1k tokens** (cheapest!)

#### Cohere
- Visit: https://dashboard.cohere.com
- Free trial with 100 calls
- **Cost: $0.00 trial**

### 2. Configure XendCode

1. Open VSCode Settings (Ctrl+,)
2. Search for "XendCode"
3. Enter your API keys:

```json
{
  "xendcode.models.gemini.apiKey": "your-gemini-key",
  "xendcode.models.grok.apiKey": "your-grok-key",
  "xendcode.models.openai.apiKey": "your-openai-key",
  "xendcode.models.anthropic.apiKey": "your-anthropic-key",
  "xendcode.models.deepseek.apiKey": "your-deepseek-key",
  "xendcode.routing.preferFreeTier": true,
  "xendcode.routing.strategy": "cost-optimized"
}
```

### 3. Choose Your Strategy

XendCode offers three routing strategies:

- **cost-optimized** (Default): Always use cheapest model
- **performance-optimized**: Use highest quality model
- **balanced**: Balance cost and quality

## 🚀 Usage

### Open Chat
- Click XendCode icon in sidebar
- Or use command: `XendCode: Open Chat`

### Code Actions
Select code and right-click:
- **Explain Code**: Get detailed explanations
- **Refactor Code**: Improve code quality
- **Fix Code**: Debug and fix issues

### View Usage
- Check "Token Usage" panel in sidebar
- Open dashboard: `XendCode: Show Usage Dashboard`

## 💡 Smart Model Grounding

XendCode automatically selects the best model for each task:

| Task | Recommended Models | Why |
|------|-------------------|-----|
| Code Completion | Gemini Flash, DeepSeek | Fast, code-optimized |
| Code Explanation | Claude Haiku, GPT-3.5 | Excellent reasoning |
| Refactoring | Claude Sonnet, DeepSeek | Deep understanding |
| Bug Fixing | Claude, GPT-4 | Complex reasoning |
| Documentation | Gemini, GPT-3.5 | Clear writing |
| General Chat | Gemini Flash, grok | Fast responses |

## 📊 Real Cost Comparison

### Monthly Cost Examples

**Heavy Usage** (200k tokens/month):
- Cursor Pro: **$20/month** 💸
- GitHub Copilot: **$10/month** 💸
- XendCode (Free tiers): **$0.00** ✅
- XendCode (Mixed): **~$1.20** ✅

**Medium Usage** (50k tokens/month):
- Cursor Pro: **$20/month** 💸
- GitHub Copilot: **$10/month** 💸
- XendCode (Free only): **$0.00** ✅
- XendCode (Mixed): **~$0.10** ✅

**Savings**: 95-100% compared to paid alternatives! 🎉

## ⚙️ Advanced Configuration

### Token Budget
Control context size to optimize costs:
```json
{
  "xendcode.tokenManagement.maxContextTokens": 8000,
  "xendcode.tokenManagement.aggressiveOptimization": true
}
```

### Rate Limiting
XendCode respects free tier rate limits:
- Gemini: 60 req/min
- grok: 30 req/min
- Cohere: 100 calls/trial

### Context Optimization
XendCode intelligently selects context:
- Active file and selection (high priority)
- Diagnostics/errors (high priority)
- Recent files (medium priority)
- Workspace symbols (low priority)

## 🛠️ Development

### Build from Source
```bash
npm install
npm run compile
```

### Watch Mode
```bash
npm run watch
```

### Package Extension
```bash
npm install -g @vscode/vsce
vsce package
```

## 🐛 Troubleshooting

### "No available model found"
- Ensure you've configured at least one API key
- Check API keys are valid
- Verify network connection

### Rate Limit Errors
- XendCode will automatically switch to another model
- Wait a minute if all free tiers are exhausted
- Consider adding more model providers

### High Token Usage
- Enable aggressive optimization
- Reduce max context tokens
- Use cost-optimized routing

## 📈 Roadmap

- [ ] Streaming responses
- [ ] Custom model configurations
- [ ] Team workspace sharing
- [ ] Usage predictions and recommendations
- [ ] More model providers (Mistral, Together.ai)
- [ ] Offline mode with local models
- [ ] Browser extension for documentation search

## 🤝 Contributing

Contributions welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) first.

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

Built with these amazing AI providers:
- Google Gemini
- OpenAI
- Anthropic
- grok
- Cohere
- DeepSeek

## 💬 Support

- GitHub Issues: Report bugs and feature requests
- Discussions: Ask questions and share tips
- Email: saicharan@xendworks.com

---

**Created by [Saicharan Govindaraj](https://github.com/saicharangovindaraj)**

Made with ❤️ for developers who love AI but hate subscription fees

*XendCode: Smart AI coding assistance, sensible costs.*
