import { IModelProvider, ModelConfig, ModelCapability, ChatMessage, CompletionOptions, CompletionResponse } from '../types';

export class GrokProvider implements IModelProvider {
    private apiKey: string;
    private config: ModelConfig;
    private baseURL = 'https://api.x.ai/v1';

    constructor(apiKey: string) {
        this.apiKey = apiKey;

        this.config = {
            name: 'grok-beta',
            provider: 'Grok',
            maxTokens: 131072,
            costPer1kTokens: 0.005, // $5 per 1M tokens
            capabilities: [
                'code-completion',
                'code-explanation',
                'code-refactoring',
                'bug-fixing',
                'documentation',
                'general-chat'
            ],
            freeTier: {
                tokensPerMonth: 25000 // Free credits for new users
            }
        };
    }

    getName(): string {
        return 'xAI Grok';
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
        return true; // Grok offers free credits
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
        if (!this.apiKey) {
            throw new Error('Grok API key not configured');
        }

        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'grok-beta',
                    messages: messages.map(m => ({
                        role: m.role,
                        content: m.content
                    })),
                    max_tokens: options?.maxTokens || 2000,
                    temperature: options?.temperature || 0.7,
                    stream: false
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Grok API error: ${error.error?.message || response.statusText}`);
            }

            const data = await response.json();
            const choice = data.choices[0];
            const usage = data.usage;

            return {
                content: choice.message.content,
                tokensUsed: {
                    input: usage?.prompt_tokens || 0,
                    output: usage?.completion_tokens || 0,
                    total: usage?.total_tokens || 0
                },
                model: 'grok-beta',
                finishReason: choice.finish_reason || 'stop',
                cost: ((usage?.total_tokens || 0) / 1000) * this.config.costPer1kTokens
            };
        } catch (error: any) {
            throw new Error(`Grok completion failed: ${error.message}`);
        }
    }

    async completeStream(
        messages: ChatMessage[],
        options?: CompletionOptions,
        onChunk?: (chunk: string) => void
    ): Promise<CompletionResponse> {
        if (!this.apiKey) {
            throw new Error('Grok API key not configured');
        }

        try {
            const response = await fetch(`${this.baseURL}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: 'grok-beta',
                    messages: messages.map(m => ({
                        role: m.role,
                        content: m.content
                    })),
                    max_tokens: options?.maxTokens || 2000,
                    temperature: options?.temperature || 0.7,
                    stream: true
                })
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(`Grok API error: ${error.error?.message || response.statusText}`);
            }

            let fullContent = '';
            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (reader) {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    const chunk = decoder.decode(value);
                    const lines = chunk.split('\n').filter(line => line.trim().startsWith('data: '));

                    for (const line of lines) {
                        const data = line.replace('data: ', '');
                        if (data === '[DONE]') continue;

                        try {
                            const json = JSON.parse(data);
                            const content = json.choices[0]?.delta?.content || '';
                            if (content) {
                                fullContent += content;
                                if (onChunk) {
                                    onChunk(content);
                                }
                            }
                        } catch (e) {
                            // Skip invalid JSON
                        }
                    }
                }
            }

            const estimatedTokens = Math.ceil(fullContent.length / 4);
            const inputTokens = Math.ceil(messages.map(m => m.content).join('').length / 4);

            return {
                content: fullContent,
                tokensUsed: {
                    input: inputTokens,
                    output: estimatedTokens,
                    total: inputTokens + estimatedTokens
                },
                model: 'grok-beta',
                finishReason: 'stop',
                cost: ((inputTokens + estimatedTokens) / 1000) * this.config.costPer1kTokens
            };
        } catch (error: any) {
            throw new Error(`Grok stream failed: ${error.message}`);
        }
    }
}
