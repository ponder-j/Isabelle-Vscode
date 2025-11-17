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
import * as lsp from './lsp'
import * as fs from 'fs'
import * as path from 'path'

// Keywords that start a function definition
const FUNCTION_KEYWORDS = ['fun', 'function', 'primrec', 'definition', 'primcorec', 'corec'];

/**
 * Symbol converter utility - loads mappings from isabelle.code-snippets
 */
class IsabelleSymbolConverter {
  private static symbolMap: { [key: string]: string } | null = null;
  private static initialized = false;

  /**
   * Initialize symbol mappings from snippets file
   */
  private static initializeSymbolMap(extensionPath: string) {
    if (this.initialized) return;

    try {
      const snippetsPath = path.join(extensionPath, 'snippets', 'isabelle.code-snippets');
      if (!fs.existsSync(snippetsPath)) {
        console.warn('[SymbolConverter] Snippets file not found:', snippetsPath);
        this.symbolMap = {};
        this.initialized = true;
        return;
      }

      const snippetsContent = fs.readFileSync(snippetsPath, 'utf8');
      const snippets = JSON.parse(snippetsContent);

      this.symbolMap = {};

      // Extract symbol mappings from snippets
      for (const [key, value] of Object.entries(snippets)) {
        const snippet = value as any;
        if (snippet.prefix && snippet.body && snippet.body[0]) {
          // Handle different prefix formats
          const prefixes = Array.isArray(snippet.prefix) ? snippet.prefix : [snippet.prefix];
          for (const prefix of prefixes) {
            if (typeof prefix === 'string' && (prefix.startsWith('\\\\') || prefix.startsWith('\\'))) {
              // Convert \\symbol or \symbol to \<symbol> for Isabelle format
              const cleanPrefix = prefix.replace(/^\\\\?/, '');
              const isabelleSymbol = `\\<${cleanPrefix}>`;
              this.symbolMap[isabelleSymbol] = snippet.body[0];
            }
          }
        }
      }

      console.log(`[SymbolConverter] Loaded ${Object.keys(this.symbolMap).length} symbol mappings`);
      this.initialized = true;
    } catch (error) {
      console.error('[SymbolConverter] Failed to initialize symbol map:', error);
      this.symbolMap = {};
      this.initialized = true;
    }
  }

