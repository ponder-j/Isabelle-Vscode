/*  Author:     Claude (Anthropic)

Function definition completion provider for Isabelle.
*/

'use strict';

import {
  CompletionItemProvider,
  CompletionItem,
  CompletionItemKind,
  TextDocument,
  Position,
  Range,
  SnippetString,
  workspace
} from 'vscode';

// Keywords that start a function definition
const FUNCTION_KEYWORDS = ['fun', 'function', 'primrec', 'definition', 'primcorec', 'corec'];

/**
 * Completion provider for type signature after `::`
 * Triggers when user types `:: ` after a function keyword
 */
export class TypeSignatureCompletionProvider implements CompletionItemProvider {

  provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] {
    const lineText = document.lineAt(position.line).text;
    const textBeforeCursor = lineText.substring(0, position.character);

    // Check if we just typed `:: ` after a function keyword
    const typeAnnotationPattern = new RegExp(`^\\s*(${FUNCTION_KEYWORDS.join('|')})\\s+\\w+\\s+::\\s*$`);

    if (typeAnnotationPattern.test(textBeforeCursor)) {
      const item = new CompletionItem('Function type signature', CompletionItemKind.Snippet);
      item.insertText = new SnippetString('"$1 ⇒ $2" where');
      item.detail = 'Complete function type signature';
      item.documentation = 'Inserts type signature template with placeholder for input and output types';
      item.sortText = '0'; // Make it appear first

      return [item];
    }

    return [];
  }
}

/**
 * Completion provider for function body after `where`
 * Triggers when user presses Enter after `where` or after a function definition line
 * Supports multi-line function definitions
 */
export class FunctionBodyCompletionProvider implements CompletionItemProvider {

  provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] {
    if (position.line === 0) return [];

    const previousLine = document.lineAt(position.line - 1).text;
    const currentLineText = document.lineAt(position.line).text;
    const textBeforeCursor = currentLineText.substring(0, position.character);

    // Don't trigger if current line already has content (not just whitespace)
    if (textBeforeCursor.trim() !== '') return [];

    // Check if previous line is empty - indicates user pressed Enter twice (wants to stop)
    if (previousLine.trim() === '') return [];

    const result = this.extractFunctionInfo(document, position.line - 1);
    if (!result) return [];

    const { functionName, keyword } = result;

    // Use ≡ for definition, = for other keywords
    const equalSign = keyword === 'definition' ? '≡' : '=';

    // Calculate the range to replace (from start of line to cursor position)
    // This will delete any auto-indentation
    const rangeToReplace = new Range(
      new Position(position.line, 0),
      position
    );

    // Case 1: Previous line ends with 'where' - this is the first function definition
    if (previousLine.trim().endsWith('where')) {
      const item = new CompletionItem('First function definition', CompletionItemKind.Snippet);
      item.insertText = new SnippetString(`  "${functionName} $1 ${equalSign} $2"`);
      item.range = rangeToReplace;  // Replace the auto-indented whitespace
      item.detail = `First pattern for ${functionName}`;
      item.documentation = 'Inserts first function definition pattern';
      item.sortText = '0';
      return [item];
    }

    // Case 2: Previous line is a function definition - add another pattern with |
    if (this.isFunctionDefinitionLine(previousLine, functionName, equalSign)) {
      const item = new CompletionItem('Continue function definition', CompletionItemKind.Snippet);
      item.insertText = new SnippetString(`| "${functionName} $1 ${equalSign} $2"`);
      item.range = rangeToReplace;  // Replace the auto-indented whitespace
      item.detail = `Next pattern for ${functionName}`;
      item.documentation = 'Inserts additional function definition pattern with | separator';
      item.sortText = '0';
      return [item];
    }

    return [];
  }

  /**
   * Check if a line is a function definition line
   * Matches pattern: optional | followed by "functionName ... = ..." or "functionName ... ≡ ..."
   */
  private isFunctionDefinitionLine(line: string, functionName: string, equalSign: string): boolean {
    // Escape the equal sign for regex (≡ doesn't need escaping, but = does in some contexts)
    const escapedEqual = equalSign.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Match pattern: optional whitespace, optional |, whitespace, "functionName, then anything, then = or ≡
    const pattern = new RegExp(
      `^\\s*\\|?\\s*"${functionName}\\s+.*${escapedEqual}.*"?\\s*$`
    );
    return pattern.test(line);
  }

  /**
   * Extract function name and keyword from the function definition
   * Looks for pattern: `fun functionName ::` or similar
   * Also checks for existing function definition lines
   * Returns {functionName, keyword} or null
   */
  private extractFunctionInfo(document: TextDocument, startLine: number): { functionName: string; keyword: string } | null {
    // Search backwards from the current position
    for (let i = startLine; i >= Math.max(0, startLine - 20); i--) {
      const line = document.lineAt(i).text;

      // First try to match the function keyword declaration
      const keywordPattern = new RegExp(`^\\s*(${FUNCTION_KEYWORDS.join('|')})\\s+(\\w+)\\s+::`);
      const keywordMatch = keywordPattern.exec(line);
      if (keywordMatch) {
        return {
          functionName: keywordMatch[2],  // Function name
          keyword: keywordMatch[1]         // Keyword (fun, function, definition, etc.)
        };
      }

      // Also try to extract from existing function definition line
      // Pattern: "functionName ... = ..." or "functionName ... ≡ ..."
      const defPattern = /^\s*\|?\s*"(\w+)\s+.*[=≡]/;
      const defMatch = defPattern.exec(line);
      if (defMatch) {
        // Found a definition line, need to search further back for the keyword
        const functionName = defMatch[1];
        // Continue searching backwards for the keyword
        for (let j = i - 1; j >= Math.max(0, startLine - 20); j--) {
          const prevLine = document.lineAt(j).text;
          const keywordPattern2 = new RegExp(`^\\s*(${FUNCTION_KEYWORDS.join('|')})\\s+${functionName}\\s+::`);
          const keywordMatch2 = keywordPattern2.exec(prevLine);
          if (keywordMatch2) {
            return {
              functionName: functionName,
              keyword: keywordMatch2[1]
            };
          }
        }
        // If we can't find the keyword, default to 'fun' and return the function name
        return {
          functionName: functionName,
          keyword: 'fun'  // Default fallback
        };
      }
    }

    return null;
  }
}

