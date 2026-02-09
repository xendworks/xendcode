import Groq from 'groq-sdk';
import { IModelProvider, ModelConfig, ModelCapability, ChatMessage, CompletionOptions, CompletionResponse } from '../types';

export class GroqProvider implements IModelProvider {
    private client: Groq | null = null;
    private apiKey: string;
    private config: ModelConfig;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        if (apiKey) {
            this.client = new Groq({ apiKey });
        }

        this.config = {
            name: 'llama-3.3-70b',
            provider: 'Groq',
            maxTokens: 8192,
            costPer1kTokens: 0, // Free tier available
            capabilities: [
                'code-completion',
                'code-explanation',
                'code-refactoring',
                'bug-fixing',
                'documentation',
                'general-chat'
            ],
            freeTier: {
                requestsPerMinute: 30
            }
        };
    }

    getName(): string {
        return 'Groq Llama 3.3 70B';
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
        return true; // Groq has free tier with fast inference
    }

    supportsCapability(capability: ModelCapability): boolean {
        return this.config.capabilities.includes(capability);
    }

    getQualityScore(capability: ModelCapability): number {
        const scores: Record<ModelCapability, number> = {
            'code-completion': 7,
            'code-explanation': 7,
            'code-refactoring': 7,
            'bug-fixing': 7,
            'documentation': 7,
            'general-chat': 8
        };
        return scores[capability] || 7;
    }

    async complete(
        messages: ChatMessage[],
        options?: CompletionOptions
    ): Promise<CompletionResponse> {
        if (!this.client) {
            throw new Error('Groq client not configured');
        }

        try {
            const response = await this.client.chat.completions.create({
                model: 'llama-3.3-70b-versatile',
                messages: messages as any,
                max_tokens: options?.maxTokens || 1000,
                temperature: options?.temperature || 0.7
            });

            const content = response.choices[0]?.message?.content || '';
            const usage = response.usage;

            return {
                content,
                tokensUsed: {
                    input: usage?.prompt_tokens || 0,
                    output: usage?.completion_tokens || 0,
                    total: usage?.total_tokens || 0
                },
                model: 'llama-3.1-70b',
                finishReason: response.choices[0]?.finish_reason || 'stop',
                cost: 0 // Free tier
            };
        } catch (error: any) {
            throw new Error(`Groq API error: ${error.message}`);
        }
    }
}
