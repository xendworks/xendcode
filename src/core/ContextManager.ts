import * as vscode from 'vscode';
import { TokenManager } from './TokenManager';

interface ContextItem {
    type: 'file' | 'selection' | 'diagnostic' | 'symbol';
    content: string;
    priority: number;
    tokens: number;
    metadata?: any;
}

export class ContextManager {
    private tokenManager: TokenManager;
    private contextCache: Map<string, ContextItem[]> = new Map();

    constructor(tokenManager: TokenManager) {
        this.tokenManager = tokenManager;
    }

    /**
     * Build optimized context for a query
     */
    async buildContext(
        query: string,
        tokenBudget: number
    ): Promise<{ context: string; tokensUsed: number; summary: string }> {
        const items: ContextItem[] = [];

        // Gather context from various sources
        items.push(...await this.getActiveFileContext());
        items.push(...await this.getWorkspaceContext(query));
        items.push(...await this.getDiagnosticsContext());
        items.push(...await this.getSymbolContext(query));

        // Sort by priority (higher first)
        items.sort((a, b) => b.priority - a.priority);

        // Pack context within token budget
        const optimized = this.packContext(items, tokenBudget);

        // Create summary
        const summary = this.createContextSummary(items, optimized.tokensUsed);

        return { ...optimized, summary };
    }

    /**
     * Create a human-readable context summary
     */
    private createContextSummary(items: ContextItem[], tokensUsed: number): string {
        const summary: string[] = [];
        
        const selectionItems = items.filter(i => i.type === 'selection');
        if (selectionItems.length > 0) {
            summary.push(`${selectionItems.length} selection(s)`);
        }
        
        const fileItems = items.filter(i => i.type === 'file');
        if (fileItems.length > 0) {
            summary.push(`${fileItems.length} file(s)`);
        }
        
        const diagItems = items.filter(i => i.type === 'diagnostic');
        if (diagItems.length > 0) {
            summary.push(`${diagItems.length} diagnostic(s)`);
        }
        
        return `Context: ${summary.join(', ')} (~${tokensUsed} tokens)`;
    }

    /**
     * Get context from currently active file
     */
    private async getActiveFileContext(): Promise<ContextItem[]> {
        const items: ContextItem[] = [];
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            return items;
        }

        const document = editor.document;
        const selection = editor.selection;

        // Add selected text with high priority
        if (!selection.isEmpty) {
            const selectedText = document.getText(selection);
            items.push({
                type: 'selection',
                content: this.formatCodeBlock(selectedText, document.languageId),
                priority: 10,
                tokens: this.tokenManager.estimateTokens(selectedText),
                metadata: {
                    fileName: document.fileName,
                    lineStart: selection.start.line,
                    lineEnd: selection.end.line
                }
            });
        }

        // Add surrounding context (lower priority)
        const surroundingRange = new vscode.Range(
            Math.max(0, selection.start.line - 20),
            0,
            Math.min(document.lineCount - 1, selection.end.line + 20),
            0
        );
        const surroundingText = document.getText(surroundingRange);
        
        items.push({
            type: 'file',
            content: this.formatCodeBlock(surroundingText, document.languageId),
            priority: 5,
            tokens: this.tokenManager.estimateTokens(surroundingText),
            metadata: {
                fileName: document.fileName
            }
        });

