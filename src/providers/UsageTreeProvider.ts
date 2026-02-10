import * as vscode from 'vscode';
import { TokenManager } from '../core/TokenManager';

export class UsageTreeProvider implements vscode.TreeDataProvider<UsageItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<UsageItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private tokenManager: TokenManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: UsageItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: UsageItem): Thenable<UsageItem[]> {
        if (!element) {
            return Promise.resolve(this.getRootItems());
        }
        return Promise.resolve([]);
    }

    private getRootItems(): UsageItem[] {
        const stats = this.tokenManager.getUsageStats();
        const items: UsageItem[] = [];

        // Format tokens
        const formatTokens = (tokens: number) => {
            if (tokens >= 1000000) {
                return `${(tokens / 1000000).toFixed(1)}M`;
            }
            return `${(tokens / 1000).toFixed(1)}K`;
        };

        // HERO STAT: Used today / Total available
        items.push(new UsageItem(
            `Today: ${formatTokens(stats.totalTokensToday)}/${formatTokens(stats.totalAvailableTokens)}`,
            'tokens used',
            vscode.TreeItemCollapsibleState.None,
            '📊'
        ));

        // Total used this month
        items.push(new UsageItem(
            `This Month: ${formatTokens(stats.totalTokensAllTime)}`,
            `${stats.daysActive} days active`,
            vscode.TreeItemCollapsibleState.None,
            '🚀'
        ));

        // Average per day
        items.push(new UsageItem(
            `Avg/Day: ${formatTokens(stats.avgTokensPerDay)}`,
            'Daily average',
            vscode.TreeItemCollapsibleState.None,
            '📈'
        ));

        // Cost and savings
        items.push(new UsageItem(
            `You Paid: $${stats.totalCost.toFixed(2)}`,
            `${stats.percentSaved}% saved!`,
            vscode.TreeItemCollapsibleState.None,
            '💰'
        ));

        // Per-model breakdown (if any)
        if (Object.keys(stats.byModel).length > 0) {
            for (const [model, data] of Object.entries(stats.byModel)) {
                const label = `${model}: ${formatTokens(data.tokensUsed)}`;
                const description = `$${data.estimatedCost.toFixed(4)}`;
                
                items.push(new UsageItem(
                    label,
                    description,
                    vscode.TreeItemCollapsibleState.None,
                    '🤖'
                ));
            }
        } else {
            items.push(new UsageItem(
                'No usage yet',
                'Start chatting!',
                vscode.TreeItemCollapsibleState.None,
                '💬'
            ));
        }

        return items;
    }
}

class UsageItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly icon: string
    ) {
        super(label, collapsibleState);
        this.description = description;
        this.iconPath = new vscode.ThemeIcon('graph');
    }
}
