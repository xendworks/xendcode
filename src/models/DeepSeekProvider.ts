import axios from 'axios';
import { IModelProvider, ModelConfig, ModelCapability, ChatMessage, CompletionOptions, CompletionResponse } from '../types';

export class DeepSeekProvider implements IModelProvider {
    private apiKey: string;
    private config: ModelConfig;
    private baseURL = 'https://api.deepseek.com/v1';

    constructor(apiKey: string) {
        this.apiKey = apiKey;

        this.config = {
            name: 'deepseek-coder',
            provider: 'DeepSeek',
            maxTokens: 16384,
            costPer1kTokens: 0.0001, // Very cheap!
            capabilities: [
                'code-completion',
                'code-explanation',
                'code-refactoring',
                'bug-fixing',
                'documentation'
            ]
        };
    }

    getName(): string {
        return 'DeepSeek Coder';
    }

    getConfig(): ModelConfig {
        return this.config;
    }

    isConfigured(): boolean {
        return !!this.apiKey && this.apiKey.length > 0;
    }

    isAvailable(): boolean {
        return !!this.apiKey;
    }

    hasFreeTierAvailable(): boolean {
        return false; // Paid but extremely cheap
    }

    supportsCapability(capability: ModelCapability): boolean {
        return this.config.capabilities.includes(capability);
    }

    getQualityScore(capability: ModelCapability): number {
        const scores: Record<ModelCapability, number> = {
            'code-completion': 9, // Excellent for code
            'code-explanation': 8,
            'code-refactoring': 9,
            'bug-fixing': 8,
            'documentation': 7,
            'general-chat': 6
        };
        return scores[capability] || 7;
    }

    async complete(
        messages: ChatMessage[],
        options?: CompletionOptions
    ): Promise<CompletionResponse> {
        if (!this.apiKey) {
            throw new Error('DeepSeek client not configured');
        }

        try {
            const response = await axios.post(
                `${this.baseURL}/chat/completions`,
                {
                    model: 'deepseek-coder',
                    messages: messages,
                    max_tokens: options?.maxTokens || 1000,
                    temperature: options?.temperature || 0.7
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const content = response.data.choices[0]?.message?.content || '';
            const usage = response.data.usage;

            return {
                content,
                tokensUsed: {
                    input: usage?.prompt_tokens || 0,
                    output: usage?.completion_tokens || 0,
                    total: usage?.total_tokens || 0
                },
                model: 'deepseek-coder',
                finishReason: response.data.choices[0]?.finish_reason || 'stop',
                cost: ((usage?.total_tokens || 0) / 1000) * this.config.costPer1kTokens
            };
        } catch (error: any) {
            throw new Error(`DeepSeek API error: ${error.response?.data?.message || error.message}`);
        }
    }
}
