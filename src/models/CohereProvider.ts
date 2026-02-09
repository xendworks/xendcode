import { CohereClient } from 'cohere-ai';
import { IModelProvider, ModelConfig, ModelCapability, ChatMessage, CompletionOptions, CompletionResponse } from '../types';

export class CohereProvider implements IModelProvider {
    private client: CohereClient | null = null;
    private apiKey: string;
    private config: ModelConfig;

    constructor(apiKey: string) {
        this.apiKey = apiKey;
        if (apiKey) {
            this.client = new CohereClient({ token: apiKey });
        }

        this.config = {
            name: 'command-a-03-2025',
            provider: 'Cohere',
            maxTokens: 4096,
            costPer1kTokens: 0.0005,
            capabilities: [
                'code-completion',
                'code-explanation',
                'documentation',
                'general-chat'
            ],
            freeTier: {
                requestsPerMinute: 100 // Trial has 100 calls
            }
        };
    }

    getName(): string {
        return 'Cohere Command-A';
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
        return true;
    }

    supportsCapability(capability: ModelCapability): boolean {
        return this.config.capabilities.includes(capability);
    }

    getQualityScore(capability: ModelCapability): number {
        const scores: Record<ModelCapability, number> = {
            'code-completion': 5,
            'code-explanation': 7,
            'code-refactoring': 5,
            'bug-fixing': 5,
            'documentation': 8,
            'general-chat': 7
        };
        return scores[capability] || 6;
    }

    async complete(
        messages: ChatMessage[],
        options?: CompletionOptions
    ): Promise<CompletionResponse> {
        if (!this.client) {
            throw new Error('Cohere client not configured');
        }

        try {
            // Convert to Cohere Chat API format
            const chatHistory = messages.slice(0, -1).map(m => ({
                role: (m.role === 'user' ? 'USER' : 'CHATBOT') as 'USER' | 'CHATBOT',
                message: m.content
            }));

            const lastMessage = messages[messages.length - 1];

            const response = await this.client.chat({
                model: 'command-a-03-2025',
                message: lastMessage.content,
                chatHistory: chatHistory.length > 0 ? chatHistory as any : undefined,
                maxTokens: options?.maxTokens || 1000,
                temperature: options?.temperature || 0.7
            });

            const content = response.text || '';
            
            // Use Cohere's token usage if available, otherwise estimate
            const inputTokens = response.meta?.tokens?.inputTokens || Math.ceil(lastMessage.content.length / 4);
            const outputTokens = response.meta?.tokens?.outputTokens || Math.ceil(content.length / 4);

            return {
                content,
                tokensUsed: {
                    input: inputTokens,
                    output: outputTokens,
                    total: inputTokens + outputTokens
                },
                model: 'command-a-03-2025',
                finishReason: response.finishReason || 'COMPLETE',
                cost: ((inputTokens + outputTokens) / 1000) * this.config.costPer1kTokens
            };
        } catch (error: any) {
            throw new Error(`Cohere API error: ${error.message}`);
        }
    }
}
