import * as vscode from 'vscode';
import { ModelManager } from './core/ModelManager';
import { TokenManager } from './core/TokenManager';
import { ContextManager } from './core/ContextManager';
import { ModernSetupWizard } from './core/ModernSetupWizard';
import { ChatProvider } from './providers/ChatProvider';
import { UsageTreeProvider } from './providers/UsageTreeProvider';
import { ModelsTreeProvider } from './providers/ModelsTreeProvider';

let modelManager: ModelManager;
let tokenManager: TokenManager;
let contextManager: ContextManager;
let setupWizard: ModernSetupWizard;

export function activate(context: vscode.ExtensionContext) {
    console.log('XendCode is now active!');

    // Initialize core managers
    modelManager = new ModelManager(context);
    tokenManager = new TokenManager(context);
    contextManager = new ContextManager(tokenManager);
    setupWizard = new ModernSetupWizard(context, modelManager);

    // Register chat provider (right-side panel)
    const chatProvider = new ChatProvider(context, modelManager, contextManager, tokenManager);
    let chatPanel: vscode.WebviewPanel | undefined;

    // Check if this is first run and show setup wizard
    const hasSeenWelcome = context.globalState.get('hasSeenWelcome', false);
    if (!hasSeenWelcome) {
        context.globalState.update('hasSeenWelcome', true);
        setupWizard.launch();
    } else {
        // Auto-open chat on startup (like Cursor/Copilot)
        setTimeout(() => {
            vscode.commands.executeCommand('xendcode.chat');
        }, 1000);
    }

    // Register tree providers
    const usageTreeProvider = new UsageTreeProvider(tokenManager);
    const modelsTreeProvider = new ModelsTreeProvider(modelManager);
    
    vscode.window.registerTreeDataProvider('xendcode.usage', usageTreeProvider);
    vscode.window.registerTreeDataProvider('xendcode.models', modelsTreeProvider);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('xendcode.chat', () => {
            if (chatPanel) {
                chatPanel.reveal(vscode.ViewColumn.Two);
            } else {
                chatPanel = vscode.window.createWebviewPanel(
                    'xendcodeChat',
                    'XendCode Chat',
                    {
                        viewColumn: vscode.ViewColumn.Two,
                        preserveFocus: false
                    },
                    {
                        enableScripts: true,
                        retainContextWhenHidden: true,
                        localResourceRoots: [context.extensionUri]
                    }
                );

                chatPanel.webview.html = chatProvider.getChatHTML(chatPanel.webview);
                chatProvider.setupWebviewMessageHandling(chatPanel.webview);

                chatPanel.onDidDispose(() => {
                    chatPanel = undefined;
                });

                chatPanel.iconPath = {
                    light: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg'),
                    dark: vscode.Uri.joinPath(context.extensionUri, 'resources', 'icon.svg')
                };
            }
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
        })
    );

    // Refresh usage data periodically
    setInterval(() => {
        usageTreeProvider.refresh();
        modelsTreeProvider.refresh();
    }, 5000);

    vscode.window.showInformationMessage('XendCode: Budget-friendly AI assistant is ready!');
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
            <div class="stat-title">Total Savings vs Paid Plans</div>
            <div class="stat-value">$${stats.totalSavings.toFixed(2)}</div>
        </div>
    </body>
    </html>
    `;
}

export function deactivate() {
    console.log('XendCode deactivated');
}
