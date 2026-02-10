export type ModelCapability = 
    | 'code-completion'
    | 'code-explanation'
    | 'code-refactoring'
    | 'bug-fixing'
    | 'documentation'
    | 'general-chat';

export interface ModelConfig {
    name: string;
    provider: string;
    maxTokens: number;
    costPer1kTokens: number;
    capabilities: ModelCapability[];
    freeTier?: {
        tokensPerMonth?: number;
        tokensPerDay?: number;
        requestsPerMinute?: number;
    };
}

export interface IModelProvider {
    getName(): string;
    getConfig(): ModelConfig;
    isConfigured(): boolean;
    isAvailable(): boolean;
    hasFreeTierAvailable(): boolean;
    supportsCapability(capability: ModelCapability): boolean;
    getQualityScore(capability: ModelCapability): number;
    
    complete(
        messages: ChatMessage[],
        options?: CompletionOptions
    ): Promise<CompletionResponse>;
    
    // Stream support (optional)
    completeStream?(
        messages: ChatMessage[],
        options?: CompletionOptions,
        onChunk?: (chunk: string) => void
    ): Promise<CompletionResponse>;
}

export interface ImageAttachment {
    name: string;
    type: string;
    data: string; // Base64 data URL
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
    images?: ImageAttachment[]; // Optional image attachments for vision models
}

export interface CompletionOptions {
    maxTokens?: number;
    temperature?: number;
    stream?: boolean;
    stopSequences?: string[];
}

export interface CompletionResponse {
    content: string;
    tokensUsed: {
        input: number;
        output: number;
        total: number;
    };
    model: string;
    finishReason: string;
    cost: number;
}

export interface UsageStats {
    model: string;
    tokensUsed: number;
    requests: number;
    estimatedCost: number;
    percentUsed: number;
}
