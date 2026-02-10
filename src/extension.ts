import * as vscode from 'vscode';
import { ModelManager } from './core/ModelManager';
import { TokenManager } from './core/TokenManager';
import { ContextManager } from './core/ContextManager';
import { ModernSetupWizard } from './core/ModernSetupWizard';
import { ChatProvider } from './providers/ChatProvider';
import { UsageTreeProvider } from './providers/UsageTreeProvider';
import { ModelsTreeProvider } from './providers/ModelsTreeProvider';
import { FirebaseService } from './services/FirebaseService';

let modelManager: ModelManager;
let tokenManager: TokenManager;
let contextManager: ContextManager;
let setupWizard: ModernSetupWizard;
let firebaseService: FirebaseService;

export function activate(context: vscode.ExtensionContext) {
    // Initialize core managers
    modelManager = new ModelManager(context);
    tokenManager = new TokenManager(context);
    contextManager = new ContextManager(tokenManager);
    setupWizard = new ModernSetupWizard(context, modelManager);
    firebaseService = new FirebaseService(context);

    // Initialize chat provider - ONLY as editor panel (right side)
    const chatProvider = new ChatProvider(context, modelManager, contextManager, tokenManager, firebaseService);

    // Check if this is first run and show setup wizard
    const hasSeenWelcome = context.globalState.get('hasSeenWelcome', false);
    if (!hasSeenWelcome) {
        context.globalState.update('hasSeenWelcome', true);
        setupWizard.launch();
    }

    // Auto-open chat panel on the right side on activation
    setTimeout(() => {
        chatProvider.openChatEditor();
    }, 500);

    // Add status bar button to open chat
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(comment-discussion) XendCode Chat";
    statusBarItem.command = 'xendcode.chat';
    statusBarItem.tooltip = "Open XendCode Chat (Ctrl+Cmd+L)";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Register tree providers
    const usageTreeProvider = new UsageTreeProvider(tokenManager);
    const modelsTreeProvider = new ModelsTreeProvider(modelManager);
    
    vscode.window.registerTreeDataProvider('xendcode.usage', usageTreeProvider);
    vscode.window.registerTreeDataProvider('xendcode.models', modelsTreeProvider);

    // Register commands
    context.subscriptions.push(
        // Main command - open chat editor on right side
        vscode.commands.registerCommand('xendcode.chat', () => {
            chatProvider.openChatEditor();
        }),

        // Alias command for opening chat editor
        vscode.commands.registerCommand('xendcode.openChatEditor', () => {
            chatProvider.openChatEditor();
        }),

        vscode.commands.registerCommand('xendcode.explain', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.document.getText(editor.selection);
                if (selection) {
                    await chatProvider.handleExplainCode(selection);
                }
            }
        }),

        vscode.commands.registerCommand('xendcode.refactor', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.document.getText(editor.selection);
                if (selection) {
                    await chatProvider.handleRefactorCode(selection);
                }
            }
        }),

        vscode.commands.registerCommand('xendcode.fix', async () => {
            const editor = vscode.window.activeTextEditor;
            if (editor) {
                const selection = editor.document.getText(editor.selection);
                if (selection) {
                    await chatProvider.handleFixCode(selection);
                }
            }
        }),

        vscode.commands.registerCommand('xendcode.configure', async () => {
            await vscode.commands.executeCommand('workbench.action.openSettings', 'xendcode');
        }),

        vscode.commands.registerCommand('xendcode.setupWizard', async () => {
            await setupWizard.launch();
        }),

        vscode.commands.registerCommand('xendcode.showDashboard', async () => {
            const panel = vscode.window.createWebviewPanel(
                'xendcodeDashboard',
                'XendCode Usage Dashboard',
                vscode.ViewColumn.One,
                { enableScripts: true }
            );
            panel.webview.html = await getDashboardHtml(tokenManager);
        }),

        vscode.commands.registerCommand('xendcode.optimizeContext', async () => {
            await contextManager.optimizeContext();
            vscode.window.showInformationMessage('Context optimized successfully!');
        }),

        vscode.commands.registerCommand('xendcode.login', async () => {
            if (!firebaseService.isConfigured()) {
                // Auto-configure Firebase with hardcoded creds (they provided them)
                const config = vscode.workspace.getConfiguration('xendcode');
                await config.update('firebase.apiKey', 'AIzaSyCaZzyz_JJIIgo_1tgaAr3pvuXOoocIYog', vscode.ConfigurationTarget.Workspace);
                await config.update('firebase.authDomain', 'xendcode.firebaseapp.com', vscode.ConfigurationTarget.Workspace);
                await config.update('firebase.projectId', 'xendcode', vscode.ConfigurationTarget.Workspace);
                await config.update('firebase.storageBucket', 'xendcode.firebasestorage.app', vscode.ConfigurationTarget.Workspace);
                await config.update('firebase.messagingSenderId', '162743756860', vscode.ConfigurationTarget.Workspace);
                await config.update('firebase.appId', '1:162743756860:web:fdc0b750698924fa9c3b39', vscode.ConfigurationTarget.Workspace);
                
                // Reinitialize Firebase service
                firebaseService = new FirebaseService(context);
                
                // Wait a bit for initialization
                await new Promise(resolve => setTimeout(resolve, 500));
                
                if (!firebaseService.isConfigured()) {
                    vscode.window.showErrorMessage('Failed to initialize Firebase. Please reload the extension.');
                    return;
                }
            }
            
            // Open login webview panel
            const panel = vscode.window.createWebviewPanel(
                'xendcodeLogin',
                'XendCode Login',
                vscode.ViewColumn.One,
                {
                    enableScripts: true,
                    retainContextWhenHidden: true
                }
            );
            
            panel.webview.html = getLoginHtml(panel.webview);
            
            // Handle messages from webview
            panel.webview.onDidReceiveMessage(async (message) => {
                switch (message.type) {
                    case 'login':
                        try {
                            await firebaseService.signIn(message.email, message.password);
                            panel.webview.postMessage({ type: 'loginSuccess' });
                            vscode.window.showInformationMessage('✅ Successfully logged in to XendCode!');
                            panel.dispose();
                            
                            // Show usage dashboard after login
                            setTimeout(() => {
                                vscode.commands.executeCommand('xendcode.showDashboard');
                            }, 500);
                        } catch (error: any) {
                            panel.webview.postMessage({ 
                                type: 'loginError', 
                                message: error.message 
                            });
                        }
                        break;
                    
                    case 'signup':
                        try {
                            await firebaseService.signUp(message.email, message.password);
                            panel.webview.postMessage({ type: 'signupSuccess' });
                            vscode.window.showInformationMessage('✅ Account created! You are now logged in.');
                            panel.dispose();
                            
                            // Show usage dashboard after signup
                            setTimeout(() => {
                                vscode.commands.executeCommand('xendcode.showDashboard');
                            }, 500);
                        } catch (error: any) {
                            panel.webview.postMessage({ 
                                type: 'signupError', 
                                message: error.message 
                            });
                        }
                        break;
                    
                    case 'googleAuth':
                        try {
                            await firebaseService.signInWithGoogle();
                            panel.webview.postMessage({ type: 'loginSuccess' });
                            vscode.window.showInformationMessage('✅ Successfully signed in with Google!');
                            panel.dispose();
                            
                            // Show usage dashboard after login
                            setTimeout(() => {
                                vscode.commands.executeCommand('xendcode.showDashboard');
                            }, 500);
                        } catch (error: any) {
                            panel.webview.postMessage({ 
                                type: 'loginError', 
                                message: error.message 
                            });
                        }
                        break;
                }
            });
        }),

        vscode.commands.registerCommand('xendcode.logout', async () => {
            try {
                await firebaseService.signOutUser();
            } catch (error: any) {
                vscode.window.showErrorMessage(error.message);
            }
        }),

        vscode.commands.registerCommand('xendcode.testFirebase', async () => {
            if (!firebaseService.isConfigured()) {
                vscode.window.showErrorMessage('Firebase not configured. Check settings.');
                return;
            }

            vscode.window.showInformationMessage('Firebase is configured! ✅ Try logging in with "XendCode: Login"');
        }),

        vscode.commands.registerCommand('xendcode.managePlaybooks', async () => {
            const config = vscode.workspace.getConfiguration('xendcode');
            const orgId = config.get('org.id', '');

            if (!orgId) {
                const setOrg = await vscode.window.showErrorMessage(
                    'Organization ID not set. Configure it in settings first.',
                    'Open Settings'
                );
                if (setOrg) {
                    await vscode.commands.executeCommand('workbench.action.openSettings', 'xendcode.org');
                }
                return;
            }

            if (!firebaseService.isLoggedIn()) {
                const login = await vscode.window.showErrorMessage(
                    'You must be logged in to manage playbooks.',
                    'Login'
                );
                if (login) {
                    await vscode.commands.executeCommand('xendcode.login');
                }
                return;
            }

            // Show playbook options
            const action = await vscode.window.showQuickPick([
                { label: '$(add) Create New Playbook', value: 'create' },
                { label: '$(list-unordered) View Playbooks', value: 'view' }
            ], {
                placeHolder: 'Manage Organization Playbooks'
            });

            if (!action) {
                return;
            }

            if (action.value === 'create') {
                const name = await vscode.window.showInputBox({
                    prompt: 'Playbook Name',
                    placeHolder: 'e.g., Code Review Standards',
                    ignoreFocusOut: true
                });

                if (!name) {
                    return;
                }

                const prompt = await vscode.window.showInputBox({
                    prompt: 'Playbook Prompt (will be added to all AI requests)',
                    placeHolder: 'Always follow our coding standards: ...',
                    ignoreFocusOut: true
                });

                if (!prompt) {
                    return;
                }

                try {
                    await firebaseService.savePlaybook(name, prompt, orgId);
                } catch (error: any) {
                    vscode.window.showErrorMessage(error.message);
                }
            } else if (action.value === 'view') {
                try {
                    const playbooks = await firebaseService.loadPlaybooks(orgId);
                    
                    if (playbooks.length === 0) {
                        vscode.window.showInformationMessage('No playbooks found for your organization.');
                        return;
                    }

                    const selected = await vscode.window.showQuickPick(
                        playbooks.map(p => ({
                            label: p.name,
                            description: p.prompt.substring(0, 100) + '...',
                            playbook: p
                        })),
                        {
                            placeHolder: 'Select a playbook to view'
                        }
                    );

                    if (selected) {
                        vscode.window.showInformationMessage(
                            `${selected.playbook.name}\n\n${selected.playbook.prompt}`,
                            { modal: true }
                        );
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(error.message);
                }
            }
        })
    );

    // Refresh usage data periodically
    setInterval(() => {
        usageTreeProvider.refresh();
        modelsTreeProvider.refresh();
    }, 5000);

    vscode.window.showInformationMessage('XendCode: Budget-friendly AI assistant is ready!');
}

