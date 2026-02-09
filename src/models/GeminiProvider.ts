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

                // Combine messages into a prompt
                const prompt = messages
                    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
                    .join('\n\n');

                const result = await model.generateContent(prompt);
                const response = result.response;
                const content = response.text();

                // Gemini doesn't provide token counts in the same way
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
                    cost: 0 // Free!
                };
            } catch (error: any) {
                lastError = error;
                // Try next model name
                continue;
            }
        }

        // All models failed
        throw new Error(`Gemini API error: ${lastError?.message}. Tried models: ${modelNames.join(', ')}`);
    }
}
