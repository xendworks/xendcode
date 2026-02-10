import * as vscode from 'vscode';
import { IModelProvider, ModelConfig, ModelCapability } from '../types';
import { OpenAIProvider } from '../models/OpenAIProvider';
import { AnthropicProvider } from '../models/AnthropicProvider';
import { GeminiProvider } from '../models/GeminiProvider';
import { CohereProvider } from '../models/CohereProvider';
import { GrokProvider } from '../models/GrokProvider';
import { GroqProvider } from '../models/GroqProvider';
import { DeepSeekProvider } from '../models/DeepSeekProvider';

export class ModelManager {
    private providers: Map<string, IModelProvider> = new Map();
    private context: vscode.ExtensionContext;
    private routingStrategy: 'cost-optimized' | 'performance-optimized' | 'balanced' = 'cost-optimized';
    private modelUsageCount: Map<string, number> = new Map();
    private lastUsedModel: string | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.initializeProviders();
        this.loadRoutingStrategy();
        this.loadUsageStats();
    }

    private loadUsageStats() {
        const stats = this.context.globalState.get<Record<string, number>>('modelUsageCount', {});
        this.modelUsageCount = new Map(Object.entries(stats));
    }

    private saveUsageStats() {
        const stats = Object.fromEntries(this.modelUsageCount);
        this.context.globalState.update('modelUsageCount', stats);
    }

    private initializeProviders() {
        const config = vscode.workspace.getConfiguration('xendcode');

        // Initialize all providers
        const providers: IModelProvider[] = [
            new GeminiProvider(config.get('models.gemini.apiKey', '')),
            new GrokProvider(config.get('models.grok.apiKey', '')),
            new GroqProvider(config.get('models.groq.apiKey', '')),
            new DeepSeekProvider(config.get('models.deepseek.apiKey', '')),
            new CohereProvider(config.get('models.cohere.apiKey', '')),
            new OpenAIProvider(config.get('models.openai.apiKey', '')),
            new AnthropicProvider(config.get('models.anthropic.apiKey', ''))
        ];

        for (const provider of providers) {
            if (provider.isConfigured()) {
                this.providers.set(provider.getName(), provider);
            }
        }
    }

    private loadRoutingStrategy() {
        const config = vscode.workspace.getConfiguration('xendcode');
        this.routingStrategy = config.get('routing.strategy', 'cost-optimized');
    }

    /**
     * Select the best model based on task requirements and routing strategy
     */
    async selectModel(
        task: ModelCapability,
        contextSize: number,
        preferFree: boolean = true
    ): Promise<IModelProvider | null> {
        const availableProviders = Array.from(this.providers.values())
            .filter(p => p.isAvailable() && p.supportsCapability(task));

        if (availableProviders.length === 0) {
            return null;
        }

        // Filter by free tier if preferred
        let candidates = preferFree
            ? availableProviders.filter(p => p.hasFreeTierAvailable())
            : availableProviders;

        // Fallback to paid if no free tier available
        if (candidates.length === 0) {
            candidates = availableProviders;
        }

        // Sort by routing strategy
        switch (this.routingStrategy) {
            case 'cost-optimized':
                return this.selectCostOptimized(candidates, contextSize);
            case 'performance-optimized':
                return this.selectPerformanceOptimized(candidates, task);
            case 'balanced':
                return this.selectBalanced(candidates, contextSize, task);
            default:
                const selected = candidates[0];
                
                // Increment usage count
                const currentCount = this.modelUsageCount.get(selected.getName()) || 0;
                this.modelUsageCount.set(selected.getName(), currentCount + 1);
                this.lastUsedModel = selected.getName();
                this.saveUsageStats();
                
                return selected;
        }
    }

    /**
     * Get model usage statistics for display
     */
    getUsageStats(): Map<string, number> {
        return new Map(this.modelUsageCount);
    }

    private selectCostOptimized(
        providers: IModelProvider[],
        contextSize: number
    ): IModelProvider {
        // Sort by cost AND usage count (rotate among free models to avoid rate limits)
        return providers.sort((a, b) => {
            const costA = a.getConfig().costPer1kTokens * contextSize / 1000;
            const costB = b.getConfig().costPer1kTokens * contextSize / 1000;
            
            // If both are free (or similar cost), rotate based on usage
            if (Math.abs(costA - costB) < 0.0001) {
                const usageA = this.modelUsageCount.get(a.getName()) || 0;
                const usageB = this.modelUsageCount.get(b.getName()) || 0;
                
                // Prefer less-used model (load balancing!)
                return usageA - usageB;
            }
            
            return costA - costB;
        })[0];
    }

    private selectPerformanceOptimized(
        providers: IModelProvider[],
        task: ModelCapability
    ): IModelProvider {
        // Sort by quality score for the task
        return providers.sort((a, b) => {
            const scoreA = a.getQualityScore(task);
            const scoreB = b.getQualityScore(task);
            return scoreB - scoreA;
        })[0];
    }

    private selectBalanced(
        providers: IModelProvider[],
        contextSize: number,
        task: ModelCapability
    ): IModelProvider {
        // Balance between cost and performance
        return providers.sort((a, b) => {
            const costA = a.getConfig().costPer1kTokens * contextSize / 1000;
            const costB = b.getConfig().costPer1kTokens * contextSize / 1000;
            const qualityA = a.getQualityScore(task);
            const qualityB = b.getQualityScore(task);
            
            // Score: higher quality, lower cost is better
            const scoreA = (qualityA / 10) - (costA * 100);
            const scoreB = (qualityB / 10) - (costB * 100);
            
            return scoreB - scoreA;
        })[0];
    }

    /**
     * Get all configured providers
     */
    getProviders(): IModelProvider[] {
        return Array.from(this.providers.values());
    }

    /**
     * Get a specific provider by name
     */
    getProvider(name: string): IModelProvider | undefined {
        return this.providers.get(name);
    }

    /**
     * Refresh providers when configuration changes
     */
    refresh() {
        this.providers.clear();
        this.initializeProviders();
    }

    /**
     * Get model grounding recommendations
     */
    getModelGrounding(task: ModelCapability): string {
        const recommendations: Record<ModelCapability, string[]> = {
            'code-completion': [
                'gemini-2.5-flash',
                'gemini-1.5-flash', 
                'deepseek-coder',
                'gpt-3.5-turbo',
                'llama-3.3-70b',
                'claude-3-haiku',
                'gpt-4-turbo'
            ],
            'code-explanation': [
                'claude-3-haiku',
                'claude-3-sonnet',
                'gemini-2.5-flash',
                'gpt-3.5-turbo',
                'gpt-4',
                'llama-3.3-70b',
                'gemini-pro'
            ],
            'code-refactoring': [
                'claude-3-sonnet',
                'claude-3.5-sonnet',
                'gpt-4',
                'deepseek-coder',
                'gemini-2.5-pro',
                'gpt-4-turbo',
                'claude-3-opus'
            ],
            'bug-fixing': [
                'claude-3-sonnet',
                'claude-3.5-sonnet',
                'gpt-4',
                'gemini-2.5-pro',
                'gemini-1.5-pro',
                'deepseek-coder',
                'gpt-4-turbo'
            ],
            'documentation': [
                'gpt-3.5-turbo',
                'gemini-2.5-flash',
                'gemini-pro',
                'cohere-command-a',
                'claude-3-haiku',
                'command-r-plus',
                'llama-3.3-70b'
            ],
            'general-chat': [
                'gemini-2.5-flash',
                'gemini-1.5-flash',
                'gpt-3.5-turbo',
                'claude-3-haiku',
                'llama-3.3-70b',
                'gpt-4',
                'cohere-command-a'
            ]
        };

        const models = recommendations[task] || [];
        return `Recommended models for ${task}:\n${models.map((m, i) => `${i + 1}. ${m}`).join('\n')}`;
    }
}
