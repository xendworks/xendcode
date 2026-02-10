import { GoogleGenerativeAI } from '@google/generative-ai';
import { IModelProvider, ModelConfig, ModelCapability, ChatMessage, CompletionOptions, CompletionResponse } from '../types';

export class GeminiProvider implements IModelProvider {
    private client: GoogleGenerativeAI | null = null;
    private apiKey: string;
    private config: ModelConfig;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        if (apiKey) {
            this.client = new GoogleGenerativeAI(apiKey);
        }

        this.config = {
            name: 'gemini-2.5-flash',
            provider: 'Google',
            maxTokens: 1048576, // 1M context
            costPer1kTokens: 0, // FREE tier!
            capabilities: [
                'code-completion',
                'code-explanation',
                'code-refactoring',
                'bug-fixing',
                'documentation',
                'general-chat'
            ],
            freeTier: {
                requestsPerMinute: 60 // Free tier: 60 requests per minute
            }
        };
    }

    getName(): string {
        return 'Google Gemini 2.5 Flash';
    }

    getConfig(): ModelConfig {
        return this.config;
    }

    isConfigured(): boolean {
        return !!this.apiKey && this.apiKey.length > 0;
    }

    isAvailable(): boolean {
        return this.client !== null;
    }

    hasFreeTierAvailable(): boolean {
        return true; // Gemini has generous free tier!
    }

    supportsCapability(capability: ModelCapability): boolean {
        return this.config.capabilities.includes(capability);
    }

    getQualityScore(capability: ModelCapability): number {
        const scores: Record<ModelCapability, number> = {
            'code-completion': 8,
            'code-explanation': 8,
            'code-refactoring': 8,
            'bug-fixing': 8,
            'documentation': 9,
            'general-chat': 8
        };
        return scores[capability] || 8;
    }

    async complete(
        messages: ChatMessage[],
        options?: CompletionOptions
    ): Promise<CompletionResponse> {
        if (!this.client) {
            throw new Error('Gemini client not configured');
        }

        // Try multiple model names in order of preference (2026 stable models)
        const modelNames = [
            'gemini-2.5-flash',        // Stable, best price-performance
            'gemini-2.5-pro',          // Stable, advanced thinking
            'gemini-3-flash-preview',  // Latest preview
            'gemini-3-pro-preview',    // Latest pro preview
            'gemini-2.5-flash-lite'    // Fallback ultra-fast
        ];

        let lastError: Error | null = null;

        for (const modelName of modelNames) {
            try {
                const model = this.client.getGenerativeModel({ 
                    model: modelName
                });

                // Check if any message has images (multimodal)
                const hasImages = messages.some(m => m.images && m.images.length > 0);

                if (hasImages) {
                    // Multimodal request with images
                    const parts: any[] = [];

                    for (const message of messages) {
                        // Add text part
                        parts.push({
                            text: `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`
                        });

                        // Add image parts if present
                        if (message.images && message.images.length > 0) {
                            for (const img of message.images) {
                                // Convert data URL to inline data format
                                const base64Data = img.data.split(',')[1]; // Remove "data:image/png;base64," prefix
                                const mimeType = img.data.split(';')[0].split(':')[1]; // Extract mime type

                                parts.push({
                                    inlineData: {
                                        data: base64Data,
                                        mimeType: mimeType
                                    }
                                });
                            }
                        }
                    }

                    const result = await model.generateContent(parts);
                    const response = result.response;
                    const content = response.text();

                    const estimatedTokens = Math.ceil(content.length / 4);
                    const inputTokens = Math.ceil(JSON.stringify(parts).length / 4);

                    return {
                        content,
                        tokensUsed: {
                            input: inputTokens,
                            output: estimatedTokens,
                            total: inputTokens + estimatedTokens
                        },
                        model: modelName,
                        finishReason: 'stop',
                        cost: 0
                    };
                } else {
                    // Text-only request
                    const prompt = messages
                        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
                        .join('\n\n');

                    const result = await model.generateContent(prompt);
                    const response = result.response;
                    const content = response.text();

                    const estimatedTokens = Math.ceil(content.length / 4);
                    const inputTokens = Math.ceil(prompt.length / 4);

                    return {
                        content,
                        tokensUsed: {
                            input: inputTokens,
                            output: estimatedTokens,
                            total: inputTokens + estimatedTokens
                        },
                        model: modelName,
                        finishReason: 'stop',
                        cost: 0
                    };
                }
            } catch (error: any) {
                lastError = error;
                console.error(`Gemini ${modelName} failed:`, error.message);
                continue;
            }
        }

        throw new Error(`Gemini API error: ${lastError?.message}. Tried models: ${modelNames.join(', ')}`);
    }

    async completeStream(
        messages: ChatMessage[],
        options?: CompletionOptions,
        onChunk?: (chunk: string) => void
    ): Promise<CompletionResponse> {
        if (!this.client) {
            throw new Error('Gemini client not configured');
        }

        const modelNames = [
            'gemini-2.5-flash',
            'gemini-2.5-pro',
            'gemini-3-flash-preview',
            'gemini-3-pro-preview',
            'gemini-2.5-flash-lite'
        ];

        let lastError: Error | null = null;

        for (const modelName of modelNames) {
            try {
                const model = this.client.getGenerativeModel({ 
                    model: modelName
                });

                const hasImages = messages.some(m => m.images && m.images.length > 0);

                if (hasImages) {
                    // Multimodal streaming
                    const parts: any[] = [];

                    for (const message of messages) {
                        parts.push({
                            text: `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`
                        });

                        if (message.images && message.images.length > 0) {
                            for (const img of message.images) {
                                const base64Data = img.data.split(',')[1];
                                const mimeType = img.data.split(';')[0].split(':')[1];

                                parts.push({
                                    inlineData: {
                                        data: base64Data,
                                        mimeType: mimeType
                                    }
                                });
                            }
                        }
                    }

                    const result = await model.generateContentStream(parts);
                    let fullContent = '';

                    for await (const chunk of result.stream) {
                        const chunkText = chunk.text();
                        if (chunkText) {
                            fullContent += chunkText;
                            if (onChunk) {
                                onChunk(chunkText);
                            }
                        }
                    }

                    const estimatedTokens = Math.ceil(fullContent.length / 4);
                    const inputTokens = Math.ceil(JSON.stringify(parts).length / 4);

                    return {
                        content: fullContent,
                        tokensUsed: {
                            input: inputTokens,
                            output: estimatedTokens,
                            total: inputTokens + estimatedTokens
                        },
                        model: modelName,
                        finishReason: 'stop',
                        cost: 0
                    };
                } else {
                    // Text-only streaming
                    const prompt = messages
                        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
                        .join('\n\n');

                    const result = await model.generateContentStream(prompt);
                    let fullContent = '';

                    for await (const chunk of result.stream) {
                        const chunkText = chunk.text();
                        if (chunkText) {
                            fullContent += chunkText;
                            if (onChunk) {
                                onChunk(chunkText);
                            }
                        }
                    }

                    const estimatedTokens = Math.ceil(fullContent.length / 4);
                    const inputTokens = Math.ceil(prompt.length / 4);

                    return {
                        content: fullContent,
                        tokensUsed: {
                            input: inputTokens,
                            output: estimatedTokens,
                            total: inputTokens + estimatedTokens
                        },
                        model: modelName,
                        finishReason: 'stop',
                        cost: 0
                    };
                }
            } catch (error: any) {
                lastError = error;
                console.error(`Gemini stream ${modelName} failed:`, error.message);
                continue;
            }
        }

        throw new Error(`Gemini API error: ${lastError?.message}. Tried models: ${modelNames.join(', ')}`);
    }
}