/**
 * Completion provider for theory header structure
 * Handles automatic completion at file start and after 'theory' and 'imports' lines
 */
export class TheoryStructureCompletionProvider implements CompletionItemProvider {

  provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] {
    const currentLineText = document.lineAt(position.line).text;
    const textBeforeCursor = currentLineText.substring(0, position.character);

    // Don't trigger if current line already has content (not just whitespace)
    if (textBeforeCursor.trim() !== '') return [];

    // Calculate the range to replace (from start of line to cursor position)
    const rangeToReplace = new Range(
      new Position(position.line, 0),
      position
    );

    // Case 0: At file beginning - suggest theory header with filename
    if (this.isFileBeginning(document, position.line)) {
      const fileName = this.extractFileName(document.uri.fsPath);
      if (fileName) {
        const item = new CompletionItem('theory header skeleton', CompletionItemKind.Snippet);
        // Multi-line snippet with tab stops:
        // $1 -> after imports
        // $2 -> inside theory body before end
        // We replace the leading whitespace the user typed (rangeToReplace covers it)
        item.insertText = new SnippetString(
          `theory ${fileName}\n  imports $1\nbegin\n\n$2\n\nend`
        );
        item.range = rangeToReplace; // remove any initial spaces the user typed
        item.detail = `Insert full theory skeleton for ${fileName}`;
        item.documentation = 'Inserts:\n  theory <name>\n    imports <TAB to fill>\n  begin\n  <TAB to body placeholder>\n  end';
        item.sortText = '0';
        return [item];
      }
    }

    // For other cases, we need a previous line
    if (position.line === 0) return [];

    const previousLine = document.lineAt(position.line - 1).text;

    // Case 1: Previous line starts with 'theory' - add 'imports'
    if (/^\s*theory\s+\w+/.test(previousLine.trim())) {
      const item = new CompletionItem('imports', CompletionItemKind.Keyword);
      item.insertText = new SnippetString('  imports $1');
      item.range = rangeToReplace;
      item.detail = 'Theory imports section';
      item.documentation = 'Add imports declaration after theory header';
      item.sortText = '0';
      return [item];
    }

    // Case 2: Previous line starts with 'imports' - add 'begin'
    if (/^\s*imports\b/.test(previousLine)) {
      const item = new CompletionItem('begin', CompletionItemKind.Keyword);
      item.insertText = 'begin';
      item.range = rangeToReplace;
      item.detail = 'Begin theory body';
      item.documentation = 'Start the theory body section';
      item.sortText = '0';
      return [item];
    }

    return [];
  }

  /**
   * Check if we're at the beginning of the file (all previous lines are empty or whitespace)
   */
  private isFileBeginning(document: TextDocument, currentLine: number): boolean {
    // If we're on line 0, we're definitely at the beginning
    if (currentLine === 0) return true;

    // Check if all previous lines are empty or contain only whitespace
    for (let i = 0; i < currentLine; i++) {
      if (document.lineAt(i).text.trim() !== '') {
        return false;
      }
    }
    return true;
  }

  /**
   * Extract filename without .thy extension from file path
   */
  private extractFileName(filePath: string): string | null {
    // Extract the base name from the path
    const pathParts = filePath.split('/');
    const fileName = pathParts[pathParts.length - 1];

    // Remove .thy extension if present
    if (fileName.endsWith('.thy')) {
      return fileName.slice(0, -4);
    }

    return fileName || null;
  }
}