  /**
   * Convert Isabelle escape sequences to Unicode symbols
   */
  static convertToUnicode(text: string, extensionPath: string): string {
    this.initializeSymbolMap(extensionPath);

    if (!this.symbolMap) return text;

    let result = text;
    
    // Sort symbols by length (longest first) to handle overlapping patterns
    const sortedSymbols = Object.keys(this.symbolMap).sort((a, b) => b.length - a.length);
    
    for (const symbol of sortedSymbols) {
      const unicode = this.symbolMap[symbol];
      // Escape special regex characters
      const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escapedSymbol, 'g'), unicode);
    }
    
    return result;
  }
}

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
  // Track the caret position (uri + line) for which the outline was provided
  private outlineCaret: lsp.Caret_Update | null = null;
  private extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
  }

  /**
   * Update the cached proof outline
   */
  public updateProofOutline(outline: string | null, caret?: lsp.Caret_Update) {
    this.cachedProofOutline = outline;
    this.outlineCaret = caret ? { ...caret } : null;
  }

  /**
   * Check if there is a cached proof outline
   */
  public hasCachedOutline(): boolean {
    return this.cachedProofOutline !== null;
  }

  /**
   * Clear cached outline if caret moved away from the proof for which the outline was produced.
   * A simple heuristic: clear when uri differs or when line differs by more than a small threshold.
   */
  public clearIfCaretMoved(newCaret: lsp.Caret_Update | undefined) {
    if (!this.cachedProofOutline || !this.outlineCaret) return;
    if (!newCaret || !newCaret.uri) {
      // no caret info -> be conservative and clear
      this.cachedProofOutline = null;
      this.outlineCaret = null;
      return;
    }

    if (this.outlineCaret.uri !== newCaret.uri) {
      this.cachedProofOutline = null;
      this.outlineCaret = null;
      return;
    }

    // If line information is available, clear when moved sufficiently far away
    if (typeof this.outlineCaret.line === 'number' && typeof newCaret.line === 'number') {
      const distance = Math.abs(this.outlineCaret.line - newCaret.line);
      if (distance > 5) {
        this.cachedProofOutline = null;
        this.outlineCaret = null;
        return;
      }
    }
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
   * Convert Isabelle escape sequences to Unicode
   */
  private convertToSnippet(outline: string, baseIndent: string): string {
    let tabStopIndex = 1;
    
    // Convert Isabelle symbols to Unicode first
    let converted = IsabelleSymbolConverter.convertToUnicode(outline, this.extensionPath);
    
    // Then replace sorry with tab stops
    const withTabStops = converted.replace(/\bsorry\b/g, () => {
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

/**
 * Completion provider for proof state goals
 * Suggests fix/assume structure based on goal variables and assumptions
 */
export class ProofStateCompletionProvider implements CompletionItemProvider {
  private cachedGoal: string | null = null;
  private goalCaret: lsp.Caret_Update | null = null;
  private proofOutlineProvider: ProofOutlineCompletionProvider | null = null;
  private extensionPath: string;

  constructor(extensionPath: string) {
    this.extensionPath = extensionPath;
    console.log('[ProofStateCompletion] ===== Provider instance created =====');
  }

  /**
   * Set the proof outline provider to check for conflicts
   */
  public setProofOutlineProvider(provider: ProofOutlineCompletionProvider) {
    this.proofOutlineProvider = provider;
    console.log('[ProofStateCompletion] Proof outline provider set');
  }

  /**
   * Update the cached goal
   */
  public updateGoal(goal: string | null, caret?: lsp.Caret_Update) {
    console.log('[ProofStateCompletion] ===== updateGoal called =====');
    console.log('[ProofStateCompletion] Goal:', goal ? goal.substring(0, 100) + '...' : 'null');
    console.log('[ProofStateCompletion] Caret:', caret);
    this.cachedGoal = goal;
    this.goalCaret = caret ? { ...caret } : null;
  }

  /**
   * Clear cached goal if caret moved away
   * More strict than proof outline: only keep cache for very nearby lines (within 2 lines)
   */
  public clearIfCaretMoved(newCaret: lsp.Caret_Update | undefined) {
    if (!this.cachedGoal || !this.goalCaret) return;
    if (!newCaret || !newCaret.uri) {
      console.log('[ProofStateCompletion] Clearing cache: no new caret info');
      this.cachedGoal = null;
      this.goalCaret = null;
      return;
    }

    if (this.goalCaret.uri !== newCaret.uri) {
      console.log('[ProofStateCompletion] Clearing cache: different file');
      this.cachedGoal = null;
      this.goalCaret = null;
      return;
    }

    if (typeof this.goalCaret.line === 'number' && typeof newCaret.line === 'number') {
      const distance = Math.abs(this.goalCaret.line - newCaret.line);
      // Stricter distance check: only keep cache if within 2 lines
      // This is because goal completion is typically used immediately after proof/case
      if (distance > 2) {
        console.log(`[ProofStateCompletion] Clearing cache: moved ${distance} lines away`);
        this.cachedGoal = null;
        this.goalCaret = null;
        return;
      }
    }
  }

  provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] {
    console.log('[ProofStateCompletion] provideCompletionItems called');
    console.log('[ProofStateCompletion] Position:', position.line, position.character);
    console.log('[ProofStateCompletion] Has cached goal:', !!this.cachedGoal);
    console.log('[ProofStateCompletion] Goal caret:', this.goalCaret);
    
    // Priority: If proof outline provider has a cached outline, don't provide goal completion
    if (this.proofOutlineProvider && this.proofOutlineProvider.hasCachedOutline()) {
      console.log('[ProofStateCompletion] Proof outline provider has cache, skipping');
      return [];
    }

    // Only trigger if we have a cached goal
    if (!this.cachedGoal) {
      console.log('[ProofStateCompletion] No cached goal');
      return [];
    }

    // Check distance from the cached goal position
    if (this.goalCaret && typeof this.goalCaret.line === 'number') {
      const distance = Math.abs(position.line - this.goalCaret.line);
      if (distance > 2) {
        console.log(`[ProofStateCompletion] Too far from cached goal position (${distance} lines), skipping`);
        return [];
      }
    }

    const currentLineText = document.lineAt(position.line).text;
    const textBeforeCursor = currentLineText.substring(0, position.character);
    console.log('[ProofStateCompletion] Current line:', currentLineText);
    console.log('[ProofStateCompletion] Text before cursor:', textBeforeCursor);

    // Don't trigger if current line already has content (not just whitespace)
    if (textBeforeCursor.trim() !== '') {
      console.log('[ProofStateCompletion] Current line has content, skipping');
      return [];
    }

    // Check if previous line contains 'proof' or 'case'
    if (position.line === 0) {
      console.log('[ProofStateCompletion] At line 0, skipping');
      return [];
    }

    const previousLine = document.lineAt(position.line - 1).text;
    console.log('[ProofStateCompletion] Previous line:', previousLine);
    console.log('[ProofStateCompletion] Previous line matches proof/case/next:', /\b(proof|case|next)\b/.test(previousLine));
    
    if (!/\b(proof|case|next)\b/.test(previousLine)) {
      console.log('[ProofStateCompletion] Previous line does not contain proof/case/next, skipping');
      return [];
    }

    // Detect whether it's a case statement (no extra indent) or proof/next (extra indent)
    const isCase = /\bcase\b/.test(previousLine.trim());
    console.log('[ProofStateCompletion] Is case statement:', isCase);

    // Parse the goal to extract variables and assumptions
    console.log('[ProofStateCompletion] Parsing goal:', this.cachedGoal);
    const parsed = this.parseGoal(this.cachedGoal);
    console.log('[ProofStateCompletion] Parsed result:', parsed);
    
    if (!parsed) {
      console.log('[ProofStateCompletion] Failed to parse goal');
      return [];
    }

    // Get the indentation of the proof/case line
    const baseIndent = previousLine.match(/^(\s*)/)?.[1] || '';

    // Calculate the range to replace
    const rangeToReplace = new Range(
      new Position(position.line, 0),
      position
    );

    // Generate the snippet text with appropriate indentation
    const snippetText = this.generateSnippet(parsed, baseIndent, isCase);
    console.log('[ProofStateCompletion] Generated snippet:', snippetText);

    const item = new CompletionItem('fix/assume (from goal)', CompletionItemKind.Snippet);
    item.insertText = new SnippetString(snippetText);
    item.range = rangeToReplace;
    item.detail = 'Insert fix and assume statements from goal';
    item.documentation = 'Extracts variables and assumptions from the current goal (works after proof, case, or next)';
    item.sortText = '0';

    console.log('[ProofStateCompletion] Returning completion item');
    return [item];
  }

  /**
   * Parse goal to extract variables (after ⋀) and assumptions (before ⟹)
   * Supports both Unicode symbols (⋀, ⟹) and Isabelle escape sequences (\<And>, \<Longrightarrow>)
   */
  private parseGoal(goalText: string): { variables: string[], assumptions: string[] } | null {
    console.log('[ProofStateCompletion] parseGoal input:', goalText);
    
    // Look for patterns like: "1. ⋀n. ... ⟹ ..." or "1. \<And>n. ... \<Longrightarrow> ..."
    // The goal text should contain a line starting with a number followed by a dot
    const lines = goalText.split('\n');
    let goalLine = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\d+\./.test(trimmed)) {
        // Found the goal line, continue collecting until we get the full statement
        goalLine = trimmed;
        // Check if this line and subsequent lines form a complete goal
        const lineIndex = lines.indexOf(line);
        for (let i = lineIndex + 1; i < lines.length; i++) {
          const nextLine = lines[i].trim();
          if (nextLine && !nextLine.startsWith('goal') && !/^\d+\./.test(nextLine)) {
            goalLine += ' ' + nextLine;
          } else {
            break;
          }
        }
        break;
      }
    }

    console.log('[ProofStateCompletion] Extracted goal line:', goalLine);
    
    if (!goalLine) {
      console.log('[ProofStateCompletion] No goal line found');
      return null;
    }

    // Remove the leading "1. " or similar
    goalLine = goalLine.replace(/^\d+\.\s*/, '');
    console.log('[ProofStateCompletion] After removing number:', goalLine);

    // Extract variables after ⋀ or \<And>
    const variables: string[] = [];
    // Try Unicode first, then escape sequence
    let varMatch = goalLine.match(/⋀([^.⟹]+)\./);
    if (!varMatch) {
      // For escape sequences, match \<And> followed by variable names until the dot
      varMatch = goalLine.match(/\\<And>([^.]+?)\./);
    }
    
    if (varMatch) {
      const varList = varMatch[1].trim();
      console.log('[ProofStateCompletion] Variable list raw:', varList);
      // Split by whitespace and filter out empty strings and Isabelle markup
      const vars = varList.split(/\s+/)
        .filter(v => v.length > 0 && !v.startsWith('\\<') && !v.includes('>'));
      variables.push(...vars);
      console.log('[ProofStateCompletion] Extracted variables:', variables);
    } else {
      console.log('[ProofStateCompletion] No variables found');
    }

    // Extract assumptions (parts before ⟹ or \<Longrightarrow>)
    const assumptions: string[] = [];
    // Split by both Unicode and escape sequence
    let parts = goalLine.split(/⟹|\\<Longrightarrow>/);
    
    console.log('[ProofStateCompletion] Split into', parts.length, 'parts');
    console.log('[ProofStateCompletion] Parts:', parts);
    
    if (parts.length > 1) {
      // Take all parts except the last one (which is the conclusion)
      for (let i = 0; i < parts.length - 1; i++) {
        let assumption = parts[i].trim();
        // Remove the variable binding part (⋀x. or \<And>x. ) if it's at the start
        assumption = assumption.replace(/⋀[^.]+\.\s*/, '');
        assumption = assumption.replace(/\\<And>[^.]+\.\s*/, '');
        if (assumption) {
          console.log('[ProofStateCompletion] Found assumption:', assumption);
          assumptions.push(assumption);
        }
      }
    } else {
      console.log('[ProofStateCompletion] No assumptions found (no implication)');
    }

    const result = { variables, assumptions };
    console.log('[ProofStateCompletion] Parse result:', JSON.stringify(result));
    return result;
  }

  /**
   * Generate snippet with fix and assume statements
   * @param parsed Parsed variables and assumptions
   * @param baseIndent Base indentation from proof/case/next line
   * @param isCase Whether this is for a case statement (affects indentation)
   *               - case: same indentation as case line
   *               - proof/next: add 2 spaces extra indentation
   */
  private generateSnippet(parsed: { variables: string[], assumptions: string[] }, baseIndent: string, isCase: boolean = false): string {
    const lines: string[] = [];
    let tabStopIndex = 1;
    
    // For 'proof', add 2 spaces extra indentation; for 'case', use same indentation
    const contentIndent = isCase ? baseIndent : baseIndent + '  ';

    // Add fix statement if there are variables
    if (parsed.variables.length > 0) {
      const varList = parsed.variables.join(' ');
      lines.push(`${contentIndent}fix ${varList}`);
    }

    // Add assume statements for each assumption
    if (parsed.assumptions.length > 0) {
      parsed.assumptions.forEach((assumption, index) => {
        const label = parsed.assumptions.length === 1 ? 'IH' : `IH${index + 1}`;
        // Convert Isabelle escape sequences to Unicode
        const unicodeAssumption = IsabelleSymbolConverter.convertToUnicode(assumption, this.extensionPath);
        lines.push(`${contentIndent}assume ${label}: "${unicodeAssumption}"`);
      });
    }

    // Add a tab stop at the end for the user to continue
    lines.push(`${contentIndent}\${${tabStopIndex}:show ?thesis sorry}`);

    return lines.join('\n');
  }
}

/**
 * Completion provider for dedenting after 'by' statements
 * Reduces indentation by 2 spaces when previous line starts with 'by'
 */
export class ByDedentCompletionProvider implements CompletionItemProvider {
  provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] {
    // Check if we're at the start of a line (only whitespace before cursor)
    const currentLineText = document.lineAt(position.line).text;
    const textBeforeCursor = currentLineText.substring(0, position.character);
    
    if (textBeforeCursor.trim() !== '') {
      return [];
    }

    // Check if previous line exists and starts with 'by'
    if (position.line === 0) {
      return [];
    }

    const previousLine = document.lineAt(position.line - 1).text;
    const trimmedPreviousLine = previousLine.trim();
    
    if (!trimmedPreviousLine.startsWith('by ') && trimmedPreviousLine !== 'by') {
      return [];
    }

    // Get the indentation of the previous line
    const previousIndent = previousLine.match(/^(\s*)/)?.[1] || '';
    
    // If previous line has at least 2 spaces of indentation, dedent by 2 spaces
    if (previousIndent.length >= 2) {
      const newIndent = previousIndent.substring(2); // Remove 2 spaces
      
      // Calculate the range to replace (from start of line to cursor)
      const rangeToReplace = new Range(
        new Position(position.line, 0),
        position
      );

      const item = new CompletionItem('dedent (after by)', CompletionItemKind.Text);
      item.insertText = newIndent;
      item.range = rangeToReplace;
      item.detail = 'Remove one level of indentation after by statement';
      item.documentation = 'Automatically dedents by 2 spaces after a line starting with "by"';
      item.sortText = '0'; // Make it appear first
      
      return [item];
    }

    return [];
  }
}

