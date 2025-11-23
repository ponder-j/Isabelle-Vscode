/*  Author:     Makarius
    Author:     Denis Paluca, TU Muenchen
    Author:     Fabian Huch, TU Muenchen

Isabelle/VSCode extension.
*/
'use strict';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const platform = __importStar(require("./platform"));
const library = __importStar(require("./library"));
const file = __importStar(require("./file"));
const vscode_lib = __importStar(require("./vscode_lib"));
const decorations = __importStar(require("./decorations"));
const preview_panel = __importStar(require("./preview_panel"));
const lsp = __importStar(require("./lsp"));
const state_panel = __importStar(require("./state_panel"));
const vscode_1 = require("vscode");
const node_1 = require("vscode-languageclient/node");
const output_view_1 = require("./output_view");
const script_decorations_1 = require("./script_decorations");
const function_completion_1 = require("./function_completion");
let last_caret_update = {};
function print_value(x) {
    return typeof (x) === "string" ? x : JSON.stringify(x);
}
function isabelle_options(args) {
    var result = [];
    function add(s) { result.push(s); }
    function add_value(opt, slot) {
        const x = args[slot];
        if (x) {
            add(opt);
            add(print_value(x));
        }
    }
    function add_values(opt, slot) {
        const xs = args[slot];
        if (xs) {
            for (const x of xs) {
                add(opt);
                add(print_value(x));
            }
        }
    }
    add_value("-A", "logic_ancestor");
    if (args.logic) {
        add_value(args.logic_requirements ? "-R" : "-l", "logic");
    }
    add_values("-d", "session_dirs");
    add_values("-i", "include_sessions");
    add_values("-m", "modes");
    add_value("-L", "log_file");
    if (args.verbose) {
        add("-v");
    }
    const config = vscode_1.workspace.getConfiguration("isabelle.options");
    Object.keys(config).forEach(key => {
        const value = config[key];
        if (typeof value == "string" && value !== "") {
            add("-o");
            add(`${key}=${value}`);
        }
    });
    add_values("-o", "options");
    return result;
}
/* activate extension */
async function activate(context) {
    /* Copy snippets to workspace .vscode folder */
    async function setupWorkspaceSnippets() {
        // Only setup if there's a workspace folder
        if (!vscode_1.workspace.workspaceFolders || vscode_1.workspace.workspaceFolders.length === 0) {
            return;
        }
        try {
            const workspaceRoot = vscode_1.workspace.workspaceFolders[0].uri;
            const vscodeDir = vscode_1.Uri.joinPath(workspaceRoot, '.vscode');
            const targetSnippetsFile = vscode_1.Uri.joinPath(vscodeDir, 'isabelle.code-snippets');
            // Check if snippets file already exists
            try {
                await vscode_1.workspace.fs.stat(targetSnippetsFile);
                // File exists, don't overwrite
                return;
            }
            catch {
                // File doesn't exist, proceed with copy
            }
            // Create .vscode directory if it doesn't exist
            try {
                await vscode_1.workspace.fs.createDirectory(vscodeDir);
            }
            catch {
                // Directory might already exist, that's fine
            }
            // Copy snippets file from extension to workspace
            const sourceSnippetsFile = vscode_1.Uri.file(context.asAbsolutePath('snippets/isabelle.code-snippets'));
            await vscode_1.workspace.fs.copy(sourceSnippetsFile, targetSnippetsFile, { overwrite: false });
            console.log('Isabelle snippets copied to workspace .vscode folder');
        }
        catch (error) {
            console.error('Failed to setup workspace snippets:', error);
        }
    }
    // Setup snippets on activation
    await setupWorkspaceSnippets();
    /* server */
    try {
        const isabelle_home = library.getenv_strict("ISABELLE_HOME");
        const isabelle_tool = isabelle_home + "/bin/isabelle";
        const args = JSON.parse(library.getenv("ISABELLE_VSCODIUM_ARGS") || "{}");
        // If there are no open Isabelle-related files, defer server startup until one is opened.
        const relevantLangs = new Set(['isabelle', 'isabelle-ml', 'bibtex']);
        const server_opts = isabelle_options(args);
        async function startServer() {
            const server_options = platform.is_windows() ?
                { command: file.cygwin_bash(),
                    args: ["-l", isabelle_tool, "vscode_server"].concat(server_opts) } :
                { command: isabelle_tool,
                    args: ["vscode_server"].concat(server_opts) };
            const language_client_options = {
                documentSelector: [
                    { language: "isabelle", scheme: vscode_lib.file_scheme },
                    { language: "isabelle-ml", scheme: vscode_lib.file_scheme },
                    { language: "bibtex", scheme: vscode_lib.file_scheme }
                ],
                middleware: {
                    provideHover: async (document, position, token, next) => {
                        const result = await next(document, position, token);
                        if (result && result.contents) {
                            // Convert symbols in hover contents
                            const symbolConverter = new (await Promise.resolve().then(() => __importStar(require('./symbol_converter')))).SymbolConverter(context.extensionUri.fsPath);
                            if (Array.isArray(result.contents)) {
                                for (let i = 0; i < result.contents.length; i++) {
                                    const content = result.contents[i];
                                    if (typeof content === 'string') {
                                        result.contents[i] = await symbolConverter.convertSymbols(content);
                                    }
                                    else if (content && typeof content === 'object' && 'value' in content) {
                                        const convertedValue = await symbolConverter.convertSymbols(content.value);
                                        result.contents[i] = new vscode_1.MarkdownString(convertedValue);
                                    }
                                }
                            }
                            else if (typeof result.contents === 'string') {
                                result.contents = await symbolConverter.convertSymbols(result.contents);
                            }
                            else if (result.contents && typeof result.contents === 'object' && 'value' in result.contents) {
                                const convertedValue = await symbolConverter.convertSymbols(result.contents.value);
                                result.contents = new vscode_1.MarkdownString(convertedValue);
                            }
                        }
                        return result;
                    },
                    handleDiagnostics: async (uri, diagnostics, next) => {
                        const symbolConverter = new (await Promise.resolve().then(() => __importStar(require('./symbol_converter')))).SymbolConverter(context.extensionUri.fsPath);
                        const convertedDiagnostics = [];
                        for (const diagnostic of diagnostics) {
                            const convertedDiagnostic = { ...diagnostic };
                            if (convertedDiagnostic.message) {
                                convertedDiagnostic.message = await symbolConverter.convertSymbols(convertedDiagnostic.message);
                            }
                            convertedDiagnostics.push(convertedDiagnostic);
                        }
                        return next(uri, convertedDiagnostics);
                    }
                }
            };
            const language_client = new node_1.LanguageClient("Isabelle", server_options, language_client_options, false);
            vscode_1.window.withProgress({ location: vscode_1.ProgressLocation.Notification, cancellable: false }, async (progress) => {
                progress.report({
                    message: "Waiting for Isabelle language server..."
                });
                await language_client.start();
            });
            /* decorations */
            decorations.setup(context);
            context.subscriptions.push(vscode_1.workspace.onDidChangeConfiguration(() => decorations.setup(context)), vscode_1.workspace.onDidChangeTextDocument(event => decorations.touch_document(event.document)), vscode_1.window.onDidChangeActiveTextEditor(editor => { if (editor)
                decorations.update_editor(editor); }), vscode_1.workspace.onDidCloseTextDocument(decorations.close_document));
            language_client.start().then(() => language_client.onNotification(lsp.decoration_type, async (decorationData) => {
                await decorations.apply_decoration(decorationData);
            }));
            /* super-/subscript decorations */
            (0, script_decorations_1.register_script_decorations)(context);
            /* caret handling */
            function update_caret() {
                const editor = vscode_1.window.activeTextEditor;
                let caret_update = {};
                if (editor) {
                    const uri = editor.document.uri;
                    const cursor = editor.selection.active;
                    if (vscode_lib.is_file(uri) && cursor)
                        caret_update = { uri: uri.toString(), line: cursor.line, character: cursor.character };
                }
                if (last_caret_update !== caret_update) {
                    if (caret_update.uri) {
                        language_client.sendNotification(lsp.caret_update_type, caret_update);
                    }
                    last_caret_update = caret_update;
                }
            }
            function goto_file(caret_update) {
                function move_cursor(editor) {
                    const pos = new vscode_1.Position(caret_update.line || 0, caret_update.character || 0);
                    editor.selections = [new vscode_1.Selection(pos, pos)];
                }
                if (caret_update.uri) {
                    vscode_1.workspace.openTextDocument(vscode_1.Uri.parse(caret_update.uri)).then(document => {
                        const editor = vscode_lib.find_file_editor(document.uri);
                        const column = editor ? editor.viewColumn : vscode_1.ViewColumn.One;
                        vscode_1.window.showTextDocument(document, column, !caret_update.focus).then(move_cursor);
                    });
                }
            }
            language_client.start().then(() => {
                context.subscriptions.push(vscode_1.window.onDidChangeActiveTextEditor(update_caret), vscode_1.window.onDidChangeTextEditorSelection(update_caret));
                update_caret();
                language_client.onNotification(lsp.caret_update_type, goto_file);
            });
            /* dynamic output */
            const provider = new output_view_1.Output_View_Provider(context.extensionUri, language_client);
            const proofOutlineProvider = new function_completion_1.ProofOutlineCompletionProvider(context.extensionPath);
            const proofStateProvider = new function_completion_1.ProofStateCompletionProvider(context.extensionPath);
            // Set proof outline provider reference to avoid conflicts
            proofStateProvider.setProofOutlineProvider(proofOutlineProvider);
            context.subscriptions.push(vscode_1.window.registerWebviewViewProvider(output_view_1.Output_View_Provider.view_type, provider));
            language_client.start().then(() => {
                language_client.onNotification(lsp.dynamic_output_type, async (params) => {
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
                    else if (content) {
                        // Clear proof outline cache if no proof outline is present
                        proofOutlineProvider.updateProofOutline(null);
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
                        }
                        else {
                            console.log('[ProofState] No goal content found after match');
                        }
                    }
                });
                language_client.onNotification(lsp.state_output_type, async (params) => {
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
                        }
                        else {
                            console.log('[ProofState] No goal found in content');
                            // Clear cache if no goal is present
                            proofStateProvider.updateGoal(null);
                        }
                    }
                    else {
                        console.log('[ProofState] No content in params');
                    }
                });
                // Monitor cursor changes to ensure proof state is updated
                context.subscriptions.push(vscode_1.window.onDidChangeTextEditorSelection(async () => {
                    // Give server time to send updates, then check if proof state should be cleared
                    setTimeout(async () => {
                        await provider.check_and_clear_old_proof_state(1500);
                        // Also clear proof-outline cache if the caret moved away from the proof
                        try {
                            proofOutlineProvider.clearIfCaretMoved(last_caret_update);
                            proofStateProvider.clearIfCaretMoved(last_caret_update);
                        }
                        catch (e) {
                            // ignore
                        }
                    }, 500);
                }));
            });
            /* state panel */
            context.subscriptions.push(vscode_1.commands.registerCommand("isabelle.state", uri => state_panel.init(uri)));
            language_client.start().then(() => state_panel.setup(context, language_client));
            /* preview panel */
            context.subscriptions.push(vscode_1.commands.registerCommand("isabelle.preview", uri => preview_panel.request(uri, false)), vscode_1.commands.registerCommand("isabelle.preview-split", uri => preview_panel.request(uri, true)));
            language_client.start().then(() => preview_panel.setup(context, language_client));
            /* function definition completion */
            const functionBodyProvider = new function_completion_1.FunctionBodyCompletionProvider();
            const theoryStructureProvider = new function_completion_1.TheoryStructureCompletionProvider();
            const byDedentProvider = new function_completion_1.ByDedentCompletionProvider();
            const alsoHaveProvider = new function_completion_1.AlsoHaveCompletionProvider();
            context.subscriptions.push(vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, new function_completion_1.TypeSignatureCompletionProvider(), ' ' // Trigger on space after ::
            ), 
            // Register with newline trigger for automatic completion after line break
            vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, functionBodyProvider, '\n' // Trigger on newline
            ), 
            // Register without trigger characters to support manual completion (Ctrl+Space) everywhere including inside strings
            vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, functionBodyProvider), 
            // Theory structure completion (theory -> imports -> begin)
            vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, theoryStructureProvider, '\n', 't', 'T', ' ' // Trigger on newline, 't', 'T', and space
            ), vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, theoryStructureProvider), 
            // Proof outline completion (from Isabelle output)
            vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, proofOutlineProvider, '\n' // Trigger on newline after proof
            ), vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, proofOutlineProvider), 
            // Proof state completion (fix/assume from goal)
            vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, proofStateProvider, '\n' // Trigger on newline after proof/case
            ), vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, proofStateProvider), 
            // By dedent completion (reduce indentation after 'by')
            vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, byDedentProvider, '\n' // Trigger on newline after 'by'
            ), vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, byDedentProvider), 
            // Also have completion (suggest 'have "… = "' after 'also ')
            vscode_1.languages.registerCompletionItemProvider({ scheme: 'file', language: 'isabelle' }, alsoHaveProvider, ' ' // Trigger on space after 'also'
            ));
            /* symbol conversion */
            async function convertSymbolsToUnicode() {
                const editor = vscode_1.window.activeTextEditor;
                if (!editor || editor.document.languageId !== 'isabelle') {
                    vscode_1.window.showWarningMessage('Please open an Isabelle (.thy) file first');
                    return;
                }
                try {
                    // Load symbol mappings from snippets file
                    const snippetsPath = context.asAbsolutePath('snippets/isabelle-snippets');
                    const snippetsContent = await vscode_1.workspace.fs.readFile(vscode_1.Uri.file(snippetsPath));
                    const symbolMap = JSON.parse(snippetsContent.toString());
                    // Get document text
                    const document = editor.document;
                    const fullText = document.getText();
                    // Replace all symbols
                    let convertedText = fullText;
                    let replacementCount = 0;
                    for (const [isabelleSymbol, unicode] of Object.entries(symbolMap)) {
                        const regex = new RegExp(isabelleSymbol.replace(/\\/g, '\\\\'), 'g');
                        const matches = convertedText.match(regex);
                        if (matches) {
                            replacementCount += matches.length;
                            convertedText = convertedText.replace(regex, unicode);
                        }
                    }
                    if (replacementCount > 0) {
                        // Apply the changes
                        const edit = new vscode_1.WorkspaceEdit();
                        const fullRange = new vscode_1.Range(document.positionAt(0), document.positionAt(fullText.length));
                        edit.replace(document.uri, fullRange, convertedText);
                        await vscode_1.workspace.applyEdit(edit);
                        vscode_1.window.showInformationMessage(`Converted ${replacementCount} symbol(s) to Unicode`);
                    }
                    else {
                        vscode_1.window.showInformationMessage('No Isabelle symbols found to convert');
                    }
                }
                catch (error) {
                    vscode_1.window.showErrorMessage(`Failed to convert symbols: ${error}`);
                }
            }
            context.subscriptions.push(vscode_1.commands.registerCommand('isabelle.convert-symbols', convertSymbolsToUnicode));
            /* spell checker */
            language_client.start().then(() => {
                context.subscriptions.push(vscode_1.commands.registerCommand("isabelle.include-word", uri => language_client.sendNotification(lsp.include_word_type)), vscode_1.commands.registerCommand("isabelle.include-word-permanently", uri => language_client.sendNotification(lsp.include_word_permanently_type)), vscode_1.commands.registerCommand("isabelle.exclude-word", uri => language_client.sendNotification(lsp.exclude_word_type)), vscode_1.commands.registerCommand("isabelle.exclude-word-permanently", uri => language_client.sendNotification(lsp.exclude_word_permanently_type)), vscode_1.commands.registerCommand("isabelle.reset-words", uri => language_client.sendNotification(lsp.reset_words_type)));
            });
            /* start server */
            language_client.start();
            context.subscriptions.push({
                dispose: () => language_client.stop()
            });
        }
        const hasOpenIsabelle = vscode_1.window.visibleTextEditors.some(editor => editor.document && relevantLangs.has(editor.document.languageId)) ||
            vscode_1.workspace.textDocuments.some(doc => relevantLangs.has(doc.languageId));
        if (hasOpenIsabelle) {
            startServer().catch(err => console.error('Failed to start Isabelle server', err));
        }
        else {
            const disposable = vscode_1.workspace.onDidOpenTextDocument(doc => {
                if (relevantLangs.has(doc.languageId)) {
                    disposable.dispose();
                    startServer().catch(err => console.error('Failed to start Isabelle server', err));
                }
            });
            context.subscriptions.push(disposable);
        }
    }
    catch (exn) {
        vscode_1.window.showErrorMessage(String(exn));
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map