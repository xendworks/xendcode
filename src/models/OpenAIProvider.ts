import OpenAI from 'openai';
import { IModelProvider, ModelConfig, ModelCapability, ChatMessage, CompletionOptions, CompletionResponse } from '../types';

export class OpenAIProvider implements IModelProvider {
    private client: OpenAI | null = null;
    private apiKey: string;
    private config: ModelConfig;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        if (apiKey) {
            this.client = new OpenAI({ apiKey });
        }

        this.config = {
            name: 'gpt-3.5-turbo',
            provider: 'OpenAI',
            maxTokens: 16385,
            costPer1kTokens: 0.002, // $0.002 per 1k tokens
            capabilities: [
                'code-completion',
                'code-explanation',
                'code-refactoring',
                'bug-fixing',
                'documentation',
                'general-chat'
            ],
            freeTier: {
                tokensPerMonth: 50000 // ~$5 free credit for new users
            }
        };
    }

    getName(): string {
        return 'OpenAI GPT-3.5 Turbo';
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
        // OpenAI provides $5 credit for new accounts
        return true;
    }

    supportsCapability(capability: ModelCapability): boolean {
        return this.config.capabilities.includes(capability);
    }

    getQualityScore(capability: ModelCapability): number {
        // Quality scores out of 10
        const scores: Record<ModelCapability, number> = {
            'code-completion': 8,
            'code-explanation': 8,
            'code-refactoring': 7,
            'bug-fixing': 7,
            'documentation': 8,
            'general-chat': 8
        };
        return scores[capability] || 7;
    }

    async complete(
        messages: ChatMessage[],
        options?: CompletionOptions
    ): Promise<CompletionResponse> {
        if (!this.client) {
            throw new Error('OpenAI client not configured');
        }

        try {
            const response = await this.client.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: messages as any,
                max_tokens: options?.maxTokens || 1000,
                temperature: options?.temperature || 0.7,
                stream: false
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
                model: 'gpt-3.5-turbo',
                finishReason: response.choices[0]?.finish_reason || 'stop',
                cost: ((usage?.total_tokens || 0) / 1000) * this.config.costPer1kTokens
            };
        } catch (error: any) {
            throw new Error(`OpenAI API error: ${error.message}`);
        }
    }

    async completeStream(
        messages: ChatMessage[],
        options?: CompletionOptions,
        onChunk?: (chunk: string) => void
    ): Promise<CompletionResponse> {
        if (!this.client) {
            throw new Error('OpenAI client not configured');
        }

        try {
            const stream = await this.client.chat.completions.create({
                model: 'gpt-3.5-turbo',
                messages: messages as any,
                max_tokens: options?.maxTokens || 1000,
                temperature: options?.temperature || 0.7,
                stream: true
            });

            let fullContent = '';
            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    fullContent += content;
                    if (onChunk) {
                        onChunk(content);
                    }
                }
            }

            // Estimate tokens (rough approximation)
            const estimatedTokens = Math.ceil(fullContent.length / 4);
            const estimatedInputTokens = Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4);

            return {
                content: fullContent,
                tokensUsed: {
                    input: estimatedInputTokens,
                    output: estimatedTokens,
                    total: estimatedInputTokens + estimatedTokens
                },
                model: 'gpt-3.5-turbo',
                finishReason: 'stop',
                cost: ((estimatedInputTokens + estimatedTokens) / 1000) * this.config.costPer1kTokens
            };
        } catch (error: any) {
            throw new Error(`OpenAI API error: ${error.message}`);
        }
    }
}
