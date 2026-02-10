import * as vscode from 'vscode';
import { ModelManager } from '../core/ModelManager';
import { ContextManager } from '../core/ContextManager';
import { TokenManager } from '../core/TokenManager';
import { FirebaseService } from '../services/FirebaseService';
import { ChatMessage } from '../types';

export class ChatProvider {
    private panel?: vscode.WebviewPanel;
    private webview?: vscode.Webview;
    private chatHistory: ChatMessage[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private modelManager: ModelManager,
        private contextManager: ContextManager,
        private tokenManager: TokenManager,
        private firebaseService: FirebaseService
    ) {}

    /**
     * Open chat as editor panel on the right side
     */
    public openChatEditor() {
        // If panel already exists, just reveal it
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            return;
        }

        // Create new panel in editor area (right side)
        this.panel = vscode.window.createWebviewPanel(
            'xendcodeChat',
            'XendCode Chat',
            vscode.ViewColumn.Beside,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [this.context.extensionUri]
            }
        );

        this.webview = this.panel.webview;
        this.panel.webview.html = this.getHtmlContent(this.panel.webview);
        this.setupWebviewMessageHandling(this.panel.webview);

        // Handle panel disposal
        this.panel.onDidDispose(() => {
            this.panel = undefined;
            this.webview = undefined;
        });
    }

    setupWebviewMessageHandling(webview: vscode.Webview) {
        this.webview = webview;
        webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'chat':
                    await this.handleChat(message.text, message.references, message.images, message.preferredModel);
                    break;
                case 'getSelection':
                    // Send current selection to webview
                    const editor = vscode.window.activeTextEditor;
                    if (editor && !editor.selection.isEmpty) {
                        const selection = editor.selection;
                        const fileName = editor.document.fileName.split('/').pop() || 'unknown';
                        const startLine = selection.start.line + 1;
                        const endLine = selection.end.line + 1;
                        
                        this.sendMessageToWebview({
                            type: 'selectionInfo',
                            selection: {
                                fileName,
                                startLine,
                                endLine,
                                code: editor.document.getText(selection),
                                fullPath: editor.document.fileName
                            }
                        });
                    }
                    break;
                case 'getAvailableModels':
                    // Send available models to webview
                    const models = this.modelManager.getProviders().map(p => ({
                        name: p.getName(),
                        isFree: p.hasFreeTierAvailable()
                    }));
                    this.sendMessageToWebview({
                        type: 'availableModels',
                        models
                    });
                    break;
                case 'clear':
                    this.chatHistory = [];
                    this.sendMessageToWebview({ type: 'clear' });
                    break;
                case 'applyCode':
                    await this.handleApplyCode(message.code, message.filePath);
                    break;
            }
        });
    }

    /**
     * Apply code changes to a file
     */
    private async handleApplyCode(code: string, filePath?: string) {
        try {
            let editor = vscode.window.activeTextEditor;
            
            // If no active editor or wrong file, try to open the target file
            if (!editor || (filePath && editor.document.uri.fsPath !== filePath)) {
                if (filePath) {
                    console.log('Opening target file:', filePath);
                    try {
                        // Try to find if document is already open
                        const targetDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
                        if (targetDoc) {
                            console.log('Found open document, switching to it');
                            editor = await vscode.window.showTextDocument(targetDoc, {
                                viewColumn: vscode.ViewColumn.One,
                                preserveFocus: false,
                                preview: false
                            });
                        } else {
                            console.log('Opening new document');
                            const doc = await vscode.workspace.openTextDocument(filePath);
                            editor = await vscode.window.showTextDocument(doc, {
                                viewColumn: vscode.ViewColumn.One,
                                preserveFocus: false,
                                preview: false
                            });
                        }
                    } catch (openError: any) {
                        throw new Error(`Could not open file: ${filePath}. ${openError.message}`);
                    }
                } else {
                    throw new Error('No file open and no target file specified. Please select code in a file before asking for changes.');
                }
            }
            
            console.log('=== APPLY CODE DEBUG ===');
            console.log('Target file:', filePath);
            console.log('Active editor:', editor.document.uri.fsPath);
            console.log('Code length:', code.length);
            
            // Apply the code
            await this.replaceEditorContent(editor, code);

            this.sendMessageToWebview({
                type: 'codeApplied',
                message: '✓ Code applied successfully'
            });
            
            vscode.window.showInformationMessage('✓ Code applied successfully');
            
        } catch (error: any) {
            console.error('Apply code error:', error);
            
            this.sendMessageToWebview({
                type: 'error',
                text: error.message || 'Failed to apply code'
            });
            
            vscode.window.showErrorMessage(`Apply code failed: ${error.message}`);
        }
    }

    /**
     * Replace content in editor (smart section-based replacement)
     */
    private async replaceEditorContent(editor: vscode.TextEditor, newCode: string) {
        const edit = new vscode.WorkspaceEdit();
        const document = editor.document;
        
        // If there's an active selection, replace just that
        if (!editor.selection.isEmpty) {
            edit.replace(document.uri, editor.selection, newCode);
            await vscode.workspace.applyEdit(edit);
            return;
        }
        
        // Try to intelligently find the section to replace
        const currentContent = document.getText();
        const newCodeTrimmed = newCode.trim();
        
        // Extract function/method/class signature from new code - MORE FLEXIBLE
        const signatureMatch = newCodeTrimmed.match(
            /^.*?(class|function|const|let|var|private|public|protected|static|async)\s+[\w\s]*?(\w+)\s*[\(<]/m
        );
        
        if (signatureMatch) {
            const identifier = signatureMatch[2]; // The actual identifier
            
            console.log('Trying to find:', identifier); // Debug
            
            // Try to find the existing function/method in the file
            const range = this.findCodeSection(currentContent, identifier, document);
            
            if (range) {
                // Replace only the found section
                console.log('Found and replacing:', identifier, 'at lines', range.start.line, '-', range.end.line);
                edit.replace(document.uri, range, newCode);
                await vscode.workspace.applyEdit(edit);
                return;
            } else {
                console.log('Could not find:', identifier);
            }
        }
        
        // Fallback: Try to find similar code block by first significant line (ignore comments/whitespace)
        const newLines = newCodeTrimmed.split('\n');
        let firstSignificantLine = '';
        for (const line of newLines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
                firstSignificantLine = trimmed;
                break;
            }
        }
        
        if (firstSignificantLine.length > 5) {
            console.log('Trying to match first line:', firstSignificantLine);
            const lines = currentContent.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
                const lineContent = lines[i].trim();
                
                // Try exact match OR partial match (at least 70% similar)
                if (lineContent === firstSignificantLine || 
                    (lineContent.length > 10 && firstSignificantLine.includes(lineContent.substring(0, Math.floor(lineContent.length * 0.7))))) {
                    
                    console.log('Found matching line at:', i);
                    
                    // Found matching start - now find the end
                    const startLine = i;
                    let endLine = i;
                    let braceCount = 0;
                    let inFunction = false;
                    
                    for (let j = i; j < lines.length; j++) {
                        const line = lines[j];
                        
                        // Count braces to find block end
                        for (const char of line) {
                            if (char === '{') {
                                braceCount++;
                                inFunction = true;
                            } else if (char === '}') {
                                braceCount--;
                                if (inFunction && braceCount === 0) {
                                    endLine = j;
                                    break;
                                }
                            }
                        }
                        
                        if (inFunction && braceCount === 0) {
                            break;
                        }
                    }
                    
                    if (inFunction) {
                        console.log('Replacing lines', startLine, '-', endLine);
                        const range = new vscode.Range(
                            new vscode.Position(startLine, 0),
                            new vscode.Position(endLine, lines[endLine].length)
                        );
                        
                        edit.replace(document.uri, range, newCode);
                        await vscode.workspace.applyEdit(edit);
                        return;
                    }
                }
            }
        }
        
        // Last resort: If user has a selection, use it; otherwise ask what to do
        console.log('Could not auto-detect location. Checking for selection...');
        
        if (!editor.selection.isEmpty) {
            console.log('Using user selection');
            edit.replace(document.uri, editor.selection, newCode);
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage('✓ Code applied to selection');
        } else {
            // Show options to user
            const choice = await vscode.window.showQuickPick(
                [
                    { label: '$(add) Insert at cursor', value: 'insert' },
                    { label: '$(select-all) Replace entire file', value: 'replace' },
                    { label: '$(close) Cancel', value: 'cancel' }
                ],
                { 
                    placeHolder: 'Could not find exact location. How should I apply the code?',
                    title: 'Apply Code'
                }
            );
            
            if (choice?.value === 'insert') {
                edit.insert(document.uri, editor.selection.active, '\n' + newCode + '\n');
                await vscode.workspace.applyEdit(edit);
                vscode.window.showInformationMessage('✓ Code inserted at cursor');
            } else if (choice?.value === 'replace') {
                const fullRange = new vscode.Range(
                    new vscode.Position(0, 0),
                    new vscode.Position(document.lineCount, 0)
                );
                edit.replace(document.uri, fullRange, newCode);
                await vscode.workspace.applyEdit(edit);
                vscode.window.showWarningMessage('⚠️ Entire file replaced. Use Ctrl+Z to undo if needed.');
            } else {
                throw new Error('Code application cancelled');
            }
        }
    }
    
    /**
     * Find a code section (function/method/class) by identifier
     */
    private findCodeSection(content: string, identifier: string, document: vscode.TextDocument): vscode.Range | null {
        const lines = content.split('\n');
        
        // Look for function/method/class definition - MUCH more flexible patterns
        const patterns = [
            // Functions
            new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${identifier}\\s*\\(`),
            new RegExp(`^\\s*(export\\s+)?(const|let|var)\\s+${identifier}\\s*=`),
            
            // Classes
            new RegExp(`^\\s*(export\\s+)?class\\s+${identifier}\\s*`),
            
            // Methods with access modifiers (private, public, protected, static, etc.)
            new RegExp(`^\\s*(private|public|protected|static|async)\\s+(private|public|protected|static|async)?\\s*${identifier}\\s*\\(`),
            
            // Methods without modifiers
            new RegExp(`^\\s*${identifier}\\s*\\(`),
            
            // Arrow functions
            new RegExp(`^\\s*(const|let|var)\\s+${identifier}\\s*=\\s*\\(`),
            
            // Async methods
            new RegExp(`^\\s*async\\s+${identifier}\\s*\\(`)
        ];
        
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            
            // Check if this line matches any pattern
            const matched = patterns.some(pattern => pattern.test(line));
            
            if (matched) {
                // Found the start - now find the end by counting braces
                let braceCount = 0;
                let startLine = i;
                let endLine = i;
                let started = false;
                
                for (let j = i; j < lines.length; j++) {
                    const currentLine = lines[j];
                    
                    for (const char of currentLine) {
                        if (char === '{') {
                            braceCount++;
                            started = true;
                        } else if (char === '}') {
                            braceCount--;
                            if (started && braceCount === 0) {
                                endLine = j;
                                return new vscode.Range(
                                    new vscode.Position(startLine, 0),
                                    new vscode.Position(endLine, lines[endLine].length)
                                );
                            }
                        }
                    }
                }
                
                // If we found a match but couldn't find closing brace, return what we have
                if (started) {
                    return new vscode.Range(
                        new vscode.Position(startLine, 0),
                        new vscode.Position(lines.length - 1, lines[lines.length - 1].length)
                    );
                }
            }
        }
        
        return null;
    }

    getChatHTML(webview: vscode.Webview): string {
        this.webview = webview;
        return this.getHtmlContent(webview);
    }

    private async handleChat(userMessage: string, references?: any[], images?: any[], preferredModel?: string) {
        if (!userMessage.trim() && (!images || images.length === 0)) {
            return;
        }

        // Build context from all attached references
        let allReferencesContext = '';
        
        if (references && references.length > 0) {
            for (const ref of references) {
                const lineRange = ref.startLine === ref.endLine 
                    ? `Line ${ref.startLine}`
                    : `Lines ${ref.startLine}-${ref.endLine}`;
                
                allReferencesContext += `\n\n=== CODE REFERENCE: ${ref.fileName} (${lineRange}) ===\n\`\`\`\n${ref.code}\n\`\`\`\n`;
            }
        }

        // Prepare image context for display
        let imageContext = '';
        if (images && images.length > 0) {
            imageContext = `\n\n=== ATTACHED IMAGES ===\n${images.map(img => `- ${img.name}`).join('\n')}\n`;
        }

        // Parse @-mentions from message
        const { cleanMessage, referencedFiles } = await this.parseReferences(userMessage);

        // Add user message to history (with images if present)
        this.chatHistory.push({
            role: 'user',
            content: cleanMessage,
            images: images && images.length > 0 ? images : undefined
        });

        // Show user message in UI with all references and images
        this.sendMessageToWebview({
            type: 'userMessage',
            text: cleanMessage,
            references: references,
            images: images && images.length > 0 ? images : undefined
        });

        // Show thinking indicator
        this.sendMessageToWebview({ type: 'thinking' });

        try {
            // Determine task type
            const taskType = this.determineTaskType(cleanMessage);

            // Build context (includes active file, selection, etc.)
            const tokenBudget = 8000;
            const { context, tokensUsed, summary } = await this.contextManager.buildContext(
                cleanMessage,
                tokenBudget
            );

            // Add referenced files to context
            let fileContext = '';
            for (const filePath of referencedFiles) {
                try {
                    const uri = vscode.Uri.file(filePath);
                    const content = await vscode.workspace.fs.readFile(uri);
                    const text = Buffer.from(content).toString('utf8');
                    const fileName = filePath.split('/').pop();
                    fileContext += `\n\n=== File: ${fileName} ===\n\`\`\`\n${text.slice(0, 3000)}\n\`\`\``;
                } catch (error) {
                    fileContext += `\n\n[Could not read file: ${filePath}]`;
                }
            }

            const fullContext = allReferencesContext + context + fileContext;
            
            // Add image context as text description
            const contextWithImages = fullContext + (images && images.length > 0 
                ? `\n\n=== USER PROVIDED IMAGES ===\nThe user has attached ${images.length} image(s). Please analyze them and respond to their question about the images.\n`
                : '');

            // Select model (use preferred if provided, otherwise auto-select)
            let model;
            
            if (preferredModel) {
                console.log('User selected model:', preferredModel);
                console.log('Available providers:', Array.from(this.modelManager.getProviders().map(p => p.getName())));
                
                // User manually selected a model
                model = this.modelManager.getProvider(preferredModel);
                
                if (!model) {
                    const availableNames = this.modelManager.getProviders().map(p => p.getName()).join(', ');
                    const errorMsg = `Model "${preferredModel}" not available. Available models: ${availableNames}`;
                    console.error(errorMsg);
                    
                    this.sendMessageToWebview({
                        type: 'error',
                        text: errorMsg
                    });
                    
                    throw new Error(errorMsg);
                }
                
                console.log('Using manually selected model:', model.getName());
            } else {
                // Auto-select best model
                const config = vscode.workspace.getConfiguration('xendcode');
                const preferFree = config.get('routing.preferFreeTier', true);
                
                model = await this.modelManager.selectModel(
                    taskType,
                    tokensUsed,
                    preferFree
                );

                if (!model) {
                    throw new Error('No available model found. Please configure API keys.');
                }
                
                console.log('Auto-selected model:', model.getName());
            }

            // Get available models info for the AI to reference
            const availableModels = this.getAvailableModelsInfo();

            // Check for org playbook
            const orgConfig = vscode.workspace.getConfiguration('xendcode');
            const orgId = orgConfig.get('org.id', '');
            let orgPlaybookPrompt = '';
            
            if (orgId && this.firebaseService.isLoggedIn()) {
                try {
                    const playbookPrompt = await this.firebaseService.getActivePlaybookPrompt(orgId);
                    if (playbookPrompt) {
                        orgPlaybookPrompt = `\n\n## ORGANIZATION PLAYBOOK\n${playbookPrompt}\n`;
                    }
                } catch (error) {
                    console.error('Failed to load org playbook:', error);
                }
            }

            // Agent-mode system prompt (inspired by Cursor's advanced prompt architecture)
            const systemPrompt = fullContext 
                ? `You are an AI coding agent in VS Code with AUTOMATIC CODE APPLICATION.

## PRIMARY TASK: IDENTIFY USER INTENT CORRECTLY

CRITICAL: Distinguish between EXPLANATION vs CODE CHANGE requests!

**EXPLANATION MODE** (User wants to UNDERSTAND - NO code blocks):
Keywords: "why", "what", "how", "explain", "tell me", "what does X do", "why is X needed", "how does X work"
Response: Explain in text, use inline code like \`method()\`, NO complete functions, NO apply button

Example:
Q: "why is this method needed?"
A: "The \`initializeProviders()\` method sets up AI service connections at startup. It reads API keys from settings and creates provider instances (OpenAI, Gemini, etc.). Without it, no models would be available."

**CODE CHANGE MODE** (User wants to MODIFY - Show complete code):
Keywords: "fix", "add", "update", "change", "improve", "create", "implement"
Response: Provide ONE complete code block, full function implementation, apply button shows

Example:
Q: "add error handling"
A: "Added try-catch: \`\`\`typescript\nfunction example() { try { ... } catch { ... } }\n\`\`\`"

**IF UNCLEAR:** Ask "Would you like me to: 1. Explain how this works, OR 2. Make changes to it?"

## AGENT BEHAVIOR
- Be THOROUGH: Gather full context before making changes
- Be AUTONOMOUS: Make decisions and provide complete, working code
- Be PRECISE: Reference specific line numbers and file paths
- TRACE symbols back to their definitions to fully understand them
- Provide COMPLETE code changes that can be directly copied and applied
- Show the ENTIRE updated section, not just fragments

## CODE CONTEXT
${fullContext}

## AVAILABLE AI MODELS IN THIS PROJECT
${availableModels}
${orgPlaybookPrompt}
## RESPONSE RULES

### CRITICAL: Code vs Explanation Distinction
**WHEN USER ASKS TO EXPLAIN/UNDERSTAND CODE:**
- DO NOT provide code blocks with modifications
- Use inline code snippets or existing code for reference only
- Focus response on EXPLAINING what the code does, not changing it
- Keywords: "explain", "what does", "how does", "show me", "tell me about"
- Example: User says "explain this method" → Give explanation with references, NO apply button

**WHEN USER ASKS TO CHANGE/FIX/ADD CODE:**
- PROVIDE complete, working code blocks that can be applied
- Show the FULL function/method/class that should replace the existing code
- Start with the complete signature (export, class name, method name, etc.)
- Keywords: "fix", "add", "update", "modify", "change", "refactor", "improve", "create"
- Example: User says "add error handling" → Give complete updated code, show apply button

### Code Output Rules
1. For CODE CHANGES: Provide ONE main code block with COMPLETE, working implementation
2. For EXPLANATIONS: Use inline code or references, focus on description
3. Always include full function signatures when providing code to apply
4. Keep explanations brief but accurate
5. Reference line numbers when discussing specific code locations

### Model Name Rules
6. When suggesting model names, ONLY use real models from the "AVAILABLE AI MODELS" section above
7. NEVER make up placeholder model names like "new-model-1" or "model-x"
8. If asked about models not listed above, search the web FIRST to get real, up-to-date model names
9. For informative questions about AI models/APIs/tech, ALWAYS use web search for current information

### Response Format
- Explanation requests: [Brief answer] + [Code references if needed] + [No apply button]
- Code change requests: [What you're changing] + [Complete code block] + [Apply button shown]

## CODE OUTPUT FORMAT

### For CODE CHANGES (Apply button will show):
When user asks to CHANGE/FIX/ADD/MODIFY code, you MUST:
1. Show the COMPLETE function/method/class with its signature
2. Start with the function/method declaration (including 'export', 'async', 'private', etc.)
3. Include ALL the code from opening brace to closing brace
4. Format as a complete, executable code block:

\`\`\`typescript
export class YourClass {
    private yourMethod(params: Type): ReturnType {
        // Complete implementation with ALL changes
    }
}
\`\`\`

OR for standalone functions:

\`\`\`typescript
export function yourFunction(params: Type): ReturnType {
    // Complete implementation
}
\`\`\`

The code will automatically replace the matching function/method in the file. Include the FULL signature for accurate matching.

### For EXPLANATIONS (NO apply button):
When user asks to EXPLAIN/UNDERSTAND code:
- Use inline code like \`methodName()\` or small snippets for reference
- Focus on describing what the code does, how it works, and why
- Do NOT wrap entire functions in code blocks unless showing for reference only
- Example format:
  "This method \`initializeProviders()\` does the following:
  1. Gets the VS Code configuration
  2. Creates instances of each provider
  3. Filters out unconfigured providers
  
  The key logic is the filtering step which checks \`provider.isConfigured()\` to ensure the API key exists."

### Strict Rules:
- EXPLANATION request = NO complete code blocks = NO apply button
- CODE CHANGE request = Complete code blocks = Apply button shows
- When in doubt, ASK the user: "Would you like me to explain this or make changes?"

## QUALITY STANDARDS  
- Add all necessary imports and dependencies
- Ensure code runs immediately without errors
- Use modern best practices and patterns
- Fix any linter errors you introduce`
                : `You are an autonomous AI coding agent in VS Code. Respond concisely with direct, actionable solutions.

## YOUR CORE BEHAVIOR
You are integrated into a VS Code extension with AUTOMATIC CODE APPLICATION:
- User asks to CHANGE/FIX/ADD code → Provide complete code blocks (apply button shows)
- User asks to EXPLAIN/UNDERSTAND code → Provide explanations only (NO apply button)
- BE STRICT about this distinction - don't provide complete code blocks for explanation requests

## AVAILABLE AI MODELS IN THIS PROJECT
${availableModels}

## CRITICAL RULES:
1. EXPLANATION requests ("explain", "what does", "how") → NO complete code blocks, focus on description
2. CODE CHANGE requests ("fix", "add", "modify", "update") → Complete, working code blocks
3. When suggesting model names, ONLY use real models from the list above
4. NEVER invent placeholder names like "new-model-1" or "model-x"
5. For informative questions about models/APIs/tech, use web search for current information
6. If unsure about context, state what information you need
7. When in doubt about explain vs change, ASK the user to clarify`;

            // Prepare messages with context
            const messages: ChatMessage[] = [
                {
                    role: 'system',
                    content: systemPrompt
                },
                ...this.chatHistory.slice(-5) // Keep last 5 messages for context
            ];

            // Get completion with STREAMING
            let fullResponse = '';
            
            // Start streaming message in UI
            this.sendMessageToWebview({
                type: 'streamStart',
                model: model.getName()
            });

            const response = await (model.completeStream ? 
                model.completeStream(messages, undefined, (chunk: string) => {
                    fullResponse += chunk;
                    // Send each chunk to webview immediately
                    this.sendMessageToWebview({
                        type: 'streamChunk',
                        chunk: chunk
                    });
                }) :
                model.complete(messages)  // Fallback to non-streaming
            );

            // Ensure we have the full content
            if (model.completeStream) {
                response.content = fullResponse;
            }

            // Record usage
            await this.tokenManager.recordUsage(
                model.getName(),
                response.tokensUsed.input,
                response.tokensUsed.output,
                response.cost
            );

            // Add assistant message to history
            this.chatHistory.push({
                role: 'assistant',
                content: response.content
            });

            // Auto-save to Firebase if logged in (async, don't block UI)
            if (this.firebaseService.isLoggedIn()) {
                this.firebaseService.saveChatHistory(this.chatHistory).catch(err => {
                    console.error('Failed to sync chat history:', err);
                });
            }

            // Calculate token savings vs naive approach
            const naiveTokens = (fullContext.length / 4) + (userMessage.length / 4);
            const actualTokens = response.tokensUsed.total;
            const tokenSavings = Math.max(0, Math.round(naiveTokens - actualTokens));
            const savingsPercent = naiveTokens > 0 ? Math.round((tokenSavings / naiveTokens) * 100) : 0;

            // Extract code blocks from response for potential application
            // Only show apply button for tasks that involve code changes, NOT explanations
            const isCodeChangeTask = ['code-refactoring', 'bug-fixing', 'code-completion'].includes(taskType);
            
            // Also check if the response text indicates it's providing changes
            const responseText = response.content.toLowerCase();
            const responseLines = response.content.split('\n');
            const firstFewLines = responseLines.slice(0, 5).join(' ').toLowerCase();
            
            // Change keywords in response
            const hasChangeKeywords = responseText.includes('updated code') || 
                                     responseText.includes('modified code') || 
                                     responseText.includes('changed to') ||
                                     responseText.includes('refactored') ||
                                     responseText.includes('fixed the') ||
                                     responseText.includes('added') ||
                                     responseText.includes('here\'s the updated') ||
                                     responseText.includes('here\'s the fixed') ||
                                     responseText.includes('replace with');
            
            // Explanation keywords (stronger detection)
            const hasExplanationKeywords = firstFewLines.includes('this code') || 
                                          firstFewLines.includes('this method') ||
                                          firstFewLines.includes('this function') ||
                                          firstFewLines.includes('what this') ||
                                          firstFewLines.includes('explains') ||
                                          firstFewLines.includes('does the following') ||
                                          firstFewLines.includes('let me explain') ||
                                          firstFewLines.includes('here\'s what') ||
                                          firstFewLines.includes('understanding') ||
                                          firstFewLines.includes('breakdown') ||
                                          responseText.startsWith('this ') ||
                                          responseText.startsWith('the ');
            
            const codeBlocks = this.extractCodeBlocks(response.content);
            
            // STRICT: If task is explicitly explanation or documentation, NEVER show apply button
            const isExplanationTask = taskType === 'code-explanation' || taskType === 'documentation';
            
            // Show apply button ONLY if:
            // 1. NOT an explanation/documentation task
            // 2. It's a code change task OR response indicates changes
            // 3. Has code blocks
            // 4. Has reference context
            // 5. Response does NOT contain explanation keywords
            const firstReference = references && references.length > 0 ? references[0] : null;
            const hasApplicableCode = !isExplanationTask &&
                                     codeBlocks.length > 0 && 
                                     firstReference && 
                                     (isCodeChangeTask || hasChangeKeywords) &&
                                     !hasExplanationKeywords;

            // Send response to UI with savings info
            this.sendMessageToWebview({
                type: 'assistantMessage',
                text: response.content,
                model: model.getName(),
                tokens: response.tokensUsed.total,
                cost: response.cost,
                contextSummary: summary,
                tokenSavings: tokenSavings > 0 ? `Saved ${tokenSavings} tokens (${savingsPercent}% reduction)` : null,
                codeBlocks: hasApplicableCode ? codeBlocks : undefined,
                targetFile: firstReference?.fullPath,
                isExplanation: isExplanationTask
            });

        } catch (error: any) {
            this.sendMessageToWebview({
                type: 'error',
                text: error.message
            });
        }
    }

    /**
     * Parse @-mentions and file references from user message
     */
    private async parseReferences(message: string): Promise<{ cleanMessage: string; referencedFiles: string[] }> {
        const referencedFiles: string[] = [];
        
        // Match @filename or @path/to/file patterns
        const mentionRegex = /@([\w\-./]+\.\w+)/g;
        const mentions = [...message.matchAll(mentionRegex)];
        
        for (const match of mentions) {
            const filePath = match[1];
            
            // Try to find the file in workspace
            const files = await vscode.workspace.findFiles(`**/${filePath}`, '**/node_modules/**', 1);
            
            if (files.length > 0) {
                referencedFiles.push(files[0].fsPath);
            } else {
                // Try as absolute or relative path
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, filePath).fsPath;
                    referencedFiles.push(fullPath);
                }
            }
        }
        
        // Clean message by removing @mentions (keep them visible but they're processed)
        const cleanMessage = message; // Keep @mentions visible in the message
        
        return { cleanMessage, referencedFiles };
    }

    async handleExplainCode(code: string) {
        const message = `Please explain this code:\n\n\`\`\`\n${code}\n\`\`\``;
        await this.handleChat(message);
        vscode.commands.executeCommand('xendcode.chat.focus');
    }

    async handleRefactorCode(code: string) {
        const message = `Please refactor this code to improve its quality:\n\n\`\`\`\n${code}\n\`\`\``;
        await this.handleChat(message);
        vscode.commands.executeCommand('xendcode.chat.focus');
    }

    async handleFixCode(code: string) {
        const message = `Please fix any issues in this code:\n\n\`\`\`\n${code}\n\`\`\``;
        await this.handleChat(message);
        vscode.commands.executeCommand('xendcode.chat.focus');
    }

    private determineTaskType(message: string): any {
        const lower = message.toLowerCase();
        
        // Explanation/informational (no code changes)
        if (lower.includes('explain') || 
            lower.includes('what does') || 
            lower.includes('how does') ||
            lower.includes('what is') ||
            lower.includes('show me') ||
            lower.includes('tell me about')) {
            return 'code-explanation';
        }
        
        // Documentation (no code changes)
        if (lower.includes('document') || lower.includes('comment')) {
            return 'documentation';
        }
        
        // Code changes
        if (lower.includes('refactor') || 
            lower.includes('improve') || 
            lower.includes('optimize') ||
            lower.includes('rewrite')) {
            return 'code-refactoring';
        }
        
        if (lower.includes('fix') || 
            lower.includes('bug') || 
            lower.includes('error') ||
            lower.includes('debug')) {
            return 'bug-fixing';
        }
        
        if (lower.includes('add') || 
            lower.includes('create') ||
            lower.includes('implement') ||
            lower.includes('complete') || 
            lower.includes('finish') ||
            lower.includes('update') ||
            lower.includes('change') ||
            lower.includes('modify')) {
            return 'code-completion';
        }
        
        return 'general-chat';
    }

    /**
     * Extract code blocks from AI response
     */
    private extractCodeBlocks(content: string): Array<{code: string, language: string}> {
        const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
        const blocks: Array<{code: string, language: string}> = [];
        let match;

        while ((match = codeBlockRegex.exec(content)) !== null) {
            blocks.push({
                language: match[1] || 'typescript',
                code: match[2].trim()
            });
        }

        return blocks;
    }

    /**
     * Get information about available models for AI context
     */
    private getAvailableModelsInfo(): string {
        return `This project supports the following AI model providers and models:

**OpenAI Models:**
- gpt-3.5-turbo (fast, cheap, general purpose)
- gpt-4 (advanced reasoning)
- gpt-4-turbo (faster GPT-4)

**Anthropic Claude Models:**
- claude-3-haiku (fast, cheap)
- claude-3-sonnet (balanced)
- claude-3.5-sonnet (advanced)
- claude-3-opus (most capable)

**Google Gemini Models:**
- gemini-1.5-flash (fast, free tier)
- gemini-2.5-flash (latest fast model, free)
- gemini-2.5-flash-lite (ultra-fast)
- gemini-pro (balanced)
- gemini-1.5-pro (advanced)
- gemini-2.5-pro (latest advanced, free)
- gemini-3-flash-preview (preview)
- gemini-3-pro-preview (preview)

**grok Models (Free, Fast Inference):**
- llama-3.3-70b (Llama 3.3 70B)
- llama-3.3-70b-versatile (versatile variant)

**DeepSeek Models (Cheap, Code-Specialized):**
- deepseek-coder (excellent for code tasks)

**Cohere Models:**
- command-a-03-2025 (cohere-command-a)
- command-r-plus (advanced)
- cohere-command (general)

When suggesting models, use these EXACT names. Never invent placeholder names.`;
    }

    private sendMessageToWebview(message: any) {
        // Send to webview
        if (this.webview) {
            this.webview.postMessage(message);
        }
    }

    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>XendCode Chat</title>
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
            height: 100vh;
            display: flex;
            flex-direction: column;
        }
        
        #chat-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
        }
        
        .message {
            margin-bottom: 16px;
            padding: 12px 16px;
            border-radius: 6px;
            width: 100%;
        }
        
        .user-message {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-panel-border);
        }
        
        .assistant-message {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
        }
        
        .message-header {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
        }
        
        .message-content {
            line-height: 1.6;
        }
        
        .code-block-wrapper {
            position: relative;
            margin: 12px 0;
        }

        .code-block-wrapper:hover .code-apply-btn {
            opacity: 1;
        }

        .code-apply-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 12px;
            font-weight: 500;
            cursor: pointer;
            opacity: 0;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            gap: 6px;
            z-index: 10;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
        }

        .code-apply-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .code-apply-btn:active {
            transform: translateY(0);
        }

        .code-apply-btn svg {
            flex-shrink: 0;
        }
        
        .code-apply-btn:disabled {
            opacity: 1 !important;
            cursor: not-allowed;
        }
        
        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }
        
        .message-selection {
            margin-bottom: 12px;
            background: var(--vscode-textCodeBlock-background);
            border: 1px solid var(--vscode-panel-border);
            padding: 8px;
            border-radius: 4px;
        }
        
        .selection-header {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 4px;
            font-weight: 600;
        }
        
        .selection-code {
            background: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 4px;
            font-size: 12px;
            font-family: var(--vscode-editor-font-family);
            overflow-x: auto;
            margin: 0;
        }
        
        .message-references {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            padding: 4px 8px;
            background: var(--vscode-badge-background);
            border-radius: 3px;
            display: inline-block;
        }
        
        .message-context {
            font-size: 10px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            font-style: italic;
        }
        
        .thinking {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 12px;
        }
        
        .error {
            color: var(--vscode-errorForeground);
            padding: 12px;
            background: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
            margin: 8px;
        }
        
        #input-container {
            padding: 16px;
            border-top: 1px solid var(--vscode-panel-border);
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        /* Headless UI inspired model selector */
        .model-selector-wrapper {
            position: relative;
            padding: 0;
        }

        .model-selector-button {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 10px 12px;
            border-radius: 6px;
            font-size: 13px;
            cursor: pointer;
            outline: none;
            transition: all 0.15s;
        }

        .model-selector-button:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .model-selector-button:focus {
            outline: 2px solid var(--vscode-focusBorder);
            outline-offset: -2px;
        }

        .model-selector-button-text {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .model-selector-icon {
            font-size: 16px;
        }

        .model-selector-chevron {
            font-size: 12px;
            opacity: 0.5;
        }

        .model-selector-dropdown {
            position: absolute;
            top: calc(100% + 4px);
            left: 0;
            right: 0;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
            max-height: 280px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            padding: 4px;
        }

        .model-selector-dropdown.open {
            display: block;
            animation: dropdownFadeIn 0.15s ease-out;
        }

        @keyframes dropdownFadeIn {
            from {
                opacity: 0;
                transform: translateY(-4px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .model-option {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 4px;
            transition: all 0.1s;
        }

        .model-option:hover {
            background: var(--vscode-list-hoverBackground);
        }

        .model-option.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }

        .model-option-content {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .model-option-icon {
            font-size: 16px;
        }

        .model-option-name {
            font-weight: 500;
        }

        .model-option-badge {
            font-size: 10px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 2px 6px;
            border-radius: 10px;
            margin-left: 6px;
        }

        .model-option-check {
            font-size: 16px;
            color: var(--vscode-list-activeSelectionForeground);
        }
        
        .selection-indicator {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--vscode-inputOption-activeBackground);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 6px 10px;
            font-size: 12px;
            color: var(--vscode-foreground);
            margin-bottom: 4px;
        }
        
        .indicator-text {
            font-family: var(--vscode-editor-font-family);
            flex: 1;
        }
        
        .indicator-close {
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 18px;
            padding: 0 4px;
            margin-left: 8px;
            width: auto;
            height: auto;
        }
        
        .indicator-close:hover {
            color: var(--vscode-foreground);
            background: transparent;
        }
        
        .input-row {
            display: flex;
            gap: 8px;
        }
        
        .input-row {
            display: flex;
            gap: 8px;
            width: 100%;
        }
        
        /* Headless UI inspired input area */
        .input-form {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
            transition: all 0.15s;
        }

        .input-form:focus-within {
            outline: 2px solid var(--vscode-focusBorder);
            outline-offset: -2px;
        }

        .input-form.drag-over {
            outline: 2px dashed var(--vscode-focusBorder);
            background: var(--vscode-list-hoverBackground);
        }

        .references-container {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .reference-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-family: var(--vscode-editor-font-family);
        }

        .reference-badge-icon {
            font-size: 12px;
        }

        .reference-badge-remove {
            background: transparent;
            border: none;
            color: var(--vscode-badge-foreground);
            cursor: pointer;
            padding: 0;
            font-size: 14px;
            line-height: 1;
            opacity: 0.7;
            margin-left: 2px;
        }

        .reference-badge-remove:hover {
            opacity: 1;
        }

        .image-preview {
            max-width: 100%;
            max-height: 200px;
            border-radius: 4px;
            margin: 8px 0;
            border: 1px solid var(--vscode-panel-border);
        }

        #message-input {
            width: 100%;
            background: transparent;
            color: var(--vscode-input-foreground);
            border: none;
            padding: 12px 16px;
            font-family: inherit;
            font-size: 13px;
            resize: none;
            min-height: 100px;
            max-height: 400px;
            overflow-y: auto;
            outline: none;
        }

        #message-input::placeholder {
            color: var(--vscode-input-placeholderForeground);
            opacity: 0.6;
        }

        .input-toolbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 8px 12px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .input-toolbar-left {
            display: flex;
            gap: 8px;
        }

        .toolbar-button {
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s;
        }

        .toolbar-button:hover {
            background: var(--vscode-list-hoverBackground);
            color: var(--vscode-foreground);
        }
        
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            font-size: 13px;
        }
        
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        
        .send-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
            display: flex;
            align-items: center;
            gap: 6px;
            transition: all 0.15s;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
        }
        
        .send-btn:hover {
            background: var(--vscode-button-hoverBackground);
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }
        
        .send-btn:active {
            transform: scale(0.98);
        }

        .send-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        
        code {
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
        
        pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 12px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
        }
        
        .apply-code-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: 1px solid var(--vscode-button-border);
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 500;
            transition: all 0.2s;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        
        .apply-code-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: translateY(-1px);
            box-shadow: 0 2px 6px rgba(0,0,0,0.15);
        }
        
        .apply-code-btn:active {
            transform: translateY(0);
            box-shadow: 0 1px 2px rgba(0,0,0,0.1);
        }
        
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        
        .message {
            animation: fadeIn 0.2s ease-out;
        }
    </style>
