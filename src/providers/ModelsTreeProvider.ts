import * as vscode from 'vscode';
import { ModelManager } from '../core/ModelManager';

export class ModelsTreeProvider implements vscode.TreeDataProvider<ModelItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<ModelItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private modelManager: ModelManager) {}

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: ModelItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ModelItem): Thenable<ModelItem[]> {
        if (!element) {
            return Promise.resolve(this.getRootItems());
        }
        return Promise.resolve([]);
    }

    private getRootItems(): ModelItem[] {
        const providers = this.modelManager.getProviders();
        const items: ModelItem[] = [];

        if (providers.length === 0) {
            items.push(new ModelItem(
                'No models configured',
                'Configure API keys in settings',
                vscode.TreeItemCollapsibleState.None,
                false
            ));
            return items;
        }

        for (const provider of providers) {
            const config = provider.getConfig();
            const isFree = provider.hasFreeTierAvailable();
            const status = provider.isAvailable() ? '✅' : '❌';
            
            const label = `${status} ${provider.getName()}`;
            const description = isFree ? 'FREE' : `$${config.costPer1kTokens}/1k`;
            
            items.push(new ModelItem(
                label,
                description,
                vscode.TreeItemCollapsibleState.None,
                provider.isAvailable()
            ));
        }

        return items;
    }
}

class ModelItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly description: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly isAvailable: boolean
    ) {
        super(label, collapsibleState);
        this.description = description;
        this.iconPath = new vscode.ThemeIcon(
            isAvailable ? 'check' : 'x'
        );
    }
}
