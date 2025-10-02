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
    /* server */
    try {
        const isabelle_home = library.getenv_strict("ISABELLE_HOME");
        const isabelle_tool = isabelle_home + "/bin/isabelle";
        const args = JSON.parse(library.getenv("ISABELLE_VSCODIUM_ARGS") || "{}");
        const server_opts = isabelle_options(args);
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
            ]
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
        language_client.start().then(() => language_client.onNotification(lsp.decoration_type, decorations.apply_decoration));
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
        context.subscriptions.push(vscode_1.window.registerWebviewViewProvider(output_view_1.Output_View_Provider.view_type, provider));
        language_client.start().then(() => {
            language_client.onNotification(lsp.dynamic_output_type, async (params) => await provider.update_content(params.content));
        });
        /* state panel */
        context.subscriptions.push(vscode_1.commands.registerCommand("isabelle.state", uri => state_panel.init(uri)));
        language_client.start().then(() => state_panel.setup(context, language_client));
        /* preview panel */
        context.subscriptions.push(vscode_1.commands.registerCommand("isabelle.preview", uri => preview_panel.request(uri, false)), vscode_1.commands.registerCommand("isabelle.preview-split", uri => preview_panel.request(uri, true)));
        language_client.start().then(() => preview_panel.setup(context, language_client));
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
    catch (exn) {
        vscode_1.window.showErrorMessage(String(exn));
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map