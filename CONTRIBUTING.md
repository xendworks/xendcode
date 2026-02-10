# Contributing to XendCode

Thank you for your interest in contributing to XendCode! This document provides guidelines and instructions for contributing.

## 🎯 Project Vision

XendCode aims to democratize AI-assisted coding by making it affordable for everyone. Our core principles:

1. **Cost-First**: Every feature should consider cost implications
2. **Multi-Model**: Support diverse AI providers
3. **Transparency**: Users should always know what they're using
4. **Quality**: Free doesn't mean low quality

## 🚀 Getting Started

### Development Setup

1. **Fork and Clone**
```bash
git clone https://github.com/yourusername/xendcode.git
cd xendcode
```

2. **Install Dependencies**
```bash
npm install
```

3. **Build Extension**
```bash
npm run compile
```

4. **Run in Development**
- Open project in VSCode
- Press `F5` to launch Extension Development Host
- Test your changes

### Project Structure

```
xendcode/
├── src/
│   ├── extension.ts          # Entry point
│   ├── core/                 # Core managers
│   │   ├── ModelManager.ts   # Model selection logic
│   │   ├── TokenManager.ts   # Token tracking
│   │   └── ContextManager.ts # Context optimization
│   ├── models/               # AI provider implementations
│   │   ├── OpenAIProvider.ts
│   │   ├── GeminiProvider.ts
│   │   └── ...
│   ├── providers/            # UI providers
│   │   ├── ChatProvider.ts
│   │   └── ...
│   └── types/                # TypeScript types
├── package.json              # Extension manifest
└── README.md
```

## 🤝 How to Contribute

### 1. Adding a New Model Provider

Want to add support for a new AI model? Great! Here's how:

1. **Create Provider File**
```typescript
// src/models/YourModelProvider.ts
import { IModelProvider, ModelConfig, ... } from '../types';

export class YourModelProvider implements IModelProvider {
    // Implement all interface methods
}
```

2. **Register in ModelManager**
```typescript
// src/core/ModelManager.ts
import { YourModelProvider } from '../models/YourModelProvider';

// In initializeProviders()
providers.push(
    new YourModelProvider(config.get('models.yourmodel.apiKey', ''))
);
```

3. **Add Configuration**
```json
// package.json - in contributes.configuration.properties
"xendcode.models.yourmodel.apiKey": {
    "type": "string",
    "default": "",
    "description": "Your Model API Key"
}
```

4. **Update Documentation**
- Add to README.md
- Add to SETUP_GUIDE.md
- Document free tier details

### 2. Improving Token Optimization

Token usage is critical for cost. Improvements welcome in:

- `src/core/ContextManager.ts` - Better context selection
- `src/core/TokenManager.ts` - More accurate tracking
- Compression techniques
- Semantic deduplication

### 3. Enhancing Model Selection

Better model routing = better cost/quality balance:

- `src/core/ModelManager.ts` - Selection algorithms
- Task type detection
- Quality scoring
- Cost prediction

### 4. UI Improvements

- Chat interface enhancements
- Better dashboard visualizations
- Usage predictions
- Settings UI

## 📝 Pull Request Process

1. **Create Feature Branch**
```bash
git checkout -b feature/your-feature-name
```

2. **Make Changes**
- Write clean, documented code
- Follow existing code style
- Add TypeScript types

3. **Test Thoroughly**
- Test in Extension Development Host
- Verify no regressions
- Test with multiple models

4. **Commit with Clear Messages**
```bash
git commit -m "Add: Support for NewModel provider"
git commit -m "Fix: Token counting for streaming responses"
git commit -m "Improve: Context selection algorithm"
```

5. **Push and Create PR**
```bash
git push origin feature/your-feature-name
```
- Create PR on GitHub
- Fill out PR template
- Link related issues

6. **Code Review**
- Address feedback
- Update as needed
- Maintain clean commit history

## 🎨 Code Style

### TypeScript

```typescript
// Use clear, descriptive names
async function selectOptimalModel(task: ModelCapability): Promise<IModelProvider> {
    // Implementation
}

// Add JSDoc comments for public APIs
/**
 * Records token usage for a model
 * @param model - Model name
 * @param tokensInput - Input tokens used
 * @param tokensOutput - Output tokens generated
 * @param cost - Estimated cost in USD
 */
async recordUsage(model: string, tokensInput: number, ...): Promise<void> {
    // Implementation
}

// Use interfaces for contracts
interface IModelProvider {
    getName(): string;
    complete(messages: ChatMessage[]): Promise<CompletionResponse>;
}

// Prefer async/await over promises
async function fetchData() {
    try {
        const result = await api.call();
        return result;
    } catch (error) {
        console.error('Error:', error);
        throw error;
    }
}
```

### File Organization

- One class per file
- Group related functionality
- Keep files under 500 lines
- Use meaningful folder structure

## 🐛 Reporting Bugs

### Before Submitting

1. Check existing issues
2. Try latest version
3. Verify it's not a configuration issue

### Bug Report Template

```markdown
**Description**
Clear description of the bug

**To Reproduce**
1. Step 1
2. Step 2
3. See error

**Expected Behavior**
What should happen

**Actual Behavior**
What actually happens

**Environment**
- VSCode Version:
- XendCode Version:
- OS:
- Models Configured:

**Logs**
Paste relevant logs from VSCode Developer Console
```

## 💡 Feature Requests

We love new ideas! When requesting features:

1. **Check Roadmap**: Might already be planned
2. **Describe Use Case**: Why is this needed?
3. **Cost Implications**: How does it affect costs?
4. **Alternative Solutions**: What else did you consider?

### Feature Request Template

```markdown
**Feature Description**
What feature do you want?

**Use Case**
Why do you need this?

**Cost Impact**
How does this affect token usage/costs?

**Proposed Implementation**
Any ideas on how to implement?

**Alternatives**
What alternatives did you consider?
```

## 🧪 Testing

### Manual Testing Checklist

- [ ] Extension activates without errors
- [ ] Chat interface works
- [ ] Model selection works correctly
- [ ] Token tracking is accurate
- [ ] Usage dashboard displays correctly
- [ ] Settings are respected
- [ ] Error handling works

### Testing with Multiple Models

Please test with at least 2 different models:
- One free tier (Gemini recommended)
- One paid tier (if available)

## 📚 Documentation

When adding features, update:

- `README.md` - User-facing features
- `SETUP_GUIDE.md` - Configuration steps
- Code comments - Implementation details
- `CHANGELOG.md` - Version changes

## 🏆 Recognition

Contributors will be:
- Listed in README.md
- Mentioned in release notes
- Given credit in documentation

## ❓ Questions?

- Open a GitHub Discussion
- Comment on related issues
- Reach out to maintainers

## 📜 Code of Conduct

### Our Standards

- Be respectful and inclusive
- Welcome newcomers
- Accept constructive criticism
- Focus on what's best for the community
- Show empathy

### Unacceptable Behavior

- Harassment or discrimination
- Trolling or insulting comments
- Personal or political attacks
- Publishing others' private information

## 📄 License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

**Thank you for making AI coding assistance affordable for everyone!** 🙏

*Every contribution, no matter how small, makes a difference.*
