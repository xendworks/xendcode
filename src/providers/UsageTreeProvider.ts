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

        // Add total savings
        items.push(new UsageItem(
            `Savings: $${stats.totalSavings.toFixed(2)}`,
            '',
            vscode.TreeItemCollapsibleState.None,
            '💰'
        ));

        // Add total cost
        items.push(new UsageItem(
            `Total Cost: $${stats.totalCost.toFixed(4)}`,
            '',
            vscode.TreeItemCollapsibleState.None,
            '💵'
        ));

        // Add per-model usage
        for (const [model, data] of Object.entries(stats.byModel)) {
            const label = `${model}: ${data.tokensUsed.toLocaleString()} tokens`;
            const description = `$${data.estimatedCost.toFixed(4)}`;
            
            items.push(new UsageItem(
                label,
                description,
                vscode.TreeItemCollapsibleState.None,
                '📊'
            ));
        }

        if (items.length === 2) {
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
