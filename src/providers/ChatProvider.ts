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
    private selectionListener?: vscode.Disposable;

    constructor(
        private context: vscode.ExtensionContext,
        private modelManager: ModelManager,
        private contextManager: ContextManager,
        private tokenManager: TokenManager,
        private firebaseService: FirebaseService
    ) {}

    public openChatEditor() {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.Beside);
            // Send current selection immediately
            this.sendCurrentSelection();
            return;
        }

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

        this.panel.onDidDispose(() => {
            this.panel = undefined;
            this.webview = undefined;
            if (this.selectionListener) {
                this.selectionListener.dispose();
            }
        });

        // Send current selection immediately when chat opens
        setTimeout(() => this.sendCurrentSelection(), 200);
    }

    private sendCurrentSelection() {
        const editor = vscode.window.activeTextEditor;
        if (editor && !editor.selection.isEmpty) {
            const selection = editor.selection;
            const selectionData = {
                fileName: editor.document.fileName.split('/').pop() || 'unknown',
                startLine: selection.start.line + 1,
                endLine: selection.end.line + 1,
                code: editor.document.getText(selection),
                fullPath: editor.document.fileName
            };
            
            this.sendMessageToWebview({
                type: 'selectionDetected',
                selection: selectionData
            });
        }
    }

    setupWebviewMessageHandling(webview: vscode.Webview) {
        this.webview = webview;
        
        // Listen for selection changes
        this.selectionListener = vscode.window.onDidChangeTextEditorSelection((event) => {
            const editor = event.textEditor;
            const selection = event.selections[0];
            
            if (editor && !selection.isEmpty && this.panel?.visible) {
                const selectionData = {
                    fileName: editor.document.fileName.split('/').pop() || 'unknown',
                    startLine: selection.start.line + 1,
                    endLine: selection.end.line + 1,
                    code: editor.document.getText(selection),
                    fullPath: editor.document.fileName
                };
                
                this.sendMessageToWebview({
                    type: 'selectionDetected',
                    selection: selectionData
                });
            }
        });
        
        webview.onDidReceiveMessage(async (message) => {
            switch (message.type) {
                case 'chat':
                    await this.handleChat(message.text, message.references, message.images, message.preferredModel);
                    break;
                case 'getAvailableModels':
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

    private async handleApplyCode(code: string, filePath?: string) {
        try {
            let editor = vscode.window.activeTextEditor;
            
            if (filePath && (!editor || editor.document.uri.fsPath !== filePath)) {
                const targetDoc = vscode.workspace.textDocuments.find(doc => doc.uri.fsPath === filePath);
                if (targetDoc) {
                    editor = await vscode.window.showTextDocument(targetDoc);
                } else {
                    const doc = await vscode.workspace.openTextDocument(filePath);
                    editor = await vscode.window.showTextDocument(doc);
                }
            }
            
            if (!editor) {
                throw new Error('No file open');
            }
            
            await this.replaceEditorContent(editor, code);
            
            this.sendMessageToWebview({
                type: 'codeApplied',
                message: '✓ Code applied'
            });
            
            vscode.window.showInformationMessage('✓ Code applied');
            
        } catch (error: any) {
            vscode.window.showErrorMessage(`Apply failed: ${error.message}`);
        }
    }

    private async replaceEditorContent(editor: vscode.TextEditor, newCode: string) {
        const edit = new vscode.WorkspaceEdit();
        const document = editor.document;
        
        if (!editor.selection.isEmpty) {
            edit.replace(document.uri, editor.selection, newCode);
            await vscode.workspace.applyEdit(edit);
            return;
        }
        
        const currentContent = document.getText();
        const signatureMatch = newCode.trim().match(
            /^.*?(class|function|const|let|var|private|public|protected|static|async)\s+[\w\s]*?(\w+)\s*[\(<]/m
        );
        
        if (signatureMatch) {
            const identifier = signatureMatch[2];
            const range = this.findCodeSection(currentContent, identifier, document);
            
            if (range) {
                edit.replace(document.uri, range, newCode);
                await vscode.workspace.applyEdit(edit);
                return;
            }
        }
        
        // Fallback: ask user
        const choice = await vscode.window.showQuickPick([
            { label: 'Insert at cursor', value: 'insert' },
            { label: 'Replace file', value: 'replace' },
            { label: 'Cancel', value: 'cancel' }
        ]);
        
        if (choice?.value === 'insert') {
            edit.insert(document.uri, editor.selection.active, '\n' + newCode + '\n');
            await vscode.workspace.applyEdit(edit);
        } else if (choice?.value === 'replace') {
            const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
            edit.replace(document.uri, fullRange, newCode);
            await vscode.workspace.applyEdit(edit);
        }
    }
    
    private findCodeSection(content: string, identifier: string, document: vscode.TextDocument): vscode.Range | null {
        const lines = content.split('\n');
        const patterns = [
            new RegExp(`^\\s*(export\\s+)?(async\\s+)?function\\s+${identifier}\\s*\\(`),
            new RegExp(`^\\s*(export\\s+)?(const|let|var)\\s+${identifier}\\s*=`),
            new RegExp(`^\\s*(export\\s+)?class\\s+${identifier}\\s*`),
            new RegExp(`^\\s*(private|public|protected|static|async)\\s+${identifier}\\s*\\(`),
        ];
        
        for (let i = 0; i < lines.length; i++) {
            if (patterns.some(p => p.test(lines[i]))) {
                let braceCount = 0, startLine = i, endLine = i, started = false;
                
                for (let j = i; j < lines.length; j++) {
                    for (const char of lines[j]) {
                        if (char === '{') { braceCount++; started = true; }
                        else if (char === '}') {
                            braceCount--;
                            if (started && braceCount === 0) {
                                return new vscode.Range(startLine, 0, j, lines[j].length);
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    getChatHTML(webview: vscode.Webview): string {
        return this.getHtmlContent(webview);
    }

    private async handleChat(userMessage: string, references?: any[], images?: any[], preferredModel?: string) {
        if (!userMessage.trim() && (!images || images.length === 0)) {
            return;
        }

        let allReferencesContext = '';
        if (references && references.length > 0) {
            for (const ref of references) {
                const lineRange = ref.startLine === ref.endLine ? `Line ${ref.startLine}` : `Lines ${ref.startLine}-${ref.endLine}`;
                allReferencesContext += `\n\n=== ${ref.fileName} (${lineRange}) ===\n\`\`\`\n${ref.code}\n\`\`\`\n`;
            }
        }

        this.chatHistory.push({
            role: 'user',
            content: userMessage
        });

        this.sendMessageToWebview({
            type: 'userMessage',
            text: userMessage,
            references: references,
            images: images
        });

        this.sendMessageToWebview({ type: 'thinking' });

        try {
            const { context, tokensUsed, summary } = await this.contextManager.buildContext(userMessage, 8000);
            const fullContext = allReferencesContext + context;

            let model;
            if (preferredModel) {
                model = this.modelManager.getProvider(preferredModel);
                if (!model) throw new Error(`Model "${preferredModel}" not available`);
            } else {
                const config = vscode.workspace.getConfiguration('xendcode');
                model = await this.modelManager.selectModel('general-chat', tokensUsed, config.get('routing.preferFreeTier', true));
                if (!model) throw new Error('No model available');
            }

            const systemPrompt = `You are an AI coding agent. Provide complete, working code when asked to make changes. Use inline code for explanations.\n\n${fullContext}`;
            const messages: ChatMessage[] = [
                { role: 'system', content: systemPrompt },
                ...this.chatHistory.slice(-5)
            ];

            let fullResponse = '';
            this.sendMessageToWebview({ type: 'streamStart', model: model.getName() });

            const response = await (model.completeStream ? 
                model.completeStream(messages, undefined, (chunk: string) => {
                    fullResponse += chunk;
                    this.sendMessageToWebview({ type: 'streamChunk', chunk });
                }) :
                model.complete(messages)
            );

            if (model.completeStream) response.content = fullResponse;

            await this.tokenManager.recordUsage(
                model.getName(),
                response.tokensUsed.input,
                response.tokensUsed.output,
                response.cost
            );

            this.chatHistory.push({ role: 'assistant', content: response.content });

            const codeBlocks = this.extractCodeBlocks(response.content);
            const firstReference = references && references.length > 0 ? references[0] : null;

            this.sendMessageToWebview({
                type: 'assistantMessage',
                text: response.content,
                model: model.getName(),
                tokens: response.tokensUsed.total,
                cost: response.cost,
                codeBlocks: codeBlocks.length > 0 && firstReference ? codeBlocks : undefined,
                targetFile: firstReference?.fullPath
            });

        } catch (error: any) {
            this.sendMessageToWebview({ type: 'error', text: error.message });
        }
    }

    private async parseReferences(message: string): Promise<{ cleanMessage: string; referencedFiles: string[] }> {
        return { cleanMessage: message, referencedFiles: [] };
    }

    private extractCodeBlocks(content: string): Array<{code: string, language: string}> {
        const blocks: Array<{code: string, language: string}> = [];
        const regex = /```(\w+)?\n([\s\S]*?)```/g;
        let match;

        while ((match = regex.exec(content)) !== null) {
            blocks.push({ language: match[1] || 'typescript', code: match[2].trim() });
        }
        return blocks;
    }

    private sendMessageToWebview(message: any) {
        if (this.webview) {
            this.webview.postMessage(message);
        }
    }

    private getHtmlContent(webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
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
        #chat { flex: 1; overflow-y: auto; padding: 16px; }
        .message {
            margin-bottom: 16px;
            padding: 12px;
            border-radius: 8px;
            border: 1px solid var(--vscode-panel-border);
        }
        .user-message { background: var(--vscode-input-background); }
        .assistant-message { background: var(--vscode-editor-background); }
        .message-header {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-bottom: 8px;
            display: flex;
            justify-content: space-between;
        }
        .thinking { color: var(--vscode-descriptionForeground); font-style: italic; padding: 12px; }
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
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        /* FLOATING SELECTION INDICATOR */
        #selection-popup {
            position: fixed;
            bottom: 100px;
            right: 20px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            padding: 12px 16px;
            border-radius: 8px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.4);
            z-index: 9999;
            display: none;
            animation: slideIn 0.3s ease-out;
        }

        @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
        }

        #selection-popup.show { display: flex; align-items: center; gap: 12px; }

        /* Model dropdown */
        .model-btn {
            width: 100%;
            background: var(--vscode-input-background);
            color: var(--vscode-foreground);
            border: 1px solid var(--vscode-input-border);
            padding: 10px 12px;
            border-radius: 6px;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .model-btn:hover { background: var(--vscode-list-hoverBackground); }
        
        .model-dropdown {
            position: absolute;
            bottom: calc(100% + 4px);
            left: 0;
            right: 0;
            background: var(--vscode-dropdown-background);
            border: 1px solid var(--vscode-dropdown-border);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.3);
            max-height: 300px;
            overflow-y: auto;
            z-index: 1000;
            display: none;
            padding: 4px;
        }
        .model-dropdown.open { display: block; }
        .model-option {
            padding: 8px 12px;
            cursor: pointer;
            border-radius: 4px;
        }
        .model-option:hover { background: var(--vscode-list-hoverBackground); }

        /* References badges */
        .refs {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            padding: 8px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
        }
        .badge button {
            background: transparent;
            border: none;
            color: inherit;
            cursor: pointer;
            padding: 0;
            font-size: 14px;
            opacity: 0.7;
        }
        .badge button:hover { opacity: 1; }

        .input-form {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 8px;
        }
        .input-form:focus-within {
            outline: 2px solid var(--vscode-focusBorder);
            outline-offset: -2px;
        }
        textarea {
            width: 100%;
            background: transparent;
            color: var(--vscode-input-foreground);
            border: none;
            padding: 12px 16px;
            font-family: inherit;
            font-size: 13px;
            resize: none;
            min-height: 100px;
            outline: none;
        }
        .toolbar {
            display: flex;
            justify-content: space-between;
            padding: 8px 12px;
            border-top: 1px solid var(--vscode-panel-border);
        }
        .toolbar button {
            background: transparent;
            color: var(--vscode-descriptionForeground);
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
        }
        .toolbar button:hover {
            background: var(--vscode-list-hoverBackground);
            color: var(--vscode-foreground);
        }
        .send-btn {
            background: var(--vscode-button-background) !important;
            color: var(--vscode-button-foreground) !important;
            font-weight: 600;
        }
        .send-btn:hover { background: var(--vscode-button-hoverBackground) !important; }

        code { background: var(--vscode-textCodeBlock-background); padding: 2px 4px; border-radius: 3px; }
        pre { background: var(--vscode-textCodeBlock-background); padding: 12px; border-radius: 4px; margin: 8px 0; position: relative; }
        
        .code-wrapper { position: relative; margin: 12px 0; }
        .code-wrapper:hover .apply-btn { opacity: 1; }
        .apply-btn {
            position: absolute;
            top: 8px;
            right: 8px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            border-radius: 6px;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.2s;
            font-size: 12px;
            z-index: 10;
        }
        .apply-btn:hover { background: var(--vscode-button-hoverBackground); }
    </style>
</head>
<body>
    <div id="chat"></div>
    
    <!-- FLOATING SELECTION INDICATOR -->
    <div id="selection-popup">
        <div id="selection-text"></div>
        <button onclick="addSelection()" style="background:rgba(255,255,255,0.2);border:none;padding:6px 12px;border-radius:4px;cursor:pointer;color:inherit;font-weight:600">Add to Chat</button>
        <button onclick="hidePopup()" style="background:transparent;border:none;color:inherit;cursor:pointer;font-size:18px;padding:0 4px;opacity:0.7">×</button>
    </div>
    
    <div id="input-container">
        <!-- Model selector -->
        <div style="position:relative">
            <button id="model-btn" class="model-btn">
                <span><span id="model-icon">🤖</span> <span id="model-name">Auto</span></span>
                <span>▼</span>
            </button>
            <div id="model-dropdown" class="model-dropdown"></div>
        </div>

        <!-- Input -->
        <div class="input-form">
            <input type="file" id="file-input" accept="image/*" multiple style="display:none" />
            <div id="refs" class="refs" style="display:none"></div>
            <textarea id="input" placeholder="Ask anything... (Drag images here)"></textarea>
            <div class="toolbar">
                <div style="display:flex;gap:8px">
                    <button id="code-btn">📎 Code</button>
                    <button id="img-btn">🖼️ Image</button>
                </div>
                <button id="send-btn" class="send-btn">Send →</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let models = [];
        let selectedModel = { value: 'auto', name: 'Auto', icon: '🤖' };
        let refs = [];
        let imgs = [];
        let detectedSelection = null;

        const chat = document.getElementById('chat');
        const input = document.getElementById('message-input') || document.getElementById('input');
        const refsDiv = document.getElementById('refs');
        const popup = document.getElementById('selection-popup');
        const modelBtn = document.getElementById('model-btn');
        const modelDropdown = document.getElementById('model-dropdown');

        // ENTER KEY
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
            }
        });

        // Buttons
        document.getElementById('send-btn').onclick = send;
        document.getElementById('code-btn').onclick = () => {
            if (detectedSelection) {
                refs.push(detectedSelection);
                updateRefs();
                hidePopup();
            } else {
                alert('Select some code first!');
            }
        };
        document.getElementById('img-btn').onclick = () => document.getElementById('file-input').click();
        
        modelBtn.onclick = (e) => {
            e.stopPropagation();
            modelDropdown.classList.toggle('open');
        };
        document.onclick = () => modelDropdown.classList.remove('open');

        // File input
        document.getElementById('file-input').onchange = (e) => {
            const files = e.target.files;
            if (files) {
                Array.from(files).forEach(file => {
                    if (file.type.startsWith('image/')) {
                        const reader = new FileReader();
                        reader.onload = (ev) => {
                            imgs.push({ name: file.name, type: file.type, data: ev.target.result });
                            updateRefs();
                        };
                        reader.readAsDataURL(file);
                    }
                });
            }
        };

        window.addSelection = () => {
            if (detectedSelection) {
                refs.push(detectedSelection);
                updateRefs();
                hidePopup();
            }
        };

        window.hidePopup = () => {
            popup.classList.remove('show');
        };

        function send() {
            const text = input.value.trim();
            if (text || imgs.length > 0) {
                vscode.postMessage({
                    type: 'chat',
                    text,
                    references: refs,
                    images: imgs,
                    preferredModel: selectedModel.value === 'auto' ? null : selectedModel.value
                });
                input.value = '';
                refs = [];
                imgs = [];
                updateRefs();
            }
        }

        function updateRefs() {
            if (refs.length === 0 && imgs.length === 0) {
                refsDiv.style.display = 'none';
                return;
            }
            refsDiv.style.display = 'flex';
            refsDiv.innerHTML = '';
            
            refs.forEach((ref, i) => {
                const badge = document.createElement('div');
                badge.className = 'badge';
                const range = ref.startLine === ref.endLine ? ':' + ref.startLine : ':' + ref.startLine + '-' + ref.endLine;
                badge.innerHTML = '📎 ' + ref.fileName + range + ' <button onclick="removeRef(' + i + ')">×</button>';
                refsDiv.appendChild(badge);
            });
            
            imgs.forEach((img, i) => {
                const badge = document.createElement('div');
                badge.className = 'badge';
                badge.innerHTML = '🖼️ ' + img.name + ' <button onclick="removeImg(' + i + ')">×</button>';
                refsDiv.appendChild(badge);
            });
        }

        window.removeRef = (i) => { refs.splice(i, 1); updateRefs(); };
        window.removeImg = (i) => { imgs.splice(i, 1); updateRefs(); };

        // Message handlers
        window.addEventListener('message', (e) => {
            const msg = e.data;
            
            if (msg.type === 'availableModels') {
                models = msg.models;
                updateModels();
            } else if (msg.type === 'selectionDetected') {
                detectedSelection = msg.selection;
                const range = msg.selection.startLine === msg.selection.endLine 
                    ? ':' + msg.selection.startLine 
                    : ':' + msg.selection.startLine + '-' + msg.selection.endLine;
                document.getElementById('selection-text').textContent = '📎 ' + msg.selection.fileName + range;
                popup.classList.add('show');
            } else if (msg.type === 'userMessage') {
                addMsg('user', msg.text, null, null, null, msg.references);
            } else if (msg.type === 'streamStart') {
                startStream(msg.model);
            } else if (msg.type === 'streamChunk') {
                updateStream(msg.chunk);
            } else if (msg.type === 'assistantMessage') {
                finishStream(msg);
            } else if (msg.type === 'thinking') {
                addThinking();
            } else if (msg.type === 'error') {
                removeThinking();
                addError(msg.text);
            } else if (msg.type === 'clear') {
                chat.innerHTML = '';
            }
        });

        function updateModels() {
            modelDropdown.innerHTML = '<div class="model-option" onclick="pickModel({value:\\'auto\\',name:\\'Auto\\',icon:\\'🤖\\'})">🤖 Auto</div>';
            models.forEach(m => {
                let icon = m.name.includes('Gemini') ? '✨' : m.name.includes('GPT') ? '🧠' : m.name.includes('Claude') ? '🎭' : '🤖';
                modelDropdown.innerHTML += '<div class="model-option" onclick="pickModel({value:\\''+m.name+'\\',name:\\''+m.name+'\\',icon:\\''+icon+'\\'})">'+icon+' '+m.name+(m.isFree?' (FREE)':'')+'</div>';
            });
        }

        window.pickModel = (m) => {
            selectedModel = m;
            document.getElementById('model-name').textContent = m.name;
            document.getElementById('model-icon').textContent = m.icon;
            modelDropdown.classList.remove('open');
        };

        let streamDiv = null, streamContent = '';

        function startStream(model) {
            removeThinking();
            streamDiv = document.createElement('div');
            streamDiv.className = 'message assistant-message';
            streamDiv.innerHTML = '<div class="message-header"><span>'+model+'</span></div><div id="stream"></div>';
            chat.appendChild(streamDiv);
            chat.scrollTop = chat.scrollHeight;
            streamContent = '';
        }

        function updateStream(chunk) {
            if (streamDiv) {
                streamContent += chunk;
                document.getElementById('stream').innerHTML = format(streamContent);
                chat.scrollTop = chat.scrollHeight;
            }
        }

        function finishStream(msg) {
            if (streamDiv) {
                streamDiv.innerHTML = '';
                addMsgContent(streamDiv, msg.text, msg.model, msg.tokens, msg.cost, null, msg.codeBlocks, msg.targetFile);
                streamDiv = null;
            } else {
                addMsg('assistant', msg.text, msg.model, msg.tokens, msg.cost, null, msg.codeBlocks, msg.targetFile);
            }
        }

        function addMsg(role, text, model, tokens, cost, refs, codeBlocks, targetFile) {
            const div = document.createElement('div');
            div.className = 'message ' + role + '-message';
            addMsgContent(div, text, model, tokens, cost, refs, codeBlocks, targetFile);
            chat.appendChild(div);
            chat.scrollTop = chat.scrollHeight;
        }

        function addMsgContent(div, text, model, tokens, cost, refs, codeBlocks, targetFile) {
            let html = '';
            if (model) {
                html += '<div class="message-header"><span>'+model+'</span><span>'+tokens+' tokens • $'+cost.toFixed(4)+'</span></div>';
            }
            if (refs && refs.length > 0) {
                refs.forEach(r => {
                    const range = r.startLine === r.endLine ? ':'+r.startLine : ':'+r.startLine+'-'+r.endLine;
                    html += '<div style="font-size:11px;opacity:0.7;margin-bottom:8px">📎 '+r.fileName+range+'</div>';
                });
            }
            html += '<div>'+format(text)+'</div>';
            
            if (codeBlocks && codeBlocks.length > 0 && targetFile) {
                div.dataset.code = codeBlocks[0].code;
                div.dataset.file = targetFile;
            }
            
            div.innerHTML = html;
        }

        function addThinking() {
            const div = document.createElement('div');
            div.className = 'thinking';
            div.id = 'thinking';
            div.textContent = 'Thinking...';
            chat.appendChild(div);
            chat.scrollTop = chat.scrollHeight;
        }

        function removeThinking() {
            const t = document.getElementById('thinking');
            if (t) t.remove();
        }

        function addError(msg) {
            const div = document.createElement('div');
            div.className = 'error';
            div.textContent = 'Error: ' + msg;
            chat.appendChild(div);
            chat.scrollTop = chat.scrollHeight;
        }

        function escape(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        let blockId = 0;
        function format(text) {
            let f = escape(text);
            f = f.replace(/\\\`\\\`\\\`(\\w+)?\\n([\\s\\S]*?)\\\`\\\`\\\`/g, (m, lang, code) => {
                const id = 'block-' + (blockId++);
                return '<div class="code-wrapper"><button class="apply-btn" onclick="applyBlock(\\''+id+'\\')">Apply</button><pre><code id="'+id+'" data-code="'+code.replace(/"/g,'&quot;')+'">'+code+'</code></pre></div>';
            });
            f = f.replace(/\\\`([^\\\`]+)\\\`/g, '<code>$1</code>');
            f = f.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
            f = f.replace(/\\n/g, '<br>');
            return f;
        }

        window.applyBlock = (id) => {
            const code = document.getElementById(id);
            if (code) {
                const msg = code.closest('.message');
                vscode.postMessage({
                    type: 'applyCode',
                    code: code.getAttribute('data-code'),
                    filePath: msg ? msg.dataset.file : null
                });
            }
        };

        // Init
        vscode.postMessage({ type: 'getAvailableModels' });
    </script>
</body>
</html>`;
    }
}
