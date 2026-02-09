import Anthropic from '@anthropic-ai/sdk';
import { IModelProvider, ModelConfig, ModelCapability, ChatMessage, CompletionOptions, CompletionResponse } from '../types';

export class AnthropicProvider implements IModelProvider {
    private client: Anthropic | null = null;
    private apiKey: string;
    private config: ModelConfig;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        if (apiKey) {
            this.client = new Anthropic({ apiKey });
        }

        this.config = {
            name: 'claude-3-haiku',
            provider: 'Anthropic',
            maxTokens: 200000,
            costPer1kTokens: 0.00025, // Very cheap for Haiku
            capabilities: [
                'code-completion',
                'code-explanation',
                'code-refactoring',
                'bug-fixing',
                'documentation',
                'general-chat'
            ]
        };
    }

    getName(): string {
        return 'Claude 3 Haiku';
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
        // Anthropic sometimes offers free credits for new users
        return false; // Conservative estimate
    }

    supportsCapability(capability: ModelCapability): boolean {
        return this.config.capabilities.includes(capability);
    }

    getQualityScore(capability: ModelCapability): number {
        const scores: Record<ModelCapability, number> = {
            'code-completion': 7,
            'code-explanation': 9,
            'code-refactoring': 9,
            'bug-fixing': 9,
            'documentation': 8,
            'general-chat': 8
        };
        return scores[capability] || 8;
    }

    async complete(
        messages: ChatMessage[],
        options?: CompletionOptions
    ): Promise<CompletionResponse> {
        if (!this.client) {
            throw new Error('Anthropic client not configured');
        }

        try {
            // Extract system message if present
            const systemMessage = messages.find(m => m.role === 'system');
            const chatMessages = messages.filter(m => m.role !== 'system');

            const response = await this.client.messages.create({
                model: 'claude-3-haiku-20240307',
                max_tokens: options?.maxTokens || 1000,
                temperature: options?.temperature || 0.7,
                system: systemMessage?.content,
                messages: chatMessages.map(m => ({
                    role: m.role as 'user' | 'assistant',
                    content: m.content
                }))
            });

            const content = response.content[0]?.type === 'text' 
                ? response.content[0].text 
                : '';

            return {
                content,
                tokensUsed: {
                    input: response.usage.input_tokens,
                    output: response.usage.output_tokens,
                    total: response.usage.input_tokens + response.usage.output_tokens
                },
                model: 'claude-3-haiku',
                finishReason: response.stop_reason || 'end_turn',
                cost: (
                    (response.usage.input_tokens / 1000) * this.config.costPer1kTokens +
                    (response.usage.output_tokens / 1000) * this.config.costPer1kTokens * 5
                )
            };
        } catch (error: any) {
            throw new Error(`Anthropic API error: ${error.message}`);
        }
    }
}
