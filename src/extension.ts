/*  Author:     Makarius
    Author:     Denis Paluca, TU Muenchen
    Author:     Fabian Huch, TU Muenchen

Isabelle/VSCode extension.
*/

'use strict';

import * as platform from './platform'
import * as library from './library'
import * as file from './file'
import * as vscode_lib from './vscode_lib'
import * as decorations from './decorations'
import * as preview_panel from './preview_panel'
import * as lsp from './lsp'
import * as state_panel from './state_panel'
import { Uri, TextEditor, ViewColumn, Selection, Position, ExtensionContext, workspace, window,
  commands, ProgressLocation, MarkdownString, languages } from 'vscode'
import { LanguageClient, LanguageClientOptions, ServerOptions } from 'vscode-languageclient/node'
import { Output_View_Provider } from './output_view'
import { register_script_decorations } from './script_decorations'
import { TypeSignatureCompletionProvider, FunctionBodyCompletionProvider, TheoryStructureCompletionProvider, ProofOutlineCompletionProvider, ProofStateCompletionProvider, ByDedentCompletionProvider, AlsoHaveCompletionProvider } from './function_completion'


let last_caret_update: lsp.Caret_Update = {}


/* command-line arguments from "isabelle vscode" */

interface Args
{
  options?: string[],
  logic?: string,
  logic_ancestor?: string,
  logic_requirements?: boolean,
  sesion_dirs?: string[],
  include_sessions?: string[],
  modes?: string[],
  log_file?: string,
  verbose?: boolean,
  [key: string]: any
}

function print_value(x: any): string
{
  return typeof(x) === "string" ? x : JSON.stringify(x)
}

function isabelle_options(args: Args): string[]
{
  var result: string[] = []
  function add(s: string) { result.push(s) }
  function add_value(opt: string, slot: string)
  {
    const x = args[slot]
    if (x) { add(opt); add(print_value(x)) }
  }
  function add_values(opt: string, slot: string)
  {
    const xs: any[] = args[slot]
    if (xs) {
      for (const x of xs) { add(opt); add(print_value(x)) }
    }
  }

  add_value("-A", "logic_ancestor")
  if (args.logic) { add_value(args.logic_requirements ? "-R" : "-l", "logic") }

  add_values("-d", "session_dirs")
  add_values("-i", "include_sessions")
  add_values("-m", "modes")
  add_value("-L", "log_file")
  if (args.verbose) { add("-v") }

  const config = workspace.getConfiguration("isabelle.options")
  Object.keys(config).forEach(key =>
  {
    const value = config[key]
    if (typeof value == "string" && value !== "")
    {
      add("-o"); add(`${key}=${value}`)
    }
  })
  add_values("-o", "options")

  return result
}


/* activate extension */

