import * as vscode from 'vscode';
import { ModelManager } from './ModelManager';

interface SetupStep {
    id: string;
    name: string;
    provider: string;
    priority: 'high' | 'medium' | 'low';
    signupUrl: string;
    apiKeyUrl: string;
    instructions: string;
    freeTier: string;
    completed: boolean;
}

export class SetupWizard {
    private context: vscode.ExtensionContext;
    private modelManager: ModelManager;
    private currentPanel?: vscode.WebviewPanel;

    constructor(context: vscode.ExtensionContext, modelManager: ModelManager) {
        this.context = context;
        this.modelManager = modelManager;
    }

    /**
     * Launch the setup wizard
     */
    async launch() {
        const steps = this.getSetupSteps();
        const completedSteps = steps.filter(s => s.completed).length;

        if (completedSteps === 0) {
            // First time setup
            await this.showWelcomeScreen();
        } else if (completedSteps < steps.length) {
            // Partial setup
            await this.showPartialSetupScreen(completedSteps, steps.length);
        } else {
            // All configured
            await this.showCompletedScreen();
        }
    }

    /**
     * Show welcome screen for first-time users
     */
    private async showWelcomeScreen() {
        const choice = await vscode.window.showInformationMessage(
            '🎉 Welcome to XendCode! Let\'s get you set up with free AI models in 2 minutes.',
            'Start Setup',
            'Skip for Now'
        );

        if (choice === 'Start Setup') {
            await this.showSetupWizard();
        }
    }

    /**
     * Show partial setup screen
     */
    private async showPartialSetupScreen(completed: number, total: number) {
        const choice = await vscode.window.showInformationMessage(
            `You have ${completed}/${total} AI models configured. Add more for better reliability!`,
            'Continue Setup',
            'Maybe Later'
        );

        if (choice === 'Continue Setup') {
            await this.showSetupWizard();
        }
    }

    /**
     * Show completed setup screen
     */
    private async showCompletedScreen() {
        vscode.window.showInformationMessage(
            '✅ All recommended AI models are configured! You\'re ready to go.'
        );
    }

