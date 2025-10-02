/*  Author:     Assistant

Symbol converter for Isabelle output - converts LaTeX-style symbols to Unicode.
*/

'use strict';

import * as fs from 'fs'
import * as path from 'path'

interface SymbolMapping {
  [key: string]: string
}

class SymbolConverter {
  private symbolMap: SymbolMapping = {}
  private subscriptMap: SymbolMapping = {}
  private superscriptMap: SymbolMapping = {}
  private initialized: boolean = false

  constructor(private extensionPath: string) {
    this.initializeControlSymbols()
  }

  // Initialize subscript/superscript mappings
  private initializeControlSymbols() {
    this.subscriptMap = {
      '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
      'a': 'ₐ', 'e': 'ₑ', 'h': 'ₕ', 'i': 'ᵢ', 'j': 'ⱼ', 'k': 'ₖ', 'l': 'ₗ', 'm': 'ₘ', 'n': 'ₙ',
      'o': 'ₒ', 'p': 'ₚ', 'r': 'ᵣ', 's': 'ₛ', 't': 'ₜ', 'u': 'ᵤ', 'v': 'ᵥ', 'x': 'ₓ'
    }

    this.superscriptMap = {
      '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
      'a': 'ᵃ', 'b': 'ᵇ', 'c': 'ᶜ', 'd': 'ᵈ', 'e': 'ᵉ', 'f': 'ᶠ', 'g': 'ᵍ', 'h': 'ʰ', 'i': 'ⁱ',
      'j': 'ʲ', 'k': 'ᵏ', 'l': 'ˡ', 'm': 'ᵐ', 'n': 'ⁿ', 'o': 'ᵒ', 'p': 'ᵖ', 'r': 'ʳ', 's': 'ˢ',
      't': 'ᵗ', 'u': 'ᵘ', 'v': 'ᵛ', 'w': 'ʷ', 'x': 'ˣ', 'y': 'ʸ', 'z': 'ᶻ'
    }

    // Add special control symbols not in snippets
    this.symbolMap['\\<^here>'] = '⌂'
  }

  // Initialize symbol mappings from snippets file
  private async initializeSymbolMap() {
    if (this.initialized) return

    try {
      const snippetsPath = path.join(this.extensionPath, '.vscode', 'isabelle.code-snippets')
      const snippetsContent = fs.readFileSync(snippetsPath, 'utf8')
      const snippets = JSON.parse(snippetsContent)

      // Extract symbol mappings from snippets
      for (const [key, value] of Object.entries(snippets)) {
        const snippet = value as any
        if (snippet.prefix && snippet.body && snippet.body[0]) {
          // Handle different prefix formats
          for (const prefix of snippet.prefix) {
            if (prefix.startsWith('\\\\') || prefix.startsWith('\\')) {
              // Convert \\symbol or \symbol to \<symbol> for Isabelle format
              const cleanPrefix = prefix.replace(/^\\\\?/, '')
              const isabelleSymbol = `\\<${cleanPrefix}>`
              this.symbolMap[isabelleSymbol] = snippet.body[0]
            }
          }
        }
      }

      this.initialized = true
    } catch (error) {
      console.error('Failed to initialize symbol map:', error)
    }
  }

  // Convert Isabelle symbols to Unicode
  async convertSymbols(text: string): Promise<string> {
    await this.initializeSymbolMap()

    let result = text

    // First, handle subscripts and superscripts before general symbol replacement
    // Handle subscripts: \<^sub>text (only convert until next space or symbol)
    result = result.replace(/\\<\^sub>(\w+)/g, (match, content) => {
      return this.convertToSubscript(content)
    })

    // Handle superscripts: \<^sup>text (only convert until next space or symbol)
    result = result.replace(/\\<\^sup>(\w+)/g, (match, content) => {
      return this.convertToSuperscript(content)
    })

    // Then handle regular symbol replacements
    for (const [symbol, unicode] of Object.entries(this.symbolMap)) {
      result = result.replace(new RegExp(this.escapeRegExp(symbol), 'g'), unicode)
    }

    return result
  }

  private convertToSubscript(text: string): string {
    return text.split('').map(char => this.subscriptMap[char] || char).join('')
  }

  private convertToSuperscript(text: string): string {
    return text.split('').map(char => this.superscriptMap[char] || char).join('')
  }

  // Utility function to escape special regex characters
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

export { SymbolConverter }