export async function activate(context: ExtensionContext)
{
  /* server */

  try {
    const isabelle_home = library.getenv_strict("ISABELLE_HOME")
    const isabelle_tool = isabelle_home + "/bin/isabelle"
    const args = JSON.parse(library.getenv("ISABELLE_VSCODIUM_ARGS") || "{}")

      // If there are no open Isabelle-related files, defer server startup until one is opened.
      const relevantLangs = new Set(['isabelle', 'isabelle-ml', 'bibtex'])

      const server_opts = isabelle_options(args)

      async function startServer() {
        const server_options: ServerOptions =
          platform.is_windows() ?
            { command: file.cygwin_bash(),
              args: ["-l", isabelle_tool, "vscode_server"].concat(server_opts) } :
            { command: isabelle_tool,
              args: ["vscode_server"].concat(server_opts) }

        const language_client_options: LanguageClientOptions = {
          documentSelector: [
            { language: "isabelle", scheme: vscode_lib.file_scheme },
            { language: "isabelle-ml", scheme: vscode_lib.file_scheme },
            { language: "bibtex", scheme: vscode_lib.file_scheme }
          ],
          middleware: {
            provideHover: async (document, position, token, next) => {
              const result = await next(document, position, token)
              if (result && result.contents) {
                // Convert symbols in hover contents
                const symbolConverter = new (await import('./symbol_converter')).SymbolConverter(context.extensionUri.fsPath)

                if (Array.isArray(result.contents)) {
                  for (let i = 0; i < result.contents.length; i++) {
                    const content = result.contents[i]
                    if (typeof content === 'string') {
                      result.contents[i] = await symbolConverter.convertSymbols(content)
                    } else if (content && typeof content === 'object' && 'value' in content) {
                      const convertedValue = await symbolConverter.convertSymbols((content as any).value)
                      result.contents[i] = new MarkdownString(convertedValue)
                    }
                  }
                } else if (typeof result.contents === 'string') {
                  result.contents = await symbolConverter.convertSymbols(result.contents) as any
                } else if (result.contents && typeof result.contents === 'object' && 'value' in result.contents) {
                  const convertedValue = await symbolConverter.convertSymbols((result.contents as any).value)
                  result.contents = new MarkdownString(convertedValue) as any
                }
              }
              return result
            },
            handleDiagnostics: async (uri, diagnostics, next) => {
              const symbolConverter = new (await import('./symbol_converter')).SymbolConverter(context.extensionUri.fsPath)

              const convertedDiagnostics = []
              for (const diagnostic of diagnostics) {
                const convertedDiagnostic = { ...diagnostic }
                if (convertedDiagnostic.message) {
                  convertedDiagnostic.message = await symbolConverter.convertSymbols(convertedDiagnostic.message)
                }
                convertedDiagnostics.push(convertedDiagnostic)
              }

              return next(uri, convertedDiagnostics)
            }
          }
        }

        const language_client = new LanguageClient("Isabelle", server_options, language_client_options, false)

        window.withProgress({location: ProgressLocation.Notification, cancellable: false},
          async (progress) =>
            {
              progress.report({
                message: "Waiting for Isabelle language server..."
              })
              await language_client.start()
            })

        /* decorations */

        decorations.setup(context)
        context.subscriptions.push(
          workspace.onDidChangeConfiguration(() => decorations.setup(context)),
          workspace.onDidChangeTextDocument(event => decorations.touch_document(event.document)),
          window.onDidChangeActiveTextEditor(editor => { if (editor) decorations.update_editor(editor) }),
          workspace.onDidCloseTextDocument(decorations.close_document))

        language_client.start().then(() =>
          language_client.onNotification(lsp.decoration_type, async (decorationData) => {
            await decorations.apply_decoration(decorationData)
          }))

        /* super-/subscript decorations */

        register_script_decorations(context)

        /* caret handling */

        function update_caret()
        {
          const editor = window.activeTextEditor
          let caret_update: lsp.Caret_Update = {}
          if (editor) {
            const uri = editor.document.uri
            const cursor = editor.selection.active
            if (vscode_lib.is_file(uri) && cursor)
              caret_update = { uri: uri.toString(), line: cursor.line, character: cursor.character }
          }
          if (last_caret_update !== caret_update) {
            if (caret_update.uri) {
              language_client.sendNotification(lsp.caret_update_type, caret_update)
            }
            last_caret_update = caret_update
          }
        }

        function goto_file(caret_update: lsp.Caret_Update)
        {
          function move_cursor(editor: TextEditor)
          {
            const pos = new Position(caret_update.line || 0, caret_update.character || 0)
            editor.selections = [new Selection(pos, pos)]
          }

          if (caret_update.uri) {
            workspace.openTextDocument(Uri.parse(caret_update.uri)).then(document =>
            {
              const editor = vscode_lib.find_file_editor(document.uri)
              const column = editor ? editor.viewColumn : ViewColumn.One
              window.showTextDocument(document, column, !caret_update.focus).then(move_cursor)
            })
          }
        }

        language_client.start().then(() =>
        {
          context.subscriptions.push(
            window.onDidChangeActiveTextEditor(update_caret),
            window.onDidChangeTextEditorSelection(update_caret))
          update_caret()

          language_client.onNotification(lsp.caret_update_type, goto_file)
        })

        /* dynamic output */

        const provider = new Output_View_Provider(context.extensionUri, language_client)
        const proofOutlineProvider = new ProofOutlineCompletionProvider(context.extensionPath);
        const proofStateProvider = new ProofStateCompletionProvider(context.extensionPath);
        
        // Set proof outline provider reference to avoid conflicts
        proofStateProvider.setProofOutlineProvider(proofOutlineProvider);

        context.subscriptions.push(
          window.registerWebviewViewProvider(Output_View_Provider.view_type, provider))

        language_client.start().then(() =>
        {
          language_client.onNotification(lsp.dynamic_output_type,
            async params => {
              await provider.update_content(params.content);

              const content = params.content;
              
              // Extract proof outline if present (priority 1)
              if (content && content.includes('Proof outline with cases:')) {
                const match = content.match(/Proof outline with cases:\s*([\s\S]*?)(?=\n\n|\n*$)/);
                if (match && match[1]) {
                  // Associate the proof outline with the last known caret position
                  proofOutlineProvider.updateProofOutline(match[1].trim(), last_caret_update);
                }
              }
              
              // Extract goal for fix/assume completion (priority 2)
              // This is also sent via dynamic_output_type, not state_output_type
              if (content && content.includes('goal (')) {
                console.log('[ProofState] Found goal in dynamic output');
                const goalMatch = content.match(/goal\s*\([^)]*\):\s*([\s\S]*?)(?=\n\n|$)/);
                console.log('[ProofState] Goal match found:', !!goalMatch);
                
                if (goalMatch && goalMatch[1]) {
                  const goalContent = goalMatch[1].trim();
                  console.log('[ProofState] Extracted goal (first 200 chars):', goalContent.substring(0, 200));
                  console.log('[ProofState] Caret position:', last_caret_update);
                  
                  // Store goal with current caret position
                  proofStateProvider.updateGoal(goalContent, last_caret_update);
                  console.log('[ProofState] Goal cached successfully');
                } else {
                  console.log('[ProofState] No goal content found after match');
                }
              }
            })

          language_client.onNotification(lsp.state_output_type,
            async params => {
              console.log('[ProofState] Received state_output_type notification');
              console.log('[ProofState] Content length:', params.content?.length || 0);
              
              await provider.update_proof_state(params.content);
              
              // Always try to extract and cache goal if present
              // We don't check the current line here because:
              // 1. The user might press Enter right after typing 'case (Suc n)' or 'next', moving the cursor to the next line
              // 2. The completion provider will check if the previous line contains 'proof', 'case', or 'next'
              if (params.content) {
                console.log('[ProofState] Extracting goal from content...');
                
                // Extract the first goal from the state output
                const goalMatch = params.content.match(/goal\s*\([^)]*\):\s*([\s\S]*?)(?=\n\n|$)/);
                console.log('[ProofState] Goal match found:', !!goalMatch);
                
                if (goalMatch && goalMatch[1]) {
                  const goalContent = goalMatch[1].trim();
                  console.log('[ProofState] Extracted goal (first 100 chars):', goalContent.substring(0, 100));
                  console.log('[ProofState] Caret position:', last_caret_update);
                  
                  // Store goal with current caret position
                  proofStateProvider.updateGoal(goalContent, last_caret_update);
                  console.log('[ProofState] Goal cached successfully');
                } else {
                  console.log('[ProofState] No goal found in content');
                  // Clear cache if no goal is present
                  proofStateProvider.updateGoal(null);
                }
              } else {
                console.log('[ProofState] No content in params');
              }
            })

          // Monitor cursor changes to ensure proof state is updated
          context.subscriptions.push(
            window.onDidChangeTextEditorSelection(async () => {
              // Give server time to send updates, then check if proof state should be cleared
              setTimeout(async () => {
                await provider.check_and_clear_old_proof_state(1500)
                // Also clear proof-outline cache if the caret moved away from the proof
                try {
                  proofOutlineProvider.clearIfCaretMoved(last_caret_update)
                  proofStateProvider.clearIfCaretMoved(last_caret_update)
                } catch (e) {
                  // ignore
                }
              }, 500)
            }))
        })

        /* state panel */

        context.subscriptions.push(
          commands.registerCommand("isabelle.state", uri => state_panel.init(uri)))

        language_client.start().then(() => state_panel.setup(context, language_client))

        /* preview panel */

        context.subscriptions.push(
          commands.registerCommand("isabelle.preview", uri => preview_panel.request(uri, false)),
          commands.registerCommand("isabelle.preview-split", uri => preview_panel.request(uri, true)))

        language_client.start().then(() => preview_panel.setup(context, language_client))

        /* function definition completion */

        const functionBodyProvider = new FunctionBodyCompletionProvider();
        const theoryStructureProvider = new TheoryStructureCompletionProvider();
        const byDedentProvider = new ByDedentCompletionProvider();
        const alsoHaveProvider = new AlsoHaveCompletionProvider();

        context.subscriptions.push(
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            new TypeSignatureCompletionProvider(),
            ' '  // Trigger on space after ::
          ),
          // Register with newline trigger for automatic completion after line break
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            functionBodyProvider,
            '\n'  // Trigger on newline
          ),
          // Register without trigger characters to support manual completion (Ctrl+Space) everywhere including inside strings
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            functionBodyProvider
          ),
          // Theory structure completion (theory -> imports -> begin)
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            theoryStructureProvider,
            '\n', 't', 'T', ' '  // Trigger on newline, 't', 'T', and space
          ),
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            theoryStructureProvider
          ),
          // Proof outline completion (from Isabelle output)
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            proofOutlineProvider,
            '\n'  // Trigger on newline after proof
          ),
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            proofOutlineProvider
          ),
          // Proof state completion (fix/assume from goal)
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            proofStateProvider,
            '\n'  // Trigger on newline after proof/case
          ),
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            proofStateProvider
          ),
          // By dedent completion (reduce indentation after 'by')
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            byDedentProvider,
            '\n'  // Trigger on newline after 'by'
          ),
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            byDedentProvider
          ),
          // Also have completion (suggest 'have "… = "' after 'also ')
          languages.registerCompletionItemProvider(
            { scheme: 'file', language: 'isabelle' },
            alsoHaveProvider,
            ' '  // Trigger on space after 'also'
          )
        )

        /* spell checker */

        language_client.start().then(() =>
        {
          context.subscriptions.push(
            commands.registerCommand("isabelle.include-word", uri =>
              language_client.sendNotification(lsp.include_word_type)),
            commands.registerCommand("isabelle.include-word-permanently", uri =>
              language_client.sendNotification(lsp.include_word_permanently_type)),
            commands.registerCommand("isabelle.exclude-word", uri =>
              language_client.sendNotification(lsp.exclude_word_type)),
            commands.registerCommand("isabelle.exclude-word-permanently", uri =>
              language_client.sendNotification(lsp.exclude_word_permanently_type)),
            commands.registerCommand("isabelle.reset-words", uri =>
              language_client.sendNotification(lsp.reset_words_type)))
        })

        /* start server */

        language_client.start()
        context.subscriptions.push({
          dispose: () => language_client.stop()
        })
      }

      const hasOpenIsabelle = window.visibleTextEditors.some(editor =>
        editor.document && relevantLangs.has(editor.document.languageId)) ||
        workspace.textDocuments.some(doc => relevantLangs.has(doc.languageId))

      if (hasOpenIsabelle) {
        startServer().catch(err => console.error('Failed to start Isabelle server', err))
      } else {
        const disposable = workspace.onDidOpenTextDocument(doc => {
          if (relevantLangs.has(doc.languageId)) {
            disposable.dispose()
            startServer().catch(err => console.error('Failed to start Isabelle server', err))
          }
        })
        context.subscriptions.push(disposable)
      }
  }
  catch (exn) {
    window.showErrorMessage(String(exn))
  }
}


export function deactivate() { }