function getLoginHtml(webview: vscode.Webview): string {
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * {
                margin: 0;
                padding: 0;
                box-sizing: border-box;
            }
            
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
                background: var(--vscode-editor-background);
                color: var(--vscode-foreground);
                display: flex;
                align-items: center;
                justify-content: center;
                min-height: 100vh;
                padding: 20px;
            }
            
            .login-container {
                width: 100%;
                max-width: 400px;
                background: var(--vscode-sideBar-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 12px;
                padding: 40px;
                box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            }
            
            .logo {
                text-align: center;
                margin-bottom: 32px;
            }
            
            .logo h1 {
                font-size: 28px;
                font-weight: 700;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
                margin-bottom: 8px;
            }
            
            .logo p {
                font-size: 14px;
                opacity: 0.7;
            }
            
            .tabs {
                display: flex;
                gap: 8px;
                margin-bottom: 24px;
                background: var(--vscode-input-background);
                padding: 4px;
                border-radius: 8px;
            }
            
            .tab {
                flex: 1;
                padding: 10px;
                background: transparent;
                border: none;
                color: var(--vscode-foreground);
                cursor: pointer;
                border-radius: 6px;
                font-size: 14px;
                font-weight: 500;
                transition: all 0.2s;
                opacity: 0.7;
            }
            
            .tab.active {
                background: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                opacity: 1;
            }
            
            .tab:hover {
                opacity: 1;
            }
            
            .form-group {
                margin-bottom: 20px;
            }
            
            label {
                display: block;
                margin-bottom: 8px;
                font-size: 13px;
                font-weight: 500;
                opacity: 0.9;
            }
            
            input {
                width: 100%;
                padding: 12px 16px;
                background: var(--vscode-input-background);
                border: 1px solid var(--vscode-input-border);
                border-radius: 8px;
                color: var(--vscode-input-foreground);
                font-size: 14px;
                outline: none;
                transition: all 0.2s;
            }
            
            input:focus {
                border-color: var(--vscode-focusBorder);
                box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
            }
            
            .submit-btn {
                width: 100%;
                padding: 14px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                border: none;
                border-radius: 8px;
                color: white;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                margin-top: 8px;
            }
            
            .submit-btn:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
            }
            
            .submit-btn:active {
                transform: translateY(0);
            }
            
            .submit-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none;
            }
            
            .divider {
                display: flex;
                align-items: center;
                gap: 16px;
                margin: 24px 0;
                opacity: 0.5;
            }
            
            .divider::before,
            .divider::after {
                content: '';
                flex: 1;
                height: 1px;
                background: var(--vscode-panel-border);
            }
            
            .divider span {
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            
            .google-btn {
                width: 100%;
                padding: 14px;
                background: white;
                border: 1px solid #ddd;
                border-radius: 8px;
                color: #333;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                transition: all 0.2s;
            }
            
            .google-btn:hover {
                background: #f8f8f8;
                border-color: #ccc;
                transform: translateY(-1px);
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
            }
            
            .google-btn:active {
                transform: translateY(0);
            }
            
            .google-btn.primary-auth {
                padding: 16px;
                font-size: 15px;
                box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
            }
            
            .google-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                transform: none;
            }
            
            .error {
                background: rgba(255, 68, 68, 0.1);
                border: 1px solid rgba(255, 68, 68, 0.3);
                color: #ff4444;
                padding: 12px;
                border-radius: 8px;
                margin-bottom: 16px;
                font-size: 13px;
                display: none;
            }
            
            .error.show {
                display: block;
            }
            
            .tab-content {
                display: none;
            }
            
            .tab-content.active {
                display: block;
            }
            
            .footer {
                margin-top: 24px;
                text-align: center;
                font-size: 12px;
                opacity: 0.6;
            }
        </style>
    </head>
    <body>
        <div class="login-container">
            <div class="logo">
                <h1>XendCode</h1>
                <p>AI-Powered Coding Assistant</p>
            </div>
            
            <div id="error-message" class="error"></div>
            
            <!-- Google Sign In (Primary) -->
            <button class="google-btn primary-auth" onclick="handleGoogleAuth()">
                <svg width="18" height="18" viewBox="0 0 18 18">
                    <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
                    <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/>
                    <path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/>
                    <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
                </svg>
                Continue with Google
            </button>
            
            <div class="divider">
                <span>or</span>
            </div>
            
            <div class="tabs">
                <button class="tab active" onclick="switchTab('login')">Email Login</button>
                <button class="tab" onclick="switchTab('signup')">Sign Up</button>
            </div>
            
            <!-- Login Form -->
            <div id="login-form" class="tab-content active">
                <form onsubmit="handleLogin(event)">
                    <div class="form-group">
                        <label for="login-email">Email</label>
                        <input type="email" id="login-email" placeholder="you@example.com" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="login-password">Password</label>
                        <input type="password" id="login-password" placeholder="••••••••" required>
                    </div>
                    
                    <button type="submit" class="submit-btn" id="login-btn">
                        Login with Email
                    </button>
                </form>
            </div>
            
            <!-- Sign Up Form -->
            <div id="signup-form" class="tab-content">
                <form onsubmit="handleSignup(event)">
                    <div class="form-group">
                        <label for="signup-email">Email</label>
                        <input type="email" id="signup-email" placeholder="you@example.com" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="signup-password">Password</label>
                        <input type="password" id="signup-password" placeholder="••••••••" required minlength="6">
                    </div>
                    
                    <div class="form-group">
                        <label for="signup-password-confirm">Confirm Password</label>
                        <input type="password" id="signup-password-confirm" placeholder="••••••••" required minlength="6">
                    </div>
                    
                    <button type="submit" class="submit-btn" id="signup-btn">
                        Create Account with Email
                    </button>
                </form>
            </div>
            
            <div class="footer">
                XendCode • Secure Firebase Authentication
            </div>
        </div>
        
        <script>
            const vscode = acquireVsCodeApi();
            
            function switchTab(tab) {
                // Update tabs
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                event.target.classList.add('active');
                
                // Update content
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.getElementById(tab + '-form').classList.add('active');
                
                // Clear error
                hideError();
            }
            
            function showError(message) {
                const errorEl = document.getElementById('error-message');
                errorEl.textContent = message;
                errorEl.classList.add('show');
            }
            
            function hideError() {
                const errorEl = document.getElementById('error-message');
                errorEl.classList.remove('show');
            }
            
            function handleLogin(e) {
                e.preventDefault();
                hideError();
                
                const email = document.getElementById('login-email').value;
                const password = document.getElementById('login-password').value;
                const btn = document.getElementById('login-btn');
                
                btn.textContent = 'Logging in...';
                btn.disabled = true;
                
                vscode.postMessage({
                    type: 'login',
                    email: email,
                    password: password
                });
            }
            
            function handleSignup(e) {
                e.preventDefault();
                hideError();
                
                const email = document.getElementById('signup-email').value;
                const password = document.getElementById('signup-password').value;
                const confirmPassword = document.getElementById('signup-password-confirm').value;
                const btn = document.getElementById('signup-btn');
                
                if (password !== confirmPassword) {
                    showError('Passwords do not match');
                    return;
                }
                
                if (password.length < 6) {
                    showError('Password must be at least 6 characters');
                    return;
                }
                
                btn.textContent = 'Creating account...';
                btn.disabled = true;
                
                vscode.postMessage({
                    type: 'signup',
                    email: email,
                    password: password
                });
            }
            
            function handleGoogleAuth() {
                hideError();
                const googleBtns = document.querySelectorAll('.google-btn');
                googleBtns.forEach(btn => {
                    btn.textContent = 'Signing in with Google...';
                    btn.disabled = true;
                });
                
                vscode.postMessage({ type: 'googleAuth' });
            }
            
            // Listen for responses
            window.addEventListener('message', event => {
                const message = event.data;
                
                if (message.type === 'loginError' || message.type === 'signupError') {
                    showError(message.message);
                    document.getElementById('login-btn').textContent = 'Login with Email';
                    document.getElementById('login-btn').disabled = false;
                    document.getElementById('signup-btn').textContent = 'Create Account with Email';
                    document.getElementById('signup-btn').disabled = false;
                    
                    // Reset Google buttons
                    const googleBtns = document.querySelectorAll('.google-btn');
                    googleBtns.forEach((btn, idx) => {
                        btn.disabled = false;
                        if (idx === 0 || btn.classList.contains('primary-auth')) {
                            btn.innerHTML = '<svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/><path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#FBBC05" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.55 0 9s.348 2.825.957 4.039l3.007-2.332z"/><path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/></svg> Continue with Google';
                        }
                    });
                }
            });
        </script>
    </body>
    </html>`;
}

async function getDashboardHtml(tokenManager: TokenManager): Promise<string> {
    const stats = tokenManager.getUsageStats();
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { 
                font-family: var(--vscode-font-family); 
                padding: 20px;
                color: var(--vscode-foreground);
            }
            .stat-card {
                background: var(--vscode-editor-background);
                border: 1px solid var(--vscode-panel-border);
                border-radius: 8px;
                padding: 20px;
                margin: 10px 0;
            }
            .stat-title { 
                font-size: 14px; 
                color: var(--vscode-descriptionForeground);
                margin-bottom: 10px;
            }
            .stat-value { 
                font-size: 24px; 
                font-weight: bold;
                color: var(--vscode-foreground);
            }
            .progress-bar {
                width: 100%;
                height: 8px;
                background: var(--vscode-progressBar-background);
                border-radius: 4px;
                margin-top: 10px;
                overflow: hidden;
            }
            .progress-fill {
                height: 100%;
                background: var(--vscode-progressBar-background);
                transition: width 0.3s;
            }
        </style>
    </head>
    <body>
        <h1>XendCode Usage Dashboard</h1>
        ${Object.entries(stats.byModel).map(([model, data]) => `
            <div class="stat-card">
                <div class="stat-title">${model}</div>
                <div class="stat-value">${data.tokensUsed.toLocaleString()} tokens</div>
                <div>Requests: ${data.requests}</div>
                <div>Est. Cost: $${data.estimatedCost.toFixed(4)}</div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${data.percentUsed}%"></div>
                </div>
            </div>
        `).join('')}
        <div class="stat-card">
            <div class="stat-title">Total Cost</div>
            <div class="stat-value">$${stats.totalCost.toFixed(4)}</div>
            <div>${stats.percentSaved}% saved with XendCode!</div>
        </div>
    </body>
    </html>
    `;
}

export function deactivate() {
    console.log('XendCode deactivated');
}