        return items;
    }

    /**
     * Get relevant workspace context based on query
     */
    private async getWorkspaceContext(query: string): Promise<ContextItem[]> {
        const items: ContextItem[] = [];
        
        // Get recently opened files
        const recentFiles = await this.getRecentlyOpenedFiles();
        
        for (const file of recentFiles.slice(0, 3)) {
            try {
                const content = await vscode.workspace.fs.readFile(vscode.Uri.file(file));
                const text = Buffer.from(content).toString('utf8');
                
                // Only include if relevant to query
                if (this.isRelevant(text, query)) {
                    items.push({
                        type: 'file',
                        content: this.formatCodeBlock(text.slice(0, 2000)),
                        priority: 3,
                        tokens: this.tokenManager.estimateTokens(text.slice(0, 2000)),
                        metadata: { fileName: file }
                    });
                }
            } catch (error) {
                // Skip files that can't be read
            }
        }

        return items;
    }

    /**
     * Get diagnostics (errors, warnings) context
     */
    private async getDiagnosticsContext(): Promise<ContextItem[]> {
        const items: ContextItem[] = [];
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            return items;
        }

        const diagnostics = vscode.languages.getDiagnostics(editor.document.uri);
        
        if (diagnostics.length > 0) {
            const diagText = diagnostics
                .slice(0, 5)
                .map(d => `Line ${d.range.start.line + 1}: ${d.message}`)
                .join('\n');

            items.push({
                type: 'diagnostic',
                content: `Current issues:\n${diagText}`,
                priority: 8,
                tokens: this.tokenManager.estimateTokens(diagText),
                metadata: { count: diagnostics.length }
            });
        }

        return items;
    }

    /**
     * Get symbol context (functions, classes) relevant to query
     */
    private async getSymbolContext(query: string): Promise<ContextItem[]> {
        const items: ContextItem[] = [];
        const editor = vscode.window.activeTextEditor;

        if (!editor) {
            return items;
        }

        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                'vscode.executeDocumentSymbolProvider',
                editor.document.uri
            );

            if (symbols) {
                for (const symbol of symbols.slice(0, 10)) {
                    const symbolText = `${symbol.kind}: ${symbol.name}`;
                    if (this.isRelevant(symbolText, query)) {
                        items.push({
                            type: 'symbol',
                            content: `Symbol: ${symbol.name} (${vscode.SymbolKind[symbol.kind]})`,
                            priority: 4,
                            tokens: this.tokenManager.estimateTokens(symbolText),
                            metadata: { symbol }
                        });
                    }
                }
            }
        } catch (error) {
            // Symbols not available for this file
        }

        return items;
    }

    /**
     * Pack context items within token budget using greedy algorithm
     */
    private packContext(
        items: ContextItem[],
        tokenBudget: number
    ): { context: string; tokensUsed: number } {
        const selected: ContextItem[] = [];
        let tokensUsed = 0;

        for (const item of items) {
            if (tokensUsed + item.tokens <= tokenBudget) {
                selected.push(item);
                tokensUsed += item.tokens;
            }
        }

        // Build context string
        const context = selected
            .map(item => item.content)
            .join('\n\n---\n\n');

        return { context, tokensUsed };
    }

    /**
     * Check if text is relevant to query
     */
    private isRelevant(text: string, query: string): boolean {
        const queryWords = query.toLowerCase().split(/\s+/);
        const textLower = text.toLowerCase();

        // Simple relevance: at least 2 query words appear in text
        const matches = queryWords.filter(word => 
            word.length > 3 && textLower.includes(word)
        );

        return matches.length >= Math.min(2, queryWords.length);
    }

    /**
     * Format code block with language
     */
    private formatCodeBlock(code: string, language?: string): string {
        const lang = language || '';
        return `\`\`\`${lang}\n${code}\n\`\`\``;
    }

    /**
     * Get recently opened files
     */
    private async getRecentlyOpenedFiles(): Promise<string[]> {
        // This is a simplified version - in production, you'd track file access
        const files: string[] = [];
        
        for (const doc of vscode.workspace.textDocuments) {
            if (doc.uri.scheme === 'file') {
                files.push(doc.uri.fsPath);
            }
        }

        return files;
    }

    /**
     * Optimize context by removing redundant information
     */
    async optimizeContext(): Promise<void> {
        // Clear cache to force rebuild
        this.contextCache.clear();
        
        // Additional optimization strategies can be added here:
        // - Semantic deduplication
        // - Compression techniques
        // - Smart chunking
    }

    /**
     * Get context summary for display
     */
    getContextSummary(context: string): string {
        const lines = context.split('\n').length;
        const tokens = this.tokenManager.estimateTokens(context);
        return `Context: ${lines} lines, ~${tokens} tokens`;
    }
}
