'use strict';

import * as vscode from 'vscode';
import * as fs from 'fs';

export class PrettifySymbolsProvider {
    private decorationType: vscode.TextEditorDecorationType;
    private symbolMap: { [key: string]: string } = {};
    private disposables: vscode.Disposable[] = [];
    private regex: RegExp | undefined;
    private revealMode: 'cursor' | 'selection' = 'selection';
    private lastSelections: readonly vscode.Selection[] = [];
    private isUpdatingSelection = false;

    constructor(context: vscode.ExtensionContext) {
        this.decorationType = vscode.window.createTextEditorDecorationType({
            textDecoration: 'none; display: none;'
        });

        this.loadConfiguration();
        this.loadSymbols(context);

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('isabelle.prettifySymbolsMode')) {
                    this.loadConfiguration();
                    if (vscode.window.activeTextEditor) {
                        this.updateDecorations(vscode.window.activeTextEditor);
                    }
                }
            }),
            vscode.window.onDidChangeActiveTextEditor(editor => {
                if (editor) this.updateDecorations(editor);
            }),
            vscode.workspace.onDidChangeTextDocument(event => {
                if (vscode.window.activeTextEditor && event.document === vscode.window.activeTextEditor.document) {
                    this.updateDecorations(vscode.window.activeTextEditor);
                }
            }),
            vscode.window.onDidChangeTextEditorSelection(event => {
                if (event.textEditor === vscode.window.activeTextEditor) {
                    this.adjustCursorPosition(event.textEditor);
                    this.updateDecorations(event.textEditor);
                }
            }),
            vscode.commands.registerTextEditorCommand('isabelle.deleteLeftSymbol', (editor) => {
                this.handleDeleteLeft(editor);
            })
        );

        if (vscode.window.activeTextEditor) {
            this.updateDecorations(vscode.window.activeTextEditor);
        }
    }

    private loadConfiguration() {
        const config = vscode.workspace.getConfiguration('isabelle');
        this.revealMode = config.get<'cursor' | 'selection'>('prettifySymbolsMode', 'selection');
    }

    private async handleDeleteLeft(editor: vscode.TextEditor) {
        // Only handle in selection mode with valid regex
        if (this.revealMode !== 'selection' || !this.regex) {
            await vscode.commands.executeCommand('deleteLeft');
            return;
        }

        const selection = editor.selection;

        // If there's a non-empty selection, use default behavior
        if (!selection.isEmpty) {
            await vscode.commands.executeCommand('deleteLeft');
            return;
        }

        const cursor = selection.active;
        const line = editor.document.lineAt(cursor.line);
        const text = line.text;

        // Check if cursor is at the right edge of a symbol
        let match;
        this.regex.lastIndex = 0;
        let foundSymbol = false;

        while ((match = this.regex.exec(text))) {
            const startCol = match.index;
            const endCol = match.index + match[0].length;

            // If cursor is exactly at the right edge of a symbol
            if (cursor.character === endCol) {
                foundSymbol = true;
                // Delete the entire symbol
                const range = new vscode.Range(
                    new vscode.Position(cursor.line, startCol),
                    new vscode.Position(cursor.line, endCol)
                );
                await editor.edit(editBuilder => {
                    editBuilder.delete(range);
                });
                return;
            }
        }

        // If not at symbol edge, use default delete behavior
        await vscode.commands.executeCommand('deleteLeft');
    }

    private async loadSymbols(context: vscode.ExtensionContext) {
        try {
            const snippetsPath = context.asAbsolutePath('snippets/isabelle-snippets');
            const content = await fs.promises.readFile(snippetsPath, 'utf8');
            this.symbolMap = JSON.parse(content);
            
            // Create a regex that matches any of the keys
            // Keys are like "\<Rightarrow>", so we need to escape backslash
            const keys = Object.keys(this.symbolMap).sort((a, b) => b.length - a.length);
            if (keys.length === 0) {
                this.regex = undefined;
                return;
            }
            const pattern = keys.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
            this.regex = new RegExp(pattern, 'g');
            
            // Trigger update after loading
            if (vscode.window.activeTextEditor) {
                this.updateDecorations(vscode.window.activeTextEditor);
            }
        } catch (error) {
            console.error('Failed to load Isabelle symbols:', error);
        }
    }

    private adjustCursorPosition(editor: vscode.TextEditor) {
        if (this.revealMode !== 'selection' || !this.regex) {
            this.lastSelections = editor.selections;
            return;
        }
        
        if (this.isUpdatingSelection) return;

        const selections = editor.selections;
        let newSelections: vscode.Selection[] = [];
        let changed = false;

        for (let i = 0; i < selections.length; i++) {
            const selection = selections[i];
            if (!selection.isEmpty) {
                newSelections.push(selection);
                continue;
            }

            const cursor = selection.active;
            const line = editor.document.lineAt(cursor.line);
            const text = line.text;
            
            let match;
            this.regex.lastIndex = 0;
            let bestPos = cursor;
            let found = false;
            
            while ((match = this.regex.exec(text))) {
                const startCol = match.index;
                const endCol = match.index + match[0].length;
                
                // Check if cursor is strictly inside the symbol
                if (cursor.character > startCol && cursor.character < endCol) {
                    changed = true;
                    found = true;
                    
                    // Determine direction based on previous selection
                    const prevSelection = this.lastSelections[i];
                    let jumpToStart = false;
                    
                    if (prevSelection && prevSelection.active.line === cursor.line) {
                        const prevChar = prevSelection.active.character;
                        // If we were at or past the end, and moved left into it -> jump to start
                        if (prevChar >= endCol) {
                            jumpToStart = true;
                        }
                        // If we were at or before start, and moved right into it -> jump to end
                        else if (prevChar <= startCol) {
                            jumpToStart = false;
                        }
                        // If we were already inside (shouldn't happen if logic works, but maybe via click)
                        // Default to end if we can't determine
                    } else {
                        // No previous info or line changed. 
                        // If we clicked inside, maybe jump to nearest edge?
                        // For now, let's default to end as it's more common to type forward.
                        // Or maybe check which edge is closer?
                        if (cursor.character - startCol < endCol - cursor.character) {
                            jumpToStart = true;
                        }
                    }
                    
                    if (jumpToStart) {
                        bestPos = new vscode.Position(cursor.line, startCol);
                    } else {
                        bestPos = new vscode.Position(cursor.line, endCol);
                    }
                    break;
                }
            }
            newSelections.push(found ? new vscode.Selection(bestPos, bestPos) : selection);
        }

        if (changed) {
            this.isUpdatingSelection = true;
            editor.selections = newSelections;
            this.isUpdatingSelection = false;
        }
        
        this.lastSelections = editor.selections;
    }

    public updateDecorations(editor: vscode.TextEditor) {
        if (!this.regex || (editor.document.languageId !== 'isabelle' && editor.document.languageId !== 'isabelle-ml')) {
            return;
        }

        const text = editor.document.getText();
        const decorations: vscode.DecorationOptions[] = [];
        const selections = editor.selections;

        let match;
        this.regex.lastIndex = 0; // Reset regex
        while ((match = this.regex.exec(text))) {
            const symbol = match[0];
            if (this.symbolMap[symbol]) {
                const startPos = editor.document.positionAt(match.index);
                const endPos = editor.document.positionAt(match.index + symbol.length);
                const range = new vscode.Range(startPos, endPos);

                // Check if cursor is inside or touching the range
                // We want to reveal the code if the cursor is "in" it.
                // "In" it usually means the selection intersects.
                let shouldReveal = false;
                for (const selection of selections) {
                    if (this.revealMode === 'selection') {
                        // Reveal ONLY if the selection is NOT empty and intersects the symbol range
                        // This means the user has actively selected part of the symbol
                        if (!selection.isEmpty && selection.intersection(range)) {
                            shouldReveal = true;
                            break;
                        }
                    } else {
                        // cursor mode
                        // Reveal if the cursor (active position) is touching/inside
                        // or if there is an intersection (standard behavior for cursor mode usually implies selection too)
                        if (selection.intersection(range)) {
                            shouldReveal = true;
                            break;
                        }
                    }
                }

                if (!shouldReveal) {
                    decorations.push({
                        range,
                        renderOptions: {
                            before: {
                                contentText: this.symbolMap[symbol],
                                // Match the color of the surrounding text or use a specific color?
                                // Default color is usually fine.
                            }
                        }
                    });
                }
            }
        }

        editor.setDecorations(this.decorationType, decorations);
    }

    public dispose() {
        this.decorationType.dispose();
        this.disposables.forEach(d => d.dispose());
    }
}

export function setup(context: vscode.ExtensionContext) {
    const provider = new PrettifySymbolsProvider(context);
    context.subscriptions.push(provider);
}
