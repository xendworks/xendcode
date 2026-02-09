import * as vscode from 'vscode';
import { ModelManager } from '../core/ModelManager';
import { ContextManager } from '../core/ContextManager';
import { TokenManager } from '../core/TokenManager';
import { ChatMessage } from '../types';

export class ChatProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private webview?: vscode.Webview;
    private chatHistory: ChatMessage[] = [];

    constructor(
        private context: vscode.ExtensionContext,
        private modelManager: ModelManager,
        private contextManager: ContextManager,
        private tokenManager: TokenManager
    ) {}

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        token: vscode.CancellationToken
    ) {
        this.view = webviewView;
        this.webview = webviewView.webview;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);
        this.setupWebviewMessageHandling(webviewView.webview);
    }

    setupWebviewMessageHandling(webview: vscode.Webview) {
        this.webview = webview;
        webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'chat':
                    await this.handleChat(message.text, message.selection);
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
            const editor = vscode.window.activeTextEditor;
            
            if (!editor) {
                throw new Error('No file open to apply changes to. Please open the target file first.');
            }
            
            console.log('=== APPLY CODE DEBUG ===');
            console.log('Target file:', filePath);
            console.log('Active editor:', editor.document.uri.fsPath);
            console.log('Code length:', code.length);
            
            // Check if the active editor is the right file
            if (filePath && editor.document.uri.fsPath !== filePath) {
                console.log('File mismatch, looking for open document...');
                
                // Find if the file is already open in another editor
                const targetDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
                if (targetDoc) {
                    console.log('Found open document, switching to it');
                    // Switch to that editor without opening new tab
                    const targetEditor = await vscode.window.showTextDocument(targetDoc, {
                        viewColumn: editor.viewColumn,
                        preserveFocus: false,
                        preview: false
                    });
                    await this.replaceEditorContent(targetEditor, code);
                } else {
                    console.log('Document not open, applying to current editor');
                    // File not open, use current editor anyway (user likely wants to apply here)
                    await this.replaceEditorContent(editor, code);
                }
            } else {
                console.log('Applying to current editor');
                // Apply to current editor directly
                await this.replaceEditorContent(editor, code);
            }

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

    private async handleChat(userMessage: string, providedSelection?: any) {
        if (!userMessage.trim()) {
            return;
        }

        // Capture current selection info (can be provided from webview or fetched from editor)
        const editor = vscode.window.activeTextEditor;
        let selectionInfo = providedSelection;
        
        if (!selectionInfo && editor && !editor.selection.isEmpty) {
            const selection = editor.selection;
            const fileName = editor.document.fileName.split('/').pop() || 'unknown';
            const startLine = selection.start.line + 1;
            const endLine = selection.end.line + 1;
            
            selectionInfo = {
                fileName,
                startLine,
                endLine,
                code: editor.document.getText(selection),
                fullPath: editor.document.fileName
            };
        }

        // Parse @-mentions from message
        const { cleanMessage, referencedFiles } = await this.parseReferences(userMessage);

        // Add user message to history
        this.chatHistory.push({
            role: 'user',
            content: cleanMessage
        });

        // Show user message in UI with references and selection
        this.sendMessageToWebview({
            type: 'userMessage',
            text: cleanMessage,
            references: referencedFiles,
            selection: selectionInfo
        });

        // Show thinking indicator
        this.sendMessageToWebview({ type: 'thinking' });

        try {
            // Determine task type
            const taskType = this.determineTaskType(cleanMessage);

            // Build context (includes active file, selection, etc.)
            const tokenBudget = 8000; // Increased budget for referenced files
            const { context, tokensUsed, summary } = await this.contextManager.buildContext(
                cleanMessage,
                tokenBudget
            );

            // Add SELECTED CODE to context (CRITICAL!)
            let selectionContext = '';
            if (selectionInfo && selectionInfo.code) {
                const lineRange = selectionInfo.startLine === selectionInfo.endLine 
                    ? `Line ${selectionInfo.startLine}`
                    : `Lines ${selectionInfo.startLine}-${selectionInfo.endLine}`;
                
                selectionContext = `\n\n=== SELECTED CODE: ${selectionInfo.fileName} (${lineRange}) ===\n\`\`\`\n${selectionInfo.code}\n\`\`\`\n`;
            }

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

            const fullContext = selectionContext + context + fileContext;

            // Select best model
            const config = vscode.workspace.getConfiguration('xendcode');
            const preferFree = config.get('routing.preferFreeTier', true);
            
            const model = await this.modelManager.selectModel(
                taskType,
                tokensUsed,
                preferFree
            );

            if (!model) {
                throw new Error('No available model found. Please configure API keys.');
            }

            // Get available models info for the AI to reference
            const availableModels = this.getAvailableModelsInfo();

            // Agent-mode system prompt (inspired by Cursor's advanced prompt architecture)
            const systemPrompt = fullContext 
                ? `You are an autonomous AI coding agent in VS Code. Your goal is to COMPLETELY resolve the user's query before responding.

## YOUR CORE BEHAVIOR
You are integrated into a VS Code extension that can AUTOMATICALLY APPLY code changes to files with a single click.
This means:
- When user asks to CHANGE/FIX/ADD code → Provide complete, executable code that will be applied to their file
- When user asks to EXPLAIN/UNDERSTAND code → Provide clear explanations WITHOUT complete code blocks
- BE PRECISE about which mode you're in based on the user's request

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

            // Get completion
            const response = await model.complete(messages);

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
            // 4. Has selection context
            // 5. Response does NOT contain explanation keywords
            const hasApplicableCode = !isExplanationTask &&
                                     codeBlocks.length > 0 && 
                                     selectionInfo && 
                                     (isCodeChangeTask || hasChangeKeywords) &&
                                     !hasExplanationKeywords;
            
            console.log('=== APPLY BUTTON DECISION ===');
            console.log('Task type:', taskType);
            console.log('Is explanation/doc task:', isExplanationTask);
            console.log('Is code change task:', isCodeChangeTask);
            console.log('Has change keywords:', hasChangeKeywords);
            console.log('Has explanation keywords:', hasExplanationKeywords);
            console.log('Code blocks found:', codeBlocks.length);
            console.log('Has selection:', !!selectionInfo);
            console.log('FINAL DECISION - Show apply button:', hasApplicableCode);
            console.log('===========================');

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
                targetFile: selectionInfo?.fullPath,
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

**Groq Models (Free, Fast Inference):**
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
        if (this.view) {
            this.view.webview.postMessage(message);
        } else if (this.webview) {
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
            padding: 12px;
            border-radius: 8px;
            max-width: 90%;
        }
        
        .user-message {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            margin-left: auto;
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
        
        .message-selection {
            margin-bottom: 12px;
            border-left: 3px solid var(--vscode-focusBorder);
            padding-left: 8px;
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
            gap: 8px;
        }
        
        .selection-indicator {
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: var(--vscode-inputOption-activeBackground);
            border: 1px solid var(--vscode-focusBorder);
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
        
        #message-input {
            flex: 1;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 8px 12px;
            border-radius: 4px;
            font-family: inherit;
            font-size: 13px;
            resize: vertical;
            min-height: 36px;
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
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: transform 0.2s;
        }
        
        .send-btn:hover {
            transform: scale(1.1);
        }
        
        .send-btn:active {
            transform: scale(0.95);
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
        <!-- Selection indicator will be inserted here dynamically -->
        <div class="input-row">
            <textarea id="message-input" placeholder="Ask me anything..." rows="1"></textarea>
            <button class="send-btn" onclick="sendMessage()" title="Send message">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M1 8l14-6-4 12-4-6-6 0z"/>
                </svg>
            </button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const chatContainer = document.getElementById('chat-container');
        const messageInput = document.getElementById('message-input');
        let currentSelection = null;

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
        }, 100);

        // Send message function
        function sendMessage() {
            const text = messageInput.value.trim();
            if (text) {
                vscode.postMessage({ 
                    type: 'chat', 
                    text: text,
                    selection: currentSelection 
                });
                messageInput.value = '';
                currentSelection = null;
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
                
                indicator.innerHTML = '<span class="indicator-text">📎 @' + currentSelection.fileName + lineRange + '</span><button class="indicator-close" onclick="clearSelection()" title="Remove">×</button>';
                
                const inputContainer = document.getElementById('input-container');
                inputContainer.insertBefore(indicator, inputContainer.firstChild);
            }
        }

        function clearSelection() {
            currentSelection = null;
            updateSelectionIndicator();
        }
        window.clearSelection = clearSelection;

        // Message handler
        window.addEventListener('message', function(event) {
            const msg = event.data;
            
            if (msg.type === 'selectionInfo') {
                currentSelection = msg.selection;
                updateSelectionIndicator();
            } else if (msg.type === 'userMessage') {
                addMessage('user', msg.text, null, null, null, msg.references, null, msg.selection, null, null);
            } else if (msg.type === 'assistantMessage') {
                removeThinking();
                addMessage('assistant', msg.text, msg.model, msg.tokens, msg.cost, null, msg.contextSummary, null, msg.codeBlocks, msg.targetFile);
            } else if (msg.type === 'codeApplied') {
                showNotification(msg.message, 'success');
            } else if (msg.type === 'thinking') {
                addThinking();
            } else if (msg.type === 'error') {
                removeThinking();
                addError(msg.text);
            } else if (msg.type === 'clear') {
                chatContainer.innerHTML = '';
            }
        });

        function addMessage(role, content, model, tokens, cost, references, contextSummary, selection, codeBlocks, targetFile) {
            const div = document.createElement('div');
            div.className = 'message ' + role + '-message';
            
            let html = '';
            if (model) {
                html += '<div class="message-header"><span>' + model + '</span><span>' + tokens + ' tokens • $' + cost.toFixed(4) + '</span></div>';
            }
            
            if (selection) {
                const lineRange = selection.startLine === selection.endLine ? 'Line ' + selection.startLine : 'Lines ' + selection.startLine + '-' + selection.endLine;
                html += '<div class="message-selection"><div class="selection-header">📝 ' + selection.fileName + ' • ' + lineRange + '</div><pre class="selection-code">' + escapeHtml(selection.code) + '</pre></div>';
            }
            
            if (references && references.length > 0) {
                const files = references.map(function(f) { return f.split('/').pop(); }).join(', ');
                html += '<div class="message-references">📎 ' + files + '</div>';
            }
            
            if (contextSummary) {
                html += '<div class="message-context">🔍 ' + contextSummary + '</div>';
            }
            
            html += '<div class="message-content">' + formatContent(content) + '</div>';
            
            // Add single "Apply Code" button if code blocks are present
            if (codeBlocks && codeBlocks.length > 0) {
                const fileName = targetFile ? targetFile.split('/').pop() : 'current file';
                html += '<div style="margin-top: 8px;">';
                html += '<button class="apply-code-btn" onclick="applyCode(0)" title="Apply to ' + fileName + '">⚡ Apply Changes</button>';
                html += '</div>';
                
                // Store the primary code block for application (use the largest one)
                const primaryBlock = codeBlocks.reduce((largest, current) => 
                    current.code.length > largest.code.length ? current : largest
                );
                div.dataset.codeBlocks = JSON.stringify([primaryBlock]);
                div.dataset.targetFile = targetFile || '';
            }
            
            div.innerHTML = html;
            
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

        function formatContent(text) {
            let formatted = escapeHtml(text);
            formatted = formatted.replace(/\\\`\\\`\\\`(\\w+)?\\n([\\s\\S]*?)\\\`\\\`\\\`/g, function(match, lang, code) {
                return '<pre><code>' + code + '</code></pre>';
            });
            formatted = formatted.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
            formatted = formatted.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
            formatted = formatted.replace(/\\n/g, '<br>');
            return formatted;
        }
    </script>
</body>
</html>`;
    }
}