/**
 * Completion provider for 'also have' pattern
 * When user types 'also ', suggests 'have "… = "' with cursor after '='
 */
export class AlsoHaveCompletionProvider implements CompletionItemProvider {
  provideCompletionItems(document: TextDocument, position: Position): CompletionItem[] {
    const currentLineText = document.lineAt(position.line).text;
    const textBeforeCursor = currentLineText.substring(0, position.character);
    
    // Check if the line ends with 'also ' (possibly with leading whitespace)
    const match = textBeforeCursor.match(/^(\s*)also\s$/);
    
    if (!match) {
      return [];
    }
    
    const indent = match[1]; // Capture the indentation
    
    // Calculate the range to replace (just the space after 'also')
    const rangeToReplace = new Range(
      new Position(position.line, position.character - 1),
      position
    );
    
    const item = new CompletionItem('have "… = "', CompletionItemKind.Snippet);
    // Use snippet with tab stop after the '='
    // $0 is the final cursor position
    item.insertText = new SnippetString(' have "… = $0"');
    item.range = rangeToReplace;
    item.detail = 'Insert have statement for also...have pattern';
    item.documentation = 'Automatically inserts \'have "… = "\' after typing "also " with cursor positioned after the equals sign';
    item.sortText = '0'; // Make it appear first
    
    return [item];
  }
}