/**
 * Completion provider for proof outlines
 * Suggests proof structure from "Proof outline with cases:" output
 */
export class ProofOutlineCompletionProvider implements CompletionItemProvider {
  private cachedProofOutline: string | null = null;

  /**
   * Update the cached proof outline
   */
  public updateProofOutline(outline: string | null) {
    this.cachedProofOutline = outline;
  }

  provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] {
    // Only trigger if we have a cached proof outline
    if (!this.cachedProofOutline) return [];

    const currentLineText = document.lineAt(position.line).text;
    const textBeforeCursor = currentLineText.substring(0, position.character);

    // Don't trigger if current line already has content (not just whitespace)
    if (textBeforeCursor.trim() !== '') return [];

    // Check if previous line contains 'proof'
    if (position.line === 0) return [];

    const previousLine = document.lineAt(position.line - 1).text;
    if (!/\bproof\b/.test(previousLine)) return [];

    // Get the indentation of the proof line
    const proofIndent = previousLine.match(/^(\s*)/)?.[1] || '';

    // Calculate the range to replace
    const rangeToReplace = new Range(
      new Position(position.line, 0),
      position
    );

    // Convert the proof outline to a snippet with proper indentation
    const snippetText = this.convertToSnippet(this.cachedProofOutline, proofIndent);

    const item = new CompletionItem('Proof outline (from Isabelle)', CompletionItemKind.Snippet);
    item.insertText = new SnippetString(snippetText);
    item.range = rangeToReplace;
    item.detail = 'Insert proof structure from Isabelle';
    item.documentation = 'Inserts the proof outline suggested by Isabelle, with sorry as tab stops';
    item.sortText = '0';

    return [item];
  }

  /**
   * Convert proof outline to snippet format
   * Replace each 'sorry' with $1, $2, $3, etc.
   * Add base indentation (from proof line) to each line
   * Add two extra spaces to the first line
   */
  private convertToSnippet(outline: string, baseIndent: string): string {
    let tabStopIndex = 1;
    const withTabStops = outline.replace(/\bsorry\b/g, () => {
      return `\${${tabStopIndex++}:sorry}`;
    });

    // Add base indentation to each line
    const lines = withTabStops.split('\n');
    const indentedLines = lines.map((line, index) => {
      if (index === 0) {
        // First line gets base indent + 2 extra spaces
        return baseIndent + '  ' + line;
      } else {
        // Other lines just get base indent
        return baseIndent + line;
      }
    });

    return indentedLines.join('\n');
  }
}
