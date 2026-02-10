import { IModelProvider, ModelConfig, ModelCapability, ChatMessage, CompletionOptions, CompletionResponse } from '../types';

export class MistralProvider implements IModelProvider {
    private apiKey: string;
    private config: ModelConfig;

    constructor(apiKey: string) {
        this.apiKey = apiKey;

        this.config = {
            name: 'mistral-large-latest',
            provider: 'Mistral',
            maxTokens: 128000,
            costPer1kTokens: 0, // Free tier
            capabilities: [
                'code-completion',
                'code-explanation',
                'code-refactoring',
                'bug-fixing',
                'documentation',
                'general-chat'
            ],
            freeTier: {
                requestsPerMinute: 30 // Free tier: 30 req/min
            }
        };
    }

    getName(): string {
        return 'Mistral Large';
    }

    getConfig(): ModelConfig {
        return this.config;
    }

    isConfigured(): boolean {
        return !!this.apiKey && this.apiKey.length > 0;
    }

    isAvailable(): boolean {
        return this.isConfigured();
    }

    hasFreeTierAvailable(): boolean {
        return true;
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
        if (!this.apiKey) {
            throw new Error('Mistral API key not configured');
        }

        try {
            const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'mistral-large-latest',
                    messages: messages.map(m => ({
                        role: m.role,
                        content: m.content
                    })),
                    max_tokens: options?.maxTokens || 2000,
                    temperature: options?.temperature || 0.7
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Mistral API error: ${error.message || response.statusText}`);
            }

            const data = await response.json();
            const choice = data.choices[0];

            return {
                content: choice.message.content,
                tokensUsed: {
                    input: data.usage?.prompt_tokens || 0,
                    output: data.usage?.completion_tokens || 0,
                    total: data.usage?.total_tokens || 0
                },
                model: 'mistral-large-latest',
                finishReason: choice.finish_reason,
                cost: 0 // Free!
            };
        } catch (error: any) {
            throw new Error(`Mistral completion failed: ${error.message}`);
        }
    }

    async completeStream(
        messages: ChatMessage[],
        options?: CompletionOptions,
        onChunk?: (chunk: string) => void
    ): Promise<CompletionResponse> {
        // Mistral supports streaming similar to OpenAI
        return this.complete(messages, options);
    }
}
