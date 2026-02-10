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
                model = this.modelManager.getProvider(preferredModel);
                
                if (!model) {
                    const availableNames = this.modelManager.getProviders().map(p => p.getName()).join(', ');
                    throw new Error(`Model "${preferredModel}" not available. Available models: ${availableNames}`);
                }
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
            }

            // Get available models info for the AI to reference
            const availableModels = this.getAvailableModelsInfo();

            // System prompt
            const systemPrompt = contextWithImages 
                ? `You are an AI coding agent in VS Code with automatic code application.

## CODE CONTEXT
${contextWithImages}

## AVAILABLE AI MODELS
${availableModels}

## RESPONSE RULES
1. For CODE CHANGES: Provide complete, working code blocks
2. For EXPLANATIONS: Use inline code or references
3. Always include full function signatures when providing code to apply
4. When suggesting model names, ONLY use real models from the list above`
                : `You are an AI coding agent in VS Code. Respond concisely with direct solutions.

## AVAILABLE AI MODELS
${availableModels}`;

            // Prepare messages
            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                ...this.chatHistory.slice(-5)
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

            // Add to history
            this.chatHistory.push({
                role: 'assistant',
                content: response.content
            });

            // Extract code blocks
            const codeBlocks = this.extractCodeBlocks(response.content);
            const firstReference = references && references.length > 0 ? references[0] : null;
            const hasApplicableCode = codeBlocks.length > 0 && firstReference;

            // Send response
            this.sendMessageToWebview({
                type: 'assistantMessage',
                text: response.content,
                model: model.getName(),
                tokens: response.tokensUsed.total,
                cost: response.cost,
                contextSummary: summary,
                codeBlocks: hasApplicableCode ? codeBlocks : undefined,
                targetFile: firstReference?.fullPath
            });

        } catch (error: any) {
            this.sendMessageToWebview({
                type: 'error',
                text: error.message
            });
        }
    }

    private async parseReferences(message: string): Promise<{ cleanMessage: string; referencedFiles: string[] }> {
        const referencedFiles: string[] = [];
        const mentionRegex = /@([\w\-./]+\.\w+)/g;
        const mentions = [...message.matchAll(mentionRegex)];
        
        for (const match of mentions) {
            const filePath = match[1];
            const files = await vscode.workspace.findFiles(`**/${filePath}`, '**/node_modules/**', 1);
            
            if (files.length > 0) {
                referencedFiles.push(files[0].fsPath);
            } else {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (workspaceFolder) {
                    const fullPath = vscode.Uri.joinPath(workspaceFolder.uri, filePath).fsPath;
                    referencedFiles.push(fullPath);
                }
            }
        }
        
        return { cleanMessage: message, referencedFiles };
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
        
        if (lower.includes('explain') || lower.includes('what does') || lower.includes('how does')) {
            return 'code-explanation';
        }
        if (lower.includes('document') || lower.includes('comment')) {
            return 'documentation';
        }
        if (lower.includes('refactor') || lower.includes('improve') || lower.includes('optimize')) {
            return 'code-refactoring';
        }
        if (lower.includes('fix') || lower.includes('bug') || lower.includes('error')) {
            return 'bug-fixing';
        }
        if (lower.includes('add') || lower.includes('create') || lower.includes('implement')) {
            return 'code-completion';
        }
        
        return 'general-chat';
    }

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

    private getAvailableModelsInfo(): string {
        return `**OpenAI:** gpt-3.5-turbo, gpt-4, gpt-4-turbo
**Anthropic:** claude-3-haiku, claude-3-sonnet, claude-3.5-sonnet, claude-3-opus
**Google Gemini:** gemini-1.5-flash, gemini-2.5-flash, gemini-pro, gemini-1.5-pro, gemini-2.5-pro
**Groq:** llama-3.3-70b, llama-3.3-70b-versatile
**DeepSeek:** deepseek-coder
**Cohere:** command-a-03-2025, command-r-plus, cohere-command`;
    }

    private sendMessageToWebview(message: any) {
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
        * { margin: 0; padding: 0; box-sizing: border-box; }
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
        }
        #input-container {
            padding: 16px;
            border-top: 1px solid var(--vscode-panel-border);
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
            margin-bottom: 8px;
        }
        .indicator-close {
            background: transparent;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            font-size: 18px;
            padding: 0 4px;
        }
        .input-row {
            display: flex;
            gap: 8px;
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
        .send-btn {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .send-btn:hover {
            background: var(--vscode-button-hoverBackground);
            transform: scale(1.1);
        }
        .apply-code-btn {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 6px;
            cursor: pointer;
            margin-top: 8px;
        }
        .apply-code-btn:hover {
            background: var(--vscode-button-hoverBackground);
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
    </style>
</head>
<body>
    <div id="chat-container"></div>
    <div id="input-container">
        <div class="input-row">
            <textarea id="message-input" placeholder="Ask me anything..." rows="1"></textarea>
            <button class="send-btn" onclick="sendMessage()">
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

        // ENTER KEY - Must work!
        messageInput.addEventListener('keydown', function(e) {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
                return false;
            }
        });

        // Request selection on focus
        messageInput.addEventListener('focus', function() {
            vscode.postMessage({ type: 'getSelection' });
        });

        // Initial selection request
        vscode.postMessage({ type: 'getSelection' });

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
                
                indicator.innerHTML = '<span>📎 @' + currentSelection.fileName + lineRange + '</span>' +
                    '<button class="indicator-close" onclick="clearSelection()">×</button>';
                
                const inputContainer = document.getElementById('input-container');
                inputContainer.insertBefore(indicator, inputContainer.firstChild);
            }
        }

        function clearSelection() {
            currentSelection = null;
            updateSelectionIndicator();
        }
        window.clearSelection = clearSelection;

        window.addEventListener('message', function(event) {
            const msg = event.data;
            
            if (msg.type === 'selectionInfo') {
                currentSelection = msg.selection;
                updateSelectionIndicator();
            } else if (msg.type === 'userMessage') {
                addMessage('user', msg.text, null, null, null, null, null, msg.selection);
            } else if (msg.type === 'assistantMessage') {
                removeThinking();
                addMessage('assistant', msg.text, msg.model, msg.tokens, msg.cost, null, null, null, msg.codeBlocks, msg.targetFile);
            } else if (msg.type === 'thinking') {
                addThinking();
            } else if (msg.type === 'error') {
                removeThinking();
                addError(msg.text);
            } else if (msg.type === 'clear') {
                chatContainer.innerHTML = '';
            }
        });

        function addMessage(role, content, model, tokens, cost, refs, ctx, selection, codeBlocks, targetFile) {
            const div = document.createElement('div');
            div.className = 'message ' + role + '-message';
            
            let html = '';
            if (model) {
                html += '<div class="message-header"><span>' + model + '</span><span>' + 
                    tokens + ' tokens • $' + cost.toFixed(4) + '</span></div>';
            }
            
            if (selection) {
                const lineRange = selection.startLine === selection.endLine 
                    ? 'Line ' + selection.startLine 
                    : 'Lines ' + selection.startLine + '-' + selection.endLine;
                html += '<div class="message-selection">' +
                    '<div class="selection-header">📝 ' + selection.fileName + ' • ' + lineRange + '</div>' +
                    '<pre class="selection-code">' + escapeHtml(selection.code) + '</pre></div>';
            }
            
            html += '<div>' + formatContent(content) + '</div>';
            
            if (codeBlocks && codeBlocks.length > 0) {
                const primaryBlock = codeBlocks.reduce((largest, current) => 
                    current.code.length > largest.code.length ? current : largest
                );
                html += '<button class="apply-code-btn" onclick="applyCode()">⚡ Apply Changes</button>';
                div.dataset.codeBlocks = JSON.stringify([primaryBlock]);
                div.dataset.targetFile = targetFile || '';
            }
            
            div.innerHTML = html;
            chatContainer.appendChild(div);
            chatContainer.scrollTop = chatContainer.scrollHeight;
        }
        
        function applyCode() {
            const messages = chatContainer.querySelectorAll('.assistant-message');
            const lastMessage = messages[messages.length - 1];
            
            if (lastMessage && lastMessage.dataset.codeBlocks) {
                const blocks = JSON.parse(lastMessage.dataset.codeBlocks);
                const block = blocks[0];
                const filePath = lastMessage.dataset.targetFile;
                
                vscode.postMessage({
                    type: 'applyCode',
                    code: block.code,
                    filePath: filePath
                });
            }
        }
        window.applyCode = applyCode;

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
            formatted = formatted.replace(/\\\`\\\`\\\`(\\w+)?\\n([\\s\\S]*?)\\\`\\\`\\\`/g, '<pre><code>$2</code></pre>');
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