</head>
<body>
    <div id="chat-container">
        <div style="padding: 12px; color: var(--vscode-descriptionForeground); font-size: 12px;">
            XendCode Chat initialized. Type a message and press Enter.
        </div>
    </div>
    <div id="input-container">
        <!-- Model Selector (Headless UI style) -->
        <div class="model-selector-wrapper">
            <button id="model-selector-button" class="model-selector-button" onclick="toggleModelDropdown()">
                <span class="model-selector-button-text">
                    <span class="model-selector-icon" id="selected-model-icon">🤖</span>
                    <span id="selected-model-name">Auto (Smart Routing)</span>
                </span>
                <span class="model-selector-chevron">▼</span>
            </button>
            <div id="model-dropdown" class="model-selector-dropdown">
                <!-- Options populated by JS -->
            </div>
        </div>

        <!-- Selection indicator will be inserted here dynamically -->
        
        <!-- Chat Input (Headless UI style with drag-drop) -->
        <div id="input-form" class="input-form">
            <!-- Hidden file input for images -->
            <input type="file" id="file-input" accept="image/*" multiple style="display: none;" />
            
            <!-- References badges -->
            <div id="references-container" class="references-container" style="display: none;"></div>
            
            <textarea id="message-input" placeholder="Ask me anything... (Drag & drop images here)"></textarea>
            
            <div class="input-toolbar">
                <div class="input-toolbar-left">
                    <button type="button" class="toolbar-button" onclick="attachContext()" title="Attach code selection">
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a3 3 0 004.241 4.243h.001l.497-.5a.75.75 0 011.064 1.057l-.498.501-.002.002a4.5 4.5 0 01-6.364-6.364l7-7a4.5 4.5 0 016.368 6.36l-3.455 3.553A2.625 2.625 0 119.52 9.52l3.45-3.451a.75.75 0 111.061 1.06l-3.45 3.451a1.125 1.125 0 001.587 1.595l3.454-3.553a3 3 0 000-4.242z" clip-rule="evenodd" />
                        </svg>
                        <span>Code</span>
                    </button>
                    <button type="button" class="toolbar-button" onclick="attachImage()" title="Attach image">
                        <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M1 5.25A2.25 2.25 0 013.25 3h13.5A2.25 2.25 0 0119 5.25v9.5A2.25 2.25 0 0116.75 17H3.25A2.25 2.25 0 011 14.75v-9.5zm1.5 5.81v3.69c0 .414.336.75.75.75h13.5a.75.75 0 00.75-.75v-2.69l-2.22-2.219a.75.75 0 00-1.06 0l-3.97 3.97-1.47-1.47a.75.75 0 00-1.06 0l-3.22 3.22zm5.25-5.56a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" clip-rule="evenodd" />
                        </svg>
                        <span>Image</span>
                    </button>
                </div>
                
                <button class="send-btn" onclick="sendMessage()" title="Send message (Enter)">
                    <span>Send</span>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M1 8l14-6-4 12-4-6-6 0z"/>
                    </svg>
                </button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const chatContainer = document.getElementById('chat-container');
        const messageInput = document.getElementById('message-input');
        const modelDropdown = document.getElementById('model-dropdown');
        const modelButton = document.getElementById('model-selector-button');
        const inputForm = document.getElementById('input-form');
        const referencesContainer = document.getElementById('references-container');
        const fileInput = document.getElementById('file-input');
        let currentSelection = null;
        let availableModels = [];
        let selectedModel = { value: 'auto', name: 'Auto (Smart Routing)', icon: '🤖' };
        let attachedReferences = []; // Multiple references support
        let attachedImages = []; // Image attachments

        // Enter key handler - MUST WORK
        messageInput.onkeydown = function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
                return false;
            }
        };

        // Focus handler
        messageInput.onfocus = function() {
            vscode.postMessage({ type: 'getSelection' });
        };

        // Load handler
        setTimeout(function() {
            vscode.postMessage({ type: 'getSelection' });
            vscode.postMessage({ type: 'getAvailableModels' });
        }, 100);

        // Send message function
        function sendMessage() {
            const text = messageInput.value.trim();
            if (text || attachedImages.length > 0) {
                vscode.postMessage({ 
                    type: 'chat', 
                    text: text,
                    references: attachedReferences,
                    images: attachedImages,
                    preferredModel: selectedModel.value === 'auto' ? null : selectedModel.value
                });
                messageInput.value = '';
                attachedReferences = [];
                attachedImages = [];
                currentSelection = null;
                updateReferences();
                updateSelectionIndicator();
            }
        }
        window.sendMessage = sendMessage;

        // Selection indicator
        function updateSelectionIndicator() {
            const existing = document.getElementById('selection-indicator');
            if (existing) existing.remove();

            if (currentSelection) {
                const indicator = document.createElement('div');
                indicator.id = 'selection-indicator';
                indicator.className = 'selection-indicator';
                
                const lineRange = currentSelection.startLine === currentSelection.endLine 
                    ? ':' + currentSelection.startLine
                    : ':' + currentSelection.startLine + '-' + currentSelection.endLine;
                
                // Safe DOM manipulation instead of innerHTML
                const textSpan = document.createElement('span');
                textSpan.className = 'indicator-text';
                textSpan.textContent = '📎 @' + currentSelection.fileName + lineRange;
                
                const closeBtn = document.createElement('button');
                closeBtn.className = 'indicator-close';
                closeBtn.title = 'Remove';
                closeBtn.textContent = '×';
                closeBtn.onclick = clearSelection;
                
                indicator.appendChild(textSpan);
                indicator.appendChild(closeBtn);
                
                const inputContainer = document.getElementById('input-container');
                inputContainer.insertBefore(indicator, inputContainer.firstChild);
            }
        }

        function clearSelection() {
            currentSelection = null;
            updateSelectionIndicator();
        }
        window.clearSelection = clearSelection;

        function toggleModelDropdown() {
            modelDropdown.classList.toggle('open');
        }
        window.toggleModelDropdown = toggleModelDropdown;

        function closeModelDropdown() {
            modelDropdown.classList.remove('open');
        }

        function selectModel(model) {
            selectedModel = model;
            document.getElementById('selected-model-name').textContent = model.name;
            document.getElementById('selected-model-icon').textContent = model.icon;
            closeModelDropdown();
        }
        window.selectModel = selectModel;

        // Close dropdown when clicking outside
        document.addEventListener('click', function(e) {
            if (!modelButton.contains(e.target) && !modelDropdown.contains(e.target)) {
                closeModelDropdown();
            }
        });

        function updateModelSelector() {
            // Clear dropdown
            modelDropdown.innerHTML = '';
            
            // Add "Auto" option
            const autoOption = createModelOption({
                value: 'auto',
                name: 'Auto (Smart Routing)',
                icon: '🤖',
                isFree: true
            }, true);
            modelDropdown.appendChild(autoOption);
            
            // Add available models
            availableModels.forEach(function(model) {
                // Add icon based on provider
                let icon = '🤖';
                if (model.name.includes('Gemini')) icon = '✨';
                else if (model.name.includes('GPT')) icon = '🧠';
                else if (model.name.includes('Claude')) icon = '🎭';
                else if (model.name.includes('Llama')) icon = '🦙';
                else if (model.name.includes('DeepSeek')) icon = '🔍';
                else if (model.name.includes('Cohere')) icon = '💬';
                
                const option = createModelOption({
                    value: model.name,
                    name: model.name,
                    icon: icon,
                    isFree: model.isFree
                }, false);
                
                modelDropdown.appendChild(option);
            });
        }

        function createModelOption(model, isSelected) {
            const div = document.createElement('div');
            div.className = 'model-option' + (isSelected ? ' selected' : '');
            div.onclick = function() { selectModel(model); };
            
            const content = document.createElement('div');
            content.className = 'model-option-content';
            
            const icon = document.createElement('span');
            icon.className = 'model-option-icon';
            icon.textContent = model.icon;
            
            const name = document.createElement('span');
            name.className = 'model-option-name';
            name.textContent = model.name;
            
            content.appendChild(icon);
            content.appendChild(name);
            
            if (model.isFree) {
                const badge = document.createElement('span');
                badge.className = 'model-option-badge';
                badge.textContent = 'FREE';
                content.appendChild(badge);
            }
            
            div.appendChild(content);
            
            if (isSelected) {
                const check = document.createElement('span');
                check.className = 'model-option-check';
                check.textContent = '✓';
                div.appendChild(check);
            }
            
            return div;
        }

        function attachContext() {
            vscode.postMessage({ type: 'getSelection' });
        }
        window.attachContext = attachContext;

        function attachImage() {
            fileInput.click();
        }
        window.attachImage = attachImage;

        // Handle file input change
        fileInput.addEventListener('change', function(e) {
            const files = e.target.files;
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    if (file.type.startsWith('image/')) {
                        const reader = new FileReader();
                        reader.onload = function(event) {
                            attachedImages.push({
                                name: file.name,
                                type: file.type,
                                data: event.target.result
                            });
                            updateReferences();
                        };
                        reader.readAsDataURL(file);
                    }
                }
            }
            // Reset input so same file can be selected again
            fileInput.value = '';
        });

        function updateReferences() {
            if (attachedReferences.length === 0 && attachedImages.length === 0) {
                referencesContainer.style.display = 'none';
                return;
            }

            referencesContainer.style.display = 'flex';
            referencesContainer.innerHTML = '';

            // Show code references
            attachedReferences.forEach(function(ref, index) {
                const badge = document.createElement('div');
                badge.className = 'reference-badge';

                const icon = document.createElement('span');
                icon.className = 'reference-badge-icon';
                icon.textContent = '📎';

                const text = document.createElement('span');
                const lineRange = ref.startLine === ref.endLine 
                    ? ':' + ref.startLine 
                    : ':' + ref.startLine + '-' + ref.endLine;
                text.textContent = ref.fileName + lineRange;

                const remove = document.createElement('button');
                remove.className = 'reference-badge-remove';
                remove.textContent = '×';
                remove.onclick = function() { removeReference(index); };

                badge.appendChild(icon);
                badge.appendChild(text);
                badge.appendChild(remove);
                referencesContainer.appendChild(badge);
            });

            // Show image references
            attachedImages.forEach(function(img, index) {
                const badge = document.createElement('div');
                badge.className = 'reference-badge';

                const icon = document.createElement('span');
                icon.className = 'reference-badge-icon';
                icon.textContent = '🖼️';

                const text = document.createElement('span');
                text.textContent = img.name;

                const remove = document.createElement('button');
                remove.className = 'reference-badge-remove';
                remove.textContent = '×';
                remove.onclick = function() { removeImage(index); };

                badge.appendChild(icon);
                badge.appendChild(text);
                badge.appendChild(remove);
                referencesContainer.appendChild(badge);
            });
        }

        function removeReference(index) {
            attachedReferences.splice(index, 1);
            updateReferences();
        }

        function removeImage(index) {
            attachedImages.splice(index, 1);
            updateReferences();
        }

        // Drag and drop handlers - must prevent default on dragover
        inputForm.addEventListener('dragenter', function(e) {
            e.preventDefault();
            e.stopPropagation();
            inputForm.classList.add('drag-over');
        });

        inputForm.addEventListener('dragover', function(e) {
            e.preventDefault();
            e.stopPropagation();
            inputForm.classList.add('drag-over');
        });

        inputForm.addEventListener('dragleave', function(e) {
            e.preventDefault();
            e.stopPropagation();
            // Only remove if leaving the form, not child elements
            if (e.target === inputForm) {
                inputForm.classList.remove('drag-over');
            }
        });

        inputForm.addEventListener('drop', function(e) {
            e.preventDefault();
            e.stopPropagation();
            inputForm.classList.remove('drag-over');

            const files = e.dataTransfer.files;
            console.log('Dropped files:', files.length);
            
            if (files && files.length > 0) {
                for (let i = 0; i < files.length; i++) {
                    const file = files[i];
                    console.log('Processing file:', file.name, file.type);
                    
                    // Check if it's an image
                    if (file.type.startsWith('image/')) {
                        const reader = new FileReader();
                        reader.onload = function(event) {
                            console.log('Image loaded:', file.name);
                            attachedImages.push({
                                name: file.name,
                                type: file.type,
                                data: event.target.result
                            });
                            updateReferences();
                        };
                        reader.onerror = function(error) {
                            console.error('Error reading file:', error);
                        };
                        reader.readAsDataURL(file);
                    } else {
                        console.log('Not an image, skipped:', file.type);
                    }
                }
            }
        });

        // Message handler
        let streamingMessage = null;
        let streamingContent = '';

        window.addEventListener('message', function(event) {
            const msg = event.data;
            
            if (msg.type === 'availableModels') {
                availableModels = msg.models;
                updateModelSelector();
            } else if (msg.type === 'selectionInfo') {
                // Add to references list instead of overwriting
                if (msg.selection) {
                    attachedReferences.push({
                        type: 'code',
                        fileName: msg.selection.fileName,
                        startLine: msg.selection.startLine,
                        endLine: msg.selection.endLine,
                        code: msg.selection.code,
                        fullPath: msg.selection.fullPath
                    });
                    updateReferences();
                }
            } else if (msg.type === 'userMessage') {
                addMessage('user', msg.text, null, null, null, msg.references, null, msg.selection, null, null, msg.images);
            } else if (msg.type === 'streamStart') {
                removeThinking();
                streamingContent = '';
                streamingMessage = startStreamingMessage(msg.model);
            } else if (msg.type === 'streamChunk') {
                if (streamingMessage) {
                    streamingContent += msg.chunk;
                    updateStreamingMessage(streamingMessage, streamingContent);
                }
            } else if (msg.type === 'assistantMessage') {
                removeThinking();
                if (streamingMessage) {
                    finalizeStreamingMessage(streamingMessage, msg);
                    streamingMessage = null;
                    streamingContent = '';
                } else {
                    addMessage('assistant', msg.text, msg.model, msg.tokens, msg.cost, null, msg.contextSummary, null, msg.codeBlocks, msg.targetFile);
                }
            } else if (msg.type === 'codeApplied') {
                showNotification(msg.message, 'success');
            } else if (msg.type === 'thinking') {
                addThinking();
            } else if (msg.type === 'error') {
                removeThinking();
                addError(msg.text);
            } else if (msg.type === 'clear') {
                while (chatContainer.firstChild) {
                    chatContainer.removeChild(chatContainer.firstChild);
                }
            }
        });

        function startStreamingMessage(model) {
            const div = document.createElement('div');
            div.className = 'message assistant-message';
            div.dataset.streaming = 'true';
            
            const header = document.createElement('div');
            header.className = 'message-header';
            const modelSpan = document.createElement('span');
            modelSpan.textContent = model;
            header.appendChild(modelSpan);
            div.appendChild(header);
            
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.dataset.role = 'streaming-content';
            div.appendChild(contentDiv);
            
            chatContainer.appendChild(div);
            chatContainer.scrollTop = chatContainer.scrollHeight;
            
            return div;
        }

        function updateStreamingMessage(messageDiv, content) {
            const contentDiv = messageDiv.querySelector('[data-role="streaming-content"]');
            if (contentDiv) {
                contentDiv.innerHTML = formatContent(content);
                chatContainer.scrollTop = chatContainer.scrollHeight;
            }
        }

        function finalizeStreamingMessage(messageDiv, msgData) {
            messageDiv.dataset.streaming = 'false';
            
            // Add final stats
            const header = messageDiv.querySelector('.message-header');
            if (header && msgData.tokens && msgData.cost !== undefined) {
                const statsSpan = document.createElement('span');
                statsSpan.textContent = msgData.tokens + ' tokens • $' + msgData.cost.toFixed(4);
                header.appendChild(statsSpan);
            }
            
            // Add code blocks if present
            if (msgData.codeBlocks && msgData.codeBlocks.length > 0) {
                const fileName = msgData.targetFile ? msgData.targetFile.split('/').pop() : 'current file';
                
                const btnContainer = document.createElement('div');
                btnContainer.style.marginTop = '8px';
                
                const applyBtn = document.createElement('button');
                applyBtn.className = 'apply-code-btn';
                applyBtn.title = 'Apply to ' + fileName;
                applyBtn.textContent = '⚡ Apply Changes';
                applyBtn.onclick = function() { applyCode(0); };
                
                btnContainer.appendChild(applyBtn);
                messageDiv.appendChild(btnContainer);
                
                const primaryBlock = msgData.codeBlocks.reduce((largest, current) => 
                    current.code.length > largest.code.length ? current : largest
                );
                messageDiv.dataset.codeBlocks = JSON.stringify([primaryBlock]);
                messageDiv.dataset.targetFile = msgData.targetFile || '';
            }
        }

        function addMessage(role, content, model, tokens, cost, references, contextSummary, selection, codeBlocks, targetFile, images) {
            const div = document.createElement('div');
            div.className = 'message ' + role + '-message';
            
            // Safe DOM construction - NO innerHTML
            if (model) {
                const header = document.createElement('div');
                header.className = 'message-header';
                
                const modelSpan = document.createElement('span');
                modelSpan.textContent = model;
                
                const statsSpan = document.createElement('span');
                statsSpan.textContent = tokens + ' tokens • $' + cost.toFixed(4);
                
                header.appendChild(modelSpan);
                header.appendChild(statsSpan);
                div.appendChild(header);
            }
            
            if (selection) {
                const lineRange = selection.startLine === selection.endLine ? 'Line ' + selection.startLine : 'Lines ' + selection.startLine + '-' + selection.endLine;
                
                const selDiv = document.createElement('div');
                selDiv.className = 'message-selection';
                
                const selHeader = document.createElement('div');
                selHeader.className = 'selection-header';
                selHeader.textContent = '📝 ' + selection.fileName + ' • ' + lineRange;
                
                const selCode = document.createElement('pre');
                selCode.className = 'selection-code';
                selCode.textContent = selection.code;
                
                selDiv.appendChild(selHeader);
                selDiv.appendChild(selCode);
                div.appendChild(selDiv);
            }
            
            if (references && references.length > 0) {
                const refDiv = document.createElement('div');
                refDiv.className = 'message-references';
                
                for (let i = 0; i < references.length; i++) {
                    const ref = references[i];
                    const badge = document.createElement('span');
                    badge.className = 'reference-badge';
                    badge.style.display = 'inline-block';
                    badge.style.marginRight = '6px';
                    
                    const lineRange = ref.startLine === ref.endLine 
                        ? ':' + ref.startLine 
                        : ':' + ref.startLine + '-' + ref.endLine;
                    badge.textContent = '📎 ' + ref.fileName + lineRange;
                    refDiv.appendChild(badge);
                }
                
                div.appendChild(refDiv);
            }
            
            // Show attached images
            if (images && images.length > 0) {
                const imgContainer = document.createElement('div');
                imgContainer.className = 'message-images';
                imgContainer.style.display = 'flex';
                imgContainer.style.flexWrap = 'wrap';
                imgContainer.style.gap = '8px';
                imgContainer.style.marginTop = '8px';
                
                for (let i = 0; i < images.length; i++) {
                    const img = images[i];
                    const imgWrapper = document.createElement('div');
                    imgWrapper.style.position = 'relative';
                    
                    const imgEl = document.createElement('img');
                    imgEl.src = img.data;
                    imgEl.alt = img.name;
                    imgEl.className = 'image-preview';
                    imgEl.style.maxWidth = '200px';
                    imgEl.style.maxHeight = '200px';
                    imgEl.style.borderRadius = '6px';
                    imgEl.style.border = '1px solid var(--vscode-panel-border)';
                    imgEl.style.cursor = 'pointer';
                    imgEl.onclick = function() {
                        // Could implement full-size image viewer here
                        vscode.postMessage({ type: 'openImage', data: img.data });
                    };
                    
                    const imgLabel = document.createElement('div');
                    imgLabel.textContent = '🖼️ ' + img.name;
                    imgLabel.style.fontSize = '11px';
                    imgLabel.style.opacity = '0.7';
                    imgLabel.style.marginTop = '4px';
                    
                    imgWrapper.appendChild(imgEl);
                    imgWrapper.appendChild(imgLabel);
                    imgContainer.appendChild(imgWrapper);
                }
                
                div.appendChild(imgContainer);
            }
            
            if (contextSummary) {
                const ctxDiv = document.createElement('div');
                ctxDiv.className = 'message-context';
                ctxDiv.textContent = '🔍 ' + contextSummary;
                div.appendChild(ctxDiv);
            }
            
            // Message content
            const contentDiv = document.createElement('div');
            contentDiv.className = 'message-content';
            contentDiv.innerHTML = formatContent(content); // formatContent already escapes HTML
            div.appendChild(contentDiv);
            
            // Add single "Apply Code" button if code blocks are present
            if (codeBlocks && codeBlocks.length > 0) {
                const fileName = targetFile ? targetFile.split('/').pop() : 'current file';
                
                const btnContainer = document.createElement('div');
                btnContainer.style.marginTop = '8px';
                
                const applyBtn = document.createElement('button');
                applyBtn.className = 'apply-code-btn';
                applyBtn.title = 'Apply to ' + fileName;
                applyBtn.textContent = '⚡ Apply Changes';
                applyBtn.onclick = function() { applyCode(0); };
                
                btnContainer.appendChild(applyBtn);
                div.appendChild(btnContainer);
                
                // Store the primary code block for application (use the largest one)
                const primaryBlock = codeBlocks.reduce((largest, current) => 
                    current.code.length > largest.code.length ? current : largest
                );
                div.dataset.codeBlocks = JSON.stringify([primaryBlock]);
                div.dataset.targetFile = targetFile || '';
            }
            
            chatContainer.appendChild(div);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        
        function applyCode(blockIndex) {
            const messages = chatContainer.querySelectorAll('.assistant-message');
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.dataset.codeBlocks) {
                const blocks = JSON.parse(lastMessage.dataset.codeBlocks);
                const block = blocks[blockIndex];
                const filePath = lastMessage.dataset.targetFile;
                
                if (block && filePath) {
                    vscode.postMessage({
                        type: 'applyCode',
                        code: block.code,
                        filePath: filePath
                    });
                }
            }
        }
        window.applyCode = applyCode;
        
        function showNotification(message, type) {
            const notification = document.createElement('div');
            notification.style.cssText = 'position: fixed; bottom: 20px; right: 20px; padding: 10px 14px; border-radius: 6px; background: ' + (type === 'success' ? 'var(--vscode-inputValidation-infoBackground)' : 'var(--vscode-inputValidation-errorBackground)') + '; color: var(--vscode-foreground); border: 1px solid ' + (type === 'success' ? 'var(--vscode-inputValidation-infoBorder)' : 'var(--vscode-inputValidation-errorBorder)') + '; z-index: 1000; animation: fadeIn 0.3s; font-size: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);';
            notification.textContent = message;
            document.body.appendChild(notification);
            
            setTimeout(function() {
                notification.style.opacity = '0';
                notification.style.transform = 'translateY(10px)';
                notification.style.transition = 'all 0.3s';
                setTimeout(function() {
                    notification.remove();
                }, 300);
            }, 2000);
        }

        function addThinking() {
            const div = document.createElement('div');
            div.className = 'thinking';
            div.id = 'thinking-indicator';
            div.textContent = 'Thinking...';
            chatContainer.appendChild(div);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        function removeThinking() {
            const thinking = document.getElementById('thinking-indicator');
            if (thinking) thinking.remove();
        }

        function addError(msg) {
            const div = document.createElement('div');
            div.className = 'error';
            div.textContent = 'Error: ' + msg;
            chatContainer.appendChild(div);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        let codeBlockCounter = 0;
        
        function formatContent(text) {
            let formatted = escapeHtml(text);
            
            // Replace code blocks with wrapper that includes apply button
            formatted = formatted.replace(/\\\`\\\`\\\`(\\w+)?\\n([\\s\\S]*?)\\\`\\\`\\\`/g, function(match, lang, code) {
                const blockId = 'code-block-' + (codeBlockCounter++);
                const escapedCode = code; // Already escaped by escapeHtml
                
                return '<div class="code-block-wrapper" data-code-id="' + blockId + '">' +
                    '<button class="code-apply-btn" onclick="applyCodeBlock(\'' + blockId + '\')" title="Apply this code change">' +
                    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">' +
                    '<path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z"/>' +
                    '</svg>' +
                    'Apply' +
                    '</button>' +
                    '<pre><code class="language-' + (lang || 'text') + '" data-code="' + escapedCode.replace(/"/g, '&quot;') + '">' + escapedCode + '</code></pre>' +
                    '</div>';
            });
            
            formatted = formatted.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
            formatted = formatted.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
            formatted = formatted.replace(/\\n/g, '<br>');
            return formatted;
        }
        
        window.applyCodeBlock = function(blockId) {
            const wrapper = document.querySelector('[data-code-id="' + blockId + '"]');
            if (!wrapper) {
                return;
            }
            
            const codeElement = wrapper.querySelector('code');
            const button = wrapper.querySelector('.code-apply-btn');
            
            if (!codeElement || !button) {
                return;
            }
            
            const code = codeElement.getAttribute('data-code');
            if (!code) {
                return;
            }
            
            // Visual feedback
            const originalHtml = button.innerHTML;
            button.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style="animation: spin 1s linear infinite;">' +
                '<circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="2" fill="none" opacity="0.25"/>' +
                '<path d="M15 8a7 7 0 0 1-7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/>' +
                '</svg> Applying...';
            button.disabled = true;
            
            // Send to extension to apply
            vscode.postMessage({
                type: 'applyCode',
                code: code
            });
            
            // Reset button after a delay
            setTimeout(function() {
                button.innerHTML = originalHtml;
                button.disabled = false;
            }, 2000);
        };
    </script>
</body>
</html>`;
    }
}
