import * as vscode from 'vscode';
import { ModelManager } from './ModelManager';

interface ProviderConfig {
    id: string;
    name: string;
    icon: string;
    color: string;
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
            icon: '🔮',
            color: '#4285F4',
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
            id: 'groq',
            name: 'Groq',
            icon: '⚡',
            color: '#FF6B00',
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
            id: 'openai',
            name: 'OpenAI',
            icon: '🤖',
            color: '#10A37F',
            authUrl: 'https://platform.openai.com',
            tokenUrl: 'https://platform.openai.com/api-keys',
            instructions: [
                'Sign up or log in',
                'Go to API keys section',
                'Create new secret key',
                'Copy the key immediately (shown only once)'
            ],
            canAutomate: false
        },
        {
            id: 'cohere',
            name: 'Cohere',
            icon: '🎯',
            color: '#39A0ED',
            authUrl: 'https://dashboard.cohere.com',
            tokenUrl: 'https://dashboard.cohere.com/api-keys',
            instructions: [
                'Sign up or log in',
                'Go to API Keys',
                'Create trial key',
                'Copy the key'
            ],
            canAutomate: true
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
                retainContextWhenHidden: true
            }
        );

        this.currentPanel = panel;
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
            /^gsk_[A-Za-z0-9]{52}$/,     // Groq
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
            case 'groq':
                const { GroqProvider } = await import('../models/GroqProvider');
                return GroqProvider;
            case 'openai':
                const { OpenAIProvider } = await import('../models/OpenAIProvider');
                return OpenAIProvider;
            case 'cohere':
                const { CohereProvider } = await import('../models/CohereProvider');
                return CohereProvider;
            default:
                throw new Error(`Unknown provider: ${provider}`);
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
        
        .progress-steps {
            display: flex;
            justify-content: center;
            gap: 16px;
            padding: 24px 0;
            margin-bottom: 32px;
        }
        
        .step {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 8px 16px;
            border-radius: 6px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-panel-border);
        }
        
        .step.active {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border-color: var(--vscode-button-background);
        }
        
        .step.completed {
            background: var(--vscode-input-background);
            border-color: var(--vscode-charts-green);
        }
        
        .step-number {
            font-size: 12px;
            font-weight: 600;
        }
        
        .step-label {
            font-size: 13px;
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
            border-left: 3px solid var(--vscode-textBlockQuote-border);
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
        
        <div class="progress-steps">
            <div class="step ${this.currentStep >= 0 ? 'active' : ''} ${this.currentStep > 0 ? 'completed' : ''}">
                <span class="step-number">1.</span>
                <span class="step-label">Select Providers</span>
            </div>
            <div class="step ${this.currentStep >= 1 ? 'active' : ''} ${this.currentStep > 1 ? 'completed' : ''}">
                <span class="step-number">2.</span>
                <span class="step-label">Authorize</span>
            </div>
            <div class="step ${this.currentStep >= 2 ? 'active' : ''}">
                <span class="step-number">3.</span>
                <span class="step-label">Complete</span>
            </div>
        </div>
        
        <div class="wizard-content">
            ${this.getStepContent(config)}
        </div>
        
        <div class="wizard-footer">
            <button class="btn btn-secondary" onclick="previousStep()" ${this.currentStep === 0 ? 'disabled' : ''}>
                ← Back
            </button>
            <button class="btn btn-primary" onclick="nextStep()">
                Next →
            </button>
        </div>
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
        return `
            <h2>Choose Your AI Providers</h2>
            <p class="subtitle">
                Select which AI providers you want to connect. We recommend starting with the free options.
            </p>
            
            <div class="provider-list">
                ${this.providers.map(provider => `
                    <div class="provider-card" data-provider="${provider.id}" onclick="selectProvider('${provider.id}')">
                        <div class="provider-icon">${provider.icon}</div>
                        <div class="provider-info">
                            <div class="provider-name">${provider.name}</div>
                            <div class="provider-description">
                                ${provider.id === 'gemini' ? '60 req/min • 1M context • Best for everything' : ''}
                                ${provider.id === 'groq' ? '30 req/min • Fast inference • Quick responses' : ''}
                                ${provider.id === 'openai' ? 'GPT-3.5 Turbo • High quality responses' : ''}
                                ${provider.id === 'cohere' ? 'Trial API • Good for documentation' : ''}
                            </div>
                        </div>
                        <span class="provider-badge ${provider.id === 'openai' ? 'badge-credit' : 'badge-free'}">
                            ${provider.id === 'openai' ? '$5 Credit' : 'FREE'}
                        </span>
                    </div>
                `).join('')}
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
            <div style="text-align: center; padding: 40px;">
                <div style="font-size: 72px; margin-bottom: 24px;">🎉</div>
                <h2>Setup Complete!</h2>
                <p style="color: #6c757d; margin: 16px 0;">
                    You've configured ${configured.length} AI provider${configured.length !== 1 ? 's' : ''}.
                </p>
                
                <div style="background: #f8f9fa; border-radius: 12px; padding: 24px; margin: 24px 0;">
                    <h3>Configured Providers:</h3>
                    <div style="margin-top: 16px;">
                        ${configured.map(p => `
                            <div style="padding: 8px; margin: 4px 0;">
                                ${p.icon} ${p.name} ✅
                            </div>
                        `).join('')}
                    </div>
                </div>
                
                <button class="btn btn-primary" onclick="vscode.postMessage({ type: 'complete' })" style="margin-top: 24px;">
                    Start Using XendCode →
                </button>
            </div>
        `;
    }
}
