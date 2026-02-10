import * as vscode from 'vscode';

interface TokenUsage {
    model: string;
    tokensUsed: number;
    tokensInput: number;
    tokensOutput: number;
    timestamp: number;
    cost: number;
}

interface ModelLimits {
    freeTokensPerMonth?: number;
    freeTokensPerDay?: number;
    freeRequestsPerMinute?: number;
    maxContextTokens: number;
}

export class TokenManager {
    private context: vscode.ExtensionContext;
    private usage: TokenUsage[] = [];
    private modelLimits: Map<string, ModelLimits> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.loadUsageHistory();
        this.initializeModelLimits();
    }

    private initializeModelLimits() {
        // Define free tier limits for various models
        this.modelLimits.set('gemini-1.5-flash', {
            freeRequestsPerMinute: 60,
            maxContextTokens: 1000000
        });

        this.modelLimits.set('gpt-3.5-turbo', {
            freeTokensPerMonth: 50000, // Approximate $5 credit
            maxContextTokens: 16385
        });

        this.modelLimits.set('claude-3-haiku', {
            maxContextTokens: 200000
        });

        this.modelLimits.set('cohere-command', {
            freeRequestsPerMinute: 100,
            maxContextTokens: 4096
        });

        this.modelLimits.set('grok-llama', {
            freeRequestsPerMinute: 30,
            maxContextTokens: 8192
        });

        this.modelLimits.set('deepseek-coder', {
            maxContextTokens: 16384
        });
    }

    private loadUsageHistory() {
        const stored = this.context.globalState.get<TokenUsage[]>('tokenUsage', []);
        // Only keep last 30 days
        const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
        this.usage = stored.filter(u => u.timestamp > thirtyDaysAgo);
    }

    private async saveUsageHistory() {
        await this.context.globalState.update('tokenUsage', this.usage);
    }

    /**
     * Record token usage for a model
     */
    async recordUsage(
        model: string,
        tokensInput: number,
        tokensOutput: number,
        cost: number
    ) {
        const usage: TokenUsage = {
            model,
            tokensUsed: tokensInput + tokensOutput,
            tokensInput,
            tokensOutput,
            timestamp: Date.now(),
            cost
        };

        this.usage.push(usage);
        await this.saveUsageHistory();
    }

    /**
     * Check if a model has free tier tokens available
     */
    canUseFreeTier(model: string): boolean {
        const limits = this.modelLimits.get(model);
        if (!limits) {
            return false;
        }

        const now = Date.now();

        // Check daily limit
        if (limits.freeTokensPerDay) {
            const dayAgo = now - (24 * 60 * 60 * 1000);
            const usedToday = this.usage
                .filter(u => u.model === model && u.timestamp > dayAgo)
                .reduce((sum, u) => sum + u.tokensUsed, 0);

            if (usedToday >= limits.freeTokensPerDay) {
                return false;
            }
        }

        // Check monthly limit
        if (limits.freeTokensPerMonth) {
            const monthAgo = now - (30 * 24 * 60 * 60 * 1000);
            const usedThisMonth = this.usage
                .filter(u => u.model === model && u.timestamp > monthAgo)
                .reduce((sum, u) => sum + u.tokensUsed, 0);

            if (usedThisMonth >= limits.freeTokensPerMonth) {
                return false;
            }
        }

        // Check rate limit
        if (limits.freeRequestsPerMinute) {
            const minuteAgo = now - (60 * 1000);
            const requestsLastMinute = this.usage
                .filter(u => u.model === model && u.timestamp > minuteAgo)
                .length;

            if (requestsLastMinute >= limits.freeRequestsPerMinute) {
                return false;
            }
        }

        return true;
    }

    /**
     * Calculate total available free tokens across all providers
     */
    getTotalAvailableTokens(): number {
        // Generous free tier estimates per month
        const freeTokensAvailable = {
            'gemini': 10000000,      // ~10M tokens/month (60 req/min, ~1M context)
            'grok': 5000000,         // ~5M tokens/month (fast inference)
            'openai': 50000,         // $5 credit (~50K tokens)
            'cohere': 100000,        // 100 calls * ~1K tokens
            'anthropic': 0,          // No free tier
            'deepseek': 1000000      // Budget pricing (~1M tokens for cheap)
        };

        return Object.values(freeTokensAvailable).reduce((sum, tokens) => sum + tokens, 0);
    }

    /**
     * Get usage statistics
     */
    getUsageStats() {
        const byModel: Record<string, any> = {};
        const now = Date.now();
        const monthAgo = now - (30 * 24 * 60 * 60 * 1000);
        const dayAgo = now - (24 * 60 * 60 * 1000);

        // Get first usage date to calculate actual days
        const allUsage = this.usage.filter(u => u.timestamp > monthAgo);
        const firstUsageTimestamp = allUsage.length > 0 
            ? Math.min(...allUsage.map(u => u.timestamp))
            : now;
        const daysActive = Math.max(1, Math.ceil((now - firstUsageTimestamp) / (24 * 60 * 60 * 1000)));

        // Group by model
        let totalTokensAllTime = 0;
        let totalTokensToday = 0;
        let totalCost = 0;

        for (const usage of allUsage) {
            if (!byModel[usage.model]) {
                byModel[usage.model] = {
                    tokensUsed: 0,
                    requests: 0,
                    estimatedCost: 0,
                    percentUsed: 0
                };
            }

            byModel[usage.model].tokensUsed += usage.tokensUsed;
            byModel[usage.model].requests += 1;
            byModel[usage.model].estimatedCost += usage.cost;
            
            totalTokensAllTime += usage.tokensUsed;
            totalCost += usage.cost;

            // Count today's tokens
            if (usage.timestamp > dayAgo) {
                totalTokensToday += usage.tokensUsed;
            }
        }

        // Calculate percent used for free tiers
        for (const [model, stats] of Object.entries(byModel)) {
            const limits = this.modelLimits.get(model);
            if (limits?.freeTokensPerMonth) {
                stats.percentUsed = (stats.tokensUsed / limits.freeTokensPerMonth) * 100;
            }
        }

        // Calculate averages
        const avgTokensPerDay = Math.round(totalTokensAllTime / daysActive);
        const avgTokensPer30Days = Math.round(totalTokensAllTime / daysActive * 30);

        // Get total available tokens
        const totalAvailableTokens = this.getTotalAvailableTokens();

        // Percentage saved
        const percentSaved = totalCost < 1 ? 100 : 99;

        return {
            byModel,
            totalCost,
            totalTokensAllTime,
            totalTokensToday,
            totalAvailableTokens,
            avgTokensPerDay,
            avgTokensPer30Days,
            daysActive,
            percentSaved
        };
    }

    /**
     * Estimate token count for text (rough approximation)
     */
    estimateTokens(text: string): number {
        // Rough estimate: 1 token ≈ 4 characters for English text
        return Math.ceil(text.length / 4);
    }

    /**
     * Get optimal token budget based on free tier availability
     */
    getOptimalTokenBudget(model: string): number {
        const limits = this.modelLimits.get(model);
        if (!limits) {
            return 4000; // Default conservative budget
        }

        if (!this.canUseFreeTier(model)) {
            return 2000; // More conservative if no free tier
        }

        // Use aggressive optimization setting
        const config = vscode.workspace.getConfiguration('xendcode');
        const maxTokens = config.get('tokenManagement.maxContextTokens', 8000);
        
        return Math.min(maxTokens, limits.maxContextTokens * 0.5);
    }
}