    /**
     * Show interactive setup wizard
     */
    async showSetupWizard() {
        const panel = vscode.window.createWebviewPanel(
            'xendcodeSetup',
            'XendCode Setup Wizard',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        this.currentPanel = panel;
        panel.webview.html = this.getSetupWizardHtml(panel.webview);

        // Handle messages from webview
        panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'openSignup':
                    await this.openSignupPage(message.provider);
                    break;
                case 'openApiKeyPage':
                    await this.openApiKeyPage(message.provider);
                    break;
                case 'validateKey':
                    await this.validateApiKey(message.provider, message.apiKey);
                    break;
                case 'saveKey':
                    await this.saveApiKey(message.provider, message.apiKey);
                    break;
                case 'skipProvider':
                    await this.skipProvider(message.provider);
                    break;
                case 'refresh':
                    panel.webview.html = this.getSetupWizardHtml(panel.webview);
                    break;
            }
        });
    }

    /**
     * Open signup page in browser
     */
    private async openSignupPage(provider: string) {
        const steps = this.getSetupSteps();
        const step = steps.find(s => s.provider === provider);
        
        if (step) {
            await vscode.env.openExternal(vscode.Uri.parse(step.signupUrl));
            
            // Show helpful message
            vscode.window.showInformationMessage(
                `Opening ${step.name} signup page. After signing up, click "Get API Key" in the wizard.`,
                'Got it'
            );
        }
    }

    /**
     * Open API key page directly in browser
     */
    private async openApiKeyPage(provider: string) {
        const steps = this.getSetupSteps();
        const step = steps.find(s => s.provider === provider);
        
        if (step) {
            await vscode.env.openExternal(vscode.Uri.parse(step.apiKeyUrl));
            
            // Show instructions with clipboard detection
            const choice = await vscode.window.showInformationMessage(
                `📋 Copy your API key from the browser, then paste it in the wizard.`,
                'I copied it',
                'Help'
            );

            if (choice === 'Help') {
                vscode.window.showInformationMessage(
                    `Look for "Create API Key" or "Generate Key" button on the page. Copy the key and paste it in the wizard input field.`
                );
            } else if (choice === 'I copied it') {
                // Try to detect clipboard
                try {
                    const clipboardText = await vscode.env.clipboard.readText();
                    if (clipboardText && clipboardText.length > 10) {
                        this.currentPanel?.webview.postMessage({
                            type: 'clipboardDetected',
                            provider,
                            apiKey: clipboardText
                        });
                    }
                } catch (error) {
                    // Clipboard access might be restricted
                }
            }
        }
    }

    /**
     * Validate API key by testing it
     */
    private async validateApiKey(provider: string, apiKey: string) {
        if (!apiKey || apiKey.trim().length === 0) {
            this.currentPanel?.webview.postMessage({
                type: 'validationResult',
                provider,
                valid: false,
                error: 'API key cannot be empty'
            });
            return;
        }

        // Show progress
        vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Testing ${provider} API key...`,
            cancellable: false
        }, async (progress) => {
            try {
                // Create temporary provider instance
                const Provider = await this.getProviderClass(provider);
                const tempProvider = new Provider(apiKey);

                // Test with a simple request
                const testMessage = [
                    { role: 'user' as const, content: 'Say "OK" if you can read this.' }
                ];

                const response = await tempProvider.complete(testMessage, { maxTokens: 10 });

                // If we get here, the key works!
                this.currentPanel?.webview.postMessage({
                    type: 'validationResult',
                    provider,
                    valid: true
                });

                vscode.window.showInformationMessage(`✅ ${provider} API key is valid!`);

            } catch (error: any) {
                this.currentPanel?.webview.postMessage({
                    type: 'validationResult',
                    provider,
                    valid: false,
                    error: error.message || 'Invalid API key'
                });

                vscode.window.showErrorMessage(`❌ ${provider} API key validation failed: ${error.message}`);
            }
        });
    }

    /**
     * Save API key to settings
     */
    private async saveApiKey(provider: string, apiKey: string) {
        const config = vscode.workspace.getConfiguration('xendcode');
        const configKey = `models.${provider.toLowerCase()}.apiKey`;

        await config.update(configKey, apiKey, vscode.ConfigurationTarget.Global);

        // Refresh model manager
        this.modelManager.refresh();

        // Notify user
        vscode.window.showInformationMessage(`✅ ${provider} configured successfully!`);

        // Refresh wizard
        this.currentPanel?.webview.postMessage({
            type: 'keySaved',
            provider
        });
    }

    /**
     * Skip provider setup
     */
    private async skipProvider(provider: string) {
        vscode.window.showInformationMessage(`Skipped ${provider}. You can add it later in settings.`);
    }

    /**
     * Get provider class dynamically
     */
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
            case 'anthropic':
                const { AnthropicProvider } = await import('../models/AnthropicProvider');
                return AnthropicProvider;
            case 'cohere':
                const { CohereProvider } = await import('../models/CohereProvider');
                return CohereProvider;
            case 'deepseek':
                const { DeepSeekProvider } = await import('../models/DeepSeekProvider');
                return DeepSeekProvider;
            default:
                throw new Error(`Unknown provider: ${provider}`);
        }
    }

    /**
     * Get setup steps with completion status
     */
    private getSetupSteps(): SetupStep[] {
        const config = vscode.workspace.getConfiguration('xendcode');

        return [
            {
                id: '1',
                name: 'Google Gemini',
                provider: 'gemini',
                priority: 'high',
                signupUrl: 'https://makersuite.google.com',
                apiKeyUrl: 'https://makersuite.google.com/app/apikey',
                instructions: 'Sign in with Google → Click "Get API Key" → Copy the key',
                freeTier: '60 requests/minute, 1M tokens context - 100% FREE!',
                completed: !!config.get('models.gemini.apiKey')
            },
            {
                id: '2',
                name: 'grok',
                provider: 'grok',
                priority: 'high',
                signupUrl: 'https://console.grok.com',
                apiKeyUrl: 'https://console.grok.com/keys',
                instructions: 'Sign up → Go to API Keys → Create new key → Copy',
                freeTier: '30 requests/minute - FREE with fast inference!',
                completed: !!config.get('models.grok.apiKey')
            },
            {
                id: '3',
                name: 'OpenAI',
                provider: 'openai',
                priority: 'medium',
                signupUrl: 'https://platform.openai.com/signup',
                apiKeyUrl: 'https://platform.openai.com/api-keys',
                instructions: 'Sign up → Create API key → Copy the key',
                freeTier: '$5 free credit for new users (~50k tokens)',
                completed: !!config.get('models.openai.apiKey')
            },
            {
                id: '4',
                name: 'Cohere',
                provider: 'cohere',
                priority: 'medium',
                signupUrl: 'https://dashboard.cohere.com',
                apiKeyUrl: 'https://dashboard.cohere.com/api-keys',
                instructions: 'Sign up → Go to API Keys → Create trial key → Copy',
                freeTier: 'Free trial with 100 API calls',
                completed: !!config.get('models.cohere.apiKey')
            }
        ];
    }

    /**
     * Generate HTML for setup wizard
     */
    private getSetupWizardHtml(webview: vscode.Webview): string {
        const steps = this.getSetupSteps();
        const completedCount = steps.filter(s => s.completed).length;
        const progressPercent = (completedCount / steps.length) * 100;

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
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background: var(--vscode-editor-background);
            padding: 24px;
            line-height: 1.6;
        }
        
        .header {
            text-align: center;
            margin-bottom: 32px;
        }
        
        .header h1 {
            font-size: 28px;
            margin-bottom: 8px;
        }
        
        .header p {
            color: var(--vscode-descriptionForeground);
            font-size: 14px;
        }
        
        .progress-section {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 20px;
            margin-bottom: 24px;
        }
        
        .progress-bar-container {
            width: 100%;
            height: 24px;
            background: var(--vscode-input-background);
            border-radius: 12px;
            overflow: hidden;
            margin-top: 12px;
        }
        
        .progress-bar {
            height: 100%;
            background: linear-gradient(90deg, #4CAF50, #8BC34A);
            transition: width 0.3s ease;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 12px;
        }
        
        .step-card {
            background: var(--vscode-editor-background);
            border: 2px solid var(--vscode-panel-border);
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 20px;
            transition: all 0.3s ease;
        }
        
        .step-card.completed {
            border-color: #4CAF50;
            opacity: 0.7;
        }
        
        .step-card.high-priority {
            border-color: #FF9800;
        }
        
        .step-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 16px;
        }
        
        .step-title {
            font-size: 20px;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        
        .priority-badge {
            font-size: 11px;
            padding: 4px 8px;
            border-radius: 4px;
            font-weight: bold;
            text-transform: uppercase;
        }
        
        .priority-high {
            background: #FF9800;
            color: white;
        }
        
        .priority-medium {
            background: #2196F3;
            color: white;
        }
        
        .status-badge {
            font-size: 11px;
            padding: 4px 12px;
            border-radius: 12px;
            font-weight: bold;
        }
        
        .status-completed {
            background: #4CAF50;
            color: white;
        }
        
        .status-pending {
            background: var(--vscode-input-background);
            color: var(--vscode-foreground);
        }
        
        .free-tier {
            background: #4CAF50;
            color: white;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 13px;
            margin-bottom: 12px;
            display: inline-block;
        }
        
        .instructions {
            color: var(--vscode-descriptionForeground);
            margin-bottom: 16px;
            font-size: 14px;
        }
        
        .action-buttons {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
        }
        
        button {
            padding: 10px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s ease;
        }
        
        .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        
        .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
        }
        
        .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        
        .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        
        .btn-skip {
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: 1px solid var(--vscode-panel-border);
        }
        
        .input-group {
            margin: 16px 0;
            display: none;
        }
        
        .input-group.show {
            display: block;
        }
        
        .input-group input {
            width: 100%;
            padding: 12px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 6px;
            font-size: 14px;
            font-family: monospace;
        }
        
        .input-group input:focus {
            outline: none;
            border-color: var(--vscode-panel-border);
        }
        
        .validation-message {
            margin-top: 8px;
            padding: 8px 12px;
            border-radius: 4px;
            font-size: 13px;
            display: none;
        }
        
        .validation-message.show {
            display: block;
        }
        
        .validation-success {
            background: rgba(76, 175, 80, 0.2);
            color: #4CAF50;
            border: 1px solid #4CAF50;
        }
        
        .validation-error {
            background: rgba(244, 67, 54, 0.2);
            color: #F44336;
            border: 1px solid #F44336;
        }
        
        .footer {
            text-align: center;
            margin-top: 32px;
            padding-top: 24px;
            border-top: 1px solid var(--vscode-panel-border);
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
        }
        
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        
        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255,255,255,0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 0.6s linear infinite;
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>🚀 XendCode Setup Wizard</h1>
        <p>Set up free AI models in just a few clicks!</p>
    </div>

    <div class="progress-section">
        <strong>Setup Progress: ${completedCount}/${steps.length} models configured</strong>
        <div class="progress-bar-container">
            <div class="progress-bar" style="width: ${progressPercent}%">
                ${progressPercent.toFixed(0)}%
            </div>
        </div>
    </div>

    ${steps.map(step => `
        <div class="step-card ${step.completed ? 'completed' : ''} ${step.priority === 'high' ? 'high-priority' : ''}" data-provider="${step.provider}">
            <div class="step-header">
                <div class="step-title">
                    ${step.completed ? '✅' : '⭕'} ${step.name}
                    <span class="priority-badge priority-${step.priority}">${step.priority} priority</span>
                </div>
                <span class="status-badge ${step.completed ? 'status-completed' : 'status-pending'}">
                    ${step.completed ? 'Configured' : 'Not Set Up'}
                </span>
            </div>
            
            <div class="free-tier">💰 ${step.freeTier}</div>
            
            <div class="instructions">
                📝 <strong>Instructions:</strong> ${step.instructions}
            </div>
            
            ${!step.completed ? `
                <div class="action-buttons">
                    <button class="btn-primary" onclick="openApiKeyPage('${step.provider}')">
                        🔑 Get API Key
                    </button>
                    <button class="btn-secondary" onclick="showInputBox('${step.provider}')">
                        ✏️ Enter Key Manually
                    </button>
                    <button class="btn-skip" onclick="skipProvider('${step.provider}')">
                        Skip for Now
                    </button>
                </div>
                
                <div class="input-group" id="input-${step.provider}">
                    <input 
                        type="text" 
                        id="key-${step.provider}" 
                        placeholder="Paste your API key here..."
                        data-provider="${step.provider}"
                    />
                    <div class="validation-message" id="validation-${step.provider}"></div>
                    <div style="margin-top: 12px; display: flex; gap: 8px;">
                        <button class="btn-primary" onclick="validateKey('${step.provider}')">
                            ✓ Validate & Save
                        </button>
                        <button class="btn-secondary" onclick="hideInputBox('${step.provider}')">
                            Cancel
                        </button>
                    </div>
                </div>
            ` : `
                <div style="color: #4CAF50; font-weight: bold;">
                    ✅ This model is ready to use!
                </div>
            `}
        </div>
    `).join('')}

    <div class="footer">
        <p><strong>Tip:</strong> You only need 1 model to start, but adding more gives you redundancy and better rate limits!</p>
        <p style="margin-top: 8px;">Need help? Check our <a href="#" onclick="openDocs()">Setup Guide</a></p>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function openApiKeyPage(provider) {
            vscode.postMessage({ type: 'openApiKeyPage', provider });
        }

        function showInputBox(provider) {
            document.getElementById('input-' + provider).classList.add('show');
        }

        function hideInputBox(provider) {
            document.getElementById('input-' + provider).classList.remove('show');
        }

        function validateKey(provider) {
            const input = document.getElementById('key-' + provider);
            const apiKey = input.value.trim();
            
            if (!apiKey) {
                showValidation(provider, false, 'Please enter an API key');
                return;
            }

            // Show validating state
            showValidation(provider, null, 'Validating... <span class="spinner"></span>');
            
            vscode.postMessage({ 
                type: 'validateKey', 
                provider, 
                apiKey 
            });
        }

        function skipProvider(provider) {
            vscode.postMessage({ type: 'skipProvider', provider });
        }

        function showValidation(provider, valid, message) {
            const el = document.getElementById('validation-' + provider);
            el.className = 'validation-message show';
            
            if (valid === true) {
                el.classList.add('validation-success');
            } else if (valid === false) {
                el.classList.add('validation-error');
            }
            
            el.textContent = message; // Safe: no HTML injection
        }

        function openDocs() {
            vscode.postMessage({ type: 'openDocs' });
        }

        // Listen for messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            
            switch (message.type) {
                case 'clipboardDetected':
                    const input = document.getElementById('key-' + message.provider);
                    if (input) {
                        input.value = message.apiKey;
                        showInputBox(message.provider);
                        showValidation(message.provider, null, '📋 API key detected from clipboard!');
                    }
                    break;
                    
                case 'validationResult':
                    if (message.valid) {
                        showValidation(message.provider, true, '✅ Valid! Saving...');
                        vscode.postMessage({
                            type: 'saveKey',
                            provider: message.provider,
                            apiKey: document.getElementById('key-' + message.provider).value
                        });
                    } else {
                        showValidation(message.provider, false, '❌ ' + message.error);
                    }
                    break;
                    
                case 'keySaved':
                    // Refresh the wizard
                    vscode.postMessage({ type: 'refresh' });
                    break;
            }
        });

        // Auto-detect paste events
        document.addEventListener('paste', (e) => {
            const target = e.target;
            if (target.tagName === 'INPUT' && target.dataset.provider) {
                setTimeout(() => {
                    const provider = target.dataset.provider;
                    showValidation(provider, null, '📋 Pasted! Click "Validate & Save" when ready.');
                }, 100);
            }
        });
    </script>
</body>
</html>`;
    }
}
