/*  Author:     Denis Paluca, TU Muenchen

Isabelle output panel as web view.
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
exports.Output_View_Provider = void 0;
exports.get_webview_html = get_webview_html;
exports.open_webview_link = open_webview_link;
const vscode_1 = require("vscode");
const decorations_1 = require("./decorations");
const vscode_lib = __importStar(require("./vscode_lib"));
const path = __importStar(require("path"));
const lsp = __importStar(require("./lsp"));
const symbol_converter_1 = require("./symbol_converter");
class Output_View_Provider {
    constructor(_extension_uri, _language_client) {
        this._extension_uri = _extension_uri;
        this._language_client = _language_client;
        this.content = '';
        this.symbolConverter = new symbol_converter_1.SymbolConverter(this._extension_uri.fsPath);
    }
    async resolveWebviewView(view, context, _token) {
        this._view = view;
        view.webview.options = {
            // Allow scripts in the webview
            enableScripts: true,
            localResourceRoots: [
                this._extension_uri
            ]
        };
        // Convert symbols in initial content if any
        const convertedContent = await this.symbolConverter.convertSymbols(this.content);
        view.webview.html = this._get_html(convertedContent);
        view.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "open":
                    open_webview_link(message.link);
                    break;
                case "resize":
                    this._language_client.sendNotification(lsp.output_set_margin_type, { margin: message.margin });
                    break;
            }
        });
    }
    async update_content(content) {
        // Convert Isabelle symbols to Unicode
        const convertedContent = await this.symbolConverter.convertSymbols(content);
        if (!this._view) {
            this.content = convertedContent;
            return;
        }
        this._view.webview.html = this._get_html(convertedContent);
    }
    _get_html(content) {
        if (this._view?.webview) {
            return get_webview_html(content, this._view.webview, this._extension_uri.fsPath);
        }
        return "";
    }
}
exports.Output_View_Provider = Output_View_Provider;
Output_View_Provider.view_type = 'isabelle-output';
function open_webview_link(link) {
    const uri = vscode_1.Uri.parse(link);
    const line = Number(uri.fragment) || 0;
    const pos = new vscode_1.Position(line, 0);
    vscode_1.window.showTextDocument(uri.with({ fragment: '' }), {
        preserveFocus: false,
        selection: new vscode_1.Selection(pos, pos)
    });
}
function get_webview_html(content, webview, extension_path) {
    const script_uri = webview.asWebviewUri(vscode_1.Uri.file(path.join(extension_path, 'media', 'main.js')));
    const css_uri = webview.asWebviewUri(vscode_1.Uri.file(path.join(extension_path, 'media', 'vscode.css')));
    const font_uri = webview.asWebviewUri(vscode_1.Uri.file(path.join(extension_path, 'fonts', 'IsabelleDejaVuSansMono.ttf')));
    return `<!DOCTYPE html>
    <html lang='en'>
      <head>
        <meta charset='UTF-8'>
        <meta name='viewport' content='width=device-width, initial-scale=1.0'>
        <link href='${css_uri}' rel='stylesheet' type='text/css'>
        <style>
            @font-face {
                font-family: "Isabelle DejaVu Sans Mono";
                src: url(${font_uri});
            }
            ${_get_decorations()}
        </style>
        <title>Output</title>
      </head>
      <body>
        ${content}
        <script src='${script_uri}'></script>
      </body>
    </html>`;
}
function _get_decorations() {
    let style = [];
    for (const key of decorations_1.text_colors) {
        style.push(`body.vscode-light .${key} { color: ${vscode_lib.get_color(key, true)} }\n`);
        style.push(`body.vscode-dark .${key} { color: ${vscode_lib.get_color(key, false)} }\n`);
    }
    return style.join("");
}
//# sourceMappingURL=output_view.js.map