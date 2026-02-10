import * as vscode from 'vscode';
import { ModelManager } from './ModelManager';

interface ProviderConfig {
    id: string;
    name: string;
    icon: string;
    color: string;
    description: string;
    freeTier: boolean;
    freeCredit?: string;
    authUrl: string;
    tokenUrl: string;
    instructions: string[];
    canAutomate: boolean;
}

export class ModernSetupWizard {
    private context: vscode.ExtensionContext;
    private modelManager: ModelManager;
    private currentPanel?: vscode.WebviewPanel;
    private currentStep: number = 0;
    private selectedProviders: Set<string> = new Set();

    private providers: ProviderConfig[] = [
        {
            id: 'gemini',
            name: 'Google Gemini',
            icon: 'gemini.svg',
            color: '#8E75FF',
            description: '60 req/min • 1M context • Best for everything',
            freeTier: true,
            authUrl: 'https://makersuite.google.com',
            tokenUrl: 'https://makersuite.google.com/app/apikey',
            instructions: [
                'Sign in with your Google account',
                'Click "Get API Key" or "Create API Key"',
                'Copy your API key'
            ],
            canAutomate: true
        },
        {
            id: 'grok',
            name: 'Grok',
            icon: 'grok.svg',
            color: '#000000',
            description: 'Elon\'s xAI • 131K context • Powerful reasoning',
            freeTier: true,
            freeCredit: '$25 credits',
            authUrl: 'https://console.x.ai',
            tokenUrl: 'https://console.x.ai',
            instructions: [
                'Sign up at console.x.ai',
                'Get free $25 credits',
                'Navigate to API Keys section',
                'Generate new API key',
                'Copy the key'
            ],
            canAutomate: false
        },
        {
            id: 'groq',
            name: 'Groq',
            icon: 'groq.svg',
            color: '#F55036',
            description: '30 req/min • Fast inference • Quick responses',
            freeTier: true,
            authUrl: 'https://console.groq.com',
            tokenUrl: 'https://console.groq.com/keys',
            instructions: [
                'Sign up or log in',
                'Navigate to API Keys',
                'Create a new API key',
                'Copy the key'
            ],
            canAutomate: true
        },
        {
            id: 'deepseek',
            name: 'DeepSeek',
            icon: 'deepseek.svg',
            color: '#0FA0CE',
            description: '1M tokens free • Excellent for code • Low cost',
            freeTier: true,
            authUrl: 'https://platform.deepseek.com',
            tokenUrl: 'https://platform.deepseek.com/api-keys',
            instructions: [
                'Sign up with email',
                'Go to API Keys',
                'Create new API key',
                'Copy the key'
            ],
            canAutomate: true
        },
        {
            id: 'mistral',
            name: 'Mistral',
            icon: 'mistral.svg',
            color: '#F2A73B',
            description: '30 req/min • Mistral Large • Great for analysis',
            freeTier: true,
            authUrl: 'https://console.mistral.ai',
            tokenUrl: 'https://console.mistral.ai/api-keys',
            instructions: [
                'Sign up or log in',
                'Navigate to API Keys',
                'Create API key',
                'Copy the key'
            ],
            canAutomate: true
        },
        {
            id: 'cohere',
            name: 'Cohere',
            icon: 'cohere.svg',
            color: '#39594D',
            description: 'Trial API • Good for documentation',
            freeTier: true,
            authUrl: 'https://dashboard.cohere.com',
            tokenUrl: 'https://dashboard.cohere.com/api-keys',
            instructions: [
                'Sign up or log in',
                'Go to API Keys',
                'Create trial key',
                'Copy the key'
            ],
            canAutomate: true
        },
        {
            id: 'openai',
            name: 'OpenAI',
            icon: 'openai.svg',
            color: '#10A37F',
            description: 'GPT-3.5 Turbo • High quality responses',
            freeTier: false,
            freeCredit: '$5 CREDIT',
            authUrl: 'https://platform.openai.com',
            tokenUrl: 'https://platform.openai.com/api-keys',
            instructions: [
                'Sign up or log in',
                'Go to API keys section',
                'Create new secret key',
                'Copy the key immediately (shown only once)'
            ],
            canAutomate: false
        }
    ];

    constructor(context: vscode.ExtensionContext, modelManager: ModelManager) {
        this.context = context;
        this.modelManager = modelManager;
    }

    async launch() {
        this.showModernWizard();
    }

    private async showModernWizard() {
        const panel = vscode.window.createWebviewPanel(
            'xendcodeModernSetup',
            'XendCode Setup',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.context.extensionUri, 'resources')
                ]
            }
        );

        this.currentPanel = panel;
        this.currentWebview = panel.webview;
        panel.webview.html = this.getModernWizardHTML(panel.webview);

        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'selectProvider':
                    this.selectedProviders.add(message.provider);
                    panel.webview.postMessage({ type: 'providerSelected', provider: message.provider });
                    break;
                    
                case 'nextStep':
                    this.currentStep = message.step;
                    panel.webview.html = this.getModernWizardHTML(panel.webview);
                    break;
                    
                case 'automateAuth':
                    await this.automateProviderAuth(message.provider);
                    break;
                    
                case 'manualAuth':
                    await this.openManualAuth(message.provider);
                    break;
                    
                case 'validateAndSave':
                    await this.validateAndSaveKey(message.provider, message.apiKey);
                    break;
                    
                case 'complete':
                    // Close wizard and open chat
                    panel.dispose();
                    this.currentPanel = undefined;
                    // Open chat window
                    vscode.commands.executeCommand('xendcode.chat');
                    break;
            }
        });
    }

    private async automateProviderAuth(providerId: string) {
        const provider = this.providers.find(p => p.id === providerId);
        if (!provider || !provider.canAutomate) {
            vscode.window.showErrorMessage('Automated auth not available for this provider');
            return;
        }

        try {
            // Launch browser automation
            vscode.window.showInformationMessage(
                `Opening ${provider.name} in browser. Please sign in and authorize.`,
                'OK'
            );

            // Open the auth URL
            await vscode.env.openExternal(vscode.Uri.parse(provider.tokenUrl));

            // Monitor clipboard for API key
            const key = await this.monitorClipboardForKey(30000); // 30 second timeout
            
            if (key) {
                this.currentPanel?.webview.postMessage({
                    type: 'keyDetected',
                    provider: providerId,
                    key
                });
            }
        } catch (error: any) {
            vscode.window.showErrorMessage(`Automation failed: ${error.message}`);
        }
    }

    private async openManualAuth(providerId: string) {
        const provider = this.providers.find(p => p.id === providerId);
        if (!provider) return;

        await vscode.env.openExternal(vscode.Uri.parse(provider.tokenUrl));
        
        vscode.window.showInformationMessage(
            `Copy your ${provider.name} API key, then return to the setup wizard`,
            'I copied it'
        );
    }

    private async monitorClipboardForKey(timeout: number): Promise<string | null> {
        const startTime = Date.now();
        let lastClipboard = '';

        return new Promise((resolve) => {
            const interval = setInterval(async () => {
                try {
                    const clipboard = await vscode.env.clipboard.readText();
                    
                    // Check if it looks like an API key (common patterns)
                    const isAPIKey = this.looksLikeAPIKey(clipboard);
                    
                    if (clipboard !== lastClipboard && isAPIKey) {
                        clearInterval(interval);
                        resolve(clipboard);
                        return;
                    }
                    
                    lastClipboard = clipboard;
                    
                    // Timeout
                    if (Date.now() - startTime > timeout) {
                        clearInterval(interval);
                        resolve(null);
                    }
                } catch (error) {
                    // Clipboard access error
                }
            }, 500); // Check every 500ms
        });
    }

    private looksLikeAPIKey(text: string): boolean {
        // Common API key patterns
        const patterns = [
            /^AIza[0-9A-Za-z-_]{35}$/,  // Google
            /^sk-[A-Za-z0-9]{48}$/,      // OpenAI
            /^gsk_[A-Za-z0-9]{52}$/,     // grok
            /^[A-Za-z0-9]{40,}$/         // Generic long key
        ];
        
        return patterns.some(pattern => pattern.test(text.trim()));
    }

    private async validateAndSaveKey(providerId: string, apiKey: string) {
        // Reuse existing validation logic
        const config = vscode.workspace.getConfiguration('xendcode');
        const configKey = `models.${providerId}.apiKey`;

        try {
            // Test the key
            const Provider = await this.getProviderClass(providerId);
            const tempProvider = new Provider(apiKey);

            const testMessage = [
                { role: 'user' as const, content: 'Say OK if you can read this.' }
            ];

            await tempProvider.complete(testMessage, { maxTokens: 10 });

            // Save if valid
            await config.update(configKey, apiKey, vscode.ConfigurationTarget.Global);
            this.modelManager.refresh();

            this.currentPanel?.webview.postMessage({
                type: 'validationSuccess',
                provider: providerId
            });

            vscode.window.showInformationMessage(`✅ ${providerId} configured successfully!`);
        } catch (error: any) {
            this.currentPanel?.webview.postMessage({
                type: 'validationError',
                provider: providerId,
                error: error.message
            });
        }
    }

    private async getProviderClass(provider: string): Promise<any> {
        switch (provider.toLowerCase()) {
            case 'gemini':
                const { GeminiProvider } = await import('../models/GeminiProvider');
                return GeminiProvider;
            case 'grok':
                const { GrokProvider } = await import('../models/GrokProvider');
                return GrokProvider;
            case 'groq':
                const { GroqProvider } = await import('../models/GroqProvider');
                return GroqProvider;
            case 'openai':
                const { OpenAIProvider } = await import('../models/OpenAIProvider');
                return OpenAIProvider;
            case 'cohere':
                const { CohereProvider } = await import('../models/CohereProvider');
                return CohereProvider;
            case 'deepseek':
                const { DeepSeekProvider } = await import('../models/DeepSeekProvider');
                return DeepSeekProvider;
            case 'mistral':
                const { MistralProvider } = await import('../models/MistralProvider');
                return MistralProvider;
            case 'anthropic':
                const { AnthropicProvider } = await import('../models/AnthropicProvider');
                return AnthropicProvider;
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
    }

    private getLogoUri(webview: vscode.Webview, logoFile: string): string {
        try {
            const logoPath = vscode.Uri.joinPath(this.context.extensionUri, 'resources', 'logos', logoFile);
            const uri = webview.asWebviewUri(logoPath);
            console.log('Logo URI generated:', logoFile, '→', uri.toString());
            return uri.toString();
        } catch (error) {
            console.error('Failed to generate logo URI:', logoFile, error);
            return '';
        }
    }

    private getModernWizardHTML(webview: vscode.Webview): string {
        const config = vscode.workspace.getConfiguration('xendcode');
        
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XendCode Setup</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: var(--vscode-editor-background);
            min-height: 100vh;
            padding: 40px 20px;
        }
        
        .wizard-container {
            background: var(--vscode-editor-background);
            max-width: 900px;
            margin: 0 auto;
        }
        
        .wizard-header {
            text-align: center;
            padding-bottom: 32px;
            border-bottom: 1px solid var(--vscode-panel-border);
            margin-bottom: 32px;
        }
        
        .wizard-header h1 {
            font-size: 24px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 8px;
        }
        
        .wizard-header p {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        
        /* Progress bar styles */
        .progress-nav {
            margin-bottom: 40px;
            padding-bottom: 0;
        }
        
        .progress-list {
            list-style: none;
            display: flex;
            margin: 0;
            padding: 0;
            border-bottom: 2px solid var(--vscode-panel-border);
            position: relative;
        }
        
        .progress-item {
            position: relative;
            flex: 1;
            padding: 0;
        }
        
        .progress-bar {
            position: absolute;
            bottom: -2px;
            left: 0;
            width: 100%;
            height: 2px;
            background: transparent;
            transition: background 0.3s;
            z-index: 10;
        }
        
        .progress-item.completed .progress-bar {
            background: #10b981;
        }
        
        .progress-item.current .progress-bar {
            background: #667eea;
        }
        
        .progress-content {
            display: flex;
            align-items: center;
            padding: 12px 16px 16px;
            gap: 10px;
        }
        
        .progress-icon {
            flex-shrink: 0;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid var(--vscode-panel-border);
            background: var(--vscode-input-background);
            transition: all 0.2s;
        }
        
        .progress-item.completed .progress-icon {
            background: #10b981;
            border-color: #10b981;
            color: white;
        }
        
        .progress-item.current .progress-icon {
            background: transparent;
            border-color: #667eea;
            color: #667eea;
        }
        
        .progress-item.upcoming .progress-icon {
            border-color: var(--vscode-panel-border);
            color: var(--vscode-descriptionForeground);
            opacity: 0.6;
        }
        
        .check-icon {
            width: 16px;
            height: 16px;
        }
        
        .progress-number {
            font-weight: 600;
            font-size: 13px;
        }
        
        .progress-text {
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        
        .progress-title {
            font-size: 12px;
            font-weight: 600;
            color: var(--vscode-foreground);
        }
        
        .progress-item.current .progress-title {
            color: #667eea;
        }
        
        .progress-item.upcoming .progress-title {
            color: var(--vscode-descriptionForeground);
            opacity: 0.7;
        }
        
        .progress-subtitle {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            opacity: 0.8;
        }
        
        .wizard-content {
            padding: 0;
        }
        
        h2 {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 8px;
        }
        
        .subtitle {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
            margin-bottom: 24px;
        }
        
        .provider-list {
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            background: var(--vscode-editor-background);
            overflow: hidden;
        }
        
        .provider-card {
            padding: 20px;
            border-bottom: 1px solid var(--vscode-panel-border);
            cursor: pointer;
            transition: background 0.2s;
            display: flex;
            align-items: center;
            gap: 16px;
        }
        
        .provider-card:last-child {
            border-bottom: none;
        }
        
        .provider-card:hover {
            background: var(--vscode-list-hoverBackground);
        }
        
        .provider-card.selected {
            background: var(--vscode-list-activeSelectionBackground);
        }
        
        .provider-icon {
            font-size: 32px;
            width: 48px;
            height: 48px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: var(--vscode-input-background);
            border-radius: 8px;
        }
        
        .provider-icon img {
            width: 40px;
            height: 40px;
            object-fit: contain;
        }
        
        .provider-info {
            flex: 1;
        }
        
        .provider-name {
            font-weight: 600;
            font-size: 15px;
            color: var(--vscode-foreground);
            margin-bottom: 4px;
        }
        
        .provider-description {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
        }
        
        .provider-badge {
            padding: 4px 12px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
        }
        
        .badge-free {
            background: var(--vscode-charts-green);
            color: white;
        }
        
        .badge-credit {
            background: var(--vscode-charts-blue);
            color: white;
        }
        
        .badge-connected {
            background: var(--vscode-editorInfo-background);
            color: var(--vscode-editorInfo-foreground);
            border: 1px solid var(--vscode-charts-blue);
        }
        
        .provider-card.connected {
            opacity: 0.6;
            cursor: not-allowed;
            background: var(--vscode-input-background);
        }
        
        .provider-card.connected:hover {
            background: var(--vscode-input-background);
            transform: none;
        }
        
        .auth-section {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 24px;
            margin-bottom: 16px;
        }
        
        .auth-section h3 {
            margin-bottom: 16px;
            color: var(--vscode-foreground);
            font-size: 16px;
            font-weight: 600;
        }
        
        .auth-buttons {
            display: flex;
            gap: 8px;
            margin: 16px 0;
        }
        
        .btn {
            padding: 10px 16px;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
        }
        
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .input-group {
            margin: 16px 0;
        }
        
        .input-group label {
            display: block;
            margin-bottom: 6px;
            font-weight: 500;
            font-size: 13px;
            color: var(--vscode-foreground);
        }
        
        .input-group input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            font-size: 13px;
            font-family: var(--vscode-editor-font-family);
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
        }
        
        .input-group input:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }
        
        .success-message {
            background: rgba(var(--vscode-charts-green), 0.1);
            color: var(--vscode-charts-green);
            padding: 10px 12px;
            border-radius: 4px;
            margin: 12px 0;
            font-size: 13px;
            display: none;
        }
        
        .success-message.show {
            display: block;
        }
        
        .error-message {
            background: rgba(var(--vscode-errorForeground), 0.1);
            color: var(--vscode-errorForeground);
            padding: 10px 12px;
            border-radius: 4px;
            margin: 12px 0;
            font-size: 13px;
            display: none;
        }
        
        .error-message.show {
            display: block;
        }
        
        .instructions {
            background: var(--vscode-textBlockQuote-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 12px;
            margin: 16px 0;
            border-radius: 4px;
            font-size: 13px;
        }
        
        .instructions ol {
            margin-left: 20px;
        }
        
        .instructions li {
            margin: 6px 0;
            color: var(--vscode-foreground);
        }
        
        .wizard-footer {
            padding: 24px 0 0 0;
            margin-top: 32px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            justify-content: space-between;
        }
    </style>
</head>
<body>
    <div class="wizard-container">
        <div class="wizard-header">
            <h1>XendCode Setup</h1>
            <p>Connect your AI providers</p>
        </div>
        
        <nav class="progress-nav">
            <ol class="progress-list">
                <li class="progress-item ${this.currentStep > 0 ? 'completed' : (this.currentStep === 0 ? 'current' : 'upcoming')}">
                    <div class="progress-bar"></div>
                    <div class="progress-content">
                        <span class="progress-icon">
                            ${this.currentStep > 0 
                                ? '<svg viewBox="0 0 24 24" fill="currentColor" class="check-icon"><path d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z"/></svg>'
                                : '<span class="progress-number">1</span>'
                            }
                        </span>
                        <div class="progress-text">
                            <span class="progress-title">Select Providers</span>
                            <span class="progress-subtitle">Choose AI models</span>
                        </div>
                    </div>
                </li>
                
                <li class="progress-item ${this.currentStep > 1 ? 'completed' : (this.currentStep === 1 ? 'current' : 'upcoming')}">
                    <div class="progress-bar"></div>
                    <div class="progress-content">
                        <span class="progress-icon">
                            ${this.currentStep > 1
                                ? '<svg viewBox="0 0 24 24" fill="currentColor" class="check-icon"><path d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z"/></svg>'
                                : '<span class="progress-number">2</span>'
                            }
                        </span>
                        <div class="progress-text">
                            <span class="progress-title">Authorize</span>
                            <span class="progress-subtitle">Add API keys</span>
                        </div>
                    </div>
                </li>
                
                <li class="progress-item ${this.currentStep > 2 ? 'completed' : (this.currentStep === 2 ? 'current' : 'upcoming')}">
                    <div class="progress-bar"></div>
                    <div class="progress-content">
                        <span class="progress-icon">
                            ${this.currentStep > 2
                                ? '<svg viewBox="0 0 24 24" fill="currentColor" class="check-icon"><path d="M19.916 4.626a.75.75 0 0 1 .208 1.04l-9 13.5a.75.75 0 0 1-1.154.114l-6-6a.75.75 0 0 1 1.06-1.06l5.353 5.353 8.493-12.74a.75.75 0 0 1 1.04-.207Z"/></svg>'
                                : '<span class="progress-number">3</span>'
                            }
                        </span>
                        <div class="progress-text">
                            <span class="progress-title">Complete</span>
                            <span class="progress-subtitle">Ready to code</span>
                        </div>
                    </div>
                </li>
            </ol>
        </nav>
        
        <div class="wizard-content">
            ${this.getStepContent(config)}
        </div>
        
        ${this.currentStep < 2 ? `
        <div class="wizard-footer">
            <button class="btn btn-secondary" onclick="previousStep()" ${this.currentStep === 0 ? 'disabled' : ''}>
                ← Back
            </button>
            <button class="btn btn-primary" onclick="nextStep()">
                Next →
            </button>
        </div>
        ` : ''}
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let currentStep = ${this.currentStep};

        function selectProvider(providerId) {
            const card = document.querySelector(\`[data-provider="\${providerId}"]\`);
            card.classList.toggle('selected');
            vscode.postMessage({ type: 'selectProvider', provider: providerId });
        }

        function nextStep() {
            currentStep++;
            vscode.postMessage({ type: 'nextStep', step: currentStep });
        }

        function previousStep() {
            if (currentStep > 0) {
                currentStep--;
                vscode.postMessage({ type: 'nextStep', step: currentStep });
            }
        }

        function automateAuth(provider) {
            vscode.postMessage({ type: 'automateAuth', provider });
        }

        function manualAuth(provider) {
            vscode.postMessage({ type: 'manualAuth', provider });
        }

        function validateKey(provider) {
            const input = document.querySelector(\`#key-\${provider}\`);
            vscode.postMessage({ 
                type: 'validateAndSave', 
                provider, 
                apiKey: input.value 
            });
        }

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'keyDetected':
                    const input = document.querySelector(\`#key-\${message.provider}\`);
                    if (input) {
                        input.value = message.key;
                    }
                    break;
                case 'validationSuccess':
                    const success = document.querySelector(\`#success-\${message.provider}\`);
                    if (success) {
                        success.classList.add('show');
                    }
                    break;
                case 'validationError':
                    const error = document.querySelector(\`#error-\${message.provider}\`);
                    if (error) {
                        error.textContent = 'Error: ' + message.error;
                        error.classList.add('show');
                    }
                    break;
            }
        });
    </script>
</body>
</html>`;
    }

    private currentWebview: vscode.Webview | null = null;

    private getStepContent(config: vscode.WorkspaceConfiguration): string {
        switch (this.currentStep) {
            case 0:
                return this.getProviderSelectionStep();
            case 1:
                return this.getAuthorizationStep(config);
            case 2:
                return this.getCompletionStep(config);
            default:
                return '';
        }
    }

    private getProviderSelectionStep(): string {
        const config = vscode.workspace.getConfiguration('xendcode');
        
        return `
            <h2>Choose Your AI Providers</h2>
            <p class="subtitle">
                Select which AI providers you want to connect. We recommend starting with the free options.
            </p>
            
            <div class="provider-list">
                ${this.providers.map(provider => {
                    const apiKey = config.get<string>(`models.${provider.id}.apiKey`, '');
                    const isConnected = apiKey && apiKey.length > 0;
                    
                    return `
                    <div class="provider-card ${isConnected ? 'connected' : ''}" data-provider="${provider.id}" onclick="${isConnected ? '' : `selectProvider('${provider.id}')`}">
                        <div class="provider-icon">
                            <img src="${this.currentWebview ? this.getLogoUri(this.currentWebview, provider.icon) : ''}" alt="${provider.name}" width="40" height="40" />
                        </div>
                        <div class="provider-info">
                            <div class="provider-name">${provider.name}</div>
                            <div class="provider-description">${provider.description}</div>
                        </div>
                        <span class="provider-badge ${isConnected ? 'badge-connected' : (provider.freeTier ? 'badge-free' : 'badge-credit')}">
                            ${isConnected ? 'CONNECTED' : (provider.freeCredit || (provider.freeTier ? 'FREE' : ''))}
                        </span>
                    </div>
                `;
                }).join('')}
            </div>
        `;
    }

    private getAuthorizationStep(config: vscode.WorkspaceConfiguration): string {
        const selectedList = Array.from(this.selectedProviders);
        if (selectedList.length === 0) {
            return '<p>Please select at least one provider</p>';
        }

        return selectedList.map(providerId => {
            const provider = this.providers.find(p => p.id === providerId);
            if (!provider) return '';

            const isConfigured = !!config.get(`models.${providerId}.apiKey`);

            return `
                <div class="auth-section">
                    <h3>${provider.icon} ${provider.name}</h3>
                    
                    ${isConfigured ? `
                        <div class="success-message show">
                            ✅ Already configured!
                        </div>
                    ` : `
                        <div class="instructions">
                            <strong>Instructions:</strong>
                            <ol>
                                ${provider.instructions.map(inst => `<li>${inst}</li>`).join('')}
                            </ol>
                        </div>
                        
                        <div class="auth-buttons">
                            ${provider.canAutomate ? `
                                <button class="btn btn-primary" onclick="automateAuth('${providerId}')">
                                    ⚡ Quick Connect
                                </button>
                            ` : ''}
                            <button class="btn btn-secondary" onclick="manualAuth('${providerId}')">
                                🔑 Manual Setup
                            </button>
                        </div>
                        
                        <div class="input-group">
                            <label>API Key:</label>
                            <input type="text" id="key-${providerId}" placeholder="Paste your API key here..." />
                        </div>
                        
                        <button class="btn btn-primary" onclick="validateKey('${providerId}')" style="width: 100%;">
                            ✓ Validate & Save
                        </button>
                        
                        <div class="success-message" id="success-${providerId}">
                            ✅ Successfully configured!
                        </div>
                        <div class="error-message" id="error-${providerId}"></div>
                    `}
                </div>
            `;
        }).join('');
    }

    private getCompletionStep(config: vscode.WorkspaceConfiguration): string {
        const configured = this.providers.filter(p => 
            !!config.get(`models.${p.id}.apiKey`)
        );

        return `
            <div style="max-width: 700px; margin: 0 auto; padding: 40px 20px;">
                <!-- Success Header -->
                <div style="text-align: center; margin-bottom: 48px;">
                    <div style="font-size: 80px; margin-bottom: 16px; animation: bounce 0.6s ease;">🎉</div>
                    <h1 style="font-size: 32px; font-weight: 700; margin-bottom: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;">
                        You're All Set!
                    </h1>
                    <p style="font-size: 16px; color: var(--vscode-descriptionForeground); margin: 0;">
                        Successfully configured ${configured.length} AI provider${configured.length !== 1 ? 's' : ''} for intelligent coding assistance
                    </p>
                </div>

                <!-- Stats Cards -->
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-bottom: 40px;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px; padding: 24px; text-align: center; color: white;">
                        <div style="font-size: 36px; font-weight: 700; margin-bottom: 4px;">${configured.length}</div>
                        <div style="font-size: 14px; opacity: 0.9;">Active Providers</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); border-radius: 16px; padding: 24px; text-align: center; color: white;">
                        <div style="font-size: 36px; font-weight: 700; margin-bottom: 4px;">∞</div>
                        <div style="font-size: 14px; opacity: 0.9;">Free Tokens</div>
                    </div>
                    <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); border-radius: 16px; padding: 24px; text-align: center; color: white;">
                        <div style="font-size: 36px; font-weight: 700; margin-bottom: 4px;">🚀</div>
                        <div style="font-size: 14px; opacity: 0.9;">Ready to Code</div>
                    </div>
                </div>

                <!-- Configured Providers List -->
                <div style="background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); border-radius: 16px; padding: 32px; margin-bottom: 32px;">
                    <h3 style="font-size: 18px; font-weight: 600; margin: 0 0 24px 0; display: flex; align-items: center; gap: 8px;">
                        <span>✓</span> Configured Providers
                    </h3>
                    <div style="display: grid; gap: 12px;">
                        ${configured.map(p => `
                            <div style="display: flex; align-items: center; gap: 16px; padding: 16px; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 12px; transition: transform 0.2s;">
                                <div style="width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: ${p.color}15; border-radius: 10px;">
                                    <img src="${this.currentWebview ? this.getLogoUri(this.currentWebview, p.icon) : ''}" alt="${p.name}" style="width: 32px; height: 32px;" />
                                </div>
                                <div style="flex: 1;">
                                    <div style="font-weight: 600; font-size: 15px; margin-bottom: 4px;">${p.name}</div>
                                    <div style="font-size: 13px; color: var(--vscode-descriptionForeground);">${p.description}</div>
                                </div>
                                <div style="width: 32px; height: 32px; background: #10b98115; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                                        <path d="M13.5 4L6 11.5L2.5 8" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                    </svg>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <!-- CTA Button -->
                <div style="text-align: center;">
                    <button class="btn btn-primary" onclick="vscode.postMessage({ type: 'complete' })" style="
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        border: none;
                        color: white;
                        font-size: 16px;
                        font-weight: 600;
                        padding: 16px 48px;
                        border-radius: 12px;
                        cursor: pointer;
                        transition: all 0.3s;
                        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
                    " onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 6px 20px rgba(102, 126, 234, 0.5)'" onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='0 4px 12px rgba(102, 126, 234, 0.4)'">
                        Start Using XendCode →
                    </button>
                    <p style="margin-top: 16px; font-size: 13px; color: var(--vscode-descriptionForeground);">
                        Press <kbd style="padding: 2px 6px; background: var(--vscode-input-background); border: 1px solid var(--vscode-panel-border); border-radius: 4px; font-family: monospace;">Ctrl+Cmd+L</kbd> to open chat anytime
                    </p>
                </div>

                <style>
                    @keyframes bounce {
                        0%, 100% { transform: translateY(0); }
                        50% { transform: translateY(-20px); }
                    }
                </style>
            </div>
        `;
    }
}